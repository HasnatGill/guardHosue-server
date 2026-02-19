const Shifts = require("../models/shifts");
const Users = require("../models/auth");
const Sites = require("../models/sites");
const WelfareLogs = require("../models/WelfareLogs");
const dayjs = require("dayjs");
const utc = require('dayjs/plugin/utc');
const { sendPushNotification } = require("../utils/pushNotify");

dayjs.extend(utc);

const monitorWelfare = async (io) => {
    try {
        const now = dayjs().utc();

        // 1. Find shifts that are active, have welfare enabled, and are past their next check time
        // We exclude 'alert' status because those are already escalated to max
        const overdueShifts = await Shifts.find({
            status: "active",
            "welfare.isEnabled": true,
            "welfare.nextCheckAt": { $lte: now.toDate() },
            "welfare.status": { $ne: "alert" }
        });

        for (const shift of overdueShifts) {
            const guard = await Users.findOne({ uid: shift.guardId });
            if (!guard) continue;

            const site = await Sites.findOne({ id: shift.siteId });

            // Calculate how many minutes past the scheduled check time we are
            const minutesSinceCheck = now.diff(dayjs(shift.welfare.nextCheckAt), 'minute');
            const gracePeriod = shift.welfare.gracePeriod || 5;

            let status = "overdue";
            let shouldAlert = false;
            let checksFailed = shift.welfare.failedChecks || 0;
            const alertIntervals = [0, 3, 5, 7, 10, 12, 15]; // Minutes AFTER grace period to notify

            // 1. Initial Prompt (at exact check time)
            if (minutesSinceCheck === 0) {
                // Send "Safety Check Required" prompt
                const title = "Welfare Check";
                const body = `Please confirm you are safe at ${site?.name || 'your site'}.`;

                if (guard.deviceToken) {
                    sendPushNotification(guard.deviceToken, title, body, { shiftId: shift.id, type: "WELFARE_CHECK", timeout: 900000 })
                        .catch(e => console.error(e));
                }
                if (io) io.to(guard.uid).emit('WELFARE_PROMPT', { shiftId: shift.id, message: body, timeout: 900000 });

                try {
                    await WelfareLogs.create({ shiftId: shift.id, guardId: shift.guardId, siteId: shift.siteId, event: 'TRIGGERED', timestamp: now.toDate(), metadata: { message: body } });
                } catch (e) { }
            }

            // 2. Escalation (After Grace Period)
            if (minutesSinceCheck > gracePeriod) {
                const minutesOverdue = minutesSinceCheck - gracePeriod;

                if (alertIntervals.includes(minutesOverdue)) {
                    const title = "Welfare Check Overdue!";
                    const body = `You are ${minutesOverdue}m past your grace period. Confirm safety immediately!`;

                    if (guard.deviceToken) {
                        sendPushNotification(guard.deviceToken, title, body, { shiftId: shift.id, type: "WELFARE_ESCALATION", timeout: 900000 })
                            .catch(e => console.error(e));
                    }
                    if (io) io.to(guard.uid).emit('WELFARE_PROMPT', { shiftId: shift.id, message: body, timeout: 900000 });

                    try {
                        await WelfareLogs.create({ shiftId: shift.id, guardId: shift.guardId, siteId: shift.siteId, event: 'MISSED', timestamp: now.toDate(), metadata: { minutesOverdue, message: body } });
                    } catch (e) { }
                }

                // Red Alert
                if (minutesOverdue >= 15) {
                    status = "alert";
                    shouldAlert = true;
                }
            } else {
                status = "overdue";
            }

            // Update Shift
            await Shifts.findOneAndUpdate(
                { id: shift.id },
                {
                    $set: {
                        "welfare.status": status,
                        "welfare.failedChecks": (minutesSinceCheck > gracePeriod && alertIntervals.includes(minutesSinceCheck - gracePeriod)) ? checksFailed + 1 : checksFailed
                    }
                }
            );

            // Emit Red Alert
            if (shouldAlert && io) {
                const alertMsg = `RED ALERT: Guard ${guard.fullName} has not responded to welfare checks!`;
                io.emit('WELFARE_ALARM', { shiftId: shift.id, guardName: guard.fullName, siteName: site?.name || "N/A", message: alertMsg });
                try {
                    await WelfareLogs.create({ shiftId: shift.id, guardId: shift.guardId, siteId: shift.siteId, event: 'ESCALATED', timestamp: now.toDate(), metadata: { message: alertMsg } });
                } catch (e) { }
            }
        }
    } catch (error) {
        console.error("Welfare Monitor Error:", error);
    }
};

const initWelfareService = (io) => {
    console.log("Welfare Service Initialized");
    setInterval(() => monitorWelfare(io), 60000); // Check every minute
};

module.exports = { initWelfareService };
