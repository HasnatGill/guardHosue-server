const express = require("express")
const Shifts = require("../models/shifts");
const Sites = require("../models/sites")
const Users = require("../models/auth")
const dayjs = require("dayjs");
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { verifyToken } = require("../middlewares/auth")
const { getRandomId, cleanObjectValues } = require("../config/global");

dayjs.extend(utc);
dayjs.extend(timezone);

const router = express.Router()

router.post("/add", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        let formData = req.body

        const shift = new Shifts({ ...formData, id: getRandomId(), createdBy: uid })
        await shift.save()

        let shiftObject = shift.toObject();
        const siteInfo = await Sites.findOne({ id: shiftObject.siteId }).select('-createdBy -__v -_id');
        if (siteInfo) { shiftObject.siteId = siteInfo.toObject(); }

        const guardId = shiftObject.guardId;

        if (guardId && req.io) {
            req.io.to(guardId).emit('new_shift_added', { shift: shiftObject, message: `Your new shift add at ${shiftObject?.site?.name}`, });
            console.log(`Shift data sent to Guard Room: ${guardId}`);
        }

        res.status(201).json({ message: "Your shift added has been successfully", isError: false, shift })

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
                            $push: { id: "$shifts.id", guardId: "$shifts.guardId", siteId: "$shifts.siteId", breakTime: "$shifts.breakTime", date: "$shifts.date", employeeName: "$guardInfo.fullName", start: "$shifts.start", end: "$shifts.end", status: "$shifts.status", liveStatus: "$shifts.liveStatus", totalHours: "$shifts.totalHours" }
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
                        shifts: { $push: { id: "$shifts.id", guardId: "$shifts.guardId", siteId: "$shifts.siteId", breakTime: "$shifts.breakTime", date: "$shifts.date", siteName: "$siteInfo.name", start: "$shifts.start", end: "$shifts.end", status: "$shifts.status", liveStatus: "$shifts.liveStatus", totalHours: "$shifts.totalHours" } }
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
            { $project: { _id: 0, id: 1, date: 1, start: 1, end: 1, status: 1, liveStatus: 1, breakTime: 1, totalHours: 1, siteId: 1, siteName: "$siteInfo.name", siteAddress: "$siteInfo.address" } }
        ]);

        console.log('shifts', shifts)
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

        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const existingShift = await Shifts.findOne({ id });
        if (!existingShift) return res.status(404).json({ message: "Shift not found.", isError: true });

        const updatedData = { ...req.body };

        const updatedShift = await Shifts.findOneAndUpdate(
            { id },
            { $set: updatedData },
            { new: true }
        );

        res.status(200).json({ message: "Shift updated successfully", isError: false, shift: updatedShift });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while updating the shift", isError: true, error });
    }
});


router.get("/live-operations", verifyToken, async (req, res) => {
    try {

        const { uid } = req

        const user = await Users.findOne({ uid })
        if (!user) return res.status(401).json({ message: "Unauthorized access.", isError: true })

        const currentTimeUTC = dayjs.utc().startOf("day");
        
        const startOfDayUTC = currentTimeUTC.startOf("day").toDate();
        const endOfDayUTC = currentTimeUTC.endOf("day").toDate();

        const missedThreshold = currentTimeUTC.subtract(5, 'minutes').toDate();

        await Shifts.updateMany(
            { liveStatus: 'awaiting', start: { $lt: missedThreshold, $gte: startOfDayUTC } },
            { $set: { liveStatus: 'missed' } }
        );


        const pipeline = [
            {
                $match: {
                    start: { $gte: startOfDayUTC, $lte: endOfDayUTC },
                    end: { $gte: startOfDayUTC, $lte: endOfDayUTC }
                }
            },
            { $lookup: { from: "sites", localField: "siteId", foreignField: "id", as: "siteDetails" } },
            { $unwind: "$siteDetails" },
            { $lookup: { from: "customers", localField: "siteDetails.customerId", foreignField: "id", as: "customerDetails" } },
            { $unwind: "$customerDetails" },
            { $match: { "customerDetails.companyId": user.companyId } },
            { $lookup: { from: "users", localField: "guardId", foreignField: "uid", as: "guardDetails" } },
            { $unwind: "$guardDetails" },
            { $project: { _id: 0, shiftId: "$id", customer: "$customerDetails.name", site: "$siteDetails.name", name: "$guardDetails.fullName", status: "$liveStatus", startTime: "$start", endTime: "$end", guardId: "$guardId" } },
            { $sort: { startTime: 1 } }
        ];

        const shifts = await Shifts.aggregate(pipeline);

        return res.status(200).json({ message: `Live shifts fetched for.`, shifts });

    } catch (error) {
        console.error("Error fetching live operations:", error);
        res.status(500).json({ message: "Server error during live operations fetch." });
    }
});

router.delete("/single/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;

        const shift = await Shifts.findOneAndDelete({ id });
        if (!shift) return res.status(404).json({ message: "Shift not found", isError: true });

        res.status(200).json({ message: "Shift deleted successfully", id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong", isError: true });
    }
});

