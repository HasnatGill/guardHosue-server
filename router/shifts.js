const express = require("express")
const Shifts = require("../models/shifts");
const Sites = require("../models/sites")
const Users = require("../models/auth")
const { verifyToken } = require("../middlewares/auth")
const { getRandomId, cleanObjectValues } = require("../config/global");

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

        const start = startDate ? new Date(startDate) : null;
        const end = endDate ? new Date(endDate) : null;

        const shiftDateMatch = {};
        if (start && end) { shiftDateMatch.date = { $gte: start, $lte: end }; }

        let match = {};

        if (model === "Sites") {

            if (customerId) match.customerId = customerId
            if (user.companyId) match.companyId = user.companyId

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
                            $push: { id: "$shifts.id", date: "$shifts.date", employeeName: "$guardInfo.fullName", start: "$shifts.start", end: "$shifts.end", status: "$shifts.status", liveStatus: "$shifts.liveStatus", totalHours: "$shifts.totalHours" }
                        }
                    }
                },
                {
                    $project: {
                        _id: 0, id: "$_id", name: 1,
                        shifts: {
                            $filter: {
                                input: "$shifts",
                                as: "s",
                                cond: {
                                    $and: [
                                        { $ne: ["$$s.id", null] },
                                        { $gte: ["$$s.date", start] },
                                        { $lte: ["$$s.date", end] }
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

            const result = await Users.aggregate([
                { $match: match },
                { $lookup: { from: "shifts", localField: "uid", foreignField: "guardId", as: "shifts" } },
                { $unwind: { path: "$shifts", preserveNullAndEmptyArrays: true } },
                { $lookup: { from: "sites", localField: "shifts.siteId", foreignField: "id", as: "siteInfo" } },
                { $unwind: { path: "$siteInfo", preserveNullAndEmptyArrays: true } },
                {
                    $group: {
                        _id: "$uid", name: { $first: "$fullName" },
                        shifts: { $push: { id: "$shifts.id", date: "$shifts.date", siteName: "$siteInfo.name", start: "$shifts.start", end: "$shifts.end", status: "$shifts.status", liveStatus: "$shifts.liveStatus", totalHours: "$shifts.totalHours" } }
                    }
                },
                {
                    $project: {
                        _id: 0, id: "$_id", name: 1,
                        shifts: {
                            $filter: {
                                input: "$shifts",
                                as: "s",
                                cond: {
                                    $and: [
                                        { $ne: ["$$s.id", null] },
                                        { $gte: ["$$s.date", start] },
                                        { $lte: ["$$s.date", end] }
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



module.exports = router