// models/Transaction.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const transactionSchema = new Schema({
  companyId: { type: String, required: true, index: true, ref: "companies" },
  ref: { type: String, required: true, unique: true },
  amount: { type: Number, default: 0 }, // optional
  method: { type: String, default: "manual" }, // optional: e.g., 'manual','stripe'
  status: { type: String, enum: ["paid", "unpaid"], default: "paid" },
  notes: { type: String, default: "" },
  transactionDate: { type: Date, default: Date.now },
  expireDate: { type: Date, default: Date.now + 30 },
  createdBy: { type: String, default: "" },
}, { timestamps: true });

const Transactions = mongoose.model("transactions", transactionSchema);

module.exports = Transactions;
