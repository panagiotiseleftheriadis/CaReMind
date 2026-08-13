// emailService.js
const { Resend } = require("resend");

let resendClient = null;

function getResendClient() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("Missing required environment variable: RESEND_API_KEY");
  }
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

async function sendMail(to, subject, html, attachments = []) {
  // Μετατροπή attachments σε format που θέλει το Resend
  // attachments: [{ filename, path, cid }]
  const mappedAttachments = await Promise.all(
    attachments.map(async (a) => {
      // Αν δεν θες καθόλου attachments, μπορείς απλά να περνάς [] και τελειώνει εδώ
      if (!a?.path) return null;

      const fs = require("fs/promises");
      const content = await fs.readFile(a.path);
      return {
        filename: a.filename || "attachment",
        content: content.toString("base64"),
      };
    })
  );

  const finalAttachments = mappedAttachments.filter(Boolean);

  await getResendClient().emails.send({
    // Προσωρινά μπορείς να βάλεις το default domain που επιτρέπει το Resend (ή το verified domain σου)
    from: "CaReMind <noreply@car-remind.gr>",
    replyTo: "support@car-remind.gr",
    to,
    subject,
    html,
    attachments: finalAttachments.length ? finalAttachments : undefined,
  });
}

module.exports = sendMail;
