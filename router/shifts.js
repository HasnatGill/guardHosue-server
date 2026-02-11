const express = require("express")
const Shifts = require("../models/shifts");
const Sites = require("../models/sites")
const Users = require("../models/auth")
const dayjs = require("dayjs");
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const multer = require("multer");
const { verifyToken } = require("../middlewares/auth")
const { getRandomId, cleanObjectValues } = require("../config/global");
const { calculateShiftHours } = require("../utils/timeUtils");
const { sendShiftEmail } = require("../utils/mailer");
const { sendPushNotification } = require("../utils/pushNotify");

dayjs.extend(utc);
dayjs.extend(timezone);

// Helper: Conflict Detection
const checkShiftConflict = async (guardId, start, end, excludeShiftId = null) => {
    const newStart = new Date(start);
    const newEnd = new Date(end);
    const query = { guardId, status: { $ne: "cancelled" }, $and: [{ start: { $lt: newEnd } }, { end: { $gt: newStart } }] };
    if (excludeShiftId) { query.id = { $ne: excludeShiftId }; }
    const conflict = await Shifts.findOne(query);
    return conflict;
};

// Helper: Compliance Check
const checkCompliance = async (guardId, start, end) => {
    const guard = await Users.findOne({ uid: guardId });
    if (!guard) return { valid: false, message: "Guard not found" };

    const warnings = [];

    if (guard.licenceExpiryDate && dayjs(guard.licenceExpiryDate).isBefore(dayjs(end))) {
        warnings.push(`Guard's SIA license expires on ${dayjs(guard.licenceExpiryDate).format("DD/MM/YYYY")}`);
    }
    const lastShift = await Shifts.findOne({ guardId, end: { $lte: start } }).sort({ end: -1 });
    if (lastShift) {
        const hoursSinceLast = dayjs(start).diff(dayjs(lastShift.end), 'hour');
        if (hoursSinceLast < 10) {
            warnings.push(`Rest period violation: Only ${hoursSinceLast} hours since last shift.`);
        }
    }

    return { valid: warnings.length === 0, warnings };
};

// Helper: Background Notifications
const sendShiftNotifications = async (shiftId, io) => {
    try {

        const shift = await Shifts.findOne({ id: shiftId });
        if (!shift) return;

        const [guard, site] = await Promise.all([Users.findOne({ uid: shift.guardId }), Sites.findOne({ id: shift.siteId })]);
        if (!guard) return;

        const shiftDetails = { ...shift.toObject(), siteName: site?.name || "N/A", siteAddress: site?.address || "N/A" };
        if (guard.email) { sendShiftEmail(guard, shiftDetails).catch(err => console.error("Email Notify Error:", err)); }

        if (guard.deviceToken) {
            sendPushNotification(guard.deviceToken, "New Shift Assigned", `You have a new shift at ${shiftDetails.siteName} on ${dayjs(shift.start).format("DD MMM")}`, { shiftId: shift.id, type: "SHIFT_PUBLISHED" }).catch(err => console.error("Push Notify Error:", err));
        }

        if (io) {
            io.to(guard.uid).emit('shift_published', { shift: shiftDetails, message: `Your new shift at ${shiftDetails.siteName} has been published.` });
            io.to(guard.uid).emit('new_shift_added', { shift: shiftDetails, message: `Your new shift at ${shiftDetails.siteName} has been published.` });
        }

    } catch (error) {
        console.error("Background Notification Error:", error);
    }
};

const router = express.Router()

