// models/Transaction.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const transactionSchema = new Schema({
  id: { type: String, required: true, unique: true },
  companyId: { type: String, required: true, index: true, ref: "companies" },
  invoiceId: { type: String, required: true, index: true, ref: "invoices" },
  ref: { type: String, unique: true },
  amount: { type: Number, default: 0 },
  method: { type: String, enum: ['bankTransfer', 'cash', 'other'], required: true, default: "cash" },
  status: { type: String, enum: ["pending", "approved", "rejected", "failed", "successfully"], default: "pending" },
  billingMonth: { type: String, default: "" },
  remarks: { type: String, default: "" },
  transactionDate: { type: Date, default: Date.now },
  approvalBy: { type: String, require: true, },
  createdBy: { type: String, require: true },
}, { timestamps: true });

transactionSchema.pre("save", async function (next) {
  if (!this.isNew) return next();

  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const monthPrefix = `${year}${month}`;

    // Find the last transaction created in the current month
    const startOfMonth = new Date(year, now.getMonth(), 1);
    const endOfMonth = new Date(year, now.getMonth() + 1, 0, 23, 59, 59);

    const lastTransaction = await this.constructor.findOne({
      createdAt: { $gte: startOfMonth, $lte: endOfMonth }
    }).sort({ createdAt: -1 }).select("ref");

    let nextSequence = 1;

    if (lastTransaction?.ref) {
      // Extract sequence from TRX-YYYYMM[Sequence]
      const lastSeqStr = lastTransaction.ref.replace(`TRX-${monthPrefix}`, "");
      const lastSeq = parseInt(lastSeqStr);
      if (!isNaN(lastSeq)) {
        nextSequence = lastSeq + 1;
      }
    }

    this.ref = `TRX-${monthPrefix}${nextSequence}`;
    next();
  } catch (error) {
    next(error);
  }
});

const Transactions = mongoose.model("transactions", transactionSchema);

module.exports = Transactions;