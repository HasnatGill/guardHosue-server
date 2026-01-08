const express = require("express");
const router = express.Router();
const Invoices = require("../models/invoices");
const Transactions = require("../models/Transactions");
const { verifyToken } = require("../middlewares/auth");
const { getRandomId, getRandomRef, cleanObjectValues } = require("../config/global");

// Create a new invoice manually
router.post("/add", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        const formData = req.body;
        const invoice = new Invoices({ ...formData, id: getRandomId(), createdBy: uid });

        await invoice.save();

        res.status(201).json({ message: "Invoice created successfully", isError: false, invoice });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while creating the invoice", isError: true, error });
    }
});

// Get all invoices with filters
router.get("/all", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });

        let { pageNo = 1, perPage = 10, status, invoiceNo, companyId, startDate, endDate } = req.query;

        pageNo = Number(pageNo);
        perPage = Number(perPage);
        const skip = (pageNo - 1) * perPage;

        const match = {};

        if (status) match.status = status;
        if (companyId) match.companyId = companyId;
        if (invoiceNo) match.invoiceNo = { $regex: invoiceNo, $options: "i" };

        if (startDate || endDate) {
            match.issueDate = {};
            if (startDate) match.issueDate.$gte = new Date(startDate);
            if (endDate) match.issueDate.$lte = new Date(endDate);
        }

        const result = await Invoices.aggregate([
            { $match: match },
            { $lookup: { from: "companies", localField: "companyId", foreignField: "id", as: "company" } },
            { $unwind: { path: "$company", preserveNullAndEmptyArrays: true } },
            { $sort: { createdAt: -1 } },
            {
                $facet: {
                    data: [{ $skip: skip }, { $limit: perPage }],
                    total: [{ $count: "count" }]
                }
            }
        ]);

        const invoices = result[0].data;
        const total = result[0].total[0]?.count || 0;

        res.status(200).json({ message: "Invoices fetched successfully", isError: false, invoices, total });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while fetching invoices", isError: true, error });
    }
});

// Get a single invoice
router.get("/single/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const invoice = await Invoices.findOne({ id }).populate("companyId", "name email").lean();

        if (!invoice) return res.status(404).json({ message: "Invoice not found", isError: true });

        res.status(200).json({ invoice });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Internal Server Error", isError: true, error });
    }
});

// Update an invoice
router.patch("/update/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        const invoice = await Invoices.findOneAndUpdate({ id }, updates, { new: true });

        if (!invoice) return res.status(404).json({ message: "Invoice not found", isError: true });

        res.status(200).json({ message: "Invoice updated successfully", isError: false, invoice });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Internal Server Error", isError: true, error });
    }
});

// Pay an invoice
router.post("/pay/:id", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        const { id } = req.params; // Invoice ID

        let { amount, method, remarks, date } = req.body;
        amount = Number(amount);

        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });
        if (!amount || isNaN(amount) || amount <= 0) return res.status(400).json({ message: "Invalid amount", isError: true });

        const invoice = await Invoices.findOne({ id });
        if (!invoice) return res.status(404).json({ message: "Invoice not found", isError: true });

        if (invoice.balanceDue < amount) {
            return res.status(400).json({ message: "Amount exceeds balance due", isError: true });
        }

        const transactionId = getRandomId();

        // Create Transaction
        const transaction = new Transactions({
            id: transactionId,
            companyId: invoice.companyId,
            invoiceId: invoice.id,
            ref: getRandomRef(),
            amount,
            method,
            status: "successfully",
            remarks,
            transactionDate: date || new Date(),
            approvedBy: uid,
            createdBy: uid
        });

        await transaction.save();

        // Update Invoice
        invoice.amountPaid += Number(amount);
        invoice.balanceDue = invoice.totalAmount - invoice.amountPaid;

        if (invoice.balanceDue <= 0) {
            invoice.status = "paid";
            invoice.balanceDue = 0; // Ensure no negative zero nonsense
        } else {
            invoice.status = "partiallyPaid";
        }

        if (!invoice.transactionsIds) invoice.transactionsIds = [];
        invoice.transactionsIds.push(transactionId); // Store transaction ID, not the doc

        await invoice.save();

        res.status(200).json({ message: "Payment recorded successfully", isError: false, invoice, transaction });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Internal Server Error", isError: true, error: error.message });
    }
});

// Delete an invoice
router.delete("/remove/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const deleted = await Invoices.findOneAndDelete({ id });

        if (!deleted) return res.status(404).json({ message: "Invoice not found", isError: true });

        res.status(200).json({ message: "Invoice deleted successfully", isError: false });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Internal Server Error", isError: true, error });
    }
});

module.exports = router;
