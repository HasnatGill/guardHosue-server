const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middlewares/auth");
const Transactions = require("../models/Transactions");
const Shifts = require("../models/shifts");
const Users = require("../models/auth");

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);


const customersSitesPipeline = (match) => [
    { $match: match },
    { $group: { _id: { siteId: "$siteId", customerId: "$customerId" }, totalHours: { $sum: "$totalHours" }, totalPayments: { $sum: "$totalPayments" } }, },
    { $lookup: { from: "sites", localField: "_id.siteId", foreignField: "id", as: "site", }, },
    { $unwind: "$site" },
    { $lookup: { from: "customers", localField: "_id.customerId", foreignField: "id", as: "customer", }, },
    { $unwind: "$customer" },
    { $project: { _id: 0, id: "$site.id", customerId: "$customer.id", customerName: "$customer.name", name: "$site.name", country: "$site.country", city: "$site.city", totalHours: { $round: ["$totalHours", 2] }, totalPayments: { $round: ["$totalPayments", 2] } }, },
];

const guardsPipeline = (match) => [
    { $match: match },
    { $group: { _id: "$guardId", totalHours: { $sum: "$totalHours" }, totalPayments: { $sum: "$totalPayments" } }, },
    { $lookup: { from: "users", localField: "_id", foreignField: "uid", as: "guard", }, },
    { $unwind: "$guard" },
    { $project: { _id: 0, uid: "$guard.uid", fullName: "$guard.fullName", email: "$guard.email", phone: "$guard.phone", companyId: "$guard.companyId", totalHours: { $round: ["$totalHours", 2] }, totalPayments: { $round: ["$totalPayments", 2] } }, },
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
            { $lookup: { from: "companies", localField: "companyId", foreignField: "id", as: "company" } },
            { $unwind: { path: "$company", preserveNullAndEmptyArrays: true } },
            {
                $facet: {
                    data: [{ $sort: { transactionDate: -1 } }, { $skip: skip }, { $limit: perPage }],
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

        const data = await Shifts.aggregate(pipeline);
        res.json({ data });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Finance API Error" });
    }
})

router.get("/total-hours", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        const { startDate, endDate, timeZone } = req.query;

        if (!uid) return res.status(400).json({ message: "Unauthorized access." });

        const user = await Users.findOne({ uid });
        if (!user) return res.status(404).json({ message: "User not found" });

        let start, end;
        const now = dayjs().tz(timeZone).utc(true);

        if (startDate && endDate) {
            start = dayjs(startDate).tz(timeZone).startOf("day").toDate();
            end = dayjs(endDate).tz(timeZone).endOf("day").toDate();
        } else {
            start = now.startOf("month").toDate();
            end = now.endOf("month").toDate();
        }
        const shifts = await Shifts.find({ guardId: uid, liveStatus: "checkOut", status: "inactive", date: { $gte: start, $lte: end } });
        const totalHours = shifts?.reduce((sum, shift) => sum + (shift.totalHours || 0), 0);

        return res.json({ guard: { uid: user.uid, fullName: user.fullName, }, totalHours, shiftsCount: shifts.length });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Server error", error: error.message });
    }
});

module.exports = router;