const cron = require('node-cron');
const Shifts = require('../models/shifts');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { getIO } = require('../socket');

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Initializes background cron jobs for shift management.
 */
const initCronJobs = () => {
    // Run every 10 minutes
    cron.schedule('*/10 * * * *', async () => {
        console.log('Running Cron: Checking for missed clock-ins...');
        try {
            // Strict UTC Calculation
            const gracePeriodLimit = dayjs().utc().subtract(15, 'minute').toDate();

            // Find shifts that are 'published' or 'awaiting' (accepted but no check-in)
            // whose start time has passed the 15-minute grace period
            const missedShifts = await Shifts.find({
                status: { $in: ['published', 'awaiting'] },
                start: { $lt: gracePeriodLimit },
                actualStartTime: { $eq: null }
            });

            if (missedShifts.length > 0) {
                console.log(`Found ${missedShifts.length} missed shifts. Updating...`);

                const shiftIds = missedShifts.map(s => s._id);

                await Shifts.updateMany(
                    { _id: { $in: shiftIds } },
                    { $set: { liveStatus: 'missed', status: 'missed' } }
                );

                // Notify Dashboard via Socket
                const io = getIO();
                missedShifts.forEach(shift => {
                    io.emit('shift_missed', {
                        shiftId: shift.id,
                        message: `Shift ${shift.id} marked as MISSED (No clock-in within 15m).`
                    });
                });
            }
        } catch (error) {
            console.error('Error in missed clock-in cron job:', error);
        }
    });

    // Welfare & Safety: Run every 1 minute
    cron.schedule('* * * * *', async () => {
        console.log('Running Cron: Checking for Welfare Safety Pings...');
        try {
            const now = dayjs().utc();
            const io = getIO();

            // 1. Trigger Welfare Check (SAFE -> PENDING)
            // Find active shifts where welfare enabled, status is SAFE (or undefined), and time is up
            const triggerShifts = await Shifts.find({
                status: 'active',
                'welfare.isEnabled': true,
                'welfare.nextPingDue': { $lte: now.toDate() }, // Time is passed
                'welfare.status': { $in: ['SAFE', 'OK', null, undefined] } // Not already pending or overdue
            });

            if (triggerShifts.length > 0) {
                console.log(`Triggering Welfare Check for ${triggerShifts.length} shifts.`);
                const shiftIds = triggerShifts.map(s => s._id);

                // Update to PENDING
                await Shifts.updateMany(
                    { _id: { $in: shiftIds } },
                    { $set: { 'welfare.status': 'PENDING', 'welfare.lastPingRequest': now.toDate() } }
                );

                // Notify Mobile Apps
                triggerShifts.forEach(shift => {
                    io.to(shift.guardId).emit('WELFARE_CHECK', {
                        shiftId: shift.id,
                        message: "Are you safe? Please confirm.",
                        timeoutMatches: 10 * 60 * 1000 // 10 minutes
                    });

                    // Also trigger Push Notification as backup
                    // (Assuming sendPushNotification is available or we rely on socket for now)
                });
            }

            // 2. Escalation (PENDING -> OVERDUE)
            // Find shifts pending for > 10 minutes
            // 10 mins ago
            const timeoutThreshold = now.subtract(10, 'minutes').toDate();

            const overdueShifts = await Shifts.find({
                status: 'active',
                'welfare.isEnabled': true,
                'welfare.status': 'PENDING',
                'welfare.lastPingRequest': { $lte: timeoutThreshold }
            });

            if (overdueShifts.length > 0) {
                console.log(`Found ${overdueShifts.length} OVERDUE welfare pings. Escalating...`);

                for (const shift of overdueShifts) {
                    await Shifts.updateOne(
                        { id: shift.id },
                        { $set: { 'welfare.status': 'OVERDUE' } }
                    );

                    // Emit CRITICAL_ALARM to Admin Dashboard
                    io.emit('WELFARE_ALARM', {
                        shiftId: shift.id,
                        siteName: shift.siteId?.name || "Unknown Site",
                        guardName: shift.guardId || "Unknown Guard",
                        message: `CRITICAL: Welfare Check Missed for ${shift.id}`
                    });
                }
            }
        } catch (error) {
            console.error('Error in welfare cron job:', error);
        }
    });
};

module.exports = { initCronJobs };
