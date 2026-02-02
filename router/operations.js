const express = require("express")
const Shifts = require("../models/shifts");
const Sites = require("../models/sites")
const Users = require("../models/auth")
const dayjs = require("dayjs");
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { verifyToken } = require("../middlewares/auth")
const { cleanObjectValues } = require("../config/global");
const { getDistance } = require("../utils/locationUtils");


dayjs.extend(utc);
dayjs.extend(timezone);

const router = express.Router()

router.patch("/check-in/:id", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        const { id: shiftId } = req.params;
        const { latitude, longitude, timeZone = "UTC" } = cleanObjectValues(req.body);
        const { checkInTime } = req.query;

        // 1. Guard Identity & Duplicate Check
        const user = await Users.findOne({ uid });
        if (!user) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const alreadyActiveShift = await Shifts.findOne({ guardId: uid, liveStatus: "checkIn" });
        if (alreadyActiveShift) return res.status(400).json({ message: "You are already clocked into another active shift.", isError: true });

        const shift = await Shifts.findOne({ id: shiftId });
        if (!shift) return res.status(404).json({ message: "Shift not found.", isError: true });

        if (shift.liveStatus === "checkIn" || shift.liveStatus === "checkOut") {
            return res.status(400).json({ message: "Shift is already active or completed.", isError: true });
        }

        const site = await Sites.findOne({ id: shift.siteId }).lean();
        if (!site) return res.status(404).json({ message: "Assigned site not found.", isError: true });

        // 2. Geofence Validation Snapshot
        let isGeofenceVerified = true;
        let violationFlag = null;

        if (latitude && longitude && site.location) {
            const distance = getDistance(
                Number(latitude), Number(longitude),
                Number(site.location.lat), Number(site.location.lng)
            );

            if (distance > (site.clockInRadius || 100)) {
                isGeofenceVerified = false;
                violationFlag = "GEOFENCE_VIOLATION";
            }
        } else {
            return res.status(400).json({ message: "Location coordinates are required for clock-in.", isError: true });
        }


        let now;
        if (checkInTime) { now = dayjs(checkInTime).utc(); } else { now = dayjs().tz(timeZone).utc(true); }

        const shiftStartLocalAsUtc = dayjs(shift.start).tz(timeZone).utc(true);

        let punctualityStatus = "On-Time";
        if (now.isBefore(shiftStartLocalAsUtc.subtract(15, 'minute'))) { // 15 min buffer
            punctualityStatus = "Early";
        } else if (now.isAfter(shiftStartLocalAsUtc.add(15, 'minute'))) {
            punctualityStatus = "Late";
        }

        // 4. Atomic Status Updates
        // Save 'now' (Local-as-UTC) as actualStartTime to match database format request
        const actualStartTime = now.toDate();

        const updatedShift = await Shifts.findOneAndUpdate(
            { id: shiftId },
            {
                $set: {
                    status: "active",
                    liveStatus: "checkIn",
                    checkIn: actualStartTime,
                    actualStartTime,
                    clockInLocation: { lat: Number(latitude), lng: Number(longitude) },
                    isGeofenceVerified,
                    punctualityStatus,
                    violationDetails: violationFlag
                }
            },
            { new: true }
        );

        const guardUser = await Users.findOne({ uid: updatedShift.guardId }, 'fullName email uid');
        const shiftFormat = { ...updatedShift.toObject(), site: site, guard: guardUser }

        // 5. Real-time Notification
        const eventMessage = violationFlag ? `Clock-In Alert: Geofence Violation by ${guardUser.fullName}` : `Guard ${guardUser.fullName} clocked in (${punctualityStatus})`;
        req.io.emit('shift_status_updated', { shift: updatedShift, type: 'check_in', message: eventMessage });

        if (updatedShift.guardId && req.io) {
            req.io.to(updatedShift.guardId).emit('shift_check_in', { shift: shiftFormat, message: "Clock-in successful." });
        }

        res.status(200).json({ message: `Clock-in successful. Status: ${punctualityStatus}`, isError: false, shift: shiftFormat, geofenceVerified: isGeofenceVerified, timeDetails: { serverTime: now.format(), shiftStart: shiftStartLocalAsUtc.format(), diff: now.diff(shiftStartLocalAsUtc, 'minute') } });

    } catch (error) {
        console.error("Critical Check-In Error:", error);
        res.status(500).json({ message: "Server error during clock-in.", isError: true });
    }
});


router.post("/accept/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { uid } = req;

        const updatedShift = await Shifts.findOneAndUpdate(
            { id, guardId: uid },
            { $set: { status: "active", acceptedAt: dayjs().toDate() } },
            { new: true }
        );

        if (!updatedShift) { return res.status(404).json({ message: "Shift not found or you are not authorized to accept it.", isError: true }); }

        if (req.io) { req.io.emit('shift_accepted', { shiftId: id, guardId: uid, message: `Guard has accepted shift ${id}` }); }

        return res.status(200).json({ message: "Shift accepted successfully. Status is now 'awaiting'.", isError: false, shift: updatedShift });
    } catch (error) {
        console.error("Shift Acceptance Error:", error);
        return res.status(500).json({ message: "An internal server error occurred while accepting the shift.", isError: true, error: error.message });
    }
});

