const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail", // αν χρησιμοποιείς gmail
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

async function sendMail(to, subject, html, attachments = []) {
  await transporter.sendMail({
    from: "CaReMind <caremind2026@gmail.com>",
    to,
    subject,
    html,
    attachments,
  });
}

module.exports = sendMail;
