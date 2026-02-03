const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middlewares/auth");
const Transactions = require("../models/Transactions");
const Customers = require("../models/customers")
const Sites = require("../models/sites")
const Shifts = require("../models/shifts");
const Users = require("../models/auth");
const Invoices = require("../models/invoices");
const Companies = require("../models/companies");
const { getRandomId, cleanObjectValues } = require("../config/global");

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

router.post(`/generate-invoice`, verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        if (!uid) { return res.status(401).json({ message: "Unauthorized access.", isError: true }); }

        let formData = req.body;
        let { rate, companyId, dueDate, billingBasis, billingPeriod, tax } = formData;

        if (!companyId || !dueDate || !billingBasis || !billingPeriod || !rate) {
            return res.status(400).json({ message: "Missing required fields", isError: true });
        }

        const countStrategies = {
            customers: () => Customers.countDocuments({ status: "active", companyId }),
            sites: () => Sites.countDocuments({ status: "active", companyId }),
            guards: () => Users.countDocuments({ status: "active", companyId, roles: { $in: ["guard"] } }),
            yearly: () => 1
        };

        const countFn = countStrategies[billingBasis];
        if (!countFn) {
            return res.status(400).json({ message: "Invalid billing basis", isError: true });
        }

        const quantity = await countFn();

        if (quantity === 0 && billingBasis !== 'yearly') {
            return res.status(400).json({ message: `No active ${billingBasis} found for this company.`, isError: true });
        }

        const subtotal = Number(rate) * Number(quantity);
        const taxAmount = Number(tax || 0);

        const totalAmount = subtotal + taxAmount;

        const invoiceId = getRandomId();

        const newInvoice = new Invoices({
            id: invoiceId,
            companyId,
            dueDate,
            billingPeriod,
            billingBasis,
            rate,
            quantity,
            subtotal,
            tax: taxAmount,
            totalAmount: Math.round(totalAmount),
            balanceDue: Math.round(totalAmount),
            createdBy: uid
        });

        await newInvoice.save();

        res.status(201).json({ message: "Invoice generated successfully", isError: false, invoice: newInvoice });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Something went wrong in API", error: error.message });
    }
})

router.get("/all", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        if (!uid) { return res.status(401).json({ message: "Unauthorized access.", isError: true }); }

        let { pageNo = 1, perPage = 10, status, search, companyId, startDate, endDate, ref } = cleanObjectValues(req.query);
        const timeZone = req.headers["x-timezone"] || req.query.timeZone || "UTC";

        pageNo = Number(pageNo);
        perPage = Number(perPage);

        const skip = (pageNo - 1) * perPage;
        const match = {};

        if (status) match.status = status;
        if (companyId) match.companyId = companyId;
        if (ref) match.ref = ref;

        if (startDate || endDate) {
            match.transactionDate = {};
            if (startDate) match.transactionDate.$gte = dayjs(startDate).tz(timeZone).startOf('day').utc(true).toDate();
            if (endDate) match.transactionDate.$lte = dayjs(endDate).tz(timeZone).endOf('day').utc(true).toDate();
        }

        const pipeline = [
            { $match: match },
            { $lookup: { from: "companies", localField: "companyId", foreignField: "id", as: "company" } },
            { $unwind: { path: "$company", preserveNullAndEmptyArrays: true } },
            { $lookup: { from: "invoices", localField: "invoiceId", foreignField: "id", as: "invoice" } },
            { $unwind: { path: "$invoice", preserveNullAndEmptyArrays: true } },
        ];

        if (search) {
            pipeline.push({
                $match: {
                    $or: [
                        { ref: { $regex: search, $options: "i" } },
                        { "company.name": { $regex: search, $options: "i" } },
                        { "company.registrationNo": { $regex: search, $options: "i" } },
                        { "invoice.invoiceNo": { $regex: search, $options: "i" } }
                    ]
                }
            });
        }

        pipeline.push(
            { $sort: { transactionDate: -1 } },
            {
                $facet: {
                    data: [{ $skip: skip }, { $limit: perPage }],
                    total: [{ $count: "count" }]
                }
            }
        );

        const result = await Transactions.aggregate(pipeline);

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
        const match = { status: "completed" };

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

// Approve Transactions (Payments)
router.post("/approve", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        const { transactionIds } = req.body;

        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });
        if (!transactionIds || !Array.isArray(transactionIds) || transactionIds.length === 0) {
            return res.status(400).json({ message: "No transactions selected", isError: true });
        }

        const transactions = await Transactions.find({ id: { $in: transactionIds }, status: "pending" });
        let approvedCount = 0;

        for (const trx of transactions) {
            trx.status = "approved";
            trx.approvedBy = uid;
            await trx.save();

            // Update Parent Invoice
            const invoice = await Invoices.findOne({ id: trx.invoiceId });
            if (invoice) {
                invoice.amountPaid += trx.amount;
                invoice.balanceDue = invoice.totalAmount - invoice.amountPaid;

                if (invoice.balanceDue <= 0) {
                    invoice.status = "paid";
                    invoice.balanceDue = 0;
                } else {
                    invoice.status = "partiallyPaid";
                }
                await invoice.save();
            }
            approvedCount++;
        }

        res.status(200).json({ message: `${approvedCount} transactions approved successfully`, isError: false });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong during approval", isError: true, error });
    }
});

// Helper for Hourly
router.get("/total-hours", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        const { startDate, endDate } = req.query;
        const timeZone = req.headers["x-timezone"] || req.query.timeZone || "UTC";

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
        const shifts = await Shifts.find({ guardId: uid, status: "completed", date: { $gte: start, $lte: end } });
        const totalHours = shifts?.reduce((sum, shift) => sum + (shift.totalHours || 0), 0);

        return res.json({ guard: { uid: user.uid, fullName: user.fullName, }, totalHours, shiftsCount: shifts.length });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Server error", error: error.message });
    }
});

module.exports = router;