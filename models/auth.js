const mongoose = require("mongoose")
const { Schema } = mongoose

const schema = new Schema({
    uid: { type: String, required: true, unique: true },
    registrationNumber: { type: String, unique: true, default: "" },
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
    password: { type: String, required: true },
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    fullName: { type: String, default: "" },
    gender: { type: String, default: "" },
    phone: { type: String, default: "" },
    photoURL: { type: String, default: "" },
    photoPublicId: { type: String, default: "" },
    status: { type: String, default: "active" },
    roles: { type: [String], default: ["guard"] },
    createdBy: { type: String, required: true },
}, { timestamps: true })

// Pre-save middleware to generate the registration number
schema.pre('save', async function (next) {
    if (!this.isNew) return next();

    try {
        const lastTransaction = await this.constructor.findOne().sort({ registrationNumber: -1 }).lean();

        const newRegistrationNumber = lastTransaction?.registrationNumber
            ? parseInt(lastTransaction.registrationNumber.split('-').pop(), 10) + 1 || 1
            : 1;

        this.registrationNumber = newRegistrationNumber.toString().padStart(6, '0');
        next();
    } catch (error) {
        next(error);
    }
});


const Users = mongoose.model("users", schema)

module.exports = Users