const Shifts = require("../models/shifts");
const Users = require("../models/auth");
const Sites = require("../models/sites");
const dayjs = require("dayjs");
const utc = require('dayjs/plugin/utc');
const { sendPushNotification } = require("../utils/pushNotify");

dayjs.extend(utc);

const monitorWelfare = async (io) => {
    try {
        const now = dayjs().utc();

        // 1. Find shifts that are overdue for a welfare check
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

            const overdueMinutes = now.diff(dayjs(shift.welfare.nextCheckAt), 'minute');

            let status = "overdue";
            let shouldAlert = false;

            // Notification intervals: 0 (immediate), 3, 5, 7, 10, 12, 15
            const alertIntervals = [0, 3, 5, 7, 10, 12, 15];

            // Check if we should send a notification based on overdue minutes
            if (alertIntervals.includes(overdueMinutes)) {
                if (guard.deviceToken) {
                    sendPushNotification(
                        guard.deviceToken,
                        "Welfare Check Required",
                        `Please confirm you are safe at ${site?.name || 'your site'}.`,
                        { shiftId: shift.id, type: "WELFARE_CHECK", timeout: 900000 } // 15 mins
                    ).catch(err => console.error("Welfare Push Error:", err));
                }

                if (io) {
                    io.to(guard.uid).emit('WELFARE_PROMPT', {
                        shiftId: shift.id,
                        message: "Safety Check required. Are you safe?",
                        timeout: 900000
                    });
                }
            }

            // If overdue for more than 15 minutes total since the FIRST reminder (which is 15 mins after prompt?)
            // The prompt has a 15 min timeout. So if overdueMinutes > 15, it's a Red Alert.
            if (overdueMinutes >= 15) {
                status = "alert";
                shouldAlert = true;
            }

            await Shifts.findOneAndUpdate(
                { id: shift.id },
                { $set: { "welfare.status": status } }
            );

            if (shouldAlert && io) {
                io.emit('WELFARE_ALARM', {
                    shiftId: shift.id,
                    guardName: guard.fullName,
                    siteName: site?.name || "N/A",
                    message: `RED ALERT: Guard ${guard.fullName} has not responded to welfare checks!`
                });
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
