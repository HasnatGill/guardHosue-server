// models/Customer.js
const mongoose = require("mongoose");

const { Schema } = mongoose

const contactSchema = new mongoose.Schema({
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    phone: { type: String, trim: true },
    email: {
        type: String, required: false, unique: false, default: "",
        validate: {
            validator: async function (value) {
                if (!value) return true; // Skip validation if email is empty
                const existingUser = await this.constructor.findOne({ email: value });
                return !existingUser; // Return false if email already exists
            },
            message: "Email must be unique.",
        },
    },
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
    province: { type: Schema.Types.Mixed, required: false, default: '{}' },
    city: { type: Schema.Types.Mixed, required: false, default: "{}" },
    zipCode: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    invoiceReminder: { type: String, default: "" },
    contacts: { type: [contactSchema], default: [] },
    status: { type: String, default: "active" },
    createdBy: { type: String, required: true },
}, { timestamps: true });

const Customers = mongoose.model("customers", customerSchema)

module.exports = Customers
