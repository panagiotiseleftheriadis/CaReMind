// emailService.js
const fs = require("fs/promises");
const { Resend } = require("resend");

let resendClient = null;

class EmailSubmissionError extends Error {
  constructor(code, providerCategory, providerMessage, cause) {
    super("Email submission failed", cause ? { cause } : undefined);
    this.name = "EmailSubmissionError";
    this.code = code;
    Object.defineProperties(this, {
      providerCategory: { value: providerCategory, enumerable: false },
      providerMessage: { value: providerMessage, enumerable: false },
    });
  }
}

function redactProviderText(value) {
  return String(value || "Unknown provider error")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .replace(/\b(?:re_|Bearer\s+)[A-Za-z0-9._-]{12,}\b/gi, "[redacted-secret]")
    .replace(/\b\d{6}\b/g, "[redacted-code]")
    .replace(/\beyJ[A-Za-z0-9._-]{20,}\b/g, "[redacted-token]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 300);
}

function providerFailureDetails(error) {
  const category = redactProviderText(
    error?.name || error?.type || error?.code || error?.statusCode || "provider_error"
  );
  const message = redactProviderText(error?.message || error?.error || error);
  return { category, message };
}

function getResendClient() {
  if (!process.env.RESEND_API_KEY) {
    throw new EmailSubmissionError(
      "EMAIL_CONFIGURATION_ERROR",
      "configuration",
      "RESEND_API_KEY is not configured"
    );
  }
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

async function sendMail(to, subject, html, attachments = []) {
  const mappedAttachments = await Promise.all(
    attachments.map(async (attachment) => {
      if (!attachment?.path) return null;
      const content = await fs.readFile(attachment.path);
      return {
        filename: attachment.filename || "attachment",
        content: content.toString("base64"),
      };
    })
  );

  try {
    const result = await getResendClient().emails.send({
      from: "CaReMind <noreply@car-remind.gr>",
      replyTo: "support@car-remind.gr",
      to,
      subject,
      html,
      attachments: mappedAttachments.some(Boolean)
        ? mappedAttachments.filter(Boolean)
        : undefined,
    });

    if (result?.error) {
      const details = providerFailureDetails(result.error);
      throw new EmailSubmissionError(
        "EMAIL_PROVIDER_REJECTED",
        details.category,
        details.message
      );
    }

    if (!result?.data) {
      throw new EmailSubmissionError(
        "EMAIL_PROVIDER_INVALID_RESPONSE",
        "invalid_response",
        "Provider response did not include submission data"
      );
    }

    return {
      status: "submitted",
      providerMessageId: result?.data?.id || null,
    };
  } catch (error) {
    if (error instanceof EmailSubmissionError) throw error;
    const details = providerFailureDetails(error);
    throw new EmailSubmissionError(
      "EMAIL_PROVIDER_UNAVAILABLE",
      details.category,
      details.message,
      error
    );
  }
}

function isEmailSubmissionError(error) {
  return error instanceof EmailSubmissionError;
}

function emailFailureLogDetails(error) {
  if (!isEmailSubmissionError(error)) return { code: "EMAIL_SUBMISSION_UNKNOWN" };
  return {
    code: error.code,
    providerCategory: error.providerCategory,
    providerMessage: error.providerMessage,
  };
}

function setResendClientForTests(client) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Resend client injection is test-only");
  }
  resendClient = client;
}

sendMail.EmailSubmissionError = EmailSubmissionError;
sendMail.isEmailSubmissionError = isEmailSubmissionError;
sendMail.emailFailureLogDetails = emailFailureLogDetails;
sendMail.setResendClientForTests = setResendClientForTests;

module.exports = sendMail;
