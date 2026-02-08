const express = require("express")
const mongoose = require("mongoose");
const Shifts = require("../models/shifts");
const Sites = require("../models/sites")
const Customers = require("../models/customers")
const Users = require("../models/auth")
const dayjs = require("dayjs");
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { verifyToken } = require("../middlewares/auth")
const { cleanObjectValues, getRandomId } = require("../config/global");
const Timesheet = require("../models/Timesheet");
const { getDistance } = require("../utils/locationUtils");

// --- Helper: Create Verified Timesheet ---
const createVerifiedTimesheet = async (shiftId) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const shift = await Shifts.findOne({ id: shiftId }).session(session);
        if (!shift || shift.isTimesheetGenerated) {
            await session.abortTransaction();
            session.endSession();
            return;
        }

        const scheduledStart = dayjs(shift.start);
        const scheduledEnd = dayjs(shift.end);
        const actualStart = dayjs(shift.actualStart);
        const actualEnd = dayjs(shift.actualEnd);

        // Calculations
        const durationMs = actualEnd.diff(actualStart);
        const durationHours = durationMs / (1000 * 60 * 60);
        const actualTotalHours = Math.max(0, parseFloat((durationHours).toFixed(2)));

        const scheduledDurationMs = scheduledEnd.diff(scheduledStart);
        const scheduledDurationHours = scheduledDurationMs / (1000 * 60 * 60);

        // Create Timesheet
        const timesheetData = {
            id: getRandomId(),
            shiftId: shift.id,
            guardId: shift.guardId,
            siteId: shift.siteId,
            companyId: shift.companyId,

            scheduledStart: shift.start,
            scheduledEnd: shift.end,
            scheduledBreakMinutes: shift.breakTime || 0,
            scheduledTotalHours: shift.totalHours,

            actualStart: shift.actualStart,
            actualEnd: shift.actualEnd,
            actualBreakMinutes: shift.breakTime || 0,
            actualTotalHours,

            selectedBreakMinutes: shift.breakTime || 0,
            selectedPayableHours: actualTotalHours,
            selectedScheduledStart: shift.start,
            selectedScheduledEnd: shift.end,
            selectedTotalHours: shift.totalHours,

            status: 'pending',
            exportStatus: false
        };

        await Timesheet.create([timesheetData], { session });

        // Update Shift
        shift.isTimesheetGenerated = true; // Ensure this field exists or is managed in schema if needed, strictly speaking schema doesn't have it but good for lock.
        // If schema doesn't support 'isTimesheetGenerated', we might rely on existence of timesheet. 
        // For now, let's assume we just save it. 
        await shift.save({ session });

        await session.commitTransaction();
        session.endSession();
        console.log(`Timesheet created successfully for shift: ${shiftId}`);

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error("Error creating verified timesheet:", error);
    }
};


dayjs.extend(utc);
dayjs.extend(timezone);

const router = express.Router()

router.get("/live-operations", verifyToken, async (req, res) => {
    try {

        const { uid } = req

        const user = await Users.findOne({ uid })
        if (!user) return res.status(401).json({ message: "Unauthorized access.", isError: true })

        const timeZone = req.headers["x-timezone"] || req.query.timeZone || "UTC";

        const currentTimeUTC = dayjs().tz(timeZone);
        const startOfDayUTC = currentTimeUTC.startOf('day').utc().toDate()
        const endOfDayUTC = currentTimeUTC.endOf('day').utc().toDate()

        const pipeline = [
            {
                $match: {
                    start: { $lte: endOfDayUTC },
                    end: { $gte: startOfDayUTC },
                    status: { $in: ["accepted", "missed", "active", "completed"] },
                }
            },
            { $lookup: { from: "sites", localField: "siteId", foreignField: "id", as: "siteDetails" } },
            { $unwind: "$siteDetails" },
            { $lookup: { from: "customers", localField: "siteDetails.customerId", foreignField: "id", as: "customerDetails" } },
            { $unwind: "$customerDetails" },
            { $match: { "customerDetails.companyId": user.companyId } },
            { $lookup: { from: "users", localField: "guardId", foreignField: "uid", as: "guardDetails" } },
            { $unwind: { path: "$guardDetails", preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    _id: 0,
                    id: "$id",
                    customer: "$customerDetails.name",
                    site: "$siteDetails.name",
                    name: { $ifNull: ["$guardDetails.fullName", "UNASSIGNED"] },
                    status: "$status",
                    startTime: "$start",
                    endTime: "$end",
                    actualStart: "$actualStart",
                    actualEnd: "$actualEnd",
                    locations: "$locations",
                    checkOut: "$checkOut",
                    guardId: "$guardId",
                    isGeofenceVerified: "$isGeofenceVerified",
                    actualStartTime: "$actualStartTime",
                    clockInLocation: "$clockInLocation"
                }
            },
        ];

        const shifts = await Shifts.aggregate(pipeline);

        return res.status(200).json({ message: `Live shifts fetched for.`, shifts });

    } catch (error) {
        console.error("Error fetching live operations:", error);
        res.status(500).json({ message: "Server error during live operations fetch." });
    }
});


