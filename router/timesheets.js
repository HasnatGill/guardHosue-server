const express = require("express");
const Timesheet = require("../models/Timesheet");
const { verifyToken } = require("../middlewares/auth");
const dayjs = require("dayjs");
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const router = express.Router();

// GET / - Fetch all timesheets with filters
router.get("/", verifyToken, async (req, res) => {
    try {
        const { startDate, endDate, guardId, siteId, status, companyId } = req.query;
        let query = {};

        if (companyId) query.companyId = companyId;
        if (guardId) query.guardId = guardId;
        if (siteId) query.siteId = siteId;
        if (status) query.status = status;

        const timeZone = req.headers["x-timezone"] || req.query.timeZone || "UTC";

        if (startDate && endDate) {
            query.startTime = {
                $gte: dayjs(startDate).tz(timeZone).startOf('day').utc(true).toDate(),
                $lte: dayjs(endDate).tz(timeZone).endOf('day').utc(true).toDate()
            };
        }

        const timesheets = await Timesheet.find(query)
            .sort({ createdAt: -1 })
            .populate('guardId', 'fullName email')
            .populate('siteId', 'name address');

        res.status(200).json({ success: true, count: timesheets.length, data: timesheets });
    } catch (error) {
        console.error("Fetch Timesheets Error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch timesheets." });
    }
});

// GET /stats - Summarize total hours and pay
router.get("/stats", verifyToken, async (req, res) => {
    try {
        const { companyId, startDate, endDate } = req.query;
        let match = {};

        const timeZone = req.headers["x-timezone"] || req.query.timeZone || "UTC";

        if (companyId) match.companyId = companyId;
        if (startDate && endDate) {
            match.startTime = {
                $gte: dayjs(startDate).tz(timeZone).startOf('day').utc(true).toDate(),
                $lte: dayjs(endDate).tz(timeZone).endOf('day').utc(true).toDate()
            };
        }

        const stats = await Timesheet.aggregate([
            { $match: match },
            {
                $group: {
                    _id: null,
                    totalHours: { $sum: "$payableHours" },
                    totalPay: { $sum: "$totalPay" },
                    totalTimesheets: { $sum: 1 },
                    pendingCount: {
                        $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] }
                    },
                    approvedCount: {
                        $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] }
                    }
                }
            }
        ]);

        res.status(200).json({
            success: true,
            data: stats[0] || { totalHours: 0, totalPay: 0, totalTimesheets: 0, pendingCount: 0, approvedCount: 0 }
        });
    } catch (error) {
        console.error("Fetch Stats Error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch timesheet stats." });
    }
});

// PATCH /approve/:id - Approve a timesheet
router.patch("/approve/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { adminNotes } = req.body;

        const updatedTimesheet = await Timesheet.findOneAndUpdate(
            { id },
            { $set: { status: 'approved', adminNotes: adminNotes || "" } },
            { new: true }
        );

        if (!updatedTimesheet) {
            return res.status(404).json({ success: false, message: "Timesheet not found." });
        }

        res.status(200).json({ success: true, message: "Timesheet approved successfully.", data: updatedTimesheet });
    } catch (error) {
        console.error("Approve Timesheet Error:", error);
        res.status(500).json({ success: false, message: "Failed to approve timesheet." });
    }
});

module.exports = router;