const getShiftCounts = async (date) => {
    const counts = await Shifts.aggregate([{ $match: { start: { $gte: date } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
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
        const { status, siteId, guardName, email, date, perPage, pageNo } = cleanObjectValues(req.query);

        const page = parseInt(pageNo) || 1;
        const limit = parseInt(perPage) || 10;
        const skip = (page - 1) * limit;

        let matchQuery = {};

        if (status) { matchQuery.status = status; }

        const currentTimeUTC = dayjs.utc();
        const startOfDayUTC = currentTimeUTC.startOf("day").toDate();

        matchQuery.start = { $gte: startOfDayUTC };

        if (date) {
            const selectedDate = new Date(date);
            const nextDate = new Date(selectedDate);
            nextDate.setDate(selectedDate.getDate() + 1);

            matchQuery.date = { $gte: selectedDate, $lt: nextDate };
            delete matchQuery.start;
            matchQuery.date = { $gte: selectedDate, $lt: nextDate };
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

            {
                $project: {
                    id: '$id',
                    start: '$start',
                    end: '$end',
                    date: '$date',
                    status: '$status',
                    reason: "$reason",
                    liveStatus: '$liveStatus',
                    totalHours: '$totalHours',
                    siteId: '$siteId',
                    siteName: '$siteInfo.name',
                    guardId: '$guardId',
                    guardName: '$guardInfo.fullName',
                    guardEmail: '$guardInfo.email',
                }
            },
            { $sort: { start: 1 } },
            { $facet: { metadata: [{ $count: "totals" }], data: [{ $skip: skip }, { $limit: limit }] } }
        ];

        const [results] = await Shifts.aggregate(pipeline);

        const shifts = results.data;
        const totals = results.metadata[0]?.totals || 0;
        const counts = await getShiftCounts(startOfDayUTC);

        res.status(200).json({ shifts, counts, totals, isError: false });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while fetching shifts", isError: true, error });
    }
});

router.patch("/updated-status/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { uid } = req;
        const { status } = req.body

        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const existingShift = await Shifts.findOne({ id });
        if (!existingShift) return res.status(404).json({ message: "Shift not found.", isError: true });

        const updatedShift = await Shifts.findOneAndUpdate(
            { id },
            { $set: { status: status } },
            { new: true }
        );

        const guardId = updatedShift.guardId;

        if (guardId && req.io) {
            req.io.to(guardId).emit('update_request', { shift: updatedShift, message: `Your Request Update`, });
        }

        res.status(200).json({ message: "Shift updated successfully", isError: false, shift: updatedShift });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while updating the shift", isError: true, error });
    }
});

router.patch("/request-approval/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { uid } = req;

        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const existingShift = await Shifts.findOne({ id });
        if (!existingShift) return res.status(404).json({ message: "Shift not found.", isError: true });

        const updatedShift = await Shifts.findOneAndUpdate(
            { id },
            { $set: { status: "request", reason: "Approval Shift" } },
            { new: true }
        );

        req.io.emit('shift_request', { shift: updatedShift, type: 'check_in', message: `Shift Check In.` });

        res.status(200).json({ message: "Approval Request sent successfully", isError: false, shift: updatedShift });
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

        res.status(200).json({ message: "Request sent successfully", isError: false, shift: updatedShift });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while sending request for shift", isError: true, error });
    }
});


router.patch("/check-in/:id", verifyToken, async (req, res) => {
    try {
        const { id: shiftId } = req.params;
        const { status = "active", liveStatus = "checkIn" } = req.body;

        const currentCheckInTime = new Date()

        const updatedShift = await Shifts.findOneAndUpdate(
            { id: shiftId },
            { $set: { status: status, liveStatus: liveStatus, checkIn: currentCheckInTime } },
            { new: true }
        );

        const site = await Sites.findOne({ id: updatedShift.siteId }).lean()

        const shiftFormat = { ...updatedShift.toObject(), site }

        if (!updatedShift) { return res.status(404).json({ message: "Shift not found.", isError: true }); }

        req.io.emit('shift_check_in', { shift: shiftFormat, type: 'check_in', message: `Shift Check In.` });

        res.status(200).json({ message: "Check-in successful and shift updated.", isError: false, shift: shiftFormat });

    } catch (error) {
        console.error("Check-In Error:", error);
        res.status(500).json({ message: "Something went wrong during check-in", isError: true, error });
    }
});

router.patch("/check-out/:id", verifyToken, async (req, res) => {
    try {
        const { id: shiftId } = req.params;
        const { status = "inactive", liveStatus = "checkOut" } = req.body;

        const currentCheckInTime = dayjs.utc(true)

        const updatedShift = await Shifts.findOneAndUpdate(
            { id: shiftId },
            { $set: { status: status, liveStatus: liveStatus, CheckOut: currentCheckInTime } },
            { new: true }
        );

        if (!updatedShift) { return res.status(404).json({ message: "Shift not found.", isError: true }); }

        req.io.emit('shift_check_out', { shift: updatedShift, type: 'check_Out', message: `Shift Check Out.` });

        res.status(200).json({ message: "Check-Out successful and shift updated.", isError: false, shift: shiftObject });

    } catch (error) {
        console.error("Check-In Error:", error);
        res.status(500).json({ message: "Something went wrong during check-in", isError: true, error });
    }
});


module.exports = router