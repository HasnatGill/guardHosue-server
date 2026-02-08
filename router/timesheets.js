const express = require("express");
const Timesheet = require("../models/Timesheet");
const Shifts = require("../models/shifts");
const Sites = require("../models/sites");
const Users = require("../models/auth");
const { verifyToken } = require("../middlewares/auth");
const dayjs = require("dayjs");
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const router = express.Router();

// GET /admin-view - Aggregated Grouped View for Dashboard (Shift-First Architecture)
router.get("/admin-view", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        const user = await Users.findOne({ uid });
        if (!user) return res.status(401).json({ success: false, message: "Unauthorized access." });

        const { startDate, endDate, siteId, customerId, guardQuery, status } = req.query;
        const timeZone = req.headers["x-timezone"] || "UTC";

        // 1. Match Shifts (Primary Collection)
        let matchStage = {
            companyId: String(user.companyId),
            status: { $nin: ['draft', 'cancelled', 'archived'] } // Exclude draft/cancelled
        };

        if (startDate && endDate) {
            matchStage.start = {
                $gte: dayjs(startDate).tz(timeZone).startOf('day').utc(true).toDate(),
                $lte: dayjs(endDate).tz(timeZone).endOf('day').utc(true).toDate()
            };
        }

        if (siteId) matchStage.siteId = String(siteId);

        const pipeline = [
            { $match: matchStage },

            // 2. Lookup Related Data
            { $lookup: { from: "timesheets", localField: "id", foreignField: "shiftId", as: "timesheet" } },
            { $unwind: { path: "$timesheet", preserveNullAndEmptyArrays: true } },

            { $lookup: { from: "sites", localField: "siteId", foreignField: "id", as: "site" } },
            { $unwind: "$site" },
            { $lookup: { from: "customers", localField: "site.customerId", foreignField: "id", as: "customer" } },
            { $unwind: "$customer" },
            { $lookup: { from: "users", localField: "guardId", foreignField: "uid", as: "guard" } },
            { $unwind: "$guard" },

            // 3. Post-Match Filters (Customer / Guard)
            // Note: Efficiently done before heavy projection if possible, but fields need to be resolved.
        ];

        // Apply filters early if possible to reduce set
        let postMatch = {};
        if (customerId) postMatch["customer.id"] = String(customerId);
        if (guardQuery) postMatch["guard.fullName"] = { $regex: guardQuery, $options: "i" };

        /* 
           Status Filtering needs special handling because 'status' might come from Timesheet OR be derived from Shift
           We'll do it after projection.
        */

        if (Object.keys(postMatch).length > 0) pipeline.push({ $match: postMatch });

        // 4. Project Unified Structure
        pipeline.push({
            $addFields: {
                // Determine Status: Timesheet Status > Shift Status Logic
                computedStatus: {
                    $switch: {
                        branches: [
                            { case: { $ifNull: ["$timesheet.status", false] }, then: "$timesheet.status" },
                            {
                                case: { $lt: ["$end", new Date()] }, // Past Shift, No Timesheet
                                then: "overdue" // or 'missed' if you prefer
                            }
                        ],
                        default: "scheduled"
                    }
                },
                // Determine ID: Use Timesheet ID if exists, else Shift ID (prefixed to avoid collision if needed, or raw)
                rowId: { $ifNull: ["$timesheet.id", "$id"] },

                // Standardized Objects for Frontend

                // 1. Scheduled Object (From Shift)
                schedule: {
                    start: "$start",
                    end: "$end",
                    breakMinutes: "$breakTime",
                    totalHours: {
                        $round: [{ $divide: [{ $subtract: ["$end", "$start"] }, 3600000] }, 2]
                    }
                },

                // 2. Actual Object (From Timesheet Actuals or Null)
                actual: {
                    start: "$timesheet.actualStart",
                    end: "$timesheet.actualEnd",
                    breakMinutes: "$timesheet.actualBreakMinutes",
                    totalHours: "$timesheet.actualTotalHours"
                },

                // 3. Selected Object (From Timesheet Selected fields or Defaults)
                // If Timesheet exists, use its selected values (which might default to actuals). 
                // If NO Timesheet, default to Schedule (but with 0 hours or flagged as empty).
                selected: {
                    source: { $ifNull: ["$timesheet.calculationPreference", "schedule"] }, // Default to schedule if no record
                    start: { $ifNull: ["$timesheet.selectedScheduledStart", "$start"] },
                    end: { $ifNull: ["$timesheet.selectedScheduledEnd", "$end"] },
                    breakMinutes: { $ifNull: ["$timesheet.selectedBreakMinutes", "$breakTime"] },
                    totalHours: { $ifNull: ["$timesheet.selectedTotalHours", { $round: [{ $divide: [{ $subtract: ["$end", "$start"] }, 3600000] }, 2] }] }
                },

                hasTimesheet: { $cond: [{ $ifNull: ["$timesheet", false] }, true, false] },

                // Keep these for aggregation grouping below
                finalStartTime: { $ifNull: ["$timesheet.selectedScheduledStart", "$start"] },
                finalPayableHours: {
                    $ifNull: ["$timesheet.selectedTotalHours", {
                        $round: [{ $divide: [{ $subtract: ["$end", "$start"] }, 3600000] }, 2]
                    }]
                },
                finalTotalPay: { $ifNull: ["$timesheet.totalPay", 0] }
            }
        });

        // 5. Status Filter (Applied on computed status)
        if (status && status !== 'All') {
            if (status === 'Awaiting Approval') pipeline.push({ $match: { computedStatus: 'pending' } });
            else if (status === 'Scheduled') pipeline.push({ $match: { computedStatus: 'scheduled' } });
            else pipeline.push({ $match: { computedStatus: status.toLowerCase() } });
        }

        // 6. Final Grouping (Match Frontend Expectation)
        pipeline.push({ $sort: { finalStartTime: 1 } });

        pipeline.push({
            $group: {
                _id: "$siteId",
                siteName: { $first: "$site.name" },
                clientChargeRate: { $first: "$site.clientChargeRate" },
                totalShifts: { $sum: 1 },
                totalPayableHours: { $sum: "$finalPayableHours" },
                totalBilling: { $sum: "$finalTotalPay" }, // Simplified for now
                timesheets: {
                    $push: {
                        id: "$rowId",
                        shiftId: "$id",
                        hasTimesheet: "$hasTimesheet",
                        status: "$computedStatus",
                        guard: "$guard",
                        customer: "$customer",
                        site: "$site",

                        // New Structured Data
                        schedule: "$schedule",
                        actual: "$actual",
                        selected: "$selected",

                        payableHours: "$finalPayableHours",
                        totalPay: "$finalTotalPay"
                    }
                }
            }
        });

        pipeline.push({ $sort: { siteName: 1 } });

        const groupedData = await Shifts.aggregate(pipeline);
        res.status(200).json({ success: true, data: groupedData });

    } catch (error) {
        console.error("Admin View Error:", error);
        res.status(500).json({ success: false, message: "Server Error during aggregation." });
    }
});

