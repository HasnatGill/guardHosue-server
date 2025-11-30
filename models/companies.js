const mongoose = require("mongoose")
const { Schema } = mongoose

const schema = new Schema({
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true, },
    registrationNo: { type: String, required: true, },
    email: { type: String, required: true, unique: true },
    phone: { type: String, required: true, default: "" },
    country: { type: Schema.Types.Mixed, required: true, default: {} },
    province: { type: Schema.Types.Mixed, required: false, default: "{}" },
    city: { type: Schema.Types.Mixed, required: false, default: "{}" },
    zipCode: { type: String, required: true, default: "" },
    address: { type: String, required: true, default: "" },
    isEmailVerify: { type: Boolean, default: false },
    status: { type: String, default: "pending" },
    paymentStatus: { type: String, enum: ["paid", "unpaid"], default: "unpaid" },
    expirePackage: { type: Date, default: null },
    createdBy: { type: String, required: true, default: "" },
}, { timestamps: true })

const Companies = mongoose.model("companies", schema)

module.exports = Companies