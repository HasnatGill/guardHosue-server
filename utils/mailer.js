const nodemailer = require("nodemailer");
const dayjs = require("dayjs");

const { MAIL_PASSWORD, MAIL_USERNAME, MAIL_HOST, MAIL_PORT, MAIL_FROM } = process.env;

const transporter = nodemailer.createTransport({
    host: MAIL_HOST,
    port: MAIL_PORT,
    secure: Number(MAIL_PORT) === 465, // true for 465, false for other ports
    auth: {
        user: MAIL_USERNAME,
        pass: MAIL_PASSWORD,
    },
    tls: {
        rejectUnauthorized: false,
    }
});

/**
 * Generic function to send an email.
 * @param {string} to - Recipient email.
 * @param {string} subject - Email subject.
 * @param {string} html - HTML content.
 */
const sendEmail = async (to, subject, html) => {
    try {
        const info = await transporter.sendMail({
            from: MAIL_FROM || `"GuardHouse Operations" <${MAIL_USERNAME}>`,
            to,
            subject,
            html
        });
        console.log("Email sent: %s", info.messageId);
        return info;
    } catch (error) {
        console.error("Error sending email:", error);
        throw error;
    }
};

/**
 * Sends a professional shift notification email.
 * @param {object} guard - User object (email, fullName).
 * @param {object} shift - Shift details (siteName, start, end, guardRole).
 */
const sendShiftEmail = async (guard, shift) => {
    if (!guard || !guard.email) {
        console.error("Mailer Error: No recipient email provided.");
        return;
    }

    const startTime = dayjs(shift.start).format("HH:mm");
    const endTime = dayjs(shift.end).format("HH:mm");
    const shiftDate = dayjs(shift.start).format("dddd, MMMM D, YYYY");

    const subject = `Shift Assignment: ${shift.siteName} - ${shiftDate}`;

    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f4f7f9; margin: 0; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
            .header { background: linear-gradient(135deg, #1a237e 0%, #0d47a1 100%); color: #ffffff; padding: 40px 20px; text-align: center; }
            .header h1 { margin: 0; font-size: 24px; font-weight: 300; letter-spacing: 1px; }
            .content { padding: 40px 30px; color: #444; }
            .greeting { font-size: 18px; font-weight: 600; color: #1a237e; margin-bottom: 20px; }
            .shift-card { background-color: #f8f9fa; border-left: 4px solid #1a237e; padding: 25px; border-radius: 4px; margin: 25px 0; }
            .detail-row { display: flex; margin-bottom: 12px; border-bottom: 1px solid #edf2f7; padding-bottom: 8px; }
            .detail-row:last-child { border-bottom: none; }
            .label { font-weight: bold; color: #718096; width: 120px; font-size: 13px; text-transform: uppercase; }
            .value { color: #2d3748; font-weight: 500; }
            .footer { background-color: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #a0aec0; }
            .cta-button { display: inline-block; padding: 14px 35px; background-color: #1a237e; color: #ffffff !important; text-decoration: none; border-radius: 50px; font-weight: 600; margin-top: 25px; transition: background 0.3s; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>SHIFT ASSIGNMENT</h1>
            </div>
            <div class="content">
                <div class="greeting">Hello ${guard.fullName},</div>
                <p>A new shift has been assigned to you. Please find the operational details below and acknowledge via the mobile app.</p>
                
                <div class="shift-card">
                    <div class="detail-row">
                        <span class="label">Date</span>
                        <span class="value">${shiftDate}</span>
                    </div>
                    <div class="detail-row">
                        <span class="label">Time</span>
                        <span class="value">${startTime} — ${endTime}</span>
                    </div>
                    <div class="detail-row">
                        <span class="label">Site Name</span>
                        <span class="value">${shift.siteName}</span>
                    </div>
                    <div class="detail-row">
                        <span class="label">Assignment</span>
                        <span class="value">${shift.guardRole || 'General Security'}</span>
                    </div>
                </div>

                <p style="text-align: center; margin-top: 30px;">
                    <a href="https://guardhouse.app" class="cta-button">Confirm Shift in App</a>
                </p>
            </div>
            <div class="footer">
                <p>&copy; ${new Date().getFullYear()} GuardHouse Operations. Confidentiality Notice: This email is intended for the named guard only.</p>
            </div>
        </div>
    </body>
    </html>
    `;

    return sendEmail(guard.email, subject, htmlContent);
};

module.exports = {
    sendEmail,
    sendShiftEmail
};