router.post("/reject/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { uid } = req;
        const { reason } = req.body;

        if (!reason) { return res.status(400).json({ message: "A reason for rejection is required.", isError: true }); }

        const updatedShift = await Shifts.findOneAndUpdate(
            { id, guardId: uid },
            { $set: { status: "rejected", rejectionReason: reason } },
            { new: true }
        );

        if (!updatedShift) { return res.status(404).json({ message: "Shift not found or you are not authorized to reject it.", isError: true }); }
        if (req.io) { req.io.emit('shift_rejected', { shiftId: id, guardId: uid, reason, message: `Guard has rejected shift ${id}` }); }

        return res.status(200).json({ message: "Shift rejected successfully. Status is now 'rejected'.", isError: false });
    } catch (error) {
        console.error("Shift Rejection Error:", error);
        return res.status(500).json({ message: "An internal server error occurred while rejecting the shift.", isError: true, error: error.message });
    }
});

router.patch("/check-out/:id", verifyToken, async (req, res) => {

    try {
        const { id: shiftId } = req.params;
        const { latitude, longitude, } = cleanObjectValues(req.body);

        // 1. Fetch Shift & site
        const shift = await Shifts.findOne({ id: shiftId });
        if (!shift) return res.status(404).json({ message: "Shift not found.", isError: true });

        if (shift.status !== "active") {
            return res.status(400).json({ message: "Only active shifts can be clocked out.", isError: true });
        }

        const site = await Sites.findOne({ id: shift.siteId }).lean();
        const guard = await Users.findOne({ uid: shift.guardId });

        // 2. Geofence Exit Validation
        let checkoutGeofenceStatus = "Verified";
        if (latitude && longitude && site.location) {
            const distance = getDistance(
                Number(latitude), Number(longitude),
                Number(site.location.lat), Number(site.location.lng)
            );
            if (distance > (site.clockInRadius || 100)) checkoutGeofenceStatus = "Violation";
        }

        // 3. Duration & Paid Hours Calculation
        const { checkOutTime } = req.query;
        // Trust client time if provided (to match user's device clock), otherwise server time
        const actualEndTime = checkOutTime ? dayjs(checkOutTime).utc().toDate() : dayjs().utc().toDate();

        const startTime = dayjs(shift.actualStartTime || shift.start).utc();
        const endTime = dayjs(actualEndTime).utc();

        // Calculate minutes difference
        const diffMinutes = endTime.diff(startTime, 'minute');
        const breakMinutes = shift.breakTime || 0;
        const netMinutes = Math.max(0, diffMinutes - breakMinutes);

        const paidHours = parseFloat((netMinutes / 60).toFixed(2));

        // Snapshot the guard's current rate
        const baseRate = guard.standardRate || guard.perHour || 0;
        const totalPay = parseFloat((paidHours * baseRate).toFixed(2));

        // 4. Update Shift
        const updatedShift = await Shifts.findOneAndUpdate(
            { id: shiftId },
            {
                $set: {
                    status: "completed",
                    liveStatus: "checkOut",
                    checkOut: actualEndTime,
                    actualEndTime,
                    clockOutLocation: { lat: Number(latitude), lng: Number(longitude) },
                    paidHours,
                    totalPayments: totalPay, // Legacy field for compatibility
                    financials: {
                        baseRate,
                        totalPay,
                        isApproved: false,
                        isPaid: false
                    },
                    violationDetails: checkoutGeofenceStatus === "Violation" ? "GEOFENCE_EXIT_VIOLATION" : shift.violationDetails
                }
            },
            { new: true }
        );

        const guardUser = await Users.findOne({ uid: updatedShift.guardId }, 'fullName email perHours uid');
        const shiftFormat = { ...updatedShift.toObject(), site, guard: guardUser }

        // 5. Real-time Notification
        const eventMessage = `Guard ${guardUser.fullName} clocked out. Final Hours: ${paidHours}`;

        // Broadcast to everyone (Dashboard)
        req.io.emit('shift_check_out', { shift: shiftFormat, message: eventMessage });
        req.io.emit('shift_status_updated', { shift: updatedShift, type: 'check_out', message: eventMessage });

        if (updatedShift.guardId && req.io) {
            req.io.to(updatedShift.guardId).emit('shift_check_out', { shift: shiftFormat, message: "Clock-out successful." });
        }

        res.status(200).json({ message: "Clock-out successful. Shift completed.", isError: false, shift: shiftFormat, paidHours, geofenceStatus: checkoutGeofenceStatus });

    } catch (error) {
        console.error("Critical Check-Out Error:", error);
        res.status(500).json({ message: "Server error during clock-out.", isError: true });
    }
});

module.exports = router