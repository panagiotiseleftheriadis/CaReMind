// Registration and email verification stay public; verification does not create a session.
(function () {
  "use strict";

  const RESEND_COOLDOWN_SECONDS = 30;
  const qs = (id) => document.getElementById(id);

  function showMessage(element, text, isError = false) {
    if (!element) return;
    element.textContent = text;
    element.hidden = false;
    element.classList.toggle("error", isError);
    element.classList.toggle("success", !isError);
  }

  function hideMessage(element) {
    if (!element) return;
    element.hidden = true;
    element.textContent = "";
    element.classList.remove("error", "success");
  }

  function readableRegistrationError(error) {
    if (error?.code === "USERNAME_TAKEN") return "Αυτό το όνομα χρήστη χρησιμοποιείται ήδη. Δοκίμασε ένα διαφορετικό.";
    if (error?.code === "EMAIL_TAKEN") return "Υπάρχει ήδη λογαριασμός με αυτό το email. Μπορείς να συνδεθείς ή να ανακτήσεις τον κωδικό σου.";
    if (error?.code === "VERIFICATION_EMAIL_UNAVAILABLE") {
      return "Ο λογαριασμός δημιουργήθηκε, αλλά δεν μπορέσαμε να στείλουμε το email. Συνέχισε στην επιβεβαίωση και ζήτησε νέο κωδικό.";
    }
    if (error?.status === 429) return "Έγιναν πολλές προσπάθειες. Περίμενε λίγο και δοκίμασε ξανά.";
    if (error?.status === 503) return "Η υπηρεσία εγγραφής δεν είναι προσωρινά διαθέσιμη. Δοκίμασε ξανά σε λίγο.";
    if (error?.status === 400) return "Έλεγξε το email, το όνομα χρήστη και τον κωδικό σου.";
    return "Δεν μπορέσαμε να ολοκληρώσουμε την εγγραφή. Έλεγξε τη σύνδεσή σου και δοκίμασε ξανά.";
  }

  function readableVerificationError(error) {
    if (error?.status === 400) return "Ο κωδικός δεν είναι σωστός ή έχει λήξει. Ζήτησε νέο κωδικό και δοκίμασε ξανά.";
    if (error?.status === 404) return "Δεν μπορέσαμε να επιβεβαιώσουμε αυτά τα στοιχεία. Έλεγξε το email και τον κωδικό.";
    if (error?.status === 429) return "Έγιναν πολλές προσπάθειες. Περίμενε λίγο πριν δοκιμάσεις ξανά.";
    if (error?.status === 503) return "Η επιβεβαίωση δεν είναι προσωρινά διαθέσιμη. Δοκίμασε ξανά σε λίγο.";
    return "Δεν μπορέσαμε να επιβεβαιώσουμε το email. Έλεγξε τη σύνδεσή σου και δοκίμασε ξανά.";
  }

  function maskEmail(email) {
    const [local, domain] = String(email || "").split("@");
    if (!local || !domain) return "το email σου";
    const visible = local.slice(0, Math.min(2, local.length));
    return `${visible}${"•".repeat(Math.max(3, Math.min(6, local.length - visible.length)))}@${domain}`;
  }

  function setVerificationMode(email) {
    qs("signupBlock").hidden = true;
    qs("verifyBlock").hidden = false;
    qs("verEmail").value = email;
    qs("verificationDestination").textContent = maskEmail(email);
    window.setTimeout(() => qs("verCode")?.focus(), 0);
  }

  function goToVerification(email) {
    const url = new URL("/register", window.location.origin);
    url.searchParams.set("verify", "1");
    url.searchParams.set("email", email);
    window.location.assign(`${url.pathname}${url.search}`);
  }

  function setSubmitBusy(button, busy, busyText) {
    if (!button) return;
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.disabled = busy;
    button.textContent = busy ? busyText : button.dataset.label;
  }

  function updateBusinessFields() {
    const selected = document.querySelector('input[name="account_type"]:checked')?.value || "individual";
    qs("businessFields").hidden = selected !== "business";
  }

  function validatePasswords() {
    const password = qs("newPassword").value;
    const confirmation = qs("regPassword").value;
    const message = qs("passMatchMsg");
    const mismatch = Boolean(confirmation && password !== confirmation);
    qs("regPassword").setCustomValidity(mismatch ? "Οι κωδικοί δεν ταιριάζουν." : "");
    message.textContent = mismatch ? "Οι κωδικοί δεν ταιριάζουν." : "";
    return !mismatch;
  }

  function setupPasswordToggles() {
    document.querySelectorAll(".toggle-pass").forEach((button) => {
      button.addEventListener("click", () => {
        const input = qs(button.dataset.target);
        if (!input) return;
        const showing = input.type === "text";
        input.type = showing ? "password" : "text";
        button.setAttribute("aria-pressed", String(!showing));
        button.setAttribute("aria-label", showing ? "Εμφάνιση κωδικού" : "Απόκρυψη κωδικού");
        const icon = button.querySelector("img");
        if (icon) icon.src = showing ? "eye.png" : "visible.png";
      });
    });
  }

  function startResendCooldown(button, status) {
    let remaining = RESEND_COOLDOWN_SECONDS;
    button.disabled = true;
    status.textContent = `Ξανά σε ${remaining}″`;
    const timer = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        window.clearInterval(timer);
        button.disabled = false;
        status.textContent = "";
        return;
      }
      status.textContent = `Ξανά σε ${remaining}″`;
    }, 1000);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const params = new URLSearchParams(window.location.search);
    const emailFromUrl = String(params.get("email") || "").trim().toLowerCase();
    if (params.get("verify") === "1") setVerificationMode(emailFromUrl);

    document.querySelectorAll('input[name="account_type"]').forEach((radio) => radio.addEventListener("change", updateBusinessFields));
    updateBusinessFields();
    setupPasswordToggles();
    qs("newPassword").addEventListener("input", validatePasswords);
    qs("regPassword").addEventListener("input", validatePasswords);

    const registerForm = qs("registerForm");
    registerForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      hideMessage(qs("registerMsg"));
      validatePasswords();
      if (!registerForm.reportValidity()) return;

      const accountType = document.querySelector('input[name="account_type"]:checked')?.value || "individual";
      const payload = {
        email: qs("userEmail").value.trim().toLowerCase(),
        username: qs("newUsername").value.trim(),
        password: qs("newPassword").value,
        account_type: accountType,
        companyName: accountType === "business" ? qs("companyName").value.trim() : "",
        phone: accountType === "business" ? qs("userNumber").value.trim() : "",
      };
      const submit = registerForm.querySelector('[type="submit"]');
      setSubmitBusy(submit, true, "Δημιουργία…");
      try {
        await window.api.register(payload);
        goToVerification(payload.email);
      } catch (error) {
        if (error?.code === "VERIFICATION_EMAIL_UNAVAILABLE") {
          try { sessionStorage.setItem("caremindRegistrationNotice", "email-unavailable"); } catch (_error) {}
          goToVerification(error.email || payload.email);
          return;
        }
        showMessage(qs("registerMsg"), readableRegistrationError(error), true);
      } finally {
        setSubmitBusy(submit, false);
      }
    });

    const verifyForm = qs("verifyForm");
    verifyForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      hideMessage(qs("verifyMsg"));
      if (!verifyForm.reportValidity()) return;
      const email = qs("verEmail").value.trim().toLowerCase();
      const code = qs("verCode").value.trim();
      const submit = verifyForm.querySelector('[type="submit"]');
      setSubmitBusy(submit, true, "Επιβεβαίωση…");
      try {
        const result = await window.api.verifyEmail(email, code);
        try {
          sessionStorage.setItem("caremindVerifiedEmail", email);
          sessionStorage.setItem("caremindVerificationResult", result?.message === "Email already verified" ? "already" : "verified");
        } catch (_error) {}
        window.location.assign("/login?verified=1&next=%2Fonboarding");
      } catch (error) {
        showMessage(qs("verifyMsg"), readableVerificationError(error), true);
      } finally {
        setSubmitBusy(submit, false);
      }
    });

    const resendButton = qs("resendBtn");
    resendButton.addEventListener("click", async () => {
      hideMessage(qs("verifyMsg"));
      const email = qs("verEmail").value.trim().toLowerCase();
      if (!email || !qs("verEmail").checkValidity()) {
        qs("verEmail").reportValidity();
        return;
      }
      resendButton.disabled = true;
      try {
        await window.api.resendVerification(email);
        showMessage(qs("verifyMsg"), "Αν το email είναι διαθέσιμο για επιβεβαίωση, το αίτημα επεξεργάστηκε. Έλεγξε τα εισερχόμενα και τα ανεπιθύμητα.");
        startResendCooldown(resendButton, qs("resendStatus"));
      } catch (error) {
        resendButton.disabled = false;
        const message = error?.status === 429
          ? "Έγιναν πολλές προσπάθειες. Περίμενε λίγο πριν ζητήσεις νέο κωδικό."
          : "Δεν μπορέσαμε να επεξεργαστούμε το αίτημα. Έλεγξε τη σύνδεσή σου και δοκίμασε ξανά.";
        showMessage(qs("verifyMsg"), message, true);
      }
    });

    try {
      if (sessionStorage.getItem("caremindRegistrationNotice") === "email-unavailable" && !qs("verifyBlock").hidden) {
        sessionStorage.removeItem("caremindRegistrationNotice");
        showMessage(qs("verifyMsg"), "Ο λογαριασμός δημιουργήθηκε, αλλά η πρώτη αποστολή δεν ολοκληρώθηκε. Πάτησε «Νέα αποστολή» για νέο κωδικό.", true);
      }
    } catch (_error) {}
  });
})();
