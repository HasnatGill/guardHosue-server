const mongoose = require("mongoose")
const { Schema } = mongoose

const schema = new Schema({
    uid: { type: String, required: true, unique: true },
    companyId: { type: String, required: false },
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
    password: { type: String, required: false, default: "" },
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    fullName: { type: String, default: "" },
    gender: { type: String, default: "" },
    phone: { type: String, default: "" },
    photoURL: { type: String, default: "" },
    photoPublicId: { type: String, default: "" },
    isEmailVerify: { type: Boolean, default: false },
    verifyToken: { type: String, default: "" },
    status: { type: String, default: "active" },
    roles: { type: [String], default: ["guard"] },
    otp: String,
    otpExpires: Date,
    createdBy: { type: String, required: true },
}, { timestamps: true })

const Users = mongoose.model("users", schema)

module.exports = Users