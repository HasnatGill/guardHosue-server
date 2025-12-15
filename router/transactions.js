const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middlewares/auth");
const Transactions = require("../models/Transactions");
const Shift = require("../models/shifts");
const Users = require("../models/auth");


const customersSitesPipeline = (match) => [
    { $match: match },

    {
        $group: {
            _id: { siteId: "$siteId", customerId: "$customerId" },
            totalHours: { $sum: "$totalHours" },
        },
    },

    {
        $lookup: {
            from: "sites",
            localField: "_id.siteId",
            foreignField: "id",
            as: "site",
        },
    },
    { $unwind: "$site" },

    {
        $lookup: {
            from: "customers",
            localField: "_id.customerId",
            foreignField: "id",
            as: "customer",
        },
    },
    { $unwind: "$customer" },

    {
        $project: {
            _id: 0,
            id: "$site.id",
            customerId: "$customer.id",
            customerName: "$customer.name",
            name: "$site.name",
            country: "$site.country",
            city: "$site.city",
            totalHours: { $round: ["$totalHours", 2] },
        },
    },
];

const guardsPipeline = (match) => [
    { $match: match },

    {
        $group: {
            _id: "$guardId",
            totalHours: { $sum: "$totalHours" },
        },
    },

    {
        $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "uid",
            as: "guard",
        },
    },
    { $unwind: "$guard" },

    {
        $project: {
            _id: 0,
            uid: "$guard.uid",
            fullName: "$guard.fullName",
            email: "$guard.email",
            phone: "$guard.phone",
            companyId: "$guard.companyId",
            totalHours: { $round: ["$totalHours", 2] },
        },
    },
];

router.get("/all", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        if (!uid) { return res.status(401).json({ message: "Unauthorized access.", isError: true }); }

        let { pageNo = 1, perPage = 10, status, ref, companyId, startDate, endDate } = req.query;

        pageNo = Number(pageNo);
        perPage = Number(perPage);

        const skip = (pageNo - 1) * perPage;
        const match = {};

        if (status) match.status = status;
        if (ref) match.ref = { $regex: ref, $options: "i" };
        if (companyId) match.companyId = companyId;
        if (startDate || endDate) match.transactionDate = {};
        if (startDate) match.transactionDate.$gte = new Date(startDate);
        if (endDate) match.transactionDate.$lte = new Date(endDate);

        const result = await Transactions.aggregate([
            { $match: match },

            {
                $lookup: {
                    from: "companies",
                    localField: "companyId",
                    foreignField: "id",
                    as: "company"
                }
            },

            { $unwind: { path: "$company", preserveNullAndEmptyArrays: true } },
            {
                $facet: {
                    data: [
                        { $sort: { transactionDate: -1 } },
                        { $skip: skip },
                        { $limit: perPage }
                    ],
                    total: [{ $count: "count" }]
                }
            }
        ]);

        const [{ data, total }] = result;

        const totalCount = total?.[0]?.count || 0;

        res.status(200).json({ transactions: data, total: totalCount });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to fetch transactions" });
    }
});


router.get("/finance-hourly", verifyToken, async (req, res) => {
    try {

        const { uid } = req;
        const user = await Users.findOne({ uid })
        if (!user) { return res.status(401).json({ message: "Unauthorized access.", isError: true }); }

        const { tab, customerId, siteId, guardId, startDate, endDate, } = req.query;
        const match = { liveStatus: "checkOut", status: "inactive", };

        if (customerId) match.customerId = customerId;
        if (siteId) match.siteId = siteId;
        if (guardId) match.guardId = guardId;
        if (user) match.companyId = user.companyId

        if (startDate && endDate) { match.date = { $gte: new Date(startDate), $lte: new Date(endDate), } }

        const pipeline =
            tab === "guards"
                ? guardsPipeline(match)
                : customersSitesPipeline(match);

        const data = await Shift.aggregate(pipeline);
        res.json({ data });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Finance API Error" });
    }
})

module.exports = router;