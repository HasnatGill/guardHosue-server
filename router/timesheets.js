const express = require("express");
const Timesheet = require("../models/Timesheet");
const Shifts = require("../models/shifts");
const Sites = require("../models/sites");
const Users = require("../models/auth");
const { verifyToken } = require("../middlewares/auth");
const { getRandomId } = require("../config/global");
const dayjs = require("dayjs");
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const router = express.Router();

// POST /generate - Create a timesheet from a completed shift
router.post("/generate", verifyToken, async (req, res) => {
    try {
        const { shiftId } = req.body;
        if (!shiftId) return res.status(400).json({ success: false, message: "shiftId is required." });

        const shift = await Shifts.findOne({ id: shiftId });
        if (!shift) return res.status(404).json({ success: false, message: "Shift not found." });
        if (shift.status !== 'completed') {
            return res.status(400).json({ success: false, message: "Only completed shifts can generate timesheets." });
        }

        // Check if timesheet already exists
        const existingTimesheet = await Timesheet.findOne({ shiftId });
        if (existingTimesheet) {
            return res.status(400).json({ success: false, message: "Timesheet already exists for this shift." });
        }

        const [guard, site] = await Promise.all([
            Users.findOne({ uid: shift.guardId }),
            Sites.findOne({ id: shift.siteId })
        ]);

        if (!guard) return res.status(404).json({ success: false, message: "Guard not found." });
        if (!site) return res.status(404).json({ success: false, message: "Site not found." });

        const actualStart = dayjs(shift.actualStartTime);
        const actualEnd = dayjs(shift.actualEndTime);

        // Calculate total hours
        const totalMinutes = actualEnd.diff(actualStart, 'minute');
        const breakMinutes = shift.breakTime || 0;
        const payableMinutes = Math.max(0, totalMinutes - breakMinutes);

        const totalHours = parseFloat((totalMinutes / 60).toFixed(2));
        const payableHours = parseFloat((payableMinutes / 60).toFixed(2));

        const guardPayRate = guard.perHour || 0;
        const totalGuardPay = parseFloat((payableHours * guardPayRate).toFixed(2));

        const newTimesheet = new Timesheet({
            id: getRandomId(),
            shiftId: shift.id,
            guardId: shift.guardId,
            siteId: shift.siteId,
            companyId: shift.companyId,
            startTime: shift.actualStartTime,
            endTime: shift.actualEndTime,
            totalHours,
            breakTime: shift.breakTime,
            payableHours,
            hourlyRate: guardPayRate,
            totalPay: totalGuardPay,
            guardPayRate,
            totalGuardPay,
            shiftReferenceData: {
                start: shift.start || shift.scheduledStart,
                end: shift.end || shift.scheduledEnd
            },
            status: 'pending'
        });

        await newTimesheet.save();
        res.status(201).json({ success: true, message: "Timesheet generated successfully.", data: newTimesheet });

    } catch (error) {
        console.error("Generate Timesheet Error:", error);
        res.status(500).json({ success: false, message: "Internal server error." });
    }
});

// GET / - Fetch all timesheets with population and filters
router.get("/", verifyToken, async (req, res) => {
    try {
        const { siteId, guardId, startDate, endDate, companyId } = req.query;
        let query = {};

        if (companyId) query.companyId = String(companyId);
        if (siteId) query.siteId = String(siteId);
        if (guardId) query.guardId = String(guardId);

        const timeZone = req.headers["x-timezone"] || req.query.timeZone || "UTC";

        if (startDate && endDate) {
            query.startTime = {
                $gte: dayjs(startDate).tz(timeZone).startOf('day').utc(true).toDate(),
                $lte: dayjs(endDate).tz(timeZone).endOf('day').utc(true).toDate()
            };
        }

        const timesheets = await Timesheet.find(query)
            .populate({ path: 'guard', select: 'fullName email photoURL uid' })
            .populate({ path: 'site', select: 'name address' })
            .populate({ path: 'shift', select: 'start end' })
            .sort({ createdAt: -1 });

        // On-the-fly punctuality calculation
        const enrichedTimesheets = timesheets.map(ts => {
            const doc = ts.toObject({ virtuals: true });

            // Try to get scheduled start from snapshot or populated shift
            const scheduledStart = ts.shiftReferenceData?.start || ts.shift?.start;
            const actualStart = ts.startTime;

            if (scheduledStart && actualStart) {
                const sStart = dayjs(scheduledStart);
                const aStart = dayjs(actualStart);

                // Calculate difference in minutes (Positive = Late, Negative = Early)
                const diff = aStart.diff(sStart, 'minute');
                doc.lateMinutes = Math.max(0, diff);

                if (diff > 15) {
                    doc.punctualityStatus = 'Late';
                } else if (diff > 5) {
                    doc.punctualityStatus = 'Slightly Late';
                } else if (diff >= -5) {
                    doc.punctualityStatus = 'On Time';
                } else {
                    doc.punctualityStatus = 'Early';
                }

                // Suggested hours after deduction
                const deduction = doc.lateMinutes / 60;
                doc.autoCalculatedHours = Math.max(0, parseFloat((ts.payableHours - deduction).toFixed(2)));
            } else {
                doc.lateMinutes = 0;
                doc.punctualityStatus = 'Pending Data';
                doc.autoCalculatedHours = ts.payableHours;
            }
            return doc;
        });

        res.status(200).json({ success: true, count: timesheets.length, data: enrichedTimesheets });
    } catch (error) {
        console.error("Fetch Timesheets Error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch timesheets." });
    }
});