// PATCH /update-financials/:id - Update Timesheet Financials & Preference
router.patch("/update-financials/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params; // shiftId or timesheetId
        const { calculationPreference, adminNotes, status, startTime, endTime, breakMinutes } = req.body;

        // 1. Try to find existing timesheet
        let timesheet = await Timesheet.findOne({ $or: [{ id: id }, { shiftId: id }] });

        // If not found, we might need to create it (if it's a fresh interaction on a Shift)
        // But typically the system creates timesheets on checkout. 
        // If missing, we fetch Shift to init.
        let shift = null;
        if (!timesheet) {
            shift = await Shifts.findOne({ id });
            if (!shift) return res.status(404).json({ success: false, message: "Shift not found." });

            // Create initial timesheet record if missing
            timesheet = new Timesheet({
                id: shift.id, // Using Shift ID as Timesheet ID for 1:1 simplicity if not generated elsewhere
                shiftId: shift.id,
                guardId: shift.guardId,
                siteId: shift.siteId,
                companyId: shift.companyId,
                scheduledStart: shift.start,
                scheduledEnd: shift.end,
                scheduledBreakMinutes: shift.breakTime,
                scheduledTotalHours: 0, // Calc below
                actualStart: shift.start, // Default to sched if no actuals check-in
                actualEnd: shift.end,
                actualBreakMinutes: shift.breakTime,
                actualTotalHours: 0,
                selectedScheduledStart: shift.start,
                selectedScheduledEnd: shift.end,
                selectedTotalHours: 0,
                selectedPayableHours: 0,
                status: 'pending'
            });
        } else {
            shift = await Shifts.findOne({ id: timesheet.shiftId });
        }

        // 2. Logic to determine "Selected" values based on Preference
        let pref = calculationPreference || timesheet.calculationPreference || 'schedule';
        let selStart, selEnd, selBreak;

        // If manual overrides provided, switch to manual
        if (startTime || endTime) {
            pref = 'manual';
            selStart = startTime ? new Date(startTime) : timesheet.selectedScheduledStart;
            selEnd = endTime ? new Date(endTime) : timesheet.selectedScheduledEnd;
            selBreak = breakMinutes !== undefined ? Number(breakMinutes) : timesheet.selectedBreakMinutes;
        }
        // Else use preference source
        else if (pref === 'scheduled') {
            selStart = shift ? shift.start : timesheet.scheduledStart;
            selEnd = shift ? shift.end : timesheet.scheduledEnd;
            selBreak = shift ? shift.breakTime : timesheet.scheduledBreakMinutes;
        }
        else if (pref === 'actual') {
            selStart = timesheet.actualStart || timesheet.scheduledStart; // Fallback
            selEnd = timesheet.actualEnd || timesheet.scheduledEnd;
            selBreak = timesheet.actualBreakMinutes || 0;
        }
        else {
            // Keep existing manual values or fallback
            selStart = timesheet.selectedScheduledStart;
            selEnd = timesheet.selectedScheduledEnd;
            selBreak = timesheet.selectedBreakMinutes;
        }

        // 3. Calculate Hours
        const startMs = new Date(selStart).getTime();
        const endMs = new Date(selEnd).getTime();
        const breakMs = (selBreak || 0) * 60000;
        const totalHours = Math.max(0, parseFloat(((endMs - startMs - breakMs) / 3600000).toFixed(2)));

        // 4. Update Fields
        timesheet.calculationPreference = pref;
        timesheet.selectedScheduledStart = selStart;
        timesheet.selectedScheduledEnd = selEnd;
        timesheet.selectedBreakMinutes = selBreak;
        timesheet.selectedTotalHours = totalHours;
        timesheet.selectedPayableHours = totalHours; // Can be different if rules apply, but for now 1:1

        // Recalculate Pay
        const rate = timesheet.guardPayRate || 0; // Ensure we have rate. If 0, maybe fetch from Guard/Site?
        timesheet.totalPay = parseFloat((totalHours * rate).toFixed(2));

        if (adminNotes !== undefined) timesheet.adminNotes = adminNotes;
        if (status !== undefined) timesheet.status = status;

        await timesheet.save();

        res.status(200).json({ success: true, message: "Timesheet updated.", data: timesheet });

    } catch (error) {
        console.error("Update Financials Error:", error);
        res.status(500).json({ success: false, message: "Failed to update financials." });
    }
});

