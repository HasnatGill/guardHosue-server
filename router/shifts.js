const express = require("express")
const Shifts = require("../models/shifts");
const Sites = require("../models/sites")
const Customers = require("../models/customers")
const Users = require("../models/auth")
const dayjs = require("dayjs");
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { verifyToken } = require("../middlewares/auth")
const { getRandomId, cleanObjectValues } = require("../config/global");
const { calculateShiftHours } = require("../utils/timeUtils");
const sendMail = require("../utils/sendMail");
const { sendPushNotification } = require("../utils/pushNotification");
const { getDistance } = require("../utils/locationUtils");


const storage = multer.memoryStorage()
const upload = multer({ storage })

dayjs.extend(utc);
dayjs.extend(timezone);

// Helper: Conflict Detection
const checkShiftConflict = async (guardId, start, end, excludeShiftId = null) => {
    // Convert to Date objects to ensure consistent comparison regardless of input type (string/ISO/Date)
    const newStart = new Date(start);
    const newEnd = new Date(end);

    // Standard overlap logic: A shift overlaps if it starts before the new one ends 
    // AND ends after the new one starts.
    const query = {
        guardId,
        status: { $ne: "cancelled" },
        $and: [
            { start: { $lt: newEnd } },
            { end: { $gt: newStart } }
        ]
    };

    if (excludeShiftId) {
        query.id = { $ne: excludeShiftId };
    }

    const conflict = await Shifts.findOne(query);
    return conflict;
};

// Helper: Compliance Check
const checkCompliance = async (guardId, start, end) => {
    const guard = await Users.findOne({ uid: guardId });
    if (!guard) return { valid: false, message: "Guard not found" };

    const warnings = [];

    // 1. License Check
    if (guard.licenceExpiryDate && dayjs(guard.licenceExpiryDate).isBefore(dayjs(end))) {
        warnings.push(`Guard's SIA license expires on ${dayjs(guard.licenceExpiryDate).format("DD/MM/YYYY")}`);
    }

    // 2. Rest Period (11h rule)
    const lastShift = await Shifts.findOne({ guardId, end: { $lte: start } }).sort({ end: -1 });
    if (lastShift) {
        const hoursSinceLast = dayjs(start).diff(dayjs(lastShift.end), 'hour');
        if (hoursSinceLast < 11) {
            warnings.push(`Rest period violation: Only ${hoursSinceLast} hours since last shift.`);
        }
    }

    return { valid: warnings.length === 0, warnings };
};

const router = express.Router()

router.post("/add", verifyToken, async (req, res) => {
    try {
        const { uid } = req;

        const user = await Users.findOne({ uid })
        if (!user) return res.status(401).json({ message: "Unauthorized access.", isError: true })

        let formData = req.body;
        const { guardId, start, end, breakTime } = formData;

        // 1. Conflict Check
        console.log("Conflict Check: FromData", formData);
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
        const qualificationsRequired = formData.qualificationsRequired || site.requiredSkills || [];

        // Calculate hours
        const { totalHours, paidHours } = calculateShiftHours(start, end, breakTime);

        const shift = new Shifts({
            ...formData,
            id: getRandomId(),
            createdBy: uid,
            companyId: user.companyId,
            customerId: site.customerId,
            conflictDetails: conflictError,
            qualificationsRequired: qualificationsRequired,
            status: formData.isPublished ? "Published" : "Draft",
            totalHours,
            paidHours
        })
        await shift.save()

        let shiftObject = shift.toObject();
        if (site) { shiftObject.siteId = site.toObject(); }

        if (shiftObject.guardId && req.io && formData.isPublished) {
            req.io.to(shiftObject.guardId).emit('new_shift_added', { shift: shiftObject, message: `Your new shift add at ${shiftObject?.siteId?.name}`, });
        }

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
                            $push: { id: "$shifts.id", guardId: "$shifts.guardId", siteId: "$shifts.siteId", breakTime: "$shifts.breakTime", date: "$shifts.date", employeeName: "$guardInfo.fullName", siteName: "$name", start: "$shifts.start", end: "$shifts.end", status: "$shifts.status", liveStatus: "$shifts.liveStatus", totalHours: "$shifts.totalHours", isPublished: "$shifts.isPublished", conflictDetails: "$shifts.conflictDetails", guardRole: "$shifts.guardRole" }
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
                        shifts: { $push: { id: "$shifts.id", guardId: "$shifts.guardId", siteId: "$shifts.siteId", breakTime: "$shifts.breakTime", date: "$shifts.date", siteName: "$siteInfo.name", employeeName: "$fullName", start: "$shifts.start", end: "$shifts.end", status: "$shifts.status", liveStatus: "$shifts.liveStatus", totalHours: "$shifts.totalHours", isPublished: "$shifts.isPublished", conflictDetails: "$shifts.conflictDetails", guardRole: "$shifts.guardRole" } }
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
                    date: { $gte: startFilter, $lte: endFilter }
                }
            },

            { $lookup: { from: "sites", localField: "siteId", foreignField: "id", as: "siteInfo" } },
            { $unwind: { path: "$siteInfo", preserveNullAndEmptyArrays: true } },
            { $project: { _id: 0, id: 1, date: 1, start: 1, end: 1, status: 1, liveStatus: 1, breakTime: 1, totalHours: 1, siteId: 1, siteName: "$siteInfo.name", siteAddress: "$siteInfo.address", checkIn: 1, } }
        ]);

        return res.status(200).json({ message: "Shifts fetched successfully.", shifts });

    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: "Server Error", isError: true, error });
    }
})

