const cron = require('node-cron');
const Shifts = require('../models/shifts');
const dayjs = require('dayjs');
const { getIO } = require('../socket');

/**
 * Initializes background cron jobs for shift management.
 */
const initCronJobs = () => {
    // Run every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
        console.log('Running Cron: Checking for missed clock-ins...');
        try {
            const now = dayjs().toDate();
            const gracePeriodLimit = dayjs().subtract(15, 'minute').toDate();

            // Find shifts that are 'Draft' or 'Published' (not checked in yet)
            // whose start time has passed the 15-minute grace period
            // and haven't been marked as missed/active yet.
            const missedShifts = await Shifts.find({
                status: { $in: ['Draft', 'Published', 'pending'] },
                start: { $lt: gracePeriodLimit },
                actualStartTime: null
            });

            if (missedShifts.length > 0) {
                console.log(`Found ${missedShifts.length} missed shifts. Updating...`);

                const shiftIds = missedShifts.map(s => s._id);

                await Shifts.updateMany(
                    { _id: { $in: shiftIds } },
                    { $set: { liveStatus: 'missed', status: 'missed' } }
                );

                // Notify via Socket
                const io = getIO();
                missedShifts.forEach(shift => {
                    io.emit('shift_missed', {
                        shiftId: shift.id,
                        message: `Shift ${shift.id} marked as MISSED (No clock-in within grace period).`
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
            const now = dayjs();

            // Find active shifts where welfare is enabled and ping is overdue
            // Logic: isEnabled is true, status is active, and now > nextPingDue
            const overdueShifts = await Shifts.find({
                status: 'active',
                'welfare.isEnabled': true,
                'welfare.nextPingDue': { $lt: now.toDate() },
                'welfare.status': { $ne: 'OVERDUE' }
            });

            if (overdueShifts.length > 0) {
                console.log(`Found ${overdueShifts.length} overdue welfare pings. alerting...`);

                const io = getIO();
                for (const shift of overdueShifts) {
                    await Shifts.updateOne(
                        { id: shift.id },
                        { $set: { 'welfare.status': 'OVERDUE' } }
                    );

                    // Emit alert to Admin Dashboard
                    io.emit('WELFARE_ALERT', {
                        shiftId: shift.id,
                        siteName: shift.siteName,
                        guardName: shift.guardName, // Assuming these fields exist or we need to look them up
                        message: `SAFETY ALERT: Guard safety check is OVERDUE for ${shift.id}`
                    });
                }
            }
        } catch (error) {
            console.error('Error in welfare cron job:', error);
        }
    });
};

module.exports = { initCronJobs };
