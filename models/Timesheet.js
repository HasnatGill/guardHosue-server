const mongoose = require("mongoose");
const { Schema } = mongoose;

const timesheetSchema = new Schema({
    id: { type: String, required: true, unique: true },
    shiftId: { type: String, ref: 'shifts', required: true },
    guardId: { type: String, ref: 'users', required: true },
    siteId: { type: String, ref: 'sites', required: true },
    companyId: { type: String, ref: 'companies', required: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    totalHours: { type: Number, required: true },
    breakTime: { type: Number, default: 0 },
    payableHours: { type: Number, required: true },
    hourlyRate: { type: Number, required: true },
    totalPay: { type: Number, required: true },

    // Financial Tracking Fields
    guardPayRate: { type: Number, required: true },
    clientChargeRate: { type: Number, required: true },
    totalGuardPay: { type: Number, required: true },
    totalClientBill: { type: Number, required: true },
    totalProfit: { type: Number }, // derived
    approvalDetails: {
        approvedBy: String,
        approvedAt: Date,
        ipAddress: String
    },
    exportStatus: { type: Boolean, default: false },

    status: {
        type: String,
        enum: ['pending', 'approved', 'disputed'],
        default: 'pending'
    },
    adminNotes: { type: String, default: "" }
}, { timestamps: true });

const Timesheet = mongoose.model("timesheets", timesheetSchema);

module.exports = Timesheet;