// GET /admin-view - Aggregated Grouped View for Dashboard
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

                // Determine Times: Actuals > Scheduled
                finalStartTime: { $ifNull: ["$timesheet.startTime", "$start"] },
                finalEndTime: { $ifNull: ["$timesheet.endTime", "$end"] },

                // Determine Hours/Pay
                finalPayableHours: {
                    $ifNull: ["$timesheet.payableHours", {
                        // Calculate Scheduled Hours if no timesheet
                        $round: [{ $divide: [{ $subtract: ["$end", "$start"] }, 3600000] }, 2]
                    }]
                },

                finalTotalPay: { $ifNull: ["$timesheet.totalPay", 0] }, // Standard projection for now

                hasTimesheet: { $cond: [{ $ifNull: ["$timesheet", false] }, true, false] }
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
                        startTime: "$finalStartTime",
                        endTime: "$finalEndTime",
                        payableHours: "$finalPayableHours",
                        totalPay: "$finalTotalPay",
                        guard: "$guard",
                        customer: "$customer",
                        site: "$site",
                        // Pass original objects for detailed logic
                        shift: { start: "$start", end: "$end", breakTime: "$breakTime" },
                        timesheet: "$timesheet",
                        snapshot: "$timesheet.snapshot",
                        actuals: "$timesheet.actuals",
                        financials: "$timesheet.financials"
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

// PATCH /update-financials/:id - Inline update for manual adjustments
router.patch("/update-financials/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { adjustedTotalHours, guardPayRate, clientChargeRate, adminNotes, status } = req.body;

        const timesheet = await Timesheet.findOne({ id });
        if (!timesheet) return res.status(404).json({ success: false, message: "Timesheet not found." });

        const updateData = {};
        if (adminNotes !== undefined) updateData.adminNotes = adminNotes;
        if (status !== undefined) updateData.status = status;

        // Determine hours to use for calculations
        const hoursToUse = adjustedTotalHours !== undefined ? (parseFloat(adjustedTotalHours) || 0) :
            (timesheet.manualAdjustment?.adjustedTotalHours ?? timesheet.payableHours ?? 0);

        if (adjustedTotalHours !== undefined) {
            updateData['manualAdjustment.adjustedTotalHours'] = hoursToUse;
            updateData.payableHours = hoursToUse;
        }

        // Handle Pay Rate change OR Hours change (affects Guard Pay)
        if (guardPayRate !== undefined || adjustedTotalHours !== undefined) {
            const rateToUse = guardPayRate !== undefined ? (parseFloat(guardPayRate) || 0) : (timesheet.guardPayRate ?? 0);
            if (guardPayRate !== undefined) {
                updateData.guardPayRate = rateToUse;
                updateData.hourlyRate = rateToUse;
            }
            updateData.totalGuardPay = parseFloat((hoursToUse * rateToUse).toFixed(2)) || 0;
            updateData.totalPay = updateData.totalGuardPay;
        }

        const updatedTimesheet = await Timesheet.findOneAndUpdate(
            { id },
            { $set: updateData },
            { new: true }
        );

        res.status(200).json({ success: true, message: "Timesheet updated successfully.", data: updatedTimesheet });

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
        const { adminNotes, startTime, endTime, breakTime, payableHours, totalPay, guardPayRate, calculationPreference } = req.body;

        const updateFields = {
            status: 'approved',
            isProcessedForPayroll: true, // Mark for payroll export
            adminNotes: adminNotes || ""
        };

        // Allow approving with updated values (if provided)
        if (startTime) updateFields.startTime = startTime;
        if (endTime) updateFields.endTime = endTime;
        if (breakTime !== undefined) updateFields.breakTime = breakTime;
        if (payableHours !== undefined) updateFields.payableHours = payableHours;
        if (totalPay !== undefined) updateFields.totalPay = totalPay;
        if (guardPayRate !== undefined) updateFields.guardPayRate = guardPayRate;
        if (calculationPreference) updateFields.calculationPreference = calculationPreference;

        // If times change, update financials snapshot if needed? 
        // For now, we assume the frontend sends the calculated totalPay/payableHours matching the times.

        const updatedTimesheet = await Timesheet.findOneAndUpdate(
            { id },
            { $set: updateFields },
            { new: true }
        );

        if (!updatedTimesheet) {
            return res.status(404).json({ success: false, message: "Timesheet not found." });
        }

        res.status(200).json({ success: true, message: "Timesheet approved and processed.", data: updatedTimesheet });
    } catch (error) {
        console.error("Approve Timesheet Error:", error);
        res.status(500).json({ success: false, message: "Failed to approve timesheet." });
    }
});

