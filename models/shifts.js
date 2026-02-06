const mongoose = require("mongoose")
const { Schema } = mongoose

const schema = new Schema({
    id: { type: String, required: true, unique: true, index: true },
    siteId: { type: String, required: true, ref: "sites", index: true },
    guardId: { type: String, required: false, ref: "users", index: true },
    customerId: { type: String, required: true, ref: "customers", index: true },
    companyId: { type: String, required: true, ref: "companies", index: true },
    start: { type: Date, required: true, alias: 'scheduledStart' },
    end: { type: Date, required: true, alias: 'scheduledEnd' },
    date: { type: Date, required: true },
    breakTime: { type: Number, required: true },
    guardRole: { type: String, default: "" },
    totalHours: { type: Number, required: true },
    paidHours: { type: Number, default: 0 },
    reason: { type: String, default: "" },
    checkIn: { type: Date, default: null },
    checkOut: { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    actualStartTime: { type: Date, default: null, alias: 'actualStart' },
    actualEndTime: { type: Date, default: null, alias: 'actualEnd' },
    clockInLocation: { lat: { type: Number }, lng: { type: Number } },
    clockOutLocation: { lat: { type: Number }, lng: { type: Number } },
    isGeofenceVerified: { type: Boolean, default: false },
    locations: { type: [{ longitude: { type: Number }, latitude: { type: Number }, time: { type: Date, default: null } }], default: [] },
    totalPayments: { type: Number, default: 0 },
    attachments: { type: Schema.Types.Mixed, default: [] },
    incidents: { type: [String], default: [] },
    rejectionReason: { type: String, default: "" },
    isTimesheetGenerated: { type: Boolean, default: false },
    status: { type: String, default: "draft", enum: ["draft", "published", "accepted", "active", "completed", "missed", "rejected", "cancelled"] },
    punctualityStatus: { type: String, default: null, enum: ["Early", "On-Time", "Late", null] },
    violationDetails: { type: String, default: null },
    conflictDetails: { type: Schema.Types.Mixed, default: null },
    timeZone: { type: String, default: "UTC" },
    createdBy: { type: String, required: true },
    financials: {
        guardPayRate: { type: Number, default: 0 },
        clientChargeRate: { type: Number, default: 0 },
        totalGuardPay: { type: Number, default: 0 },
        totalClientBill: { type: Number, default: 0 }
    }
}, { timestamps: true, toJSON: { virtuals: true, aliases: true }, toObject: { virtuals: true, aliases: true } })

// Virtual Population
schema.virtual('site', { ref: 'sites', localField: 'siteId', foreignField: 'id', justOne: true });
schema.virtual('guard', { ref: 'users', localField: 'guardId', foreignField: 'uid', justOne: true });
schema.virtual('customer', { ref: 'customers', localField: 'customerId', foreignField: 'id', justOne: true });
schema.virtual('company', { ref: 'companies', localField: 'companyId', foreignField: 'id', justOne: true });

schema.index({ siteId: 1, date: 1 });
schema.index({ guardId: 1, start: 1, end: 1 });

const Shifts = mongoose.model("shifts", schema)

module.exports = Shifts