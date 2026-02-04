// auth.js
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

  async init() {
    // 1. Φόρτωση βασικών στοιχείων από localStorage για το UI
    const userData = localStorage.getItem("currentUser");
    if (userData) {
      this.currentUser = JSON.parse(userData);
      this.updateNavigation();
    }

    // 2. Persistent Login Check: Προσπάθεια ανανέωσης session από το cookie
    // Αν είμαστε σε προστατευμένη σελίδα και δεν έχουμε token στη μνήμη
    const isLoginPage = window.location.pathname.endsWith("index.html") || window.location.pathname.endsWith("/");
    
    try {
      const success = await api.refreshToken();
      if (success) {
        // Αν βρήκαμε token, ενημερώνουμε το user object
        this.currentUser = JSON.parse(localStorage.getItem("currentUser"));
        this.updateNavigation();
        if (isLoginPage) window.location.href = "dashboard.html";
      } else if (!isLoginPage && !this.isLoggedIn()) {
        // Αν αποτύχει το refresh και είμαστε σε εσωτερική σελίδα, logout
        this.logout();
      }
    } catch (e) {
      console.log("No existing session.");
    }
  }

  isLoggedIn() {
    return !!this.currentUser && !!api.token;
  }

  async login(username, password) {
    if (!username || !password) {
      showLoginError("Συμπληρώστε όνομα χρήστη και κωδικό.");
      markLoginInputsError();
      return false;
    }

    try {
      const response = await api.login(username, password);

      // Σώζουμε μόνο τα στοιχεία του χρήστη (όχι το token)
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
      localStorage.setItem("currentUser", JSON.stringify(this.currentUser));
      this.updateNavigation();

      const params = new URLSearchParams(window.location.search);
      const nextRaw = params.get("next");
      const next = nextRaw ? decodeURIComponent(nextRaw) : null;
      const safeNext = next && !/^(https?:)?\/\//i.test(next) ? next.replace(/^\//, "") : null;

      window.location.href = safeNext || "dashboard.html";
      return true;
    } catch (error) {
      const message = error.message || "Λάθος στοιχεία εισόδου.";
      showLoginError(message);

      if (error.code === "INVALID_PASSWORD" || message.toLowerCase().includes("κωδ")) {
        markUsernameValid();
        markPasswordError();
      } else {
        markLoginInputsError();
      }
      return false;
    }
  }

  async logout() {
    this.currentUser = null;
    localStorage.removeItem("currentUser");
    await api.logout(); // Καθαρίζει token και cookies
    
    const inSubfolder = window.location.href.includes("/pages/") || window.location.href.includes("/views/");
    window.location.href = inSubfolder ? "../index.html" : "index.html";
  }

  updateNavigation() {
    const userNameEl = document.getElementById("userName");
    if (userNameEl) {
      userNameEl.textContent = this.currentUser ? this.currentUser.username : "";
    }

    const loggedInEls = document.querySelectorAll('[data-show="logged-in"]');
    const loggedOutEls = document.querySelectorAll('[data-show="logged-out"]');

    loggedInEls.forEach((el) => (el.style.display = this.isLoggedIn() ? "" : "none"));
    loggedOutEls.forEach((el) => (el.style.display = this.isLoggedIn() ? "none" : ""));
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

  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      const username = document.getElementById("username")?.value?.trim();
      const password = document.getElementById("password")?.value;
      await auth.login(username, password);
    });
  }

  const logoutButtons = document.querySelectorAll("#logoutButton, .logout-link");
  logoutButtons.forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      auth.logout();
    })
  );

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
  }

  function setEmailError(text) {
    if (fpEmailError) fpEmailError.textContent = text || "";
  }

  function showStep(which) {
    if (stepEmail) stepEmail.style.display = which === "email" ? "block" : "none";
    if (stepCode) stepCode.style.display = which === "code" ? "block" : "none";
    if (stepReset) stepReset.style.display = which === "reset" ? "block" : "none";
    hideMsg();
  }

  openLink?.addEventListener("click", (e) => { e.preventDefault(); openModal(); });
  closeBtn?.addEventListener("click", (e) => { e.preventDefault(); closeModal(); });

  function openModal() {
    if (!modal) return;
    modal.classList.add("open");
    showStep("email");
  }

  function closeModal() {
    modal?.classList.remove("open");
  }

  btnSendCode?.addEventListener("click", async (e) => {
    e.preventDefault();
    const email = fpEmail?.value?.trim().toLowerCase();
    if (!email) { setEmailError("Πληκτρολογήστε Email"); return; }
    
    btnSendCode.disabled = true;
    try {
      await api.forgotPassword(email);
      cachedEmail = email;
      showStep("code");
    } catch (err) {
      showMsg(err.message, "error");
    } finally {
      btnSendCode.disabled = false;
    }
  });

  btnVerify?.addEventListener("click", async (e) => {
    e.preventDefault();
    const code = fpCode?.value?.trim();
    try {
      const resp = await api.verifyResetCode(cachedEmail, code);
      resetToken = resp.resetToken;
      showStep("reset");
    } catch (err) {
      showMsg(err.message, "error");
    }
  });

  btnReset?.addEventListener("click", async (e) => {
    e.preventDefault();
    const p1 = fpNewPass?.value;
    const p2 = fpNewPass2?.value;
    if (p1 !== p2) { showMsg("Οι κωδικοί δεν ταιριάζουν", "error"); return; }

    try {
      await api.resetPassword(resetToken, p1);
      showMsg("Επιτυχής αλλαγή!", "success");
      setTimeout(closeModal, 1500);
    } catch (err) {
      showMsg(err.message, "error");
    }
  });

  // Password Visibility Toggle
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".toggle-password");
    if (!btn) return;
    const input = document.getElementById(btn.dataset.target);
    const img = btn.querySelector("img");
    if (input && img) {
      const isPass = input.type === "password";
      input.type = isPass ? "text" : "password";
      img.src = isPass ? "visible.png" : "eye.png";
    }
  });
});