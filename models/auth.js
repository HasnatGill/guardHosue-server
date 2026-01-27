const mongoose = require("mongoose")
const { Schema } = mongoose

const schema = new Schema({
    uid: { type: String, required: true, unique: true },
    companyId: { type: String, required: true },
    email: {
        type: String, required: false, unique: false, default: "",
        validate: {
            validator: async function (value) {
                if (!value) return true;
                const existingUser = await this.constructor.findOne({ email: value });
                return !existingUser;
            },
            message: "Email must be unique.",
        },
    },
    password: { type: String, required: false, default: "" },
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    fullName: { type: String, default: "" },
    gender: { type: String, default: "" },
    country: { type: String, default: "{}" },
    province: { type: String, default: "" },
    city: { type: String, default: "" },
    address: { type: String, default: "" },
    street_address: { type: String, default: "" },
    street_address_1: { type: String, default: "" },
    phone: { type: String, default: "" },
    photoURL: { type: String, default: "" },
    photoPublicId: { type: String, default: "" },
    perHour: { type: Number, default: 0 },
    lincenceNumber: { type: String, required: true, default: "" },
    licenceExpiryDate: { type: Date, default: null, required: true },
    licenceStatus: { type: String, default: "pending" },
    isEmailVerify: { type: Boolean, default: false },
    verifyToken: { type: String, default: "" },
    status: { type: String, default: "active" },
    roles: { type: [String], default: ["guard"] },
    skills: { type: [String], default: [] },
    location: {
        latitude: { type: Number, default: null },
        longitude: { type: Number, default: null }
    },
    otp: String,
    otpExpires: Date,
    createdBy: { type: String, required: true },
}, { timestamps: true })

const Users = mongoose.model("users", schema)

module.exports = Users