// GET /export - Export timesheets data for CSV
router.get("/export", verifyToken, async (req, res) => {
    try {
        const { type, id, startDate, endDate, companyId } = req.query;
        if (!type || !id) return res.status(400).json({ success: false, message: "Type and ID are required." });

        let match = {};
        if (companyId) match.companyId = String(companyId);

        const timeZone = req.headers["x-timezone"] || req.query.timeZone || "UTC";

        if (startDate && endDate) {
            match.startTime = {
                $gte: dayjs(startDate).tz(timeZone).startOf('day').utc(true).toDate(),
                $lte: dayjs(endDate).tz(timeZone).endOf('day').utc(true).toDate()
            };
        }

        let pipeline = [];

        if (type === 'guard') {
            match.guardId = String(id);
            pipeline = [
                { $match: match },
                {
                    $lookup: {
                        from: "sites",
                        localField: "siteId",
                        foreignField: "id",
                        as: "siteInfo"
                    }
                },
                {
                    $lookup: {
                        from: "users",
                        localField: "guardId",
                        foreignField: "uid",
                        as: "guardInfo"
                    }
                },
                { $unwind: "$siteInfo" },
                { $unwind: "$guardInfo" },
                {
                    $project: {
                        _id: 0,
                        Date: { $dateToString: { format: "%Y-%m-%d", date: "$startTime", timezone: timeZone } },
                        GuardName: "$guardInfo.fullName",
                        SiteName: "$siteInfo.name",
                        Start: { $dateToString: { format: "%H:%M", date: "$startTime", timezone: timeZone } },
                        End: { $dateToString: { format: "%H:%M", date: "$endTime", timezone: timeZone } },
                        TotalHours: "$payableHours",
                        PayRate: "$guardPayRate",
                        TotalPay: "$totalPay",
                        Status: "$status"
                    }
                }
            ];
        } else if (type === 'site') {
            match.siteId = String(id);
            pipeline = [
                { $match: match },
                {
                    $lookup: {
                        from: "users",
                        localField: "guardId",
                        foreignField: "uid",
                        as: "guardInfo"
                    }
                },
                { $unwind: "$guardInfo" },
                {
                    $group: {
                        _id: "$guardId",
                        GuardName: { $first: "$guardInfo.fullName" },
                        TotalHours: { $sum: "$payableHours" },
                        TotalPay: { $sum: "$totalPay" },
                        ShiftCount: { $sum: 1 }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        GuardName: 1,
                        TotalHours: { $round: ["$TotalHours", 2] },
                        TotalPay: { $round: ["$TotalPay", 2] },
                        ShiftCount: 1
                    }
                }
            ];
        } else if (type === 'customer') {
            // First find all sites for this customer
            const sites = await Sites.find({ customerId: String(id) });
            const siteIds = sites.map(s => s.id);
            match.siteId = { $in: siteIds };

            pipeline = [
                { $match: match },
                {
                    $lookup: {
                        from: "sites",
                        localField: "siteId",
                        foreignField: "id",
                        as: "siteInfo"
                    }
                },
                { $unwind: "$siteInfo" },
                {
                    $group: {
                        _id: "$siteId",
                        SiteName: { $first: "$siteInfo.name" },
                        TotalHours: { $sum: "$payableHours" },
                        TotalPay: { $sum: "$totalPay" },
                        ShiftCount: { $sum: 1 }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        SiteName: 1,
                        TotalHours: { $round: ["$TotalHours", 2] },
                        TotalPay: { $round: ["$TotalPay", 2] },
                        ShiftCount: 1
                    }
                }
            ];
        }

        const data = await Timesheet.aggregate(pipeline);

        // Task 4: Enhance Export with Profile Context for Guard
        let summary = null;
        if (type === 'guard' && data.length > 0) {
            const totalHours = data.reduce((acc, curr) => acc + (curr.TotalHours || 0), 0);
            const totalPay = data.reduce((acc, curr) => acc + (curr.TotalPay || 0), 0);
            summary = {
                "Guard Name": data[0].GuardName,
                "UID": id,
                "Period": match.startTime ? `${dayjs(match.startTime.$gte).format('YYYY-MM-DD')} to ${dayjs(match.startTime.$lte).format('YYYY-MM-DD')}` : "All Time",
                "Total Worked Hours": totalHours.toFixed(2),
                "Total Earnings": `£${totalPay.toFixed(2)}`
            };
        }

        res.status(200).json({ success: true, count: data.length, data, summary });

    } catch (error) {
        console.error("Export Error:", error);
        res.status(500).json({ success: false, message: "Failed to export data." });
    }
});

module.exports = router;
