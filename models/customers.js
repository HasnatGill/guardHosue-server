// models/Customer.js
const mongoose = require("mongoose");

const { Schema } = mongoose

const contactSchema = new mongoose.Schema({
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, required: false, unique: false, default: "", },
    position: { type: String, trim: true },
    note: { type: String, trim: true },
}, { _id: false });

const customerSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    companyId: { type: String, required: true, ref: "companies" },
    referenceNo: { type: String, required: true, trim: true },
    referenceId: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, unique: true },
    country: { type: Schema.Types.Mixed, required: true },
    province: { type: String, required: true, default: "", trim: true },
    city: { type: String, required: true, default: "", trim: true },
    zipCode: { type: String, required: true, trim: true },
    address: { type: String, required: false, trim: true, default: "", },
    street_address: { type: String, required: false, trim: true, default: "" },
    street_address_1: { type: String, required: false, trim: true, default: "" },
    invoiceReminder: { type: Number, default: 30 },
    contacts: { type: [contactSchema], default: [] },
    status: { type: String, default: "active" },
    createdBy: { type: String, required: true },
}, { timestamps: true });

const Customers = mongoose.model("customers", customerSchema)

module.exports = Customers