router.post("/add", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        const timeZone = req.headers["x-timezone"] || req.body.timeZone || "UTC";

        const user = await Users.findOne({ uid })
        if (!user) return res.status(401).json({ message: "Unauthorized access.", isError: true })

        let formData = req.body;
        const { guardId, start, end } = formData;
        // 1. Conflict Check
        let conflictError = null;
        if (guardId) {
            const conflict = await checkShiftConflict(guardId, start, end);
            if (conflict) {
                if (!formData.forceSave) {
                    return res.status(409).json({ message: "Guard has an overlapping shift.", isError: true, conflict: true, conflictDetails: conflict });
                } else {
                    conflictError = { type: "Overlapping Shift", details: `Forced override. Overlaps with shift ${conflict.id}` };
                }
            }
        }

        // 2. Compliance Check
        let complianceWarnings = [];
        if (guardId) {
            const compliance = await checkCompliance(guardId, start, end);
            if (!compliance.valid) {
                complianceWarnings = compliance.warnings;
            }
        }

        const site = await Sites.findOne({ id: formData.siteId }).select('-createdBy -__v -_id')
        const dataAdd = { ...formData, id: getRandomId(), createdBy: uid, companyId: user.companyId, customerId: site.customerId, conflictDetails: conflictError, status: "draft", timeZone }
        const shift = new Shifts(dataAdd)
        await shift.save()

        let shiftObject = shift.toObject();
        if (site) { shiftObject.siteId = site.toObject(); }

        res.status(201).json({ message: "Your shift added has been successfully", isError: false, shift, warnings: complianceWarnings })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong while adding the shift", isError: true, error })
    }
})

router.get("/all", verifyToken, async (req, res) => {
    try {

        const { uid } = req;

        const user = await Users.findOne({ uid })
        if (!user) return res.status(401).json({ message: "Unauthorized access.", isError: true })

        const { customerId, model, startDate, endDate } = cleanObjectValues(req.query);

        let start = JSON.parse(startDate);
        let end = JSON.parse(endDate);

        if (model === "Sites") {

            let match = {};
            if (customerId) match.customerId = customerId
            if (user.companyId) match.companyId = user.companyId
            match.status = "active"
            const result = await Sites.aggregate([
                { $match: match },
                { $lookup: { from: "shifts", localField: "id", foreignField: "siteId", as: "shifts" } },
                { $unwind: { path: "$shifts", preserveNullAndEmptyArrays: true } },
                { $lookup: { from: "users", localField: "shifts.guardId", foreignField: "uid", as: "guardInfo" } },
                { $unwind: { path: "$guardInfo", preserveNullAndEmptyArrays: true } },
                {
                    $group: {
                        _id: "$id",
                        name: { $first: "$name" },
                        shifts: {
                            $push: { id: "$shifts.id", guardId: "$shifts.guardId", siteId: "$shifts.siteId", breakTime: "$shifts.breakTime", date: "$shifts.date", employeeName: "$guardInfo.fullName", siteName: "$name", start: "$shifts.start", end: "$shifts.end", status: "$shifts.status", totalHours: "$shifts.totalHours", isPublished: "$shifts.isPublished", conflictDetails: "$shifts.conflictDetails", guardRole: "$shifts.guardRole" }
                        }
                    }
                },
                {
                    $project: {
                        _id: 0, id: "$_id", name: 1,
                        shifts: {
                            $filter: {
                                input: "$shifts", as: "s",
                                cond: {
                                    $and: [
                                        { $ne: ["$$s.id", null] },
                                        start ? { $gte: ["$$s.date", { $dateFromString: { dateString: start } }] } : true,
                                        end ? { $lte: ["$$s.date", { $dateFromString: { dateString: end } }] } : true
                                    ]
                                }
                            }
                        }
                    }
                }
            ]);

            return res.json({ model: "sites", data: result });
        }

        if (model === "Guards") {

            let match = {}
            match.roles = { $in: ["guard"] }
            if (user.companyId) match.companyId = user.companyId
            match.status = "active"

            const result = await Users.aggregate([
                { $match: match },
                { $lookup: { from: "shifts", localField: "uid", foreignField: "guardId", as: "shifts" } },
                { $unwind: { path: "$shifts", preserveNullAndEmptyArrays: true } },
                { $lookup: { from: "sites", localField: "shifts.siteId", foreignField: "id", as: "siteInfo" } },
                { $unwind: { path: "$siteInfo", preserveNullAndEmptyArrays: true } },
                {
                    $group: {
                        _id: "$uid", name: { $first: "$fullName" },
                        shifts: { $push: { id: "$shifts.id", guardId: "$shifts.guardId", siteId: "$shifts.siteId", breakTime: "$shifts.breakTime", date: "$shifts.date", siteName: "$siteInfo.name", employeeName: "$fullName", start: "$shifts.start", end: "$shifts.end", status: "$shifts.status", totalHours: "$shifts.totalHours", isPublished: "$shifts.isPublished", conflictDetails: "$shifts.conflictDetails", guardRole: "$shifts.guardRole" } }
                    }
                },
                {
                    $project: {
                        _id: 0, id: "$_id", name: 1,
                        shifts: {
                            $filter: {
                                input: "$shifts", as: "s",
                                cond: {
                                    $and: [
                                        { $ne: ["$$s.id", null] },
                                        start ? { $gte: ["$$s.date", { $dateFromString: { dateString: start } }] } : true,
                                        end ? { $lte: ["$$s.date", { $dateFromString: { dateString: end } }] } : true
                                    ]
                                }
                            }
                        }
                    }
                }
            ]);

            return res.json({ model: "employees", data: result });
        }

        return res.status(400).json({ message: "Invalid model. Use /site or /guard" });

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error", err });
    }
});

