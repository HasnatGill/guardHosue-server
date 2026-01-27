const sendMail = require("./sendMail");
const dayjs = require("dayjs");

/**
 * Sends a push notification to a guard.
 * @param {string} guardId - The guard's ID.
 * @param {string} message - The message content.
 * @param {object} data - Additional data payload.
 */
const sendPushNotification = async (guardId, message, data = {}) => {
    // Placeholder for Push Notification Logic
    // Integration with Firebase (FCM) or Expo would go here.
    console.log(`[PUSH] Sending Push Notification to Guard ${guardId}: "${message}"`, data);
    return Promise.resolve(true);
};

/**
 * Sends an email notification to a guard about a shift.
 * @param {object} guard - User object containing email and fullName.
 * @param {object} shift - Shift object.
 */
const sendEmailNotification = async (guard, shift) => {
    if (!guard || !guard.email) {
        console.warn(`[EMAIL] Skipped: No email for guard ${guard?.uid}`);
        return;
    }

    const subject = `New Shift Assigned: ${shift.siteName || "GuardHouse Site"}`;
    const date = dayjs(shift.start).format("dddd, MMM D, YYYY");
    const time = `${dayjs(shift.start).format("HH:mm")} - ${dayjs(shift.end).format("HH:mm")}`;

    const htmlBody = `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <h2 style="color: #0056b3;">New Shift Assignment</h2>
            <p>Hi ${guard.fullName},</p>
            <p>You have been assigned a new shift.</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Site:</strong></td>
                    <td style="padding: 8px; border-bottom: 1px solid #ddd;">${shift.siteName || "N/A"}</td>
                </tr>
                <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Date:</strong></td>
                    <td style="padding: 8px; border-bottom: 1px solid #ddd;">${date}</td>
                </tr>
                <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Time:</strong></td>
                    <td style="padding: 8px; border-bottom: 1px solid #ddd;">${time}</td>
                </tr>
            </table>
            <p style="margin-top: 20px;">Please log in to the app to acknowledge this shift.</p>
            <p>Best regards,<br/>Security Matrix AI Team</p>
        </div>
    `;

    try {
        await sendMail(guard.email, subject, htmlBody);
        console.log(`[EMAIL] Sent to ${guard.email} for shift ${shift.id}`);
    } catch (error) {
        console.error(`[EMAIL] Failed to send to ${guard.email}:`, error);
    }
};

module.exports = { sendPushNotification, sendEmailNotification };
