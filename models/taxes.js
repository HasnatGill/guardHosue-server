const mongoose = require("mongoose");
const { Schema } = mongoose;

const taxesSchema = new Schema({
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true }, // e.g. "Standard VAT", "Zero Rated"
    rate: { type: Number, required: true }, // e.g. 20, 0
    type: { type: String, enum: ['percentage'], default: 'percentage' },
    description: { type: String },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    createdBy: { type: String }
}, { timestamps: true });

const Taxes = mongoose.model("taxes", taxesSchema);

module.exports = Taxes;
