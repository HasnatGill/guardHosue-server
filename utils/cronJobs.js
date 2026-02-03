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
    // Run every 2 minutes for better responsiveness
    cron.schedule('*/5 * * * *', async () => {
        console.log(`[${dayjs().format('HH:mm:ss')}] Running Cron: Checking for missed clock-ins...`);
        try {
            // Find shifts that are 'published' or 'accepted' (accepted but no check-in)
            const potentialMissedShifts = await Shifts.find({
                status: { $in: ['published', 'accepted'] },
                actualStartTime: null
            });

            const missedShiftIds = [];
            const missedShiftsData = [];

            for (const shift of potentialMissedShifts) {
                const tz = shift.timeZone || "UTC";
                // Get current time in shift's local timezone, then treat that wall-clock time as UTC 
                // to match how shift.start is stored.
                const localNowWallClock = dayjs().tz(tz).utc(true);
                const gracePeriodLimit = localNowWallClock.subtract(15, 'minute');

                if (dayjs(shift.start).isBefore(gracePeriodLimit)) {
                    missedShiftIds.push(shift._id);
                    missedShiftsData.push(shift);
                }
            }

            if (missedShiftIds.length > 0) {
                console.log(`Found ${missedShiftIds.length} missed shifts. Updating statuses...`);

                const result = await Shifts.updateMany(
                    { _id: { $in: missedShiftIds } },
                    { $set: { status: 'missed' } }
                );

                console.log(`Successfully updated ${result.modifiedCount} shifts to 'missed'.`);

                // Notify Dashboard via Socket
                const io = getIO();
                missedShiftsData.forEach(shift => {
                    io.emit('shift_missed', {
                        shiftId: shift.id,
                        message: `Shift ${shift.id} marked as MISSED (No clock-in within 15m of ${dayjs(shift.start).format('HH:mm')}).`
                    });
                });
            }
        } catch (error) {
            console.error('Error in missed clock-in cron job:', error);
        }
    });

    // Welfare & Safety: Run every 1 minute
    // cron.schedule('* * * * *', async () => {
    //     console.log(`[${dayjs().format('HH:mm:ss')}] Running Cron: Checking for Welfare Safety Pings...`);
    //     try {
    //         const io = getIO();

    //         // 1. Trigger Welfare Check (SAFE -> PENDING)
    //         // Query for active shifts with welfare enabled
    //         const activeWelfareShifts = await Shifts.find({
    //             status: 'active',
    //             'welfare.isEnabled': true,
    //             'welfare.status': { $in: ['SAFE', 'OK', null, undefined] }
    //         });

    //         for (const shift of activeWelfareShifts) {
    //             if (!shift.welfare?.nextPingDue) continue;

    //             const tz = shift.timeZone || "UTC";
    //             const localNowWallClock = dayjs().tz(tz).utc(true);

    //             if (dayjs(shift.welfare.nextPingDue).isBefore(localNowWallClock)) {
    //                 console.log(`Triggering Welfare Check for shift ${shift.id} (${tz})`);

    //                 await Shifts.updateOne(
    //                     { _id: shift._id },
    //                     {
    //                         $set: {
    //                             'welfare.status': 'PENDING',
    //                             'welfare.lastPingRequest': localNowWallClock.toDate()
    //                         }
    //                     }
    //                 );

    //                 io.to(shift.guardId).emit('WELFARE_CHECK', {
    //                     shiftId: shift.id,
    //                     message: "Are you safe? Please confirm.",
    //                     timeoutMatches: 10 * 60 * 1000 // 10 minutes
    //                 });
    //             }
    //         }

    //         // 2. Escalation (PENDING -> OVERDUE)
    //         const pendingShifts = await Shifts.find({
    //             status: 'active',
    //             'welfare.isEnabled': true,
    //             'welfare.status': 'PENDING'
    //         });

    //         for (const shift of pendingShifts) {
    //             const tz = shift.timeZone || "UTC";
    //             const localNowWallClock = dayjs().tz(tz).utc(true);
    //             const timeoutThreshold = localNowWallClock.subtract(10, 'minutes');

    //             if (dayjs(shift.welfare.lastPingRequest).isBefore(timeoutThreshold)) {
    //                 console.log(`Welfare check for shift ${shift.id} is OVERDUE (${tz}). Escalating...`);

    //                 await Shifts.updateOne(
    //                     { _id: shift._id },
    //                     { $set: { 'welfare.status': 'OVERDUE' } }
    //                 );

    //                 io.emit('WELFARE_ALARM', {
    //                     shiftId: shift.id,
    //                     siteName: shift.siteId?.name || "Unknown Site",
    //                     guardName: shift.guardId || "Unknown Guard",
    //                     message: `CRITICAL: Welfare Check Missed for ${shift.id}`
    //                 });
    //             }
    //         }
    //     } catch (error) {
    //         console.error('Error in welfare cron job:', error);
    //     }
    // });
};

module.exports = { initCronJobs };
