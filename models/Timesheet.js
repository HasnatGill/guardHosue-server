const mongoose = require("mongoose");
const { Schema } = mongoose;

const timesheetSchema = new Schema({
    id: { type: String, required: true, unique: true, index: true },
    shiftId: { type: String, ref: 'shifts', required: true, index: true },
    guardId: { type: String, ref: 'users', required: true, index: true },
    siteId: { type: String, ref: 'sites', required: true, index: true },
    companyId: { type: String, ref: 'companies', required: true, index: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    totalHours: { type: Number, required: true },
    breakTime: { type: Number, default: 0 },
    payableHours: { type: Number, required: true },
    hourlyRate: { type: Number, required: true },
    totalPay: { type: Number, required: true },

    // Financial Tracking Fields
    guardPayRate: { type: Number, required: true },
    totalGuardPay: { type: Number, required: true },

    // --- Snapshot (Source of Truth from Shift) ---
    snapshot: {
        scheduledStart: { type: Date },
        scheduledEnd: { type: Date },
        guardPayRate: { type: Number },
        clientChargeRate: { type: Number, default: 0 }
    },

    // --- Actuals (From Operations) ---
    actuals: {
        actualStart: { type: Date, required: true },
        actualEnd: { type: Date, required: true },
        totalBreakMinutes: { type: Number, default: 0 }
    },

    // --- Variance & Calculations ---
    varianceMinutes: { type: Number, default: 0 }, // (Actual End - Actual Start) - (Scheduled End - Scheduled Start)

    // --- Financials ---
    financials: {
        payableHours: { type: Number, required: true },
        grossGuardPay: { type: Number, required: true },
        grossClientBilling: { type: Number, default: 0 },
        marginPercentage: { type: Number, default: 0 }
    },

    // --- Manual Adjustments ---
    manualAdjustment: {
        adjustedTotalHours: { type: Number },
        adjustedTotalPay: { type: Number },
        reason: { type: String }
    },

    // --- Audit Trail ---
    audit: {
        isProcessedForPayroll: { type: Boolean, default: false },
        payrollId: { type: String, ref: 'paysheets', default: null }
    },

    approvalDetails: {
        approvedBy: String,
        approvedAt: Date,
        ipAddress: String
    },
    exportStatus: { type: Boolean, default: false },

    status: {
        type: String,
        enum: ['pending', 'approved', 'disputed', 'processed'],
        default: 'pending'
    },
    adminNotes: { type: String, default: "" }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Virtual Population
timesheetSchema.virtual('guard', {
    ref: 'users',
    localField: 'guardId',
    foreignField: 'uid',
    justOne: true
});

timesheetSchema.virtual('site', {
    ref: 'sites',
    localField: 'siteId',
    foreignField: 'id',
    justOne: true
});

timesheetSchema.virtual('shift', {
    ref: 'shifts',
    localField: 'shiftId',
    foreignField: 'id',
    justOne: true
});

timesheetSchema.virtual('company', {
    ref: 'companies',
    localField: 'companyId',
    foreignField: 'id',
    justOne: true
});

// Compound Index for Fast Reporting
timesheetSchema.index({ guardId: 1, siteId: 1, createdAt: -1 });

const Timesheet = mongoose.model("timesheets", timesheetSchema);

module.exports = Timesheet;