router.get("/single-with-id/:id", verifyToken, async (req, res) => {
    try {

        const { uid } = req;
        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const { id } = req.params;

        const shift = await Shifts.findOne({ id });

        res.status(200).json({ shift });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong. Internal server error.", isError: true, error });
    }
});

router.get("/my-shifts", verifyToken, async (req, res) => {
    try {
        const { uid } = req;

        const user = await Users.findOne({ uid });

        if (!user) { return res.status(401).json({ message: "Unauthorized access.", isError: true }); }

        let { startDate, endDate } = cleanObjectValues(req.query);

        startDate = JSON.parse(startDate)
        endDate = JSON.parse(endDate)

        const start = dayjs(startDate);
        const end = dayjs(endDate);

        if (!start.isValid() || !end.isValid()) { return res.status(400).json({ message: "Invalid date format.", isError: true }); }

        const startFilter = start.startOf("day").toDate();
        const endFilter = end.endOf("day").toDate();

        const shifts = await Shifts.aggregate([
            {
                $match: {
                    guardId: uid,
                    date: { $gte: startFilter, $lte: endFilter },
                    status: { $in: ["published", "accepted", "active", "completed"] }
                }
            },

            { $lookup: { from: "sites", localField: "siteId", foreignField: "id", as: "siteInfo" } },
            { $unwind: { path: "$siteInfo", preserveNullAndEmptyArrays: true } },
            { $project: { _id: 0, id: 1, date: 1, start: 1, end: 1, status: 1, breakTime: 1, totalHours: 1, siteId: 1, guardId: 1, siteName: "$siteInfo.name", siteAddress: "$siteInfo.address", actualStart: 1, } }
        ]);

        return res.status(200).json({ message: "Shifts fetched successfully.", shifts });

    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: "Server Error", isError: true, error });
    }
})

