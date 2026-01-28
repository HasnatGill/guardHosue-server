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
};

module.exports = { initCronJobs };