// GET /stats - Summarize total hours and pay (Keeping existing logic for dashboard)
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

// PATCH /approve/:id - Approve a timesheet (with optional updates)
router.patch("/approve/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { adminNotes, calculationPreference, status } = req.body;
        const { uid } = req; // From auth middleware

        const user = await Users.findOne({ uid }); // Get approver info

        // Reuse the logic from update-financials if preference is sent?
        // Or simplified approval.

        let timesheet = await Timesheet.findOne({ $or: [{ id: id }, { shiftId: id }] });
        if (!timesheet) return res.status(404).json({ success: false, message: "Timesheet not found." });

        // Update Approval Details
        timesheet.status = status || 'approved'; // Allow passing 'disputed'

        if (timesheet.status === 'approved') {
            timesheet.approvalDetails = {
                approvedBy: user ? user.fullName : 'Admin',
                approvedAt: new Date()
            };
            timesheet.isProcessedForPayroll = true;
        } else {
            timesheet.isProcessedForPayroll = false;
        }

        if (adminNotes) timesheet.adminNotes = adminNotes;
        if (calculationPreference) {
            // If preference changing during approval, trigger logic. 
            // For now, assume preference was set prior or match simple update logic
            timesheet.calculationPreference = calculationPreference;
            // Ideally we run the full calc logic here too, but to avoid duplication I'll assume 
            // frontend calls update-financials first OR we merge logic.
            // Let's rely on update-financials for calc changes.
        }

        await timesheet.save();

        res.status(200).json({ success: true, message: `Timesheet ${timesheet.status}.`, data: timesheet });
    } catch (error) {
        console.error("Approve Timesheet Error:", error);
        res.status(500).json({ success: false, message: "Failed to approve timesheet." });
    }
});

