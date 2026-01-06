// models/Transaction.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const invoicesSchema = new Schema({
    id: { type: String, required: true, unique: true },
    invoiceNo: { type: String, required: true, unique: true },
    companyId: { type: String, required: true, index: true, ref: "companies" },
    transactionsIds: [{ type: String, index: true, ref: "transactions", default: null, }],
    issueDate: { type: Date, default: Date.now },
    dueDate: { type: Date, required: true },
    billingPeriod: { type: String, required: true },
    billingBasis: { type: String, enum: ['customer', 'site', 'guard'] },
    rate: { type: Number, required: true },
    quantity: { type: Number, required: true },
    subtotal: { type: Number, required: true },
    tax: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },
    status: { type: String, enum: ['draft', 'sent', 'paid', 'partiallyPaid', 'overdue', 'cancelled'], default: 'draft' },
    amountPaid: { type: Number, default: 0 },
    balanceDue: { type: Number, required: true },
    approvalBy: { type: String, require: true, },
    createdBy: { type: String, require: true },
}, { timestamps: true });

const Invoices = mongoose.model("invoices", invoicesSchema);

module.exports = Invoices;