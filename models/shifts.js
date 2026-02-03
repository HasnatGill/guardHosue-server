const mongoose = require("mongoose")
const { Schema } = mongoose

const schema = new Schema({
    id: { type: String, required: true, unique: true },
    siteId: { type: String, required: true, ref: "sites" },
    guardId: { type: String, required: false, ref: "users" },
    customerId: { type: String, required: true, ref: "customers" },
    companyId: { type: String, required: true, ref: "companies" },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    date: { type: Date, required: true },
    breakTime: { type: Number, required: true },
    guardRole: { type: String, default: "" },
    totalHours: { type: Number, required: true },
    paidHours: { type: Number, default: 0 },
    reason: { type: String, default: "" },
    checkIn: { type: Date, default: null },
    checkOut: { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    actualStartTime: { type: Date, default: null },
    actualEndTime: { type: Date, default: null },
    clockInLocation: { lat: { type: Number }, lng: { type: Number } },
    clockOutLocation: { lat: { type: Number }, lng: { type: Number } },
    isGeofenceVerified: { type: Boolean, default: false },
    locations: { type: [{ longitude: { type: Number }, latitude: { type: Number }, time: { type: Date, default: null } }], default: [] },
    totalPayments: { type: Number, default: 0 },
    attachments: { type: Schema.Types.Mixed, default: [] },
    rejectionReason: { type: String, default: "" },
    status: { type: String, default: "draft", enum: ["draft", "published", "accepted", "active", "completed", "missed", "rejected", "cancelled"] },
    punctualityStatus: { type: String, default: null, enum: ["Early", "On-Time", "Late", null] },
    violationDetails: { type: String, default: null },
    conflictDetails: { type: Schema.Types.Mixed, default: null },
    createdBy: { type: String, required: true },
}, { timestamps: true })

// Optimize Schedule Views & Conflict Checks
// Used heavily when fetching shifts for specific sites or checking overlaps
schema.index({ siteId: 1, date: 1 });
schema.index({ guardId: 1, start: 1, end: 1 });

const Shifts = mongoose.model("shifts", schema)

module.exports = Shifts