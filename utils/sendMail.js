const nodemailer = require("nodemailer");

const { MAIL_PASSWORD, MAIL_USERNAME, MAIL_HOST, MAIL_PORT } = process.env

const transporter = nodemailer.createTransport({
    host: MAIL_HOST,
    port: MAIL_PORT,
    secure: true,
    auth: {
        user: MAIL_USERNAME,
        pass: MAIL_PASSWORD,
    },
    tls: {
        rejectUnauthorized: false,
    }
});

async function sendMail(to, subjectText, bodyHtml, attachments = []) {
    return transporter.sendMail({
        from: `"Security Matrix AI" <contact@securitymatrixai.com>`,
        to,
        subject: subjectText,
        html: bodyHtml,
        attachments
    });
}

module.exports = sendMail;

