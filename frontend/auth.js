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

  init() {
    // Έλεγχος αν ο χρήστης είναι συνδεδεμένος
    const userData = localStorage.getItem("currentUser");
    if (userData) {
      this.currentUser = JSON.parse(userData);
      this.updateNavigation();
    }
  }

  isLoggedIn() {
    return !!this.currentUser;
  }

  async login(username, password) {
    if (!username || !password) {
      showLoginError("Συμπληρώστε όνομα χρήστη και κωδικό.");
      markLoginInputsError();
      return false;
    }

    try {
      const response = await api.login(username, password);

      this.currentUser = {
        username: response.user.username,
        companyId: response.user.companyId,
        companyName: response.user.companyName, // 🔥 ΠΡΟΣΤΕΘΗΚΕ
        userId: response.user.id,
        role: response.user.role, // προαιρετικό αλλά χρήσιμο
        loginAt: new Date().toISOString(),
      };
      clearInputStates();
      hideLoginError();
      localStorage.setItem("currentUser", JSON.stringify(this.currentUser));
      this.updateNavigation();
      hideLoginError();

      window.location.href = "dashboard.html";
      return true;
    } catch (error) {
      const message =
        error.message || "Λάθος στοιχεία εισόδου. Παρακαλώ προσπαθήστε ξανά.";

      showLoginError(message);

      // 🧠 Αν το backend λέει ότι το username υπάρχει αλλά ο κωδικός είναι λάθος
      if (
        error.code === "INVALID_PASSWORD" ||
        message.toLowerCase().includes("κωδ")
      ) {
        markUsernameValid(); // μπλε
        markPasswordError(); // κόκκινο
      } else {
        // default: και τα δύο λάθος
        markLoginInputsError();
      }

      return false;
    }
  }

  logout() {
    this.currentUser = null;
    localStorage.removeItem("currentUser");
    this.updateNavigation();
    api.removeToken();

    const inSubfolder =
      window.location.href.includes("/pages/") ||
      window.location.href.includes("/views/");
    window.location.href = inSubfolder ? "../login.html" : "login.html";
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
  document.addEventListener("DOMContentLoaded", function () {
    const u = document.getElementById("username");
    const p = document.getElementById("password");

    if (u) u.addEventListener("input", hideLoginError);
    if (p) p.addEventListener("input", hideLoginError);
  });
  ["username", "password"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;

    el.addEventListener("input", () => {
      el.classList.remove("input-error", "input-valid");
      hideLoginError();
    });
  });
});
