const mongoose = require("mongoose");
const { Schema } = mongoose;

const paysheetSchema = new Schema({
    id: { type: String, required: true, unique: true, index: true },
    timesheetId: { type: String, ref: 'timesheets', required: true, unique: true }, // One-to-one link
    guardId: { type: String, ref: 'users', required: true, index: true },
    siteId: { type: String, ref: 'sites', required: true, index: true },
    companyId: { type: String, ref: 'companies', required: true, index: true },

    hourlyRate: { type: Number, default: 0 },
    overtimeRate: { type: Number, default: 0 },
    totalEarnings: { type: Number, default: 0 }, // Calculated as hourlyRate * timesheet.selectedPayableHours

    status: { type: String, enum: ['draft', 'finalized', 'exported'], default: 'draft' },
    adjustmentNote: { type: String }, // For manual corrections

}, { timestamps: true });

// Virtual Population
paysheetSchema.virtual('guard', { ref: 'users', localField: 'guardId', foreignField: 'uid', justOne: true });
paysheetSchema.virtual('site', { ref: 'sites', localField: 'siteId', foreignField: 'id', justOne: true });
paysheetSchema.virtual('timesheet', { ref: 'timesheets', localField: 'timesheetId', foreignField: 'id', justOne: true });
paysheetSchema.virtual('company', { ref: 'companies', localField: 'companyId', foreignField: 'id', justOne: true });

// Ensure virtuals are included in JSON output
paysheetSchema.set('toObject', { virtuals: true });
paysheetSchema.set('toJSON', { virtuals: true });

const Paysheet = mongoose.model("paysheet", paysheetSchema);

module.exports = Paysheet;
