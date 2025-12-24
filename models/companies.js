const mongoose = require("mongoose")
const { Schema } = mongoose

const schema = new Schema({
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    registrationNo: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true },
    phone: { type: String, required: true, default: "", },
    country: { type: Schema.Types.Mixed, required: true, default: "{}" },
    province: { type: String, required: true, trim: true, },
    city: { type: String, required: true, trim: true, },
    zipCode: { type: String, required: true, default: "", trim: true },
    address: { type: String, required: false, default: "", trim: true },
    street_address: { type: String, required: false, default: "", trim: true },
    street_address_1: { type: String, required: false, default: "", trim: true },
    isEmailVerify: { type: Boolean, default: false },
    status: { type: String, default: "pending" },
    paymentStatus: { type: String, enum: ["paid", "unpaid"], default: "unpaid" },
    expirePackage: { type: Date, default: null },
    createdBy: { type: String, required: true, default: "" },
}, { timestamps: true })

const Companies = mongoose.model("companies", schema)

module.exports = Companies