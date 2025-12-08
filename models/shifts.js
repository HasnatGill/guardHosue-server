const mongoose = require("mongoose")
const { Schema } = mongoose

const schema = new Schema({
    id: { type: String, required: true, unique: true },
    siteId: { type: String, required: true, ref: "sites" },
    guardId: { type: String, required: true, ref: "users" },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    date: { type: Date, required: true },
    breakTime: { type: Number, required: true },
    totalHours: { type: Number, required: true },
    reason: { type: String, default: "" },
    checkIn: { type: Date, default: null },
    CheckOut: { type: Date, default: null },
    liveStatus: { type: String, default: "awaiting" },
    status: { type: String, default: "pending" },
    createdBy: { type: String, required: true },
}, { timestamps: true })

const Shifts = mongoose.model("shifts", schema)

module.exports = Shifts