// GET /export - Professional Timesheet Export (Approved Only)
router.get("/export", verifyToken, async (req, res) => {
    try {
        const { uid } = req;
        const user = await Users.findOne({ uid });
        if (!user) return res.status(401).json({ success: false, message: "Unauthorized access." });

        // Access Control: Admin only
        if (user.role && user.role !== 'admin' && user.role !== 'superadmin') {
            // Some systems use 'role', others 'roles' (array)
            // Checking if any role is admin or if it's a string 'admin'
            const userRoles = Array.isArray(user.roles) ? user.roles : [user.role];
            if (!userRoles.includes('admin') && !userRoles.includes('superadmin')) {
                return res.status(403).json({ success: false, message: "Forbidden: Admin access required." });
            }
        }

        const { startDate, endDate, siteId, customerId } = req.query;
        const timeZone = req.headers["x-timezone"] || "UTC";

        // 1. Match Stage (Strictly 'approved')
        let matchStage = {
            companyId: String(user.companyId),
            status: 'approved'
        };

        if (startDate && endDate) {
            matchStage.selectedScheduledStart = {
                $gte: dayjs(startDate).tz(timeZone).startOf('day').utc(true).toDate(),
                $lte: dayjs(endDate).tz(timeZone).endOf('day').utc(true).toDate()
            };
        }

        if (siteId) matchStage.siteId = String(siteId);

        const pipeline = [
            { $match: matchStage },
            { $lookup: { from: "sites", localField: "siteId", foreignField: "id", as: "site" } },
            { $unwind: "$site" },
            { $lookup: { from: "customers", localField: "site.customerId", foreignField: "id", as: "customer" } },
            { $unwind: "$customer" },
            { $lookup: { from: "users", localField: "guardId", foreignField: "uid", as: "guard" } },
            { $unwind: "$guard" },
        ];

        // Apply customer filter if provided
        if (customerId) {
            pipeline.push({ $match: { "customer.id": String(customerId) } });
        }

        // Project into the exact CSV structure requested
        pipeline.push({
            $project: {
                _id: 0,
                "Date": { $dateToString: { format: "%Y-%m-%d", date: "$selectedScheduledStart", timezone: timeZone } },
                "Staff First Name": { $arrayElemAt: [{ $split: ["$guard.fullName", " "] }, 0] },
                "Staff Last Name": {
                    $reduce: {
                        input: { $slice: [{ $split: ["$guard.fullName", " "] }, 1, { $size: { $split: ["$guard.fullName", " "] } }] },
                        initialValue: "",
                        in: { $concat: ["$$value", { $cond: [{ $eq: ["$$value", ""] }, "", " "] }, "$$this"] }
                    }
                },
                "Site": "$site.name",
                "Start": { $dateToString: { format: "%H:%M", date: "$selectedScheduledStart", timezone: timeZone } },
                "Finish": { $dateToString: { format: "%H:%M", date: "$selectedScheduledEnd", timezone: timeZone } },
                "Hours": "$selectedTotalHours"
            }
        });

        // Sort by Date then Start Time
        pipeline.push({ $sort: { "Date": 1, "Start": 1 } });

        const data = await Timesheet.aggregate(pipeline);

        res.status(200).json({ success: true, count: data.length, data });

    } catch (error) {
        console.error("Export Error:", error);
        res.status(500).json({ success: false, message: "Failed to export timesheet data." });
    }
});

module.exports = router;
