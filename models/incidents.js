const mongoose = require("mongoose");
const { Schema } = mongoose;

const schema = new Schema({
    id: { type: String, required: true, unique: true },
    guardId: { type: String, required: true, ref: "users" },
    siteId: { type: String, required: true, ref: "sites" },
    shiftId: { type: String, required: true, ref: "shifts" },
    companyId: { type: String, required: true, ref: "companies" },
    description: { type: String, required: true },
    severity: { type: String, enum: ['Low', 'Medium', 'High'], default: 'Medium' },
    images: {
        type: [{
            url: { type: String, required: true },
            publicId: { type: String },
            name: { type: String }
        }],
        default: []
    },
    status: { type: String, enum: ['Open', 'Resolved', 'Investigating'], default: 'Open' },
    createdBy: { type: String, required: true },
}, { timestamps: true });

const Incidents = mongoose.model("incidents", schema);

module.exports = Incidents;
