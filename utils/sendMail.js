const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    host: "sandbox.smtp.mailtrap.io",
    port: 2525,
    auth: {
        user: "6867c26f87c061",
        pass: "17fbab6be6fc3c"
    }
});

async function sendVerificationMail(to, link) {
    return transporter.sendMail({
        from: "Guard <no-reply@yourapp.com>",
        to,
        subject: "Set Your Password",
        html: `
      <p>Hello Admin,</p>
      <p>Please click the link below to set your password:</p>
      <a href="${link}" style="color: blue; text-decoration: underline;">Set Password</a>
    `
    });
}

module.exports = sendVerificationMail;
