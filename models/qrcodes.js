const mongoose = require("mongoose")
const { Schema } = mongoose

const schema = new Schema({
    id: { type: String, required: true, unique: true },
    checkPointNumber: { type: String, required: true },
    latitude: { type: String, required: true },
    longitude: { type: String, required: true },
    status: { type: String, default: "active" },
    companyId: { type: String, required: true, ref: "companies" },
    createdBy: { type: String, required: true },
}, { timestamps: true })

const QRCodes = mongoose.model("qrcodes", schema)

module.exports = QRCodes
