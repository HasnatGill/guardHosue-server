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

        let start = null;
        let end = null;

        if (startDate) {
            const s = new Date(startDate);
            s.setUTCHours(0, 0, 0, 0);
            start = s.toISOString();
        }

        if (endDate) {
            const e = new Date(endDate);
            e.setUTCHours(23, 59, 59, 999);
            end = e.toISOString();
        }


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

        const { startDate, endDate } = cleanObjectValues(req.query);

        const dateFilter = startDate && endDate ? { date: { $gte: new Date(startDate), $lte: new Date(`${endDate}T23:59:59.999Z`) } } : {};

        const shifts = await Shifts.aggregate([
            { $match: { guardId: uid, ...dateFilter } },

            { $lookup: { from: "sites", localField: "siteId", foreignField: "id", as: "siteInfo" } },
            { $unwind: { path: "$siteInfo", preserveNullAndEmptyArrays: true } },
            { $project: { _id: 0, id: 1, date: 1, start: 1, end: 1, status: 1, liveStatus: 1, totalHours: 1, siteId: 1, siteName: "$siteInfo.name", siteAddress: "$siteInfo.address" } }
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

        const currentTimeUTC = dayjs.utc();
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
                    start: { $gte: startOfDayUTC, $lte: endOfDayUTC }
                }
            },
            { $lookup: { from: "sites", localField: "siteId", foreignField: "id", as: "siteDetails" } },
            { $unwind: "$siteDetails" },
            { $lookup: { from: "customers", localField: "siteDetails.customerId", foreignField: "id", as: "customerDetails" } },
            { $unwind: "$customerDetails" },
            { $match: { "customerDetails.companyId": user.companyId } },
            { $lookup: { from: "users", localField: "guardId", foreignField: "uid", as: "guardDetails" } },
            { $unwind: "$guardDetails" },
            { $project: { _id: 0, shiftId: "$id", customer: "$customerDetails.name", site: "$siteDetails.name", name: "$guardDetails.fullName", status: "$liveStatus", startTime: "$start", endTime: "$end", } },
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


module.exports = router