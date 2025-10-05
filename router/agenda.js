const Agenda = require("agenda");
const Schedules = require("../models/schedules");

const { getIO } = require("../socket")

const { MONGODB_USERNAME, MONGODB_PASSWORD, MONGODB_NAME } = process.env

const MONGO_URL = `mongodb+srv://${MONGODB_USERNAME}:${MONGODB_PASSWORD}@cluster0.mlzgbyw.mongodb.net/${MONGODB_NAME}`

const agenda = new Agenda({ db: { address: MONGO_URL, collection: "agendaJobs" } });

// Job define
agenda.define("mark missed schedule", async (job) => {
    const { scheduleId } = job.attrs.data;
    const schedule = await Schedules.findById(scheduleId);

    console.log('schedule', schedule)

    const now = new Date()

    const startTime = new Date(schedule.start.time)
    const graceTime = new Date(startTime.getTime() + 10 * 60000)

    if (schedule && schedule.status === "pending" && graceTime < now) {
        schedule.status = "missed";
        await schedule.save();
        console.log('schedule', schedule)

        const io = getIO()
        io.emit("scheduleUpdated", schedule);
        io.to(schedule.guardId).emit("scheduleMissed", schedule);
    }
});

// Start agenda
(async function () { await agenda.start() })();
module.exports = agenda;
