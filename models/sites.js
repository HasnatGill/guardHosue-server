const mongoose = require("mongoose")
const { Schema } = mongoose

const schema = new Schema({
    id: { type: String, required: true, unique: true },
    customerId: { type: String, required: true, ref: "customers" },
    companyId: { type: String, required: true, ref: "companies" },
    name: { type: String, required: true, trim: true },
    country: { type: Schema.Types.Mixed, required: true },
    province: { type: String, required: true, default: "", trim: true },
    city: { type: String, required: true, default: "", trim: true },
    zipCode: { type: String, required: true, trim: true },
    latitude: { type: String, required: true, trim: true }, // Keeping for backward compatibility
    longitude: { type: String, required: true, trim: true }, // Keeping for backward compatibility
    location: {
        lat: { type: Number, required: true },
        lng: { type: Number, required: true }
    },
    meters: { type: Number, required: true }, // Keeping existing meters field
    clockInRadius: { type: Number, default: 100 }, // Standardized name
    address: { type: String, required: false, trim: true },
    street_address: { type: String, trim: true, default: "", },
    street_address_1: { type: String, trim: true, default: "", },
    clientChargeRate: { type: Number, default: 0 }, // Added for financial tracking
    requiredSkills: { type: [String], default: [] },
    status: { type: String, default: "active" },
    createdBy: { type: String, required: true },
}, { timestamps: true })

schema.index({ location: "2dsphere" });

const Sites = mongoose.model("sites", schema)

module.exports = Sites