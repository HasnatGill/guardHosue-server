// models/Transaction.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const invoicesSchema = new Schema({
    id: { type: String, required: true, unique: true },
    invoiceNo: { type: String, unique: true },
    companyId: { type: String, required: true, index: true, ref: "companies" },
    transactionsIds: [{ type: String, index: true, ref: "transactions", default: null, }],
    issueDate: { type: Date, default: Date.now },
    dueDate: { type: Date, required: true },
    billingPeriod: { type: String, required: true },
    billingBasis: { type: String, enum: ['customers', 'sites', 'guards'] },
    rate: { type: Number, required: true },
    quantity: { type: Number, required: true },
    subtotal: { type: Number, required: true },
    tax: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },
    status: { type: String, enum: ['draft', 'sent', 'paid', 'partiallyPaid', 'overdue', 'cancelled'], default: 'draft' },
    amountPaid: { type: Number, default: 0 },
    balanceDue: { type: Number, required: true },
    createdBy: { type: String, require: true },
}, { timestamps: true });

invoicesSchema.pre("save", async function (next) {
    if (!this.isNew) return next();

    try {
        const lastInvoice = await this.constructor.findOne().sort({ createdAt: -1 }).select("invoiceNo");
        let nextSequence = 1;

        if (lastInvoice?.invoiceNo) {
            const lastSeq = parseInt(lastInvoice.invoiceNo.split("-").pop());
            nextSequence = lastSeq + 1;
        }

        const randomNumber = Math.floor(1000000 + Math.random() * 900000000);

        this.invoiceNo = `INV-${randomNumber}-${nextSequence}`;
        next();
    } catch (error) {
        next(error);
    }
});

const Invoices = mongoose.model("invoices", invoicesSchema);

module.exports = Invoices;