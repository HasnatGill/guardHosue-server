const express = require("express");
const router = express.Router();
const Paysheet = require("../models/Paysheet");
const Timesheet = require("../models/Timesheet");
const { getRandomId } = require("../config/global");

// Get Paysheets (Auto-Sync View)
router.get("/", async (req, res) => {
    try {
        const { companyId, startDate, endDate, guardId, siteId, guardQuery } = req.query;

        if (!companyId) return res.status(400).json({ message: "Company ID required" });

        // 1. Build Timesheet Query (Status: Approved)
        const query = {
            companyId,
            status: "approved"
        };

        if (siteId) query.siteId = siteId;
        if (guardId) query.guardId = guardId;

        // Date Filter on Selected Scheduled Start
        if (startDate && endDate) {
            query.selectedScheduledStart = { $gte: new Date(startDate), $lte: new Date(endDate) };
        }

        // 2. Fetch Approved Timesheets
        let timesheets = await Timesheet.find(query).populate('guard').populate('site').sort({ selectedScheduledStart: -1 });

        // Guard Name Search Filter (In-memory if not done via aggregate)
        if (guardQuery) {
            const lowerQ = guardQuery.toLowerCase();
            timesheets = timesheets.filter(t => t.guard?.fullName?.toLowerCase().includes(lowerQ));
        }

        // 3. Fetch Existing Paysheets for these timesheets
        const timesheetIds = timesheets.map(t => t.id);
        const existingPaysheets = await Paysheet.find({ timesheetId: { $in: timesheetIds } });
        const paysheetMap = new Map(existingPaysheets.map(p => [p.timesheetId, p]));

        // 4. Merge Data & Calculate Summary
        let totalPayableHours = 0;
        let totalEstimatedPayroll = 0;
        let finalizedCount = 0;
        let pendingCount = 0;

        const mergedData = timesheets.map(ts => {
            const paysheet = paysheetMap.get(ts.id);

            const hourlyRate = paysheet ? paysheet.hourlyRate : 0;
            const status = paysheet ? paysheet.status : 'pending';

            totalPayableHours += (ts.selectedPayableHours || 0);
            totalEstimatedPayroll += (hourlyRate * (ts.selectedPayableHours || 0));

            if (status === 'finalized' || status === 'exported') {
                finalizedCount++;
            } else {
                pendingCount++;
            }
            return { timesheetId: ts.id, paysheetId: paysheet?.id || null, guard: ts.guard, site: ts.site, shiftDate: ts.selectedScheduledStart, shiftStart: ts.selectedScheduledStart, shiftEnd: ts.selectedScheduledEnd, payableHours: ts.selectedPayableHours, hourlyRate: hourlyRate, totalEarnings: hourlyRate * (ts.selectedPayableHours || 0), status: status, timesheet: ts };
        });

        res.json({ summary: { totalPayableHours, totalEstimatedPayroll, finalizedCount, pendingCount, totalShifts: timesheets.length }, data: mergedData });

    } catch (error) {
        console.error("Error fetching paysheets:", error);
        res.status(500).json({ message: "Server Error" });
    }
});


// Update Rate & Calculate (Upsert)
router.patch("/update-rate/:timesheetId", async (req, res) => {
    try {
        const { timesheetId } = req.params;
        const { hourlyRate } = req.body;

        // 1. Try to find existing Paysheet
        let paysheet = await Paysheet.findOne({ timesheetId });

        // 2. If exists, update
        if (paysheet) {
            if (paysheet.status === 'finalized' || paysheet.status === 'exported') {
                return res.status(400).json({ message: "Cannot edit finalized paysheets" });
            }
            paysheet.hourlyRate = Number(hourlyRate);

            const timesheet = await Timesheet.findOne({ id: timesheetId });
            if (timesheet) {
                const totalEarnings = Number(hourlyRate) * (timesheet.selectedPayableHours || 0);
                paysheet.totalEarnings = totalEarnings.toFixed(2);

                // Update Timesheet as well
                timesheet.guardPayRate = Number(hourlyRate);
                timesheet.totalPay = totalEarnings.toFixed(2);
                await timesheet.save();
            }

            await paysheet.save();
        }
        else {
            const timesheet = await Timesheet.findOne({ id: timesheetId });
            if (!timesheet) return res.status(404).json({ message: "Timesheet not found" });

            const totalEarnings = Number(hourlyRate) * (timesheet.selectedPayableHours || 0);

            paysheet = new Paysheet({
                id: getRandomId(),
                timesheetId: timesheetId,
                guardId: timesheet.guardId,
                siteId: timesheet.siteId,
                companyId: timesheet.companyId,
                hourlyRate: Number(hourlyRate),
                totalEarnings: totalEarnings,
                status: 'draft'
            });

            // Update Timesheet as well
            timesheet.guardPayRate = Number(hourlyRate);
            timesheet.totalPay = totalEarnings.toFixed(2);
            await timesheet.save();

            await paysheet.save();
        }

        res.json(paysheet);

    } catch (error) {
        console.error("Error updating paysheet rate:", error);
        res.status(500).json({ message: "Server Error" });
    }
});

// Finalize (Upsert)
router.patch("/finalize/:timesheetId", async (req, res) => {
    try {
        const { timesheetId } = req.params;

        let paysheet = await Paysheet.findOne({ timesheetId });

        if (paysheet) { paysheet.status = 'finalized'; await paysheet.save(); }
        else {
            const timesheet = await Timesheet.findOne({ id: timesheetId });
            if (!timesheet) return res.status(404).json({ message: "Timesheet not found" });

            paysheet = new Paysheet({ id: getRandomId(), timesheetId: timesheetId, guardId: timesheet.guardId, siteId: timesheet.siteId, companyId: timesheet.companyId, hourlyRate: 0, totalEarnings: 0, status: 'finalized' });
            await paysheet.save();
        }

        res.json(paysheet);
    } catch (error) {
        console.error("Error finalizing paysheet:", error);
        res.status(500).json({ message: "Server Error" });
    }
});

router.delete("/:timesheetId", async (req, res) => {
    try {
        const { timesheetId } = req.params;
        const paysheet = await Paysheet.findOne({ timesheetId });

        if (!paysheet) return res.status(404).json({ message: "No custom paysheet record found to reset." });

        if (paysheet.status === 'finalized') {
            return res.status(400).json({ message: "Cannot reset finalized paysheets" });
        }

        await Paysheet.deleteOne({ timesheetId });
        res.json({ message: "Paysheet reset to default" });
    } catch (error) {
        console.error("Error deleting paysheet:", error);
        res.status(500).json({ message: "Server Error" });
    }
});

module.exports = router;

