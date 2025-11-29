const express = require("express");
const router = express.Router();
const Transactions = require("../models/Transactions");
const Companies = require("../models/companies");
const { verifyToken } = require("../middlewares/auth");

router.get("/all", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const { pageNo = 1, perPage = 10, status, ref, companyId, startDate, endDate } = req.query;

        const query = {};
        if (status) query.status = status;
        if (ref) query.ref = { $regex: ref, $options: "i" };
        if (companyId) query.companyId = companyId;
        if (startDate || endDate) query.transactionDate = {};
        if (startDate) query.transactionDate.$gte = new Date(startDate);
        if (endDate) query.transactionDate.$lte = new Date(endDate);

        // Fetch transactions
        const transactions = await Transactions.find(query).sort({ transactionDate: -1 }).skip((pageNo - 1) * perPage).limit(Number(perPage)).lean();

        const companyIds = [...new Set(transactions.map(t => t.companyId))];
        const companies = await Companies.find({ id: { $in: companyIds } }).select("id name registrationNo").lean();

        const companyMap = companies.reduce((acc, c) => { acc[c.id] = c; return acc; }, {});

        const data = transactions.map(t => ({ ...t, company: companyMap[t.companyId] || null }));

        const total = await Transactions.countDocuments(query);

        res.status(200).json({ transactions: data, total });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to fetch transactions" });
    }
});

module.exports = router;

