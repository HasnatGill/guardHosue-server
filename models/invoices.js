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
    billingBasis: { type: String, enum: ['customers', 'sites', 'guards', "yearly"] },
    rate: { type: Number, required: true },
    quantity: { type: Number, required: true },
    subtotal: { type: Number, required: true },
    tax: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    previousBalance: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },
    status: { type: String, enum: ['draft', 'sent', 'paid', 'partiallyPaid', 'overdue', 'cancelled', "rolledOver"], default: 'draft' },
    amountPaid: { type: Number, default: 0 },
    balanceDue: { type: Number, required: true },
    createdBy: { type: String, require: true },
}, { timestamps: true });

invoicesSchema.pre("save", async function (next) {
    if (!this.isNew) return next();

    try {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const monthPrefix = `${year}${month}`;

        // Find the last invoice created in the current month
        const startOfMonth = new Date(year, now.getMonth(), 1);
        const endOfMonth = new Date(year, now.getMonth() + 1, 0, 23, 59, 59);

        const lastInvoice = await this.constructor.findOne({
            createdAt: { $gte: startOfMonth, $lte: endOfMonth }
        }).sort({ createdAt: -1 }).select("invoiceNo");

        let nextSequence = 1;

        if (lastInvoice?.invoiceNo) {
            // Extract sequence from INV-YYYYMM[Sequence]
            // We assume the prefix length is fixed (INV- is 4 chars, YYYYMM is 6 chars = 10 chars total)
            const lastSeqStr = lastInvoice.invoiceNo.replace(`INV-${monthPrefix}`, "");
            const lastSeq = parseInt(lastSeqStr);
            if (!isNaN(lastSeq)) {
                nextSequence = lastSeq + 1;
            }
        }

        this.invoiceNo = `INV-${monthPrefix}${nextSequence}`;
        next();
    } catch (error) {
        next(error);
    }
});

const Invoices = mongoose.model("invoices", invoicesSchema);

module.exports = Invoices;