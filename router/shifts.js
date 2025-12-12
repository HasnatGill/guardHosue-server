const express = require("express")
const Shifts = require("../models/shifts");
const Sites = require("../models/sites")
const Users = require("../models/auth")
const dayjs = require("dayjs");
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { verifyToken } = require("../middlewares/auth")
const { getRandomId, cleanObjectValues } = require("../config/global");

const storage = multer.memoryStorage()
const upload = multer({ storage })

dayjs.extend(utc);
dayjs.extend(timezone);

const router = express.Router()

router.post("/add", verifyToken, async (req, res) => {
    try {
        const { uid } = req;

        const user = await Users.findOne({ uid })
        if (!user) return res.status(401).json({ message: "Unauthorized access.", isError: true })

        let formData = req.body

        const shift = new Shifts({ ...formData, id: getRandomId(), createdBy: uid, companyId: user.companyId })
        await shift.save()

        let shiftObject = shift.toObject();
        const siteInfo = await Sites.findOne({ id: shiftObject.siteId }).select('-createdBy -__v -_id');
        if (siteInfo) { shiftObject.siteId = siteInfo.toObject(); }

        const guardId = shiftObject.guardId;

        if (guardId && req.io) {
            req.io.to(guardId).emit('new_shift_added', { shift: shiftObject, message: `Your new shift add at ${shiftObject?.siteId?.name}`, });
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
        const { guardId: newGuardId } = req.body;
        const updatedData = { ...req.body };

        if (!uid) { return res.status(401).json({ message: "Unauthorized access.", isError: true }); }

        const existingShift = await Shifts.findOne({ id });
        if (!existingShift) { return res.status(404).json({ message: "Shift not found.", isError: true }); }

        const oldGuardId = existingShift.guardId;

        const updatedShift = await Shifts.findOneAndUpdate(
            { id },
            { $set: updatedData },
            { new: true }
        );

        const guardUser = await Users.findOne({ uid: updatedShift.guardId }, 'fullName uid');
        const siteData = await Sites.findOne({ id: updatedShift.siteId }, 'name city address');

        const shiftToSend = {
            ...updatedShift.toObject(),
            guardName: guardUser ? guardUser.fullName : "",
            siteName: siteData ? siteData.name : "",
            siteAddress: siteData ? siteData.address : "",
            siteCity: siteData ? JSON.parse(siteData.city || '{}').label : "",
        };

        const shiftMessage = `Your shift Update at ${shiftToSend.siteName}`;

        if (req.io) {
            if (newGuardId && newGuardId !== oldGuardId) {
                req.io.to(oldGuardId).emit('remove_shift_from_admin', { shift: shiftToSend, message: `Your shift has been removed from ${shiftToSend.siteName}` });
                req.io.to(newGuardId).emit('new_shift_added', { shift: shiftToSend, message: `You have been assigned a new shift at ${shiftToSend.siteName}` });
            }
            else if (updatedShift.guardId) {
                req.io.to(updatedShift.guardId).emit('shift_update_from_admin', { shift: shiftToSend, message: shiftMessage });
            }
        }

        res.status(200).json({ message: "Shift updated successfully", isError: false, shift: updatedShift });
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

        const currentTimeUTC = dayjs.utc().startOf("day");

        const startOfDayUTC = currentTimeUTC.startOf("day").toDate();
        const endOfDayUTC = currentTimeUTC.endOf("day").toDate();
        const now = currentTimeUTC.toDate();

        await Shifts.updateMany(
            { liveStatus: 'awaiting', end: { $lt: now } },
            { $set: { liveStatus: 'missed', status: "inactive" } }
        );

        const pipeline = [
            {
                $match: {
                    start: { $gte: startOfDayUTC, $lte: endOfDayUTC },
                }
            },
            { $lookup: { from: "sites", localField: "siteId", foreignField: "id", as: "siteDetails" } },
            { $unwind: "$siteDetails" },
            { $lookup: { from: "customers", localField: "siteDetails.customerId", foreignField: "id", as: "customerDetails" } },
            { $unwind: "$customerDetails" },
            { $match: { "customerDetails.companyId": user.companyId } },
            { $lookup: { from: "users", localField: "guardId", foreignField: "uid", as: "guardDetails" } },
            { $unwind: "$guardDetails" },
            { $project: { _id: 0, id: "$id", liveStatus: "$liveStatus", checkIn: "$checkIn", customer: "$customerDetails.name", site: "$siteDetails.name", name: "$guardDetails.fullName", status: "$status", startTime: "$start", endTime: "$end", checkOut: "$checkOut", guardId: "$guardId" } },
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

        if (shift.guardId && req.io) { req.io.to(shift.guardId).emit('remove_shift_from_admin', { shift, message: `Shift remove`, }); }
        res.status(200).json({ message: "Shift deleted successfully", id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong", isError: true });
    }
});

const getShiftCounts = async (date, companyId) => {
    const counts = await Shifts.aggregate([{ $match: { start: { $gte: date }, companyId: companyId } }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
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

        const { status, siteId, guardName, email, date, perPage, pageNo } = cleanObjectValues(req.query);

        const page = parseInt(pageNo) || 1;
        const limit = parseInt(perPage) || 10;
        const skip = (page - 1) * limit;

        let matchQuery = {};

        if (status) { matchQuery.status = status; }
        matchQuery.companyId = user.companyId

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

            { $project: { id: '$id', start: '$start', end: '$end', date: '$date', status: '$status', reason: "$reason", liveStatus: '$liveStatus', totalHours: '$totalHours', siteId: '$siteId', siteName: '$siteInfo.name', guardId: '$guardId', guardName: '$guardInfo.fullName', guardEmail: '$guardInfo.email', } },
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

        const guardUser = await Users.findOne({ uid: guardId }, 'fullName uid');
        const siteData = await Sites.findOne({ id: updatedShift.siteId }, 'name city address');

        const shiftToSend = {
            ...updatedShift.toObject(),
            guardName: guardUser ? guardUser.fullName : "",
            siteName: siteData ? siteData.name : "",
            guardEmail: guardUser ? guardUser.email : "",
            siteAddress: siteData ? siteData.address : "",
            siteCity: siteData ? JSON.parse(siteData.city || '{}').label : "",
        };

        if (guardId && req.io) { req.io.to(guardId).emit('request_approved', { shift: shiftToSend, message: `Your Request approved`, }); }

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
        const guardUser = await Users.findOne({ uid: updatedShift.guardId }, 'fullName email uid');
        const siteData = await Sites.findOne({ id: updatedShift.siteId }, 'name city address');

        const shiftToSend = {
            ...updatedShift.toObject(),
            guardName: guardUser ? guardUser.fullName : "",
            guardEmail: guardUser ? guardUser.email : "",
            siteName: siteData ? siteData.name : "",
            siteAddress: siteData ? siteData.address : "",
            siteCity: siteData ? JSON.parse(siteData.city || '{}').label : "",
        };

        req.io.emit('new_request', { shift: shiftToSend, message: `Request for approval shift.` });

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

        const guardUser = await Users.findOne({ uid: updatedShift.guardId }, 'fullName email uid');
        const siteData = await Sites.findOne({ id: updatedShift.siteId }, 'name city address');

        const shiftToSend = {
            ...updatedShift.toObject(),
            guardName: guardUser ? guardUser.fullName : "",
            guardEmail: guardUser ? guardUser.email : "",
            siteName: siteData ? siteData.name : "",
            siteAddress: siteData ? siteData.address : "",
            siteCity: siteData ? JSON.parse(siteData.city || '{}').label : "",
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
        const { id: shiftId } = req.params;

        const { checkInTime } = cleanObjectValues(req.query);

        const updatedShift = await Shifts.findOneAndUpdate(
            { id: shiftId },
            { $set: { status: "active", liveStatus: "checkIn", checkIn: checkInTime } },
            { new: true }
        );

        const site = await Sites.findOne({ id: updatedShift.siteId }).lean()
        const guardUser = await Users.findOne({ uid: updatedShift.guardId }, 'fullName email uid');
        const shiftFormat = { ...updatedShift.toObject(), site, guard: guardUser }

        if (!updatedShift) { return res.status(404).json({ message: "Shift not found.", isError: true }); }

        req.io.emit('shift_check_in', { shift: updatedShift, type: 'check_in', message: `Shift Chock In. by ${guardUser.fullName}` });
        if (updatedShift.guardId && req.io) { req.io.to(updatedShift.guardId).emit('shift_check_in', { shift: shiftFormat, message: `Shift clock-in`, }); }

        res.status(200).json({ message: "Check-in successful and shift updated.", isError: false, shift: updatedShift });

    } catch (error) {
        console.error("Check-In Error:", error);
        res.status(500).json({ message: "Something went wrong during check-in", isError: true, error });
    }
});

router.patch("/check-out/:id", verifyToken, async (req, res) => {
    try {
        const { id: shiftId } = req.params;
        const { status = "inactive", liveStatus = "checkOut", checkOutTime } = cleanObjectValues(req.query);


        const updatedShift = await Shifts.findOneAndUpdate(
            { id: shiftId },
            { $set: { status: status, liveStatus: liveStatus, checkOut: checkOutTime } },
            { new: true }
        );

        const site = await Sites.findOne({ id: updatedShift.siteId }).lean()
        const guardUser = await Users.findOne({ uid: updatedShift.guardId }, 'fullName email uid');
        const shiftFormat = { ...updatedShift.toObject(), site, guard: guardUser }

        if (!updatedShift) { return res.status(404).json({ message: "Shift not found.", isError: true }); }

        req.io.emit('shift_check_out', { shift: updatedShift, type: 'check_Out', message: `Shift Check Out.` });
        if (updatedShift.guardId && req.io) { req.io.to(updatedShift.guardId).emit('shift_check_out', { shift: shiftFormat, message: `Shift clock-Out`, }); }

        res.status(200).json({ message: "Check-Out successful and shift updated.", isError: false, shift: shiftFormat });

    } catch (error) {
        console.error("Check-In Error:", error);
        res.status(500).json({ message: "Something went wrong during check-in", isError: true, error });
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

        // Upload all files concurrently
        const uploadedFiles = await Promise.all(req.files.map(uploadToCloudinary));

        // Update only the attachments field
        const updatedTransaction = await Shifts.findOneAndUpdate({ id }, { $push: { attachments: { $each: uploadedFiles } } }, { new: true });

        if (!updatedTransaction) { return res.status(404).json({ message: "Transaction not found", isError: true }); }

        res.status(200).json({ message: "Attachments uploaded successfully", attachments: uploadedFiles, isError: false });

    } catch (error) {
        console.error("Error uploading attachments:", error);
        res.status(500).json({ message: "Something went wrong", isError: true, error: error.message });
    }
});


module.exports = router