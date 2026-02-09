const cron = require('node-cron');
const Shifts = require('../models/shifts');
const Timesheet = require('../models/Timesheet');
const Users = require('../models/auth');
const Sites = require('../models/sites');
const { getRandomId } = require('../config/global');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { getIO } = require('../socket');

dayjs.extend(utc);
dayjs.extend(timezone);

const initCronJobs = () => {
    cron.schedule('*/15 * * * *', async () => {
        console.log(`[${dayjs().format('HH:mm:ss')}] Running Cron: Checking for missed clock-ins...`);
        try {
            const potentialMissedShifts = await Shifts.find({
                status: { $in: ['published', 'accepted'] },
                actualStart: null
            });

            const missedShiftIds = [];
            const missedShiftsData = [];

            for (const shift of potentialMissedShifts) {
                const tz = shift.timeZone || "UTC";
                const localNowWallClock = dayjs().tz(tz).utc(true);
                const gracePeriodLimit = localNowWallClock.subtract(15, 'minute');

                if (dayjs(shift.start).isBefore(gracePeriodLimit)) {
                    missedShiftIds.push(shift._id);
                    missedShiftsData.push(shift);

                    try {
                        const guard = await Users.findOne({ uid: shift.guardId });
                        const guardPayRate = guard?.perHour || guard?.standardRate || 0;

                        await Timesheet.create({
                            id: getRandomId(),
                            shiftId: shift.id,
                            guardId: shift.guardId,
                            siteId: shift.siteId,
                            companyId: shift.companyId,
                            scheduledStart: shift.start,
                            scheduledEnd: shift.end,
                            scheduledBreakMinutes: shift.breakTime || 0,
                            scheduledTotalHours: shift.totalHours || 0,
                            actualStart: null,
                            actualEnd: null,
                            actualBreakMinutes: shift.breakTime || 0,
                            actualTotalHours: 0,
                            selectedBreakMinutes: shift.breakTime || 0,
                            selectedPayableHours: 0,
                            selectedScheduledStart: shift.start,
                            selectedScheduledEnd: shift.end,
                            selectedTotalHours: 0,
                            calculationPreference: 'scheduled',
                            status: 'missed',
                            adminNotes: "Missed Shift: No clock-in detected.",
                            guardPayRate: guardPayRate,
                            totalPay: 0
                        });

                        // Mark shift so we don't process it again (though status 'missed' handles this)
                        await Shifts.updateOne({ _id: shift._id }, { $set: { isTimesheetGenerated: true } });
                    } catch (tsErr) {
                        console.error(`Failed to create missed timesheet for shift ${shift.id}:`, tsErr);
                    }
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

};

module.exports = { initCronJobs };