router.patch("/update/:id", verifyToken, async (req, res) => {
    try {

        const { id } = req.params;
        const { uid } = req;
        const { guardId: newGuardId } = req.body;
        const updatedData = { ...req.body };

        if (!uid) { return res.status(401).json({ message: "Unauthorized access.", isError: true }); }

        const existingShift = await Shifts.findOne({ id });
        if (!existingShift) { return res.status(404).json({ message: "Shift not found.", isError: true }); }

        const oldGuardId = existingShift.guardId;

        // 1. Conflict Check
        const { start, end, siteId, guardId, breakTime, isPublished, forceSave, qualificationsRequired } = updatedData;
        let conflictError = null;
        if (guardId) {
            const conflict = await checkShiftConflict(guardId, start, end, id);
            if (conflict) {
                if (!forceSave) {
                    return res.status(409).json({
                        message: "Guard has an overlapping shift.",
                        isError: true,
                        conflict: true,
                        conflictDetails: conflict
                    });
                } else {
                    conflictError = {
                        type: "Overlapping Shift",
                        details: `Forced override. Overlaps with shift ${conflict.id}`
                    };
                }
            }
        }

        // 2. Compliance Check
        let complianceWarnings = [];
        if (guardId) {
            const compliance = await checkCompliance(guardId, start, end);
            if (!compliance.valid) complianceWarnings = compliance.warnings;
        }

        // Calculate hours
        const { totalHours, paidHours } = calculateShiftHours(start, end, breakTime);

        const updatedShift = await Shifts.findOneAndUpdate(
            { id },
            {
                $set: {
                    start: start,
                    end: end,
                    siteId: siteId,
                    guardId: guardId,
                    status: isPublished ? "Published" : "Draft",
                    breakTime: breakTime,
                    isPublished: isPublished,
                    conflictDetails: conflictError,
                    qualificationsRequired: qualificationsRequired,
                    totalHours,
                    paidHours
                }
            },
            { new: true }
        );

        const guardUser = await Users.findOne({ uid: updatedShift.guardId }, 'fullName uid');
        const siteData = await Sites.findOne({ id: updatedShift.siteId }, 'name city address');

        const shiftToSend = {
            ...updatedShift.toObject(),
            guardName: guardUser ? guardUser.fullName : "",
            siteName: siteData ? siteData.name : "",
            siteAddress: siteData ? siteData.address : "",
            siteCity: siteData ? siteData.city : "",
        };

        const shiftMessage = `Your shift Update at ${shiftToSend.siteName}`;



        if (req.io && updatedShift.isPublished) {
            if (newGuardId && newGuardId !== oldGuardId) {
                req.io.to(oldGuardId).emit('remove_shift_from_admin', { shift: shiftToSend, message: `Your shift has been removed from ${shiftToSend.siteName}` });
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

router.get("/live-operations", verifyToken, async (req, res) => {
    try {

        const { uid } = req

        const user = await Users.findOne({ uid })
        if (!user) return res.status(401).json({ message: "Unauthorized access.", isError: true })

        const { timeZone = "UTC" } = cleanObjectValues(req.query)

        const currentTimeUTC = dayjs().tz(timeZone);
        const now = currentTimeUTC.toDate()
        const startOfDayUTC = currentTimeUTC.startOf('day').utc().toDate()
        const endOfDayUTC = currentTimeUTC.endOf('day').utc().toDate()

        const pipeline = [
            {
                $match: {
                    $or: [
                        { start: { $gte: startOfDayUTC, $lte: endOfDayUTC } },
                        { end: { $gte: startOfDayUTC, $lte: endOfDayUTC } }
                    ]
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
                    liveStatus: "$liveStatus",
                    checkIn: "$checkIn",
                    customer: "$customerDetails.name",
                    site: "$siteDetails.name",
                    name: { $ifNull: ["$guardDetails.fullName", "UNASSIGNED"] },
                    status: "$status",
                    startTime: "$start",
                    endTime: "$end",
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

router.patch("/assign/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { uid } = req;
        const { guardId } = req.body;

        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const shift = await Shifts.findOne({ id });
        if (!shift) return res.status(404).json({ message: "Shift not found.", isError: true });

        // Conflict detection (optional but recommended)
        const conflict = await checkShiftConflict(guardId, shift.start, shift.end, id);
        if (conflict) {
            return res.status(409).json({ message: "Guard has an overlapping shift.", isError: true, conflict: true });
        }

        const updatedShift = await Shifts.findOneAndUpdate(
            { id },
            { $set: { guardId: guardId, status: "Published", isPublished: true } },
            { new: true }
        );

        const guardUser = await Users.findOne({ uid: updatedShift.guardId }, 'fullName uid');
        const siteData = await Sites.findOne({ id: updatedShift.siteId }, 'name');

        const shiftToSend = {
            ...updatedShift.toObject(),
            name: guardUser ? guardUser.fullName : "UNASSIGNED",
            site: siteData ? siteData.name : "",
            startTime: updatedShift.start,
            endTime: updatedShift.end
        };

        if (req.io) {
            req.io.emit('shift_assigned', { shift: shiftToSend, message: `Guard ${guardUser?.fullName} assigned to shift at ${siteData?.name}` });
            req.io.to(guardId).emit('new_shift_added', { shift: shiftToSend, message: `You have been assigned a new shift at ${siteData?.name}` });
        }

        res.status(200).json({ message: "Guard assigned successfully", isError: false, shift: shiftToSend });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong during assignment", isError: true, error });
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
    const result = { active: 0, pending: 0, request: 0 };
    counts.forEach(item => {
        if (item._id === 'active') result.active = item.count;
        if (item._id === 'pending') result.pending = item.count;
        if (item._id === 'request') result.request = item.count;
    });
    return result;
};

router.get("/all-with-status", verifyToken, async (req, res) => {
    try {

        const { uid } = req

        const user = await Users.findOne({ uid })
        if (!user) return res.status(401).json({ message: "Unauthorized access.", isError: true })

        const { status, siteId, guardName, email, date, perPage, pageNo, timeZone } = cleanObjectValues(req.query);

        const page = parseInt(pageNo) || 1;
        const limit = parseInt(perPage) || 10;
        const skip = (page - 1) * limit;

        let matchQuery = {};

        if (status) { matchQuery.status = status; }
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

            { $project: { id: '$id', start: '$start', end: '$end', date: '$date', status: '$status', reason: "$reason", liveStatus: '$liveStatus', totalHours: '$totalHours', siteId: '$siteId', siteName: '$siteInfo.name', guardId: '$guardId', guardName: '$guardInfo.fullName', guardEmail: '$guardInfo.email', isPublished: '$isPublished', conflictDetails: '$conflictDetails' } },
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

// router.patch("/updated-status/:id", verifyToken, async (req, res) => {
//     try {
//         const { id } = req.params;
//         const { uid } = req;
//         const { status } = req.body

//         if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

//         const existingShift = await Shifts.findOne({ id });
//         if (!existingShift) return res.status(404).json({ message: "Shift not found.", isError: true });

//         const updatedShift = await Shifts.findOneAndUpdate(
//             { id },
//             { $set: { status: status } },
//             { new: true }
//         );

//         const guardId = updatedShift.guardId;

//         const guardUser = await Users.findOne({ uid: guardId }, 'fullName uid');
//         const siteData = await Sites.findOne({ id: updatedShift.siteId }, 'name city address');

//         const shiftToSend = {
//             ...updatedShift.toObject(),
//             guardName: guardUser ? guardUser.fullName : "",
//             siteName: siteData ? siteData.name : "",
//             guardEmail: guardUser ? guardUser.email : "",
//             siteAddress: siteData ? siteData.address : "",
//             siteCity: siteData ? JSON.parse(siteData.city || '{}').label : "",
//         };

//         if (guardId && req.io) { req.io.to(guardId).emit('request_approved', { shift: shiftToSend, message: `Your Request approved`, }); }

//         res.status(200).json({ message: "Shift updated successfully", isError: false, shift: updatedShift });
//     } catch (error) {
//         console.error(error);
//         res.status(500).json({ message: "Something went wrong while updating the shift", isError: true, error });
//     }
// });

router.patch("/request-approval/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { uid } = req;

        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const existingShift = await Shifts.findOne({ id });
        if (!existingShift) return res.status(404).json({ message: "Shift not found.", isError: true });

        const updatedShift = await Shifts.findOneAndUpdate(
            { id },
            { $set: { status: "active" } },
            { new: true }
        );
        const guardUser = await Users.findOne({ uid: updatedShift.guardId }, 'fullName email uid');
        const siteData = await Sites.findOne({ id: updatedShift.siteId }, 'name city address');

        const shiftToSend = {
            ...updatedShift.toObject(),
            guardName: guardUser ? guardUser.fullName : "",
            guardEmail: guardUser ? guardUser.email : "",
            siteName: siteData ? siteData.name : "",
            siteAddress: siteData ? siteData.address : "",
            siteCity: siteData ? siteData.city : "",
        };

        req.io.emit('shift_approved', { shift: shiftToSend, message: `Shit Approved.` });

        res.status(200).json({ message: "Approval Request sent successfully", isError: false, shift: shiftToSend });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while sending approval request for shift", isError: true, error });
    }
});


router.patch("/send-request/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { uid } = req;
        const { reason } = req.body

        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const existingShift = await Shifts.findOne({ id });
        if (!existingShift) return res.status(404).json({ message: "Shift not found.", isError: true });

        const updatedShift = await Shifts.findOneAndUpdate(
            { id },
            { $set: { status: "request", reason: reason } },
            { new: true }
        );

        const guardUser = await Users.findOne({ uid: updatedShift.guardId }, 'fullName email uid');
        const siteData = await Sites.findOne({ id: updatedShift.siteId }, 'name city address');

        const shiftToSend = {
            ...updatedShift.toObject(),
            guardName: guardUser ? guardUser.fullName : "",
            guardEmail: guardUser ? guardUser.email : "",
            siteName: siteData ? siteData.name : "",
            siteAddress: siteData ? siteData.address : "",
            siteCity: siteData ? siteData.city : "",
        };

        req.io.emit('new_request', { shift: shiftToSend, message: `New Request.` });

        res.status(200).json({ message: "Request sent successfully", isError: false, shift: updatedShift });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while sending request for shift", isError: true, error });
    }
});


router.patch("/check-in/:id", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        const { id: shiftId } = req.params;
        const { latitude, longitude, timeZone = "UTC" } = cleanObjectValues(req.body);

        // 1. Guard Identity & Duplicate Check
        const user = await Users.findOne({ uid });
        if (!user) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const alreadyActiveShift = await Shifts.findOne({ guardId: uid, status: "active" });
        if (alreadyActiveShift) return res.status(400).json({ message: "You are already clocked into another active shift.", isError: true });

        const shift = await Shifts.findOne({ id: shiftId });
        if (!shift) return res.status(404).json({ message: "Shift not found.", isError: true });

        if (shift.status === "active" || shift.status === "Completed") {
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

        // 3. Punctuality Calculation
        const now = dayjs();
        const shiftStart = dayjs.utc(shift.start).tz(timeZone);
        let punctualityStatus = "On-Time";

        if (now.isBefore(shiftStart.subtract(5, 'minute'))) {
            punctualityStatus = "Early";
        } else if (now.isAfter(shiftStart.add(15, 'minute'))) {
            punctualityStatus = "Late";
        }

        // 4. Atomic Status Updates
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

        res.status(200).json({
            message: `Clock-in successful. Status: ${punctualityStatus}`,
            isError: false,
            shift: shiftFormat,
            geofenceVerified: isGeofenceVerified
        });

    } catch (error) {
        console.error("Critical Check-In Error:", error);
        res.status(500).json({ message: "Server error during clock-in.", isError: true });
    }
});

router.post("/welfare-ping/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { latitude, longitude } = req.body;

        if (!latitude || !longitude) {
            return res.status(400).json({ message: "GPS coordinates required for safety check.", isError: true });
        }

        const shift = await Shifts.findOne({ id });
        if (!shift) return res.status(404).json({ message: "Shift not found.", isError: true });

        const now = new Date();
        const nextDue = dayjs(now).add(shift.welfare.interval, 'minute').toDate();

        const updatedShift = await Shifts.findOneAndUpdate(
            { id },
            {
                $set: {
                    "welfare.lastPingTime": now,
                    "welfare.nextPingDue": nextDue,
                    "welfare.status": "SAFE"
                },
                $push: {
                    locations: {
                        latitude: Number(latitude),
                        longitude: Number(longitude),
                        time: now
                    }
                }
            },
            { new: true }
        );

        res.status(200).json({
            message: "Safety ping confirmed.",
            isError: false,
            nextPingDue: nextDue
        });

    } catch (error) {
        console.error("Welfare Ping Error:", error);
        res.status(500).json({ message: "Server error during safety check.", isError: true });
    }
});

router.post("/welfare-manual-confirm/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const shift = await Shifts.findOne({ id });
        if (!shift) return res.status(404).json({ message: "Shift not found.", isError: true });

        const now = new Date();
        const nextDue = dayjs(now).add(shift.welfare.interval, 'minute').toDate();

        await Shifts.findOneAndUpdate(
            { id },
            {
                $set: {
                    "welfare.lastPingTime": now,
                    "welfare.nextPingDue": nextDue,
                    "welfare.status": "SAFE"
                }
            }
        );

        res.status(200).json({ message: "Manual welfare confirmation successful.", isError: false });
    } catch (error) {
        console.error("Manual Welfare Error:", error);
        res.status(500).json({ message: "Server error during manual confirmation.", isError: true });
    }
});

router.patch("/check-out/:id", verifyToken, async (req, res) => {
    try {
        const { id: shiftId } = req.params;
        const { latitude, longitude, timeZone = "UTC" } = cleanObjectValues(req.body);

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
        const actualEndTime = dayjs().toDate();
        const startTime = dayjs(shift.actualStartTime || shift.start);
        const endTime = dayjs(actualEndTime);

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
                    status: "Completed",
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
        req.io.emit('shift_status_updated', {
            shift: updatedShift,
            type: 'check_out',
            message: `Guard ${guardUser.fullName} clocked out. Final Hours: ${paidHours}`
        });

        if (updatedShift.guardId && req.io) {
            req.io.to(updatedShift.guardId).emit('shift_check_out', { shift: shiftFormat, message: "Clock-out successful." });
        }

        res.status(200).json({
            message: "Clock-out successful. Shift completed.",
            isError: false,
            shift: shiftFormat,
            paidHours,
            geofenceStatus: checkoutGeofenceStatus
        });

    } catch (error) {
        console.error("Critical Check-Out Error:", error);
        res.status(500).json({ message: "Server error during clock-out.", isError: true });
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

// // Function to upload a file to Cloudinary
const uploadToCloudinary = (file) => {
    return new Promise((resolve, reject) => {
        const resourceType = file.mimetype.startsWith("video/") ? "video" : "image";

        const uploadStream = cloudinary.uploader.upload_stream(
            { folder: "incidents", resource_type: resourceType },  // Set resource type dynamically
            (error, result) => {
                if (error) return reject(error);
                resolve({
                    name: file.originalname,
                    url: result.secure_url,
                    type: file.mimetype,
                    publicId: result.public_id
                });
            }
        );
        uploadStream.end(file.buffer);
    });
};

// Route to upload attachments for a donation
router.post("/upload-attachments/:id", upload.array("files"), async (req, res) => {
    try {
        const { id } = req.params;
        if (!req.files?.length) { return res.status(400).json({ message: "No files uploaded", isError: true }); }

        const uploadedFiles = await Promise.all(req.files.map(uploadToCloudinary));

        const updatedShift = await Shifts.findOneAndUpdate({ id }, { $push: { attachments: { $each: uploadedFiles } } }, { new: true });

        const site = await Sites.findOne({ id: updatedShift.siteId }).lean()
        const guardUser = await Users.findOne({ uid: updatedShift.guardId }, 'fullName email uid');
        const customer = await Customers.findOne({ id: site.customerId })
        const shiftFormat = { ...updatedShift.toObject(), site, guard: guardUser, customer }

        if (!updatedShift) { return res.status(404).json({ message: "Shift not found", isError: true }); }

        req.io.emit('shift_incident', { shift: shiftFormat, type: 'incident', message: `Incident at ${shiftFormat.site.name}.` });
        res.status(200).json({ message: "Incidents uploaded successfully", shift: shiftFormat, isError: false });

    } catch (error) {
        console.error("Error uploading attachments:", error);
        res.status(500).json({ message: "Something went wrong", isError: true, error: error.message });
    }
});

router.get("/timesheets", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        const { startDate, endDate, guardId, siteId, timeZone = "UTC" } = req.query;

        const user = await Users.findOne({ uid });
        if (!user) return res.status(401).json({ message: "Unauthorized", isError: true });

        const query = {
            companyId: user.companyId,
            status: "Completed",
            "financials.totalPay": { $exists: true }
        };

        if (startDate && endDate) {
            query.actualStartTime = {
                $gte: dayjs(startDate).startOf('day').toDate(),
                $lte: dayjs(endDate).endOf('day').toDate()
            };
        }

        if (guardId) query.guardId = guardId;
        if (siteId) query.siteId = siteId;

        const shifts = await Shifts.find(query).sort({ actualStartTime: -1 });

        const enrichedShifts = await Promise.all(shifts.map(async (shift) => {
            const guard = await Users.findOne({ uid: shift.guardId }, 'fullName uid');
            const site = await Sites.findOne({ id: shift.siteId }, 'name');
            return {
                ...shift.toObject(),
                key: shift.id,
                guardName: guard?.fullName || "Unknown Guard",
                siteName: site?.name || "Unknown Site"
            };
        }));

        res.status(200).json({ success: true, timesheets: enrichedShifts });
    } catch (error) {
        console.error("Fetch Timesheets Error:", error);
        res.status(500).json({ message: "Failed to fetch timesheets", isError: true });
    }
});

router.patch("/approve-bulk", verifyToken, async (req, res) => {
    try {
        const { ids, isApproved } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: "Invalid shift IDs", isError: true });

        const result = await Shifts.updateMany(
            { id: { $in: ids } },
            { $set: { "financials.isApproved": isApproved } }
        );

        res.status(200).json({ success: true, message: `${result.modifiedCount} Timesheets ${isApproved ? 'Approved' : 'Revoked'}`, result });
    } catch (error) {
        console.error("Bulk Approve Error:", error);
        res.status(500).json({ message: "Failed to process bulk approval", isError: true });
    }
});

router.get("/incidents", verifyToken, async (req, res) => {
    try {

        const { uid } = req

        const user = await Users.findOne({ uid })
        if (!user) return res.status(401).json({ message: "Unauthorized access.", isError: true })


        const { startDate, endDate, timeZone } = cleanObjectValues(req.query);

        const currentTimeUTC = dayjs().tz(timeZone);

        let start = currentTimeUTC.startOf("day").toDate();
        let end = currentTimeUTC.endOf("day").toDate();

        if (startDate && endDate) {
            start = dayjs(startDate).startOf("day").toDate();
            end = dayjs(endDate).endOf("day").toDate();
        }
        const data = await Shifts.aggregate([
            {
                $match: {
                    companyId: user.companyId,
                    attachments: { $exists: true, $not: { $size: 0 } },
                    $or: [
                        { start: { $gte: start, $lte: end } },
                        { end: { $gte: start, $lte: end } }
                    ]
                }
            },
            { $lookup: { from: "sites", localField: "siteId", foreignField: "id", as: "site" } },
            { $unwind: "$site" },
            { $lookup: { from: "customers", localField: "customerId", foreignField: "id", as: "customer" } },
            { $unwind: "$customer" },
            { $lookup: { from: "users", localField: "guardId", foreignField: "uid", as: "guard" } },
            { $unwind: "$guard" },
            { $project: { customer: "$customer.name", name: "$site.name", fullName: "$guard.fullName", address: "$site.address", date: "$date", attachments: 1 } }
        ]);

        res.status(200).json({ incidents: data, total: data.length });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong" });
    }
});



// Import utilities (Top of file usually, but for tool context I'll add require here if needed, 
// though best practice is top. I'll rely on the existing imports being fine and just use the new one)
// Wait, I need to add the import at the top first, or just use require inside the handler if I want to be lazy (bad practice).
// I will split this into two edits: 1. Add import. 2. Update handler.
// ACTUALLY, I can do it in one Replace if I scope it right, but Imports are at top.
// I'll do the Handler update here.

// NOTE: I am assuming `notificationUtils` is imported. I will add the import in a separate step or just assume I can add it at top.
// Let's stick to updating the handler logic here.

router.patch("/publish", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        const { shiftIds, notificationMethod } = req.body; // notificationMethod: ['email', 'push']

        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const user = await Users.findOne({ uid });
        if (!user) return res.status(401).json({ message: "User not found", isError: true });

        if (!shiftIds || shiftIds.length === 0) {
            return res.status(400).json({ message: "No shifts selected to publish.", isError: true });
        }

        const query = { id: { $in: shiftIds }, companyId: user.companyId };

        // Update shifts
        const result = await Shifts.updateMany(query, { $set: { isPublished: true, status: "pending" } });

        // Send Notifications
        if (notificationMethod && Array.isArray(notificationMethod)) {
            // Fetch shifts and populate guard/site info
            const publishedShifts = await Shifts.aggregate([
                { $match: query },
                { $lookup: { from: "users", localField: "guardId", foreignField: "uid", as: "guard" } },
                { $unwind: { path: "$guard", preserveNullAndEmptyArrays: true } },
                { $lookup: { from: "sites", localField: "siteId", foreignField: "id", as: "site" } },
                { $unwind: { path: "$site", preserveNullAndEmptyArrays: true } }
            ]);

            const { sendEmailNotification, sendPushNotification } = require("../utils/notificationUtils");

            // Process Notifications asynchronously
            await Promise.all(publishedShifts.map(async (shift) => {
                if (shift.guard) {
                    const shiftData = { ...shift, siteName: shift.site?.name };

                    // EMAIL
                    if (notificationMethod.includes("email")) {
                        await sendEmailNotification(shift.guard, shiftData);
                    }

                    // PUSH
                    if (notificationMethod.includes("push")) {
                        await sendPushNotification(shift.guard.uid, "You have a new shift assignment.", shiftData);
                    }

                    // SOCKET IO
                    if (req.io) {
                        req.io.to(shift.guardId).emit("shift_published", { message: "New Shift Published", shift: shiftData });
                    }
                }
            }));
        }

        res.status(200).json({ message: "Shifts published successfully", count: result.modifiedCount, isError: false });

    } catch (error) {
        console.error("Error publishing shifts:", error);
        res.status(500).json({ message: "Something went wrong", isError: true });
    }
});


router.get("/suggestions", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        const { siteId, start, end } = cleanObjectValues(req.query);

        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const site = await Sites.findOne({ id: siteId });
        if (!site) return res.status(404).json({ message: "Site not found.", isError: true });

        const user = await Users.findOne({ uid });

        const guards = await Users.find({
            companyId: user.companyId,
            roles: "guard",
            status: "active"
        });

        const suggestions = [];

        for (const guard of guards) {
            let score = 100;
            const reasons = [];

            // Skill Match
            const missingSkills = (site.requiredSkills || []).filter(skill => !(guard.skills || []).includes(skill));
            if (missingSkills.length > 0) {
                score -= 50;
                reasons.push(`Missing skills: ${missingSkills.join(", ")}`);
            }

            // Conflict Check
            const conflict = await checkShiftConflict(guard.uid, start, end);
            if (conflict) {
                score = 0;
                reasons.push("Already has a shift at this time.");
            }

            // Compliance Check
            const compliance = await checkCompliance(guard.uid, start, end);
            if (!compliance.valid) {
                score -= 30;
                reasons.push(...compliance.warnings);
            }

            if (score > 0) {
                suggestions.push({ guard, score, reasons });
            }
        }

        suggestions.sort((a, b) => b.score - a.score);

        res.status(200).json({ suggestions });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error fetching suggestions", isError: true });
    }
});



