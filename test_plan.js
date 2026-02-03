const mongoose = require('mongoose');
const { Schema } = mongoose;

const userSchema = new Schema({
    uid: String,
    name: String
});
const User = mongoose.model('users_test', userSchema);

const timeSheetSchema = new Schema({
    guardId: { type: String, ref: 'users_test' }
});
const TimeSheet = mongoose.model('timesheets_test', timeSheetSchema);

async function run() {
    await mongoose.connect('mongodb://localhost:27017/test_populate'); // Dummy connection string, won't actually work without mongo running locally
    // This script is just to inspect code logic, but I can't really run it against their DB. 
    // However, I know Mongoose behavior.
}

console.log("Plan: Switch to cleanup aggregation.");
