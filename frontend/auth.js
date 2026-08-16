// auth.js
const EXPLICIT_LOGOUT_KEY = "caremindExplicitLogout";

function showLoginError(message) {
  const el = document.getElementById("loginError");
  if (!el) return;
  el.textContent = message;
  el.style.display = "block";
}

function hideLoginError() {
  const el = document.getElementById("loginError");
  if (!el) return;
  el.style.display = "none";
}
function markLoginInputsError() {
  document.getElementById("username")?.classList.add("input-error");
  document.getElementById("password")?.classList.add("input-error");
}

function clearLoginInputsError() {
  document.getElementById("username")?.classList.remove("input-error");
  document.getElementById("password")?.classList.remove("input-error");
}
function markUsernameValid() {
  const u = document.getElementById("username");
  if (!u) return;
  u.classList.remove("input-error");
  u.classList.add("input-valid");
}

function markPasswordError() {
  const p = document.getElementById("password");
  if (!p) return;
  p.classList.remove("input-valid");
  p.classList.add("input-error");
}

function clearInputStates() {
  ["username", "password"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove("input-error", "input-valid");
  });
}

class AuthService {
  constructor() {
    this.currentUser = null;
    this.init();
  }

  init() {
    // Δεν ελέγχουμε πλέον για token στο localStorage.
    // Ελέγχουμε μόνο αν έχουμε user info για να δείξουμε το όνομα.
    const userData = localStorage.getItem("currentUser");
    if (userData) {
      this.currentUser = JSON.parse(userData);
      this.updateNavigation();
    }
    
    // Αν είμαστε σε σελίδα Login, ίσως θέλουμε να δούμε αν υπάρχει ήδη cookie
    // και να κάνουμε redirect στο dashboard αυτόματα.
    if (
      window.location.pathname.endsWith("index.html") &&
      localStorage.getItem(EXPLICIT_LOGOUT_KEY) !== "1"
    ) {
        api.refreshToken().then(data => {
            if (data && data.accessToken) {
                 window.location.href = "dashboard.html";
            }
        }).catch(() => {
            // Αν αποτύχει, απλά μένουμε στη σελίδα login
        });
    }
  }

 async login(username, password) {
    if (!username || !password) {
      showLoginError("Συμπληρώστε όνομα χρήστη και κωδικό.");
      markLoginInputsError();
      return false;
    }

    try {
      // Το api.login πλέον διαχειρίζεται το token internall
      const response = await api.login(username, password);

      this.currentUser = {
        username: response.user.username,
        companyId: response.user.companyId,
        companyName: response.user.companyName,
        userId: response.user.id,
        role: response.user.role,
        loginAt: new Date().toISOString(),
      };

      clearInputStates();
      hideLoginError();
      
      // Αποθηκεύουμε ΜΟΝΟ τα user info (όχι το token) στο localStorage για το UI
      localStorage.removeItem(EXPLICIT_LOGOUT_KEY);
      localStorage.setItem("currentUser", JSON.stringify(this.currentUser));
      
      this.updateNavigation();

      // Redirect logic
      const params = new URLSearchParams(window.location.search);
      const nextRaw = params.get("next");
      const next = nextRaw ? decodeURIComponent(nextRaw) : null;
      const safeNext = next && !/^(https?:)?\/\//i.test(next) ? next.replace(/^\//, "") : null;

      window.location.href = safeNext || "dashboard.html";
      return true;
    } catch (error) {
      // ... (error handling code remains the same) ...
      const message = error.message || "Λάθος στοιχεία.";
      showLoginError(message);
      return false;
    }
  }
  
  async logout() {
    return api.logout();
  }

  requireAuth() {
    if (!this.isLoggedIn()) {
      const inSubfolder =
        window.location.href.includes("/pages/") ||
        window.location.href.includes("/views/");
      window.location.href = inSubfolder ? "../login.html" : "login.html";
      return false;
    }
    return true;
  }

