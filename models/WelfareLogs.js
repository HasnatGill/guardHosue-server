const mongoose = require("mongoose");
const { Schema } = mongoose;

const schema = new Schema({
    shiftId: { type: String, required: true, index: true },
    guardId: { type: String, required: true, index: true },
    siteId: { type: String, required: true },
    event: {
        type: String,
        required: true,
        enum: ['TRIGGERED', 'ACKNOWLEDGED', 'MISSED', 'ESCALATED', 'FAILED', 'INIT']
    },
    timestamp: { type: Date, default: Date.now },
    location: {
        lat: Number,
        lng: Number,
        accuracy: Number
    },
    metadata: { type: Schema.Types.Mixed }, // For battery level, network status, details
    clientTimestamp: { type: Date } // When the event actually happened on the device (for offline sync)
}, { timestamps: true });

const WelfareLogs = mongoose.model("welfare_logs", schema);

module.exports = WelfareLogs;
