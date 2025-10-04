const mongoose = require("mongoose")
const { Schema } = mongoose

const schema = new Schema({
    id: { type: String, required: true, unique: true },
    siteId: { type: String, required: true, default: "" },
    companyId: { type: String, required: true, default: null },
    start: { type: { time: { type: String, required: true, default: "" }, status: { type: String, default: null } }, required: true, default: "" },
    end: { type: { time: { type: String, required: true, default: "" }, status: { type: String, default: null } }, required: true, default: "" },
    breakHours: { type: String, required: true, default: "" },
    guardId: { type: String, required: true, default: "" },
    status: { type: String, default: "pending" },
    createdBy: { type: String, required: true, default: "" }
}, { timestamps: true })

const SiteSchedules = mongoose.model("siteSchedules", schema)

module.exports = SiteSchedules