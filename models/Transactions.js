// models/Transaction.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const transactionSchema = new Schema({
  id: { type: String, required: true, unique: true },
  companyId: { type: String, required: true, index: true, ref: "companies" },
  invoiceId: { type: String, required: true, index: true, ref: "invoices" },
  ref: { type: String, required: true, unique: true },
  amount: { type: Number, default: 0 },
  method: { type: String, enum: ['bankTransfer', 'cash', 'other'], required: true, default: "cash" },
  status: { type: String, enum: ["pending", "successfully", "failed"], default: "pending" },
  remarks: { type: String, default: "" },
  transactionDate: { type: Date, default: Date.now },
  approvalBy: { type: String, require: true, },
  createdBy: { type: String, require: true },
}, { timestamps: true });

const Transactions = mongoose.model("transactions", transactionSchema);

module.exports = Transactions;