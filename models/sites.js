const mongoose = require("mongoose")
const { Schema } = mongoose

const schema = new Schema({
    id: { type: String, required: true, unique: true },
    customerId: { type: String, required: true, ref: "customers" },
    companyId: { type: String, required: true, ref: "companies" },
    name: { type: String, required: true, trim: true },
    country: { type: Schema.Types.Mixed, required: true },
    province: { type: Schema.Types.Mixed, required: false, default: "{}" },
    city: { type: Schema.Types.Mixed, required: false, default: "{}" },
    zipCode: { type: String, required: true, trim: true },
    latitude: { type: String, required: true, trim: true },
    longitude: { type: String, required: true, trim: true },
    meters: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    status: { type: String, default: "active" },
    createdBy: { type: String, required: true },
}, { timestamps: true })

const Sites = mongoose.model("sites", schema)

module.exports = Sites