  updateNavigation() {
    const userNameEl = document.getElementById("userName");
    if (userNameEl) {
      userNameEl.textContent = this.currentUser
        ? this.currentUser.username
        : "";
    }

    const loggedInEls = document.querySelectorAll('[data-show="logged-in"]');
    const loggedOutEls = document.querySelectorAll('[data-show="logged-out"]');

    loggedInEls.forEach(
      (el) => (el.style.display = this.isLoggedIn() ? "" : "none")
    );
    loggedOutEls.forEach(
      (el) => (el.style.display = this.isLoggedIn() ? "none" : "")
    );
  }
}

// Global instance
const auth = new AuthService();

document.addEventListener("DOMContentLoaded", function () {
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");

  if (usernameInput) {
    usernameInput.addEventListener("input", () => {
      clearLoginInputsError();
      hideLoginError();
    });
  }

  if (passwordInput) {
    passwordInput.addEventListener("input", () => {
      clearLoginInputsError();
      hideLoginError();
    });
  }

  // Login form handler
  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", async function (e) {
      e.preventDefault();

      const username = document.getElementById("username")?.value?.trim();
      const password = document.getElementById("password")?.value;

      const ok = await auth.login(username, password);
      // Το μήνυμα για κενά πεδία το δείχνει ήδη το auth.login()
      // Αν θες επιπλέον handling:
      if (!ok) {
        console.warn("Login δεν ολοκληρώθηκε");
      }
    });
  }

  // One-click portfolio demo. No backend, database or credentials required.
  const demoLoginButton = document.getElementById("demoLoginBtn");
  demoLoginButton?.addEventListener("click", () => {
    if (!window.CaReMindDemo) {
      showLoginError("Το demo δεν μπόρεσε να φορτώσει. Δοκιμάστε ξανά.");
      return;
    }

    demoLoginButton.disabled = true;
    localStorage.removeItem(EXPLICIT_LOGOUT_KEY);
    window.CaReMindDemo.start({ reset: true });
    window.location.href = "dashboard.html";
  });

  // Logout buttons/links
  const logoutButtons = document.querySelectorAll(
    "#logoutButton, .logout-link"
  );
  logoutButtons.forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      auth.logout();
    })
  );

  // Έλεγχος authentication σε προστατευμένες σελίδες
  const protectedPages = [
    "dashboard.html",
    "vehicles.html",
    "maintenance.html",
  ];
  const currentPage = window.location.pathname.split("/").pop();

  if (protectedPages.includes(currentPage)) {
    auth.requireAuth();
  }

  /* ==========================
     Forgot password modal logic
     ========================== */
  const modal = document.getElementById("forgotModal");
  const openLink = document.getElementById("forgotPasswordLink");
  const closeBtn = document.getElementById("forgotClose");

  const stepEmail = document.getElementById("fpStepEmail");
  const stepCode = document.getElementById("fpStepCode");
  const stepReset = document.getElementById("fpStepReset");

  const fpEmail = document.getElementById("fpEmail");
  const fpCode = document.getElementById("fpCode");
  const fpNewPass = document.getElementById("fpNewPass");
  const fpNewPass2 = document.getElementById("fpNewPass2");

  const btnSendCode = document.getElementById("fpSendCode");
  const btnVerify = document.getElementById("fpVerifyCode");
  const btnBack = document.getElementById("fpBackToEmail");
  const btnReset = document.getElementById("fpDoReset");

  const msg = document.getElementById("fpMsg");

  const fpEmailError = document.getElementById("fpEmailError");
  let cachedEmail = "";
  let resetToken = "";

  function showMsg(text, type = "success") {
    if (!msg) return;
    msg.textContent = text;
    msg.className = `fp-message ${type}`;
    msg.style.display = "block";
  }

  function hideMsg() {
    if (!msg) return;
    msg.style.display = "none";
    msg.textContent = "";
    msg.className = "fp-message";
  }

  function setEmailError(text) {
    if (!fpEmailError) return;
    fpEmailError.textContent = text || "";
  }

  function clearEmailError() {
    setEmailError("");
  }

  function showStep(which) {
    if (stepEmail)
      stepEmail.style.display = which === "email" ? "block" : "none";
    if (stepCode) stepCode.style.display = which === "code" ? "block" : "none";
    if (stepReset)
      stepReset.style.display = which === "reset" ? "block" : "none";
    hideMsg();
    if (which === "email") clearEmailError();
  }

  function openModal() {
    if (!modal) return;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    resetToken = "";
    cachedEmail = "";
    if (fpEmail) fpEmail.value = "";
    if (fpCode) fpCode.value = "";
    if (fpNewPass) fpNewPass.value = "";
    if (fpNewPass2) fpNewPass2.value = "";
    showStep("email");
    setTimeout(() => fpEmail?.focus(), 50);
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  }

  openLink?.addEventListener("click", (e) => {
    e.preventDefault();
    openModal();
  });
  closeBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    closeModal();
  });
  modal?.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal?.classList.contains("open")) closeModal();
  });

  btnSendCode?.addEventListener("click", async (e) => {
    e.preventDefault();
    clearEmailError();

    const email = String(fpEmail?.value || "")
      .trim()
      .toLowerCase();

    if (!email) {
      setEmailError("Πληκτρολογήστε έγκυρη διεύθυνση Email");
      fpEmail?.focus();
      return;
    }

    btnSendCode.disabled = true;
    try {
      await api.forgotPassword(email);
      cachedEmail = email;
      showStep("code");
      setTimeout(() => fpCode?.focus(), 50);
    } catch (err) {
      if (err?.code === "EMAIL_NOT_FOUND" || err?.status === 404) {
        setEmailError("Πληκτρολογήστε έγκυρη διεύθυνση Email");
        fpEmail?.focus();
        return;
      }
      showMsg(err?.message || "Αποτυχία αποστολής κωδικού.", "error");
    } finally {
      btnSendCode.disabled = false;
    }
  });

  btnBack?.addEventListener("click", (e) => {
    e.preventDefault();
    showStep("email");
    setTimeout(() => fpEmail?.focus(), 50);
  });

  btnVerify?.addEventListener("click", async (e) => {
    e.preventDefault();
    const code = String(fpCode?.value || "").trim();
    if (!cachedEmail) {
      showStep("email");
      return;
    }
    if (!code || code.length < 4) {
      showMsg("Συμπληρώστε τον κωδικό που λάβατε.", "error");
      fpCode?.focus();
      return;
    }

    btnVerify.disabled = true;
    try {
      const resp = await api.verifyResetCode(cachedEmail, code);
      resetToken = resp.resetToken;
      showStep("reset");
      setTimeout(() => fpNewPass?.focus(), 50);
    } catch (err) {
      showMsg(err.message || "Λάθος κωδικός.", "error");
    } finally {
      btnVerify.disabled = false;
    }
  });

  btnReset?.addEventListener("click", async (e) => {
    e.preventDefault();
    const p1 = String(fpNewPass?.value || "");
    const p2 = String(fpNewPass2?.value || "");
    if (!resetToken) {
      showStep("email");
      return;
    }
    if (!p1 || p1.length < 6) {
      showMsg(
        "Ο νέος κωδικός πρέπει να είναι τουλάχιστον 6 χαρακτήρες.",
        "error"
      );
      fpNewPass?.focus();
      return;
    }
    if (p1 !== p2) {
      showMsg("Οι κωδικοί δεν ταιριάζουν.", "error");
      fpNewPass2?.focus();
      return;
    }

    btnReset.disabled = true;
    try {
      await api.resetPassword(resetToken, p1);
      showMsg(
        "Ο κωδικός σας άλλαξε επιτυχώς. Μπορείς να συνδεθείτε.",
        "success"
      );
      setTimeout(() => {
        closeModal();
        // Προσυμπλήρωση για ευκολία
        const userInput = document.getElementById("username");
        if (userInput && cachedEmail) userInput.value = cachedEmail;
        document.getElementById("password")?.focus();
      }, 900);
    } catch (err) {
      showMsg(err.message || "Αποτυχία αλλαγής κωδικού.", "error");
    } finally {
      btnReset.disabled = false;
    }
  });
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".toggle-password");
    if (!btn) return;

    const input = document.getElementById(btn.dataset.target);
    const img = btn.querySelector("img");
    if (!input || !img) return;

    const show = input.type === "password";

    input.type = show ? "text" : "password";
    img.src = show ? "visible.png" : "eye.png";
  });
});
