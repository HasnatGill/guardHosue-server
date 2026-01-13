const express = require("express");
const router = express.Router();
const Invoices = require("../models/invoices");
const Transactions = require("../models/Transactions");
const Companies = require("../models/companies");
const Users = require("../models/auth");
const Customers = require("../models/customers");
const Sites = require("../models/sites");
const { verifyToken } = require("../middlewares/auth");
const { getRandomId, getRandomRef, cleanObjectValues } = require("../config/global");
const sendMail = require("../utils/sendMail");
const dayjs = require("dayjs");
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
            // ref: getRandomRef(),
            amount,
            method,
            status: "approved", // Auto-approved
            billingMonth: invoice.billingPeriod,
            remarks,
            transactionDate: date || new Date(),
            approvedBy: uid,
            createdBy: uid
        });

        await transaction.save();

        // Update Invoice Payment Details
        invoice.amountPaid = (invoice.amountPaid || 0) + amount;
        invoice.balanceDue = invoice.totalAmount - invoice.amountPaid;

        if (invoice.balanceDue <= 0) {
            invoice.status = 'paid';
            invoice.balanceDue = 0; // Prevent negative
        } else if (invoice.balanceDue < invoice.totalAmount) {
            invoice.status = 'partiallyPaid';
        }

        if (!invoice.transactionsIds) invoice.transactionsIds = [];
        invoice.transactionsIds.push(transactionId);

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



// Invoice Tracker Stats
router.get("/tracker", verifyToken, async (req, res) => {
    try {
        const startOfMonth = dayjs().startOf('month').toDate();
        const endOfMonth = dayjs().endOf('month').toDate();

        const eligibleCompanies = await Companies.countDocuments({
            status: { $ne: 'inactive' }, // Active or pending? Let's say not inactive.
            $or: [
                { trialEndsAt: { $lt: new Date() } },
                { trialEndsAt: null }
            ]
        });

        const generatedCount = await Invoices.countDocuments({
            issueDate: { $gte: startOfMonth, $lte: endOfMonth }
        });

        const pendingGeneration = Math.max(0, eligibleCompanies - generatedCount);

        const tracker = {
            pendingGeneration,
            generatedThisMonth: generatedCount
        };

        res.status(200).json({ message: "Tracker data fetched", isError: false, tracker });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error fetching tracker data", isError: true, error });
    }
});

// Generate Invoices
// Generate Invoice (Single Company)
router.post("/generate", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        const { companyId, mode, billingPeriod, dueDate, rate: manualRate, tax: manualTax, billingBasis: manualBasis } = req.body;

        if (!uid) return res.status(401).json({ message: "Unauthorized", isError: true });
        if (!companyId) return res.status(400).json({ message: "Company ID is required", isError: true });

        const company = await Companies.findOne({ id: companyId });
        if (!company) return res.status(404).json({ message: "Company not found", isError: true });

        // if (company.trialEndsAt && dayjs(company.trialEndsAt).isAfter(dayjs())) {
        //     return res.status(400).json({ message: "Company is still in trial period", isError: true });
        // }

        // Determine Billing Basis
        const basis = manualBasis || company.billingBasis || 'customers';

        // Strategies for Quantity Calculation
        const getQuantity = async () => {
            if (basis === 'customers') return await Customers.countDocuments({ status: "active", companyId });
            if (basis === 'sites') return await Sites.countDocuments({ status: "active", companyId });
            if (basis === 'guards') return await Users.countDocuments({ status: "active", companyId, roles: { $in: ["guard"] } });
            if (basis === 'yearly') return 1;
            return 1;
        };

        let quantity = await getQuantity();

        // Rate Logic
        let rate = 0;
        if (basis === 'yearly') {
            // Special Yearly Logic: Use Yearly Rate / 12
            rate = company.yearlyRate ? (company.yearlyRate / 12) : 0;
        } else {
            // Use Manual Rate -> Company Rate -> Default
            rate = manualRate ? Number(manualRate) : (company.rate || 0);
        }

        // Formatting Rate to 2 decimal places if needed, but keeping as number
        rate = Number(rate.toFixed(2));

        if (quantity === 0 && basis !== 'yearly') {
            // Determine what to do if 0 count? 
            // If manual rate is provided, maybe user wants to bill anyway? 
            // For now, let's keep it 1 if explicit manual rate, else 0? 
            // The previous logic defaulted to 1 if manualRate was present.
            if (manualRate) quantity = 1;
        }

        const subtotal = quantity * rate;
        const taxAmount = manualTax ? Number(manualTax) : 0;
        const total = subtotal + taxAmount;

        const invoice = new Invoices({
            id: getRandomId(),
            companyId: company.id,
            billingPeriod: billingPeriod || dayjs().format('MMMM YYYY'),
            billingBasis: basis,
            dueDate: dueDate ? new Date(dueDate) : dayjs().add(7, 'day').toDate(),
            issueDate: new Date(),
            rate,
            quantity,
            tax: taxAmount,
            subtotal: subtotal,
            totalAmount: total,
            balanceDue: total,
            createdBy: uid,
            status: mode === 'send' ? 'sent' : 'draft',
        });

        await invoice.save();

        if (mode === 'send') {
            try {
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

                await sendMail(company.email, `Invoice ${invoice.invoiceNo} from GuardHouse`, emailBody, [
                    { filename: `Invoice-${invoice.invoiceNo}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }
                ]);

            } catch (mailError) {
                console.error("Failed to send email during generation:", mailError);
                // We should probably warn the user but the invoice is generated
                return res.status(200).json({ message: "Invoice generated but failed to send email", isError: false, invoices: [invoice] });
            }
        }

        res.status(201).json({
            message: `Invoice ${mode === 'send' ? 'generated & sent' : 'generated'} successfully`,
            isError: false,
            invoices: [invoice] // Keep array format for frontend compatibility if needed, or just change frontend
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error generating invoice", isError: true, error: error.message });
    }
});

module.exports = router;
