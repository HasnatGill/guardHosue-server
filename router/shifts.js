const express = require("express")
const Shifts = require("../models/shifts");
// const Customers = require("../models/customers")
const { verifyToken } = require("../middlewares/auth")
const { getRandomId } = require("../config/global");

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


router.get("/all/:customerId/:module", verifyToken, async (req, res) => {
    try {

        const { uid } = req;
        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        // const {customerId} = req.params

        // const { status, customerId, name, longitude, latitude, perPage = 10, pageNo = 1 } = cleanObjectValues(req.query);

        const match = {}

        const shifts = await Shifts.aggregate([
            { $match: match },
            { $lookup: { from: "customers", localField: "customerId", foreignField: "id", as: "customer" } },
            { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
            { $addFields: { customer: { $ifNull: ["$customer.name", "Unknown Customer"] } } },
            { $sort: { createdAt: -1 } },
            { $skip: (pageNo - 1) * perPage },
            { $limit: Number(perPage) }
        ])

        const counts = await Shifts.aggregate([
            {
                $group: {
                    _id: null,
                    active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
                    inactive: { $sum: { $cond: [{ $eq: ["$status", "inactive"] }, 1, 0] } },
                }
            }
        ]);

        const total = await Sites.countDocuments(match)
        const countResult = counts[0] || { active: 0, inactive: 0 };

        res.status(200).json({ message: "Sites fetched", isError: false, sites, total, count: { active: countResult.active, inactive: countResult.inactive } })
    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong while getting the sites", isError: true, error })
    }
})
