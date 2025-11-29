// routes/transactions.js
const express = require("express");
const router = express.Router();
const Transactions = require("../models/Transactions");
const Companies = require("../models/companies");
const { verifyToken } = require("../middlewares/auth");

// router.get("/all", verifyToken, async (req, res) => {
//     try {
//         const { pageNo = 1, perPage = 10, status } = req.query;
//         const query = status ? { status } : {};

//         const transactions = await Transactions.find(query).sort({ transactionDate: -1 }).skip((pageNo - 1) * perPage).limit(Number(perPage)).lean();

//         // Fetch company details
//         const companyIds = transactions.map(t => t.companyId);
//         const companies = await Companies.find({ id: { $in: companyIds } })
//             .select("id name registrationNo")
//             .lean();

//         const companyMap = companies.reduce((acc, c) => { acc[c.id] = c; return acc; }, {});

//         const data = transactions.map(t => ({ ...t, company: companyMap[t.companyId] || {} }));

//         const total = await Transactions.countDocuments(query);

//         res.status(200).json({ transactions: data, total });
//     } catch (error) {
//         console.error(error);
//         res.status(500).json({ message: "Failed to fetch transactions" });
//     }
// });

router.get("/all", async (req, res) => {
    try {
        const { pageNo = 1, perPage = 10, status, ref, companyName, startDate, endDate } = req.query;

        const query = {};
        if (status) query.status = status;
        if (ref) query.ref = { $regex: ref, $options: "i" };

        if (startDate || endDate) query.transactionDate = {};
        if (startDate) query.transactionDate.$gte = new Date(startDate);
        if (endDate) query.transactionDate.$lte = new Date(endDate);

        const transactions = await Transactions.find(query).sort({ transactionDate: -1 }).skip((pageNo - 1) * perPage).limit(Number(perPage)).lean();

        let companyIds = transactions.map(t => t.companyId);
        let companiesQuery = {};
        if (companyName) companiesQuery.name = { $regex: companyName, $options: "i" };
        const companies = await Companies.find({ id: { $in: companyIds }, ...companiesQuery }).select("id name registrationNo expirePackage").lean();

        const companyMap = companies.reduce((acc, c) => { acc[c.id] = c; return acc; }, {});

        const data = transactions.map(t => ({ ...t, company: companyMap[t.companyId] || null })).filter(t => t.company !== null);

        const total = await Transactions.countDocuments(query);

        res.status(200).json({ transactions: data, total });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to fetch transactions" });
    }
});


module.exports = router;
