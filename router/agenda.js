const Agenda = require("agenda");
const Schedules = require("../models/schedules");

const { MONGODB_USERNAME, MONGODB_PASSWORD } = process.env

const MONGO_URL = `mongodb+srv://${MONGODB_USERNAME}:${MONGODB_PASSWORD}@cluster0.mlzgbyw.mongodb.net/development`

const agenda = new Agenda({ db: { address: MONGO_URL, collection: "agendaJobs" } });

// Job define
agenda.define("mark missed schedule", async (job) => {
    const { scheduleId } = job.attrs.data;
    const schedule = await Schedules.findById(scheduleId);

    if (schedule && schedule.status === "pending") {
        schedule.status = "missed";
        await schedule.save();

        // Socket real-time update
        req.io.emit("scheduleUpdated", schedule);
        req.io.to(schedule.guardId).emit("scheduleMissed", schedule);
    }
});

// Start agenda
(async function () { await agenda.start() })();
module.exports = agenda;
