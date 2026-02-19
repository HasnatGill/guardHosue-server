const mongoose = require("mongoose")
const { Schema } = mongoose

const schema = new Schema({
    id: { type: String, required: true, unique: true, index: true },
    siteId: { type: String, required: true, ref: "sites", index: true },
    guardId: { type: String, required: false, ref: "users", index: true },
    customerId: { type: String, required: true, ref: "customers", index: true },
    companyId: { type: String, required: true, ref: "companies", index: true },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    date: { type: Date, required: true },
    breakTime: { type: Number, required: true },
    guardRole: { type: String, default: "" },
    totalHours: { type: Number, required: true },
    acceptedAt: { type: Date, default: null },
    actualStart: { type: Date, default: null, },
    actualEnd: { type: Date, default: null, },
    clockInLocation: { lat: { type: Number }, lng: { type: Number } },
    clockOutLocation: { lat: { type: Number }, lng: { type: Number } },
    isGeofenceVerified: { type: Boolean, default: false },
    locations: { type: [{ longitude: { type: Number }, latitude: { type: Number }, time: { type: Date, default: null } }], default: [] },
    checkpoints: {
        type: [{
            checkPointNumber: { type: String },
            latitude: { type: Number },
            longitude: { type: Number },
            scannedAt: { type: Date, default: null }
        }],
        default: []
    },
    incidents: { type: [String], default: [] },
    rejectionReason: { type: String, default: "" },
    status: { type: String, default: "draft", enum: ["draft", "published", "accepted", "active", "completed", "missed", "rejected", "cancelled"] },
    punctualityStatus: { type: String, default: null, enum: ["Early", "On-Time", "Late", null] },
    violationDetails: { type: String, default: null },
    conflictDetails: { type: Schema.Types.Mixed, default: null },
    welfare: {
        isEnabled: { type: Boolean, default: false },
        interval: { type: Number, default: 60 },
        startDelay: { type: Number, default: 0 },
        gracePeriod: { type: Number, default: 5 },
        status: { type: String, enum: ['pending', 'ok', 'overdue', 'alert'], default: 'pending' },
        nextCheckAt: { type: Date },
        lastResponseAt: { type: Date },
        failedChecks: { type: Number, default: 0 }
    },
    timeZone: { type: String, default: "UTC" },
    createdBy: { type: String, required: true },
}, { timestamps: true })

// Virtual Population
schema.virtual('site', { ref: 'sites', localField: 'siteId', foreignField: 'id', justOne: true });
schema.virtual('guard', { ref: 'users', localField: 'guardId', foreignField: 'uid', justOne: true });
schema.virtual('customer', { ref: 'customers', localField: 'customerId', foreignField: 'id', justOne: true });
schema.virtual('company', { ref: 'companies', localField: 'companyId', foreignField: 'id', justOne: true });

schema.index({ siteId: 1, date: 1 });
schema.index({ guardId: 1, start: 1, end: 1 });

const Shifts = mongoose.model("shifts", schema)

module.exports = Shifts