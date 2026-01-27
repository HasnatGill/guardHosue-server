const dayjs = require("dayjs");

/**
 * Calculates shift duration and paid hours.
 * @param {string|dayjs.Dayjs} start - Start time/date
 * @param {string|dayjs.Dayjs} end - End time/date
 * @param {number|string} breakTime - Break time in minutes
 * @returns {Object} - { totalDuration: string, totalHours: number, paidHours: number }
 */
const calculateShiftHours = (start, end, breakTime = 0) => {
    if (!start || !end) {
        return {
            totalDuration: "0h 0m",
            totalHours: 0,
            paidHours: 0
        };
    }

    const startDate = dayjs(start);
    let endDate = dayjs(end);

    // Handle midnight span logic:
    // If End < Start, add 24 hours to End.
    if (endDate.isBefore(startDate)) {
        endDate = endDate.add(1, 'day');
    }

    // Calculate difference in minutes
    const totalMinutes = endDate.diff(startDate, 'minute');

    // Calculate Paid Minutes
    const breakMinutes = parseFloat(breakTime) || 0;
    const paidMinutes = totalMinutes - breakMinutes;

    // Format Total Duration String (e.g., "7h 30m")
    const durationHours = Math.floor(totalMinutes / 60);
    const durationMins = totalMinutes % 60;
    const totalDuration = `${durationHours}h ${durationMins}m`;

    // Decimal Calculations
    const totalHours = parseFloat((totalMinutes / 60).toFixed(2));
    const paidHours = parseFloat((Math.max(0, paidMinutes) / 60).toFixed(2));

    return {
        totalDuration,
        totalHours,
        paidHours
    };
};

module.exports = { calculateShiftHours };
