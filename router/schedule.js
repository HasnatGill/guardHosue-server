const express = require("express")
const Schedules = require("../models/schedules")
const Sites = require("../models/sites");
const Companies = require("../models/companies")
const Users = require("../models/auth");
const agenda = require("./agenda");
const { verifyToken } = require("../middlewares/auth")
const { getRandomId } = require("../config/global");

const router = express.Router()

router.post("/add", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        let formData = req.body;

        const shiftStart = new Date(formData.start.time);
        const now = new Date();

        let status = "pending";
        if (shiftStart < now) { status = "missed"; }

        const schedule = new Schedules({ ...formData, id: getRandomId(), createdBy: uid, status });
        await schedule.save();

        const company = await Companies.findOne({ id: schedule.companyId })
        const site = await Sites.findOne({ id: schedule.siteId })
        const user = await Users.findOne({ uid: schedule.guardId })

        if (status === "pending") {
            const graceTime = new Date(shiftStart.getTime() + 10 * 60000);
            await agenda.schedule(graceTime, "mark missed schedule", { scheduleId: schedule._id });
        }

        const dataFormat = { ...schedule.toObject(), companyName: company.name, siteName: site.name, guardName: user.fullName }

        // Real-time guard ko notify
        req.io.emit("newSchedule", dataFormat);
        req.io.to(schedule.guardId).emit("newSchedule", dataFormat);

        res.status(201).json({ message: "Your site schedule has been successfully added", isError: false, schedule: dataFormat });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while adding the schedule", isError: true, error });
    }
});

router.get("/all", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        if (!uid) { return res.status(401).json({ message: "Permission denied." }); }

        const now = new Date();

        // Sirf aaj ke aur future ke schedules lao
        const schedules = await Schedules.find({ $or: [{ "start.time": { $gte: now.toISOString() } }, { "end.time": { $gte: now.toISOString() } }] }).sort({ _id: -1 }).lean();

        // IDs jinhe missed mark karna hai
        const missedIds = schedules.filter(s => {
            const startTime = new Date(s.start.time);
            const graceTime = new Date(startTime.getTime() + 10 * 60000);
            console.log('graceTime', graceTime)
            console.log('now', now)
            return graceTime < now && s.status === "pending";
        }).map(s => s._id);

        // DB update if needed
        if (missedIds.length > 0) { await Schedules.updateMany({ _id: { $in: missedIds } }, { $set: { status: "missed" } }); }

        // Company, Site, Guard ka mapping
        const [companiesMap, sitesMap, guardsMaps] = await Promise.all([
            Companies.find({ id: { $in: schedules.map(({ companyId }) => companyId) } })
                .select("id name").lean()
                .then(companies => Object.fromEntries(companies.map(({ id, name }) => [id, name]))),

            Sites.find({ id: { $in: schedules.map(({ siteId }) => siteId) } })
                .select("id name").lean()
                .then(sites => Object.fromEntries(sites.map(({ id, name }) => [id, name]))),

            Users.find({ uid: { $in: schedules.map(({ guardId }) => guardId) } })
                .select("uid fullName").lean()
                .then(users => Object.fromEntries(users.map(({ uid, fullName }) => [uid, fullName]))),
        ]);

        const shiftsFormat = schedules.map(shift => {
            let status = shift.status;
            if (new Date(shift.start.time) < now && status === "pending") { status = "missed"; }
            return { ...shift, status, companyName: companiesMap[shift.companyId] ?? "Unknown Company", siteName: sitesMap[shift.siteId] ?? "Unknown Site", guardName: guardsMaps[shift.guardId] ?? "Unknown Guard", };
        });

        res.status(200).json({ message: "Schedules fetched successfully", isError: false, shifts: shiftsFormat });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Something went wrong while getting the schedules", isError: true, error });
    }
});

router.get("/all-sites", verifyToken, async (req, res) => {
    try {

        const { status = "" } = req.query
        let query = {}
        if (status) { query.status = status }

        const sites = await Sites.find(query).select("id name")

        res.status(200).json({ message: "Companies fetched", isError: false, sites })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong while getting the Sites", isError: true, error })
    }
})

router.patch("/update/:id", verifyToken, async (req, res) => {
    try {

        const { id } = req.params
        let formData = req.body

        const site = await Sites.findOne({ id });
        if (!site) { return res.status(404).json({ message: "Site not found" }) }

        const newData = { ...formData }

        const updatedSite = await Sites.findOneAndUpdate({ id }, newData, { new: true })
        if (!updatedSite) { return res.status(404).json({ message: "Site didn't update" }) }


        res.status(200).json({ message: "A site has been successfully updated", isError: false, site: updatedSite })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong while updating the company", isError: true, error })
    }
})

router.get("/single-with-id/:id", verifyToken, async (req, res) => {
    try {

        const { id } = req.params

        const site = await Sites.findOne({ id })

        res.status(200).json({ site })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong. Internal server error.", isError: true, error })
    }
})

router.get("/single-shift", verifyToken, async (req, res) => {
    try {
        const { uid } = req
        const relevantStatuses = ["pending", "checkIn"]

        const shift = await Schedules.findOne({ guardId: uid, status: { $in: relevantStatuses } }).sort({ createdAt: -1 }).lean()

        if (!shift) { return res.status(404).json({ message: "No active shift found" }) }

        const [company, site] = await Promise.all([
            Companies.findOne({ id: shift.companyId }).select("name").lean(),
            Sites.findOne({ id: shift.siteId }).select("name").lean(),
        ]);

        const dataFormat = { ...shift, company: company?.name ?? "Unknown", site: site?.name ?? "Unknown" };

        res.status(200).json({ shift: dataFormat })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong. Internal server error.", isError: true, error })
    }
})

router.post("/checkout/:id", async (req, res) => {
    try {

        const { id } = req.params

        const schedule = await Schedules.findByIdAndUpdate(
            { id },
            { status: "checkOUt", "end.status": "active" },
            { new: true }
        )

        // Real-time update
       req.io.emit("scheduleUpdated", schedule)

        res.status(200).json({ message: "Shift status Updated", schedule })
    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong. Internal server error.", isError: true, error })
    }
})

router.post("/checkIn/:id", async (req, res) => {
    try {
        const { id } = req.params

        const schedule = await Schedules.findByIdAndUpdate(
            { id },
            { status: "checkIn", "start.status": "active" },
            { new: true }
        )

        // Real-time update panel ke dashboard pe
        req.io.emit("scheduleUpdated", schedule)

        res.status(200).json({ message: "Shift Status Updated", schedule })
    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong. Internal server error.", isError: true, error })
    }
})


router.delete("/single/:id", verifyToken, async (req, res) => {
    try {

        const { id } = req.params

        await Sites.findOneAndUpdate(
            { id },
            { $set: { status: "inactive" } },
            { new: true }
        )

        res.status(200).json({ message: "The site has been successfully deleted", isError: false })

    } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Something went wrong while deleting the site", isError: true, error })
    }
})

module.exports = router