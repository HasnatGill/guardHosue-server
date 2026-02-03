const dayjs = require("dayjs");
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const startDate = "2023-11-01T10:00:00.000Z";
const timeZone = "America/New_York";

try {
    const res = dayjs(startDate).tz(timeZone).startOf('day').utc(true).toDate();
    console.log("Result:", res);
} catch (e) {
    console.error("Error:", e);
}

try {
    const res2 = dayjs("invalid").tz(timeZone).startOf('day').utc(true).toDate();
    console.log("Result2:", res2);
} catch (e) {
    console.error("Error2:", e);
}
