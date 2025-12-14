const nodemailer = require("nodemailer");

const { MAIL_HOST, MAIL_PORT, MAIL_USERNAME, MAIL_PASSWORD } = process.env

const transporter = nodemailer.createTransport({
    host: MAIL_HOST,
    port: MAIL_PORT,
    auth: {
        user: MAIL_USERNAME,
        pass: MAIL_PASSWORD,
    }
});

async function sendMail(to, subjectText, bodHtml) {
    return transporter.sendMail({
        from: "Security Matrixai", to, subject: subjectText,
        html: bodHtml
    });
}

module.exports = sendMail;
