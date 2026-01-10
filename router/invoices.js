const express = require("express");
const router = express.Router();
const Invoices = require("../models/invoices");
const Transactions = require("../models/Transactions");
const Companies = require("../models/companies");
const { verifyToken } = require("../middlewares/auth");
const { getRandomId, getRandomRef, cleanObjectValues } = require("../config/global");
const sendMail = require("../utils/sendMail");
const generateInvoicePDF = require("../utils/invoicePdfGenerator");

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

        let { pageNo = 1, perPage = 10, status, search, companyId, startDate, endDate } = req.query;

        pageNo = Number(pageNo);
        perPage = Number(perPage);
        const skip = (pageNo - 1) * perPage;

        const match = {};

        if (status) match.status = status;
        if (companyId) match.companyId = companyId;

        // Date Filtering
        if (startDate || endDate) {
            match.issueDate = {};
            if (startDate) match.issueDate.$gte = new Date(startDate);
            if (endDate) match.issueDate.$lte = new Date(endDate);
        }

        const pipeline = [
            { $match: match },
            { $lookup: { from: "companies", localField: "companyId", foreignField: "id", as: "company" } },
            { $unwind: { path: "$company", preserveNullAndEmptyArrays: true } },
        ];

        // Search Filter (Applied after lookup to search company name)
        if (search) {
            pipeline.push({
                $match: {
                    $or: [
                        { invoiceNo: { $regex: search, $options: "i" } },
                        { "company.name": { $regex: search, $options: "i" } },
                        { "company.registrationNo": { $regex: search, $options: "i" } }
                    ]
                }
            });
        }

        pipeline.push(
            { $sort: { createdAt: -1 } },
            {
                $facet: {
                    data: [{ $skip: skip }, { $limit: perPage }],
                    total: [{ $count: "count" }]
                }
            }
        );

        const result = await Invoices.aggregate(pipeline);

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

// Send Invoices via Email
router.post("/send", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        const { invoiceIds } = req.body; // Array of IDs

        if (!uid) return res.status(401).json({ message: "Unauthorized access.", isError: true });
        if (!invoiceIds || !Array.isArray(invoiceIds) || invoiceIds.length === 0) {
            return res.status(400).json({ message: "No invoices selected", isError: true });
        }

        const invoices = await Invoices.find({ id: { $in: invoiceIds } });

        // Manual populate because companyId is a String(custom ID), not ObjectId
        const companyIds = [...new Set(invoices.map(inv => inv.companyId))];
        const companies = await Companies.find({ id: { $in: companyIds } });
        const companyMap = companies.reduce((acc, comp) => {
            acc[comp.id] = comp;
            return acc;
        }, {});

        let sentCount = 0;

        for (const invoice of invoices) {
            const company = companyMap[invoice.companyId];
            if (company && company.email) {
                // Generate PDF
                const pdfBuffer = await generateInvoicePDF(invoice, company);

                const emailBody = `
                    <h3>Invoice #${invoice.invoiceNo}</h3>
                    <p>Dear ${company.name},</p>
                    <p>Please find attached your invoice for ${invoice.billingPeriod}.</p>
                    <p><strong>Total Amount:</strong> $${invoice.totalAmount}</p>
                    <p><strong>Balance Due:</strong> $${invoice.balanceDue}</p>
                    <p>Due Date: ${new Date(invoice.dueDate).toDateString()}</p>
                    <br/>
                    <p>Thank you for your business.</p>
                `;

                // Attachments array for nodemailer
                const attachments = [
                    {
                        filename: `Invoice-${invoice.invoiceNo}.pdf`,
                        content: pdfBuffer,
                        contentType: 'application/pdf'
                    }
                ];

                await sendMail(company.email, `Invoice ${invoice.invoiceNo} from Security Matrix AI`, emailBody, attachments);

                if (invoice.status === 'draft') {
                    invoice.status = 'sent';
                    await invoice.save();
                }
                sentCount++;
            }
        }

        res.status(200).json({ message: `Successfully sent ${sentCount} invoices.`, sentCount });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to send emails", isError: true, error: error.message });
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
