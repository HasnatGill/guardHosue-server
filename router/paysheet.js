const express = require("express");
const router = express.Router();
const Paysheet = require("../models/Paysheet");
const Timesheet = require("../models/Timesheet");
const { v4: uuidv4 } = require('uuid');
const dayjs = require('dayjs');

// Fetch Approved Shifts (that don't have a Paysheet yet)
router.get("/approved-but-not-generated", async (req, res) => {
    try {
        const { companyId, startDate, endDate } = req.query;

        if (!companyId) {
            return res.status(400).json({ message: "Company ID is required" });
        }

        // 1. Find all approved timesheets for the company and date range
        const query = {
            companyId,
            status: "approved",
        };

        if (startDate && endDate) {
            query.selectedScheduledStart = {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            };
        }

        const approvedTimesheets = await Timesheet.find(query)
            .populate('guard')
            .populate('site');

        // 2. Find existing paysheets to exclude them
        const existingPaysheets = await Paysheet.find({ companyId }).select('timesheetId');
        const existingTimesheetIds = new Set(existingPaysheets.map(p => p.timesheetId));

        // 3. Filter out timesheets that already have a paysheet
        const pendingGeneration = approvedTimesheets.filter(t => !existingTimesheetIds.has(t.id));

        res.json(pendingGeneration);
    } catch (error) {
        console.error("Error fetching approved shifts:", error);
        res.status(500).json({ message: "Server Error" });
    }
});

// Bulk Generate Paysheets
router.post("/bulk-generate", async (req, res) => {
    try {
        const { timesheetIds, companyId } = req.body;

        if (!timesheetIds || !timesheetIds.length) {
            return res.status(400).json({ message: "No timesheets selected" });
        }

        const timesheets = await Timesheet.find({
            id: { $in: timesheetIds },
            companyId: companyId
        });

        const newPaysheets = [];

        for (const ts of timesheets) {
            // check if already exists to be safe
            const exists = await Paysheet.findOne({ timesheetId: ts.id });
            if (exists) continue;

            // Default rate (could be fetched from Guard profile if it existed there, but for now 0 as per specs)
            const hourlyRate = 0;
            const totalEarnings = hourlyRate * ts.selectedPayableHours;

            newPaysheets.push({
                id: uuidv4(),
                timesheetId: ts.id,
                guardId: ts.guardId,
                siteId: ts.siteId,
                companyId: ts.companyId,
                hourlyRate,
                totalEarnings,
                status: 'draft'
            });
        }

        if (newPaysheets.length > 0) {
            await Paysheet.insertMany(newPaysheets);
        }

        res.json({ message: `Successfully generated ${newPaysheets.length} paysheets`, count: newPaysheets.length });

    } catch (error) {
        console.error("Error bulk generating paysheets:", error);
        res.status(500).json({ message: "Server Error" });
    }
});

// Get Paysheets (Main listing)
router.get("/", async (req, res) => {
    try {
        const { companyId, startDate, endDate, guardId, siteId } = req.query;

        if (!companyId) return res.status(400).json({ message: "Company ID required" });

        const query = { companyId };

        if (guardId) query.guardId = guardId;
        if (siteId) query.siteId = siteId;

        // Date filtering needs to be done on the *Timesheet's* date, which requires a lookup or population filter.
        // For simplicity and performance in Mongoose, we usually query Paysheet and populate.
        // However, standard simplified approach: Fetch paysheets, populate timesheet, then filter in memory 
        // OR (better) use aggregate.

        // Let's use simple find + populate for now as per typical MERN stack patterns unless volume is huge.
        // To filter by date properly without massive over-fetching, we should first find relevant timesheets if dates are provided.

        let timesheetFilter = {};
        if (startDate && endDate) {
            timesheetFilter = {
                selectedScheduledStart: {
                    $gte: new Date(startDate),
                    $lte: new Date(endDate)
                }
            };

            // Find timesheet IDs in this range
            const relevantTimesheets = await Timesheet.find({ ...timesheetFilter, companyId }).select('id');
            const relevantIds = relevantTimesheets.map(t => t.id);
            query.timesheetId = { $in: relevantIds };
        }

        const paysheets = await Paysheet.find(query)
            .populate('guard')
            .populate('site')
            .populate('timesheet')
            .sort({ createdAt: -1 });

        res.json(paysheets);

    } catch (error) {
        console.error("Error fetching paysheets:", error);
        res.status(500).json({ message: "Server Error" });
    }
});


// Update Rate & Calculate
router.patch("/update-rate/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { hourlyRate } = req.body;

        const paysheet = await Paysheet.findOne({ id }).populate('timesheet');
        if (!paysheet) return res.status(404).json({ message: "Paysheet not found" });

        if (paysheet.status === 'finalized' || paysheet.status === 'exported') {
            return res.status(400).json({ message: "Cannot edit finalized paysheets" });
        }

        paysheet.hourlyRate = Number(hourlyRate);
        const hours = paysheet.timesheet ? paysheet.timesheet.selectedPayableHours : 0;
        paysheet.totalEarnings = paysheet.hourlyRate * hours;

        await paysheet.save();

        res.json(paysheet);

    } catch (error) {
        console.error("Error updating paysheet rate:", error);
        res.status(500).json({ message: "Server Error" });
    }
});

// Finalize
router.patch("/finalize/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const paysheet = await Paysheet.findOne({ id });

        if (!paysheet) return res.status(404).json({ message: "Paysheet not found" });

        paysheet.status = 'finalized';
        await paysheet.save();

        res.json(paysheet);
    } catch (error) {
        console.error("Error finalizing paysheet:", error);
        res.status(500).json({ message: "Server Error" });
    }
});

// Delete (Implicitly needed for "Action Buttons: ... Delete")
router.delete("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const paysheet = await Paysheet.findOne({ id });
        if (!paysheet) return res.status(404).json({ message: "Paysheet not found" });

        if (paysheet.status === 'finalized') {
            return res.status(400).json({ message: "Cannot delete finalized paysheets" });
        }

        await Paysheet.deleteOne({ id });
        res.json({ message: "Paysheet deleted" });
    } catch (error) {
        console.error("Error deleting paysheet:", error);
        res.status(500).json({ message: "Server Error" });
    }
});

module.exports = router;