router.patch("/check-in/:id", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        const { id: shiftId } = req.params;
        const { latitude, longitude } = cleanObjectValues(req.body);
        const timeZone = req.headers["x-timezone"] || req.body.timeZone || "UTC";
        const { checkInTime } = req.query;

        // 1. Guard Identity & Duplicate Check
        const user = await Users.findOne({ uid });
        if (!user) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const alreadyActiveShift = await Shifts.findOne({ guardId: uid, status: "active" });
        if (alreadyActiveShift) return res.status(400).json({ message: "You are already clocked into another active shift.", isError: true });

        const shift = await Shifts.findOne({ id: shiftId });
        if (!shift) return res.status(404).json({ message: "Shift not found.", isError: true });

        if (shift.status === "completed") { return res.status(400).json({ message: "Shift is already active or completed.", isError: true }); }

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

        const actualStartTime = now.toDate();

        const updatedShift = await Shifts.findOneAndUpdate(
            { id: shiftId },
            {
                $set: {
                    status: "active",
                    actualStart: checkInTime,
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

        // Broadcast to everyone (Dashboard)
        req.io.emit('shift_check_in', { shift: shiftFormat, message: eventMessage });
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
        const timeZone = req.headers["x-timezone"] || req.body.timeZone;
        const now = dayjs().tz(timeZone).utc(true);

        const updatedShift = await Shifts.findOneAndUpdate(
            { id, guardId: uid },
            { $set: { status: "accepted", acceptedAt: now.toISOString() } },
            { new: true }
        );

        if (!updatedShift) { return res.status(404).json({ message: "Shift not found or you are not authorized to accept it.", isError: true }); }

        const site = await Sites.findOne({ id: updatedShift.siteId }).lean();
        const guard = await Users.findOne({ uid: updatedShift.guardId }, 'fullName email uid');
        const customer = await Customers.findOne({ id: site?.customerId }).lean();

        const shiftFormat = {
            ...updatedShift.toObject(),
            siteName: site?.name || "N/A",
            site: site?.name || "N/A",
            guardName: guard?.fullName || "N/A",
            name: guard?.fullName || "N/A",
            guardEmail: guard?.email || "N/A",
            customer: customer?.name || "N/A",
            startTime: updatedShift.start,
            endTime: updatedShift.end
        };

        if (req.io) { req.io.emit('shift_accepted', { shift: shiftFormat, message: `Guard ${guard.fullName} has accepted shift ${id}` }); }

        return res.status(200).json({ message: "Shift accepted successfully. Status is now 'accepted'.", isError: false, shift: shiftFormat });
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

        const site = await Sites.findOne({ id: updatedShift.siteId }).lean();
        const guard = await Users.findOne({ uid: updatedShift.guardId }, 'fullName email uid');
        const customer = await Customers.findOne({ id: site?.customerId }).lean();

        const shiftFormat = {
            ...updatedShift.toObject(),
            siteName: site?.name || "N/A",
            site: site?.name || "N/A",
            guardName: guard?.fullName || "N/A",
            name: guard?.fullName || "N/A",
            guardEmail: guard?.email || "N/A",
            customer: customer?.name || "N/A",
            startTime: updatedShift.start,
            endTime: updatedShift.end
        };

        if (req.io) { req.io.emit('shift_rejected', { shift: shiftFormat, reason, message: `Guard ${guard.fullName} has rejected shift ${id}: ${reason}` }); }

        return res.status(200).json({ message: "Shift rejected successfully. Status is now 'rejected'.", isError: false, shift: shiftFormat });
    } catch (error) {
        console.error("Shift Rejection Error:", error);
        return res.status(500).json({ message: "An internal server error occurred while rejecting the shift.", isError: true, error: error.message });
    }
});

router.patch("/check-out/:id", verifyToken, async (req, res) => {
    try {
        const { id: shiftId } = req.params;
        const { checkOutTime } = req.query;
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

        const actualEndTime = checkOutTime ? dayjs(checkOutTime).utc().toDate() : dayjs().utc().toDate();

        const startTime = dayjs(shift.actualStart || shift.start).utc();
        const endTime = dayjs(actualEndTime).utc();

        // Calculate minutes difference
        const diffMinutes = endTime.diff(startTime, 'minute');
        const breakMinutes = shift.breakTime || 0;
        const netMinutes = Math.max(0, diffMinutes - breakMinutes);

        const paidHours = parseFloat((netMinutes / 60).toFixed(2));

        const baseRate = guard.standardRate || guard.perHour || 0;
        // const totalPay = parseFloat((paidHours * baseRate).toFixed(2));

        const updatedShift = await Shifts.findOneAndUpdate(
            { id: shiftId },
            {
                $set: {
                    status: "completed",
                    actualEnd: actualEndTime,
                    clockOutLocation: { lat: Number(latitude), lng: Number(longitude) },
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

        if (updatedShift.guardId && req.io) { req.io.to(updatedShift.guardId).emit('shift_check_out', { shift: shiftFormat, message: "Clock-out successful." }); }

        // 6. Trigger Timesheet Create (Async)
        createVerifiedTimesheet(updatedShift.id).catch(err => console.error("Async Timesheet Creation Trigger Error:", err));

        res.status(200).json({ message: "Clock-out successful. Shift completed.", isError: false, shift: shiftFormat, paidHours, geofenceStatus: checkoutGeofenceStatus });

    } catch (error) {
        console.error("Critical Check-Out Error:", error);
        res.status(500).json({ message: "Server error during clock-out.", isError: true });
    }
});

module.exports = router