// Helper: Send Notification
const notifyGuard = async (shift, guard, notificationMethod) => {
    const site = await Sites.findOne({ id: shift.siteId });
    const formattedDate = dayjs(shift.start).format("DD MMM YYYY");
    const formattedTime = `${dayjs(shift.start).format("HH:mm")} - ${dayjs(shift.end).format("HH:mm")}`;

    // 1. Email
    if (notificationMethod.includes("email") && guard.email) {
        const subject = `New Shift Assigned at ${site?.name}`;
        const html = `
            <h3>New Shift Assignment</h3>
            <p>Dear ${guard.firstName},</p>
            <p>You have been assigned a new shift.</p>
            <ul>
                <li><strong>Site:</strong> ${site?.name}</li>
                <li><strong>Date:</strong> ${formattedDate}</li>
                <li><strong>Time:</strong> ${formattedTime}</li> 
                <li><strong>Address:</strong> ${site?.address}</li>
            </ul>
            <p>Please log in to the app to acknowledge.</p>
        `;
        await sendMail(guard.email, subject, html);
    }

    // 2. Push Notification
    if (notificationMethod.includes("push") && guard.oneSignalPlayerId) {
        const title = "New Shift Assigned";
        const body = `You have a shift at ${site?.name} on ${formattedDate}`;
        await sendPushNotification(guard.oneSignalPlayerId, title, body, { shiftId: shift.id });
    }
};

