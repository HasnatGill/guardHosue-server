const mongoose = require("mongoose");
const { Schema } = mongoose;

const timesheetSchema = new Schema({
    id: { type: String, required: true, unique: true, index: true },
    shiftId: { type: String, ref: 'shifts', required: true, index: true },
    guardId: { type: String, ref: 'users', required: true, index: true },
    siteId: { type: String, ref: 'sites', required: true, index: true },
    companyId: { type: String, ref: 'companies', required: true, index: true },
    scheduledStart: { type: Date, required: true },
    scheduledEnd: { type: Date, required: true },
    scheduledBreakMinutes: { type: Number, default: 0 },
    scheduledTotalHours: { type: Number, required: true },
    actualStart: { type: Date, default: null },
    actualEnd: { type: Date, default: null },
    actualBreakMinutes: { type: Number, default: 0 },
    actualTotalHours: { type: Number, default: 0 },
    selectedBreakMinutes: { type: Number, default: 0 },
    selectedPayableHours: { type: Number, default: 0 },
    selectedScheduledStart: { type: Date, required: true },
    selectedScheduledEnd: { type: Date, required: true },
    selectedTotalHours: { type: Number, default: 0 },
    calculationPreference: { type: String, enum: ['scheduled', 'actual', 'manual'], default: 'scheduled' },
    manualAdjustment: {
        startTime: Date,
        endTime: Date,
        breakMinutes: Number,
        totalHours: Number
    },
    approvalDetails: { approvedBy: String, approvedAt: Date, },
    exportStatus: { type: Boolean, default: false },
    status: { type: String, enum: ['pending', 'approved', 'disputed', 'missed'], default: 'pending' },
    totalPay: { type: Number, default: 0 },
    guardPayRate: { type: Number, default: 0 },
    adminNotes: { type: String, default: "" },
    isProcessedForPayroll: { type: Boolean, default: false },
}, { timestamps: true });

// Virtual Population
timesheetSchema.virtual('guard', { ref: 'users', localField: 'guardId', foreignField: 'uid', justOne: true });
timesheetSchema.virtual('site', { ref: 'sites', localField: 'siteId', foreignField: 'id', justOne: true });
timesheetSchema.virtual('shift', { ref: 'shifts', localField: 'shiftId', foreignField: 'id', justOne: true });
timesheetSchema.virtual('company', { ref: 'companies', localField: 'companyId', foreignField: 'id', justOne: true });

timesheetSchema.index({ guardId: 1, siteId: 1, createdAt: -1 });

const Timesheet = mongoose.model("timesheets", timesheetSchema);

module.exports = Timesheet;
