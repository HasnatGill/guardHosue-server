const mongoose = require("mongoose")
const { Schema } = mongoose

const schema = new Schema({
    id: { type: String, required: true, unique: true },
    companyId: { type: String, required: true, default: "" },
    name: { type: String, required: true, default: "" },
    country: { type: Schema.Types.Mixed, required: true, default: {} },
    province: { type: Schema.Types.Mixed, required: true, default: {} },
    city: { type: Schema.Types.Mixed, required: true, default: {} },
    zipCode: { type: String, required: true, default: "" },
    latitude: { type: String, required: true, default: "" },
    longitude: { type: String, required: true, default: "" },
    meters: { type: String, required: true, default: "" },
    address: { type: String, required: true, default: "" },
    status: { type: String, default: "active" },
    createdBy: { type: String, required: true, default: "" },
}, { timestamps: true })

const Sites = mongoose.model("sitesRegistered", schema)

module.exports = Sites