const mongoose = require("mongoose")
const { Schema } = mongoose

const schema = new Schema({
    id: { type: String, required: true, unique: true },
    siteId: { type: String, required: true, ref: "sites" },
    guardId: { type: String, required: true, ref: "users" },
    // customerId: { type: String, required: true, ref: "customers" },
    // companyId: { type: String, required: true, ref: "companies" },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    date: { type: Date, required: true },
    breakTime: { type: Number, required: true },
    totalHours: { type: Number, required: true },
    reason: { type: String, default: "" },
    checkIn: { type: Date, default: null },
    checkOut: { type: Date, default: null },
    locations: {
        type: [{
            longitude: { type: String },
            latitude: { type: String },
            time: { type: Date, default: null }
        }],
        default: []
    },
    attachments: { type: Schema.Types.Mixed, default: [] },
    liveStatus: { type: String, default: "awaiting" },
    status: { type: String, default: "pending" },
    createdBy: { type: String, required: true },
}, { timestamps: true })

const Shifts = mongoose.model("shifts", schema)

module.exports = Shifts