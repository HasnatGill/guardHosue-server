const mongoose = require("mongoose");
const { Schema } = mongoose;

const PersonSchema = new Schema({
    name: { type: String, required: true },
    phone: { type: String },
}, { _id: false });


const IncidentSchema = new Schema({
    id: { type: String, required: true, unique: true, index: true },
    shiftId: { type: String, ref: 'shifts', required: true },
    guardId: { type: String, ref: 'users', required: true },
    siteId: { type: String, ref: 'sites', required: true },
    companyId: { type: String, ref: 'companies', required: true },
    incidentType: { type: String, required: true },
    incidentDescription: { type: String, required: true },
    description: { type: String, required: true },
    actionTaken: { type: String, required: true },
    people: { type: [PersonSchema], default: [] },
    attachments: { type: [String], default: [] },
    video: { type: String },
    signature: { type: String },
    status: { type: String, enum: ['pending', 'reviewed', 'resolved'], default: 'pending' }
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });

// Virtual Population
IncidentSchema.virtual('site', { ref: 'sites', localField: 'siteId', foreignField: 'id', justOne: true });
IncidentSchema.virtual('guard', { ref: 'users', localField: 'guardId', foreignField: 'uid', justOne: true });
IncidentSchema.virtual('shift', { ref: 'shifts', localField: 'shiftId', foreignField: 'id', justOne: true });

const Incident = mongoose.model("Incident", IncidentSchema);

module.exports = Incident;