router.patch("/publish", verifyToken, async (req, res) => {
    try {
        const { shiftIds, notificationMethod } = req.body;
        const { uid } = req;

        if (!shiftIds || shiftIds.length === 0) {
            return res.status(400).json({ message: "No shifts selected to publish", isError: true });
        }

        // Update status
        const updateResult = await Shifts.updateMany(
            { id: { $in: shiftIds } },
            { $set: { status: "Published", isPublished: true } }
        );

        // Fetch updated shifts to notify
        const shifts = await Shifts.find({ id: { $in: shiftIds } });

        let sentCount = 0;
        for (const shift of shifts) {
            const guard = await Users.findOne({ uid: shift.guardId });
            if (guard) {
                // Trigger Socket as well (existing logic)
                if (req.io) {
                    req.io.to(guard.uid).emit('new_shift_added', {
                        shift: shift.toObject(),
                        message: `New shift published at ${shift.siteId}`
                    });
                }

                try {
                    // Send Email/Push
                    await notifyGuard(shift, guard, notificationMethod || []);
                    sentCount++;
                } catch (err) {
                    console.error(`Failed to notify guard ${guard.uid} for shift ${shift.id}:`, err);
                }
            }
        }

        res.status(200).json({
            message: "Shifts published successfully",
            count: updateResult.modifiedCount,
            sentCount,
            isError: false
        });

    } catch (error) {
        console.error("Publish Error:", error);
        res.status(500).json({ message: "Failed to publish shifts", isError: true, error });
    }
});

router.post("/resend-notification/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const shift = await Shifts.findOne({ id });

        if (!shift) return res.status(404).json({ message: "Shift not found", isError: true });

        const guard = await Users.findOne({ uid: shift.guardId });
        if (!guard) return res.status(404).json({ message: "Guard not found associated with this shift", isError: true });

        // Default to both or check query? Assuming resend sends via all configured channels or defaults.
        const methods = ["email", "push"];

        await notifyGuard(shift, guard, methods);

        res.status(200).json({ message: "Notification resent successfully", isError: false });

    } catch (error) {
        console.error("Resend Error:", error);
        res.status(500).json({ message: "Failed to resend notification", isError: true, error });
    }
});

module.exports = router