router.patch("/update/:id", verifyToken, async (req, res) => {
    try {

        const timeZone = req.headers["x-timezone"] || req.body.timeZone;
        const { id } = req.params;
        const { uid } = req;

        const { guardId: newGuardId } = req.body;

        const updatedData = { ...req.body };

        if (!uid) { return res.status(401).json({ message: "Unauthorized access.", isError: true }); }

        const existingShift = await Shifts.findOne({ id });
        if (!existingShift) { return res.status(404).json({ message: "Shift not found.", isError: true }); }

        const oldGuardId = existingShift.guardId;

        // 1. Conflict Check
        const { start, end, siteId, guardId, breakTime, forceSave } = updatedData;
        let conflictError = null;
        if (guardId) {
            const conflict = await checkShiftConflict(guardId, start, end, id);
            if (conflict) {
                if (!forceSave) {
                    return res.status(409).json({ message: "Guard has an overlapping shift.", isError: true, conflict: true, conflictDetails: conflict });
                } else {
                    conflictError = { type: "Overlapping Shift", details: `Forced override. Overlaps with shift ${conflict.id}` };
                }
            }
        }

        // 2. Compliance Check
        let complianceWarnings = [];
        if (guardId) {
            const compliance = await checkCompliance(guardId, start, end);
            if (!compliance.valid) complianceWarnings = compliance.warnings;
        }

        const updatePayload = { start, end, siteId, guardId, status: "draft", acceptedAt: null, rejectionReason: "", breakTime, conflictDetails: conflictError, };
        if (timeZone) updatePayload.timeZone = timeZone;

        const updatedShift = await Shifts.findOneAndUpdate(
            { id },
            { $set: updatePayload },
            { new: true }
        );

        const guardUser = await Users.findOne({ uid: updatedShift.guardId }, 'fullName uid');
        const siteData = await Sites.findOne({ id: updatedShift.siteId }, 'name city address');

        const shiftToSend = { ...updatedShift.toObject(), guardName: guardUser ? guardUser.fullName : "", siteName: siteData ? siteData.name : "", siteAddress: siteData ? siteData.address : "", siteCity: siteData ? siteData.city : "", };
        const shiftMessage = `Your shift Update at ${shiftToSend.siteName}`;


        if (req.io) {
            if (newGuardId && newGuardId !== oldGuardId) {
                req.io.to(oldGuardId).emit('remove_shift_from_admin', { shift: shiftToSend, message: `Your shift has been removed from ${shiftToSend.siteName}` });
                req.io.to(newGuardId).emit('shift_published', { shift: shiftToSend, message: `You have been assigned a new shift at ${shiftToSend.siteName}` });
                req.io.to(newGuardId).emit('new_shift_added', { shift: shiftToSend, message: `You have been assigned a new shift at ${shiftToSend.siteName}` });
            }
            else if (updatedShift.guardId) {
                req.io.to(updatedShift.guardId).emit('shift_update_from_admin', { shift: shiftToSend, message: shiftMessage });
            }
        }

        res.status(200).json({ message: "Shift updated successfully", isError: false, shift: updatedShift, warnings: complianceWarnings });
    } catch (error) {
        console.error("Shift Update Error:", error);
        res.status(500).json({ message: "Something went wrong while updating the shift", isError: true, error: error.message });
    }
});

router.delete("/single/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;

        const shift = await Shifts.findOneAndDelete({ id });
        if (!shift) return res.status(404).json({ message: "Shift not found", isError: true });

        if (shift.guardId && req.io) { req.io.to(shift.guardId).emit('remove_shift_from_admin', { shift, message: `Shift remove`, }); }
        res.status(200).json({ message: "Shift deleted successfully", id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong", isError: true });
    }
});

