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
    breakTime: { type: Number, required: true }, // In Minutes
    guardRole: { type: String, default: "" }, // Role selection
    totalHours: { type: Number, required: true },
    paidHours: { type: Number, default: 0 },
    reason: { type: String, default: "" },
    checkIn: { type: Date, default: null },
    checkOut: { type: Date, default: null },
    actualStartTime: { type: Date, default: null },
    actualEndTime: { type: Date, default: null },
    clockInLocation: {
        lat: { type: Number },
        lng: { type: Number }
    },
    clockOutLocation: {
        lat: { type: Number },
        lng: { type: Number }
    },
    isGeofenceVerified: { type: Boolean, default: false },
    locations: {
        type: [{
            longitude: { type: Number },
            latitude: { type: Number },
            time: { type: Date, default: null }
        }],
        default: []
    },
    totalPayments: { type: Number, default: 0 },
    attachments: { type: Schema.Types.Mixed, default: [] },
    liveStatus: { type: String, default: "awaiting" },
    status: { type: String, default: "Draft", enum: ["Draft", "Published", "Confirmed", "Completed", "pending", "active", "inactive", "request", "missed"] }, // Added missed status
    isPublished: { type: Boolean, default: false },
    isAcknowledged: { type: Boolean, default: false }, // Guard Acknowledgment
    punctualityStatus: { type: String, default: null, enum: ["Early", "On-Time", "Late", null] },
    violationDetails: { type: String, default: null }, // e.g., "GEOFENCE_VIOLATION"
    financials: {
        baseRate: { type: Number, default: 0 },
        totalPay: { type: Number, default: 0 },
        isApproved: { type: Boolean, default: false },
        isPaid: { type: Boolean, default: false }
    },
    conflictDetails: { type: Schema.Types.Mixed, default: null },
    qualificationsRequired: { type: [String], default: [] },
    welfare: {
        isEnabled: { type: Boolean, default: false },
        interval: { type: Number, default: 60 }, // minutes
        lastPingTime: { type: Date, default: null },
        nextPingDue: { type: Date, default: null },
        status: { type: String, enum: ['SAFE', 'PENDING', 'OVERDUE'], default: 'SAFE' }
    },
    createdBy: { type: String, required: true },
}, { timestamps: true })

const Shifts = mongoose.model("shifts", schema)

module.exports = Shifts