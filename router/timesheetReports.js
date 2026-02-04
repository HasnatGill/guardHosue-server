const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Timesheet = require("../models/Timesheet");
const { verifyToken } = require("../middlewares/auth");
const dayjs = require("dayjs");
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

// Helper to build date match stage
const buildDateMatch = (req) => {
    const { startDate, endDate } = req.query;
    const match = { companyId: req.user.companyId }; // Assuming verifyToken populates req.user.companyId directly or we fetch it.

    // If verifyToken attaches 'uid' and we need to fetch user, we might need to adjust. 
    // Usually verifyToken attaches user object or uid. 
    // Let's assume req.user is populated or we use req.companyId if available.
    // Based on previous files, verifyToken likely attaches 'uid'.
    // We should strictly follow the pattern in operations.js: 
    // const { uid } = req; const user = await Users.findOne({ uid });
    // But for aggregation efficiency, if we can get companyId from token that's better.
    // Let's stick to the pattern: verifyToken -> req.user or req.uid.

    // ADJUSTMENT: operations.js does: const { uid } = req; const user = await Users.findOne({ uid });
    // This router should probably also do that or middleware attaches it.
    // To be safe, I'll use the user fetch pattern inside the route for now, or assume middleware.
    // Re-reading operations.js: it fetches user.

    // But wait, for a Report, we need company-wide data. 
    // We'll trust the caller passes data correctly? No, we must secure it.
    // I will implement user fetch in the route handler for security.

    if (startDate && endDate) {
        match.startTime = {
            $gte: dayjs(startDate).startOf('day').toDate(),
            $lte: dayjs(endDate).endOf('day').toDate()
        };
    }
    return match;
};

// Middleware to ensure companyId is available (if not in token)
const attachCompany = async (req, res, next) => {
    try {
        const Users = require("../models/auth");
        const { uid } = req;
        const user = await Users.findOne({ uid });
        if (!user) return res.status(401).json({ message: "Unauthorized", isError: true });
        req.user = user; // Attach full user
        next();
    } catch (error) {
        return res.status(500).json({ message: "Auth Error", isError: true });
    }
};

router.use(verifyToken);
router.use(attachCompany);

/**
 * GET /summary/site-wise
 * Group by Site: Total Hours, Total Bill, Total Profit
 */
router.get("/summary/site-wise", async (req, res) => {
    try {
        const matchStage = buildDateMatch(req);

        const pipeline = [
            { $match: matchStage },
            {
                $group: {
                    _id: "$siteId",
                    totalHours: { $sum: "$totalHours" },
                    totalGuardPay: { $sum: "$totalGuardPay" },
                    siteId: { $first: "$siteId" }
                }
            },
            {
                $lookup: {
                    from: "sites",
                    localField: "siteId",
                    foreignField: "id",
                    as: "siteDetails"
                }
            },
            { $unwind: "$siteDetails" },
            {
                $project: {
                    _id: 0,
                    siteId: 1,
                    siteName: "$siteDetails.name",
                    totalHours: { $round: ["$totalHours", 2] },
                    totalGuardPay: { $round: ["$totalGuardPay", 2] }
                }
            }
        ];

        const report = await Timesheet.aggregate(pipeline);
        res.status(200).json({ message: "Site-wise summary fetched.", report });

    } catch (error) {
        console.error("Site Report Error:", error);
        res.status(500).json({ message: "Error fetching site summary.", isError: true });
    }
});

/**
 * GET /summary/guard-wise
 * Group by Guard: Total Hours, Total Pay
 */
router.get("/summary/guard-wise", async (req, res) => {
    try {
        const matchStage = buildDateMatch(req);

        const pipeline = [
            { $match: matchStage },
            {
                $group: {
                    _id: "$guardId",
                    totalHours: { $sum: "$totalHours" },
                    totalGuardPay: { $sum: "$totalGuardPay" },
                    count: { $sum: 1 },
                    guardId: { $first: "$guardId" }
                }
            },
            {
                $lookup: {
                    from: "users",
                    localField: "guardId",
                    foreignField: "uid",
                    as: "guardDetails"
                }
            },
            { $unwind: { path: "$guardDetails", preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    _id: 0,
                    guardId: 1,
                    guardName: { $ifNull: ["$guardDetails.fullName", "Unknown Guard"] },
                    totalHours: { $round: ["$totalHours", 2] },
                    totalGuardPay: { $round: ["$totalGuardPay", 2] },
                    totalShifts: "$count"
                }
            }
        ];

        const report = await Timesheet.aggregate(pipeline);
        res.status(200).json({ message: "Guard-wise summary fetched.", report });

    } catch (error) {
        console.error("Guard Report Error:", error);
        res.status(500).json({ message: "Error fetching guard summary.", isError: true });
    }
});

/**
 * GET /export
 * Detailed Flat List for CSV Export
 */
router.get("/export", async (req, res) => {
    try {
        const matchStage = buildDateMatch(req);

        const pipeline = [
            { $match: matchStage },
            {
                $lookup: {
                    from: "sites",
                    localField: "siteId",
                    foreignField: "id",
                    as: "siteDetails"
                }
            },
            { $unwind: { path: "$siteDetails", preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: "users",
                    localField: "guardId",
                    foreignField: "uid",
                    as: "guardDetails"
                }
            },
            { $unwind: { path: "$guardDetails", preserveNullAndEmptyArrays: true } },
            { $sort: { startTime: -1 } },
            {
                $project: {
                    _id: 0,
                    timesheetId: "$id",
                    siteName: "$siteDetails.name",
                    guardName: "$guardDetails.fullName",
                    date: { $dateToString: { format: "%Y-%m-%d", date: "$startTime" } },
                    startTime: "$startTime",
                    endTime: "$endTime",
                    totalHours: "$totalHours",
                    guardPayRate: "$guardPayRate",
                    totalGuardPay: "$totalGuardPay",
                    status: "$status"
                }
            }
        ];

        const report = await Timesheet.aggregate(pipeline);
        res.status(200).json({ message: "Export data fetched.", report });

    } catch (error) {
        console.error("Export Report Error:", error);
        res.status(500).json({ message: "Error fetching export data.", isError: true });
    }
});

module.exports = router;
