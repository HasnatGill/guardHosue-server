const mongoose = require("mongoose")
const { Schema } = mongoose

const schema = new Schema({
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true, },
    registrationNo: { type: String, required: true, },
    email: { type: String, required: true, unique: true, },
    phone: { type: String, required: true, default: "" },
    country: { type: Schema.Types.Mixed, required: true, default: "{}" },
    province: { type: String, required: true, trim: true, },
    city: { type: String, required: true, trim: true, },
    zipCode: { type: String, required: true, default: "" },
    address: { type: String, required: false, default: "" },
    street_address: { type: String, required: false, default: "" },
    street_address_1: { type: String, required: false, default: "" },
    isEmailVerify: { type: Boolean, default: false },
    status: { type: String, default: "pending" },
    paymentStatus: { type: String, enum: ["paid", "unpaid"], default: "unpaid" },
    expirePackage: { type: Date, default: null },
    createdBy: { type: String, required: true, default: "" },
}, { timestamps: true })

const Companies = mongoose.model("companies", schema)

module.exports = Companies