const getShiftCounts = async (date, companyId) => {
    const counts = await Shifts.aggregate([{ $match: { end: { $gte: date }, companyId: companyId } }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
    const result = { active: 0, published: 0, rejected: 0, missed: 0 };
    counts.forEach(item => {
        if (item._id === 'active' || item._id === 'accepted') result.active += item.count;
        if (item._id === 'published') result.published += item.count;
        if (item._id === 'rejected') result.rejected += item.count;
        if (item._id === 'missed') result.missed += item.count;
    });
    return result;
};

router.get("/all-with-status", verifyToken, async (req, res) => {
    try {

        const { uid } = req

        const user = await Users.findOne({ uid })
        if (!user) return res.status(401).json({ message: "Unauthorized access.", isError: true })

        const { status, siteId, guardName, email, date, perPage, pageNo } = cleanObjectValues(req.query);
        const timeZone = req.headers["x-timezone"] || req.query.timeZone || "UTC";

        const page = parseInt(pageNo) || 1;
        const limit = parseInt(perPage) || 10;
        const skip = (page - 1) * limit;

        let matchQuery = {};

        if (status) {
            if (status === "active") {
                matchQuery.status = { $in: ["active", "accepted"] };
            } else if (status === "published") {
                matchQuery.status = "published";
            } else if (status === "rejected") {
                matchQuery.status = "rejected";
            } else {
                matchQuery.status = status;
            }
        }
        matchQuery.companyId = user.companyId

        const currentTimeUTC = dayjs().tz(timeZone);
        const startOfDayUTC = currentTimeUTC.startOf("day").toDate();

        matchQuery.end = { $gte: startOfDayUTC };

        if (date) {
            const selectedDateUTC = dayjs(date);
            const nextDateUTC = selectedDateUTC.add(1, 'day');
            matchQuery.date = { $gte: selectedDateUTC.toDate(), $lt: nextDateUTC.toDate(), };
            delete matchQuery.end;
        }
        let pipeline = [
            { $match: matchQuery },
            { $lookup: { from: 'sites', localField: 'siteId', foreignField: 'id', as: 'siteInfo' } },
            { $unwind: { path: '$siteInfo', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: 'users', localField: 'guardId', foreignField: 'uid', as: 'guardInfo' } },
            { $unwind: { path: '$guardInfo', preserveNullAndEmptyArrays: true } },
            {
                $match: {
                    $and: [
                        guardName ? { 'guardInfo.fullName': { $regex: guardName, $options: 'i' } } : {},
                        email ? { 'guardInfo.email': { $regex: email, $options: 'i' } } : {},
                        siteId ? { 'siteId': siteId } : {},
                    ]
                }
            },

            { $project: { id: '$id', start: '$start', end: '$end', date: '$date', status: '$status', reason: "$reason", totalHours: '$totalHours', siteId: '$siteId', siteName: '$siteInfo.name', guardId: '$guardId', guardName: '$guardInfo.fullName', guardEmail: '$guardInfo.email', isPublished: '$isPublished', conflictDetails: '$conflictDetails' } },
            { $sort: { start: 1 } },
            { $facet: { metadata: [{ $count: "totals" }], data: [{ $skip: skip }, { $limit: limit }] } }
        ];

        const [results] = await Shifts.aggregate(pipeline);

        const shifts = results.data;
        const totals = results.metadata[0]?.totals || 0;
        const counts = await getShiftCounts(startOfDayUTC, user.companyId);

        res.status(200).json({ shifts, counts, totals, isError: false });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while fetching shifts", isError: true, error });
    }
});

router.patch("/drop-pin/:id", verifyToken, async (req, res) => {

    const { id } = req.params;
    const { latitude, longitude, time } = req.body;

    if (!latitude || !longitude || !time) { return res.status(400).json({ success: false, message: "Latitude and Longitude or Time are required." }); }

    try {
        const updatedShift = await Shifts.findOneAndUpdate(
            { id },
            {
                $push: {
                    locations: {
                        longitude: longitude,
                        latitude: latitude,
                        time: time,
                    }
                }
            },
            { new: true, runValidators: true }
        );

        if (!updatedShift) { return res.status(404).json({ success: false, message: "Shift not found with this ID." }); }

        req.io.emit('shift_drop_pin', { shift: updatedShift, type: 'drop_pin', message: `New Drop Pin.` });
        return res.status(200).json({ success: true, message: "Location successfully updated.", shift: updatedShift });

    } catch (error) {
        console.error("Error updating location:", error);
        return res.status(500).json({ success: false, message: "Server error occurred while updating location.", error });
    }
});

// Bulk Publish Endpoint
router.patch("/publish", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        const { shiftIds } = req.body;

        if (!shiftIds || shiftIds.length === 0) {
            return res.status(400).json({ message: "No shifts selected to publish.", isError: true });
        }

        const user = await Users.findOne({ uid });
        const query = {
            id: { $in: shiftIds },
            companyId: user.companyId,
            status: "draft"
        };

        // Update shifts
        const result = await Shifts.updateMany(query, { $set: { status: "published" } });

        // Trigger background notifications for each shift
        shiftIds.forEach(id => {
            sendShiftNotifications(id, req.io);
        });

        res.status(200).json({ message: "Shifts published successfully", count: result.modifiedCount, isError: false });

    } catch (error) {
        console.error("Bulk Publish Error:", error);
        res.status(500).json({ message: "Something went wrong", isError: true });
    }
});


module.exports = router