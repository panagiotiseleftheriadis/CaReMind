// auth-guard.js
// Redirects unauthenticated visitors to login.html when they try to open protected pages directly.
// Criteria: both currentUser (from auth.js) AND authToken (from api.js) must exist.

(function () {
  try {
    const user = localStorage.getItem("currentUser");
    const token = localStorage.getItem("authToken");

    // If either is missing, treat as not logged-in
    if (!user || !token) {
      const inSubfolder =
        window.location.href.includes("/pages/") ||
        window.location.href.includes("/views/");

      // Preserve where the user tried to go (so we can send them back after login)
      const attempted =
        (window.location.pathname + window.location.search + window.location.hash)
          .replace(/^\//, "");

      // The login page in this project is index.html
      const loginPage = inSubfolder ? "../index.html" : "index.html";
      const next = encodeURIComponent(attempted || "dashboard.html");

      window.location.replace(`${loginPage}?next=${next}`);
    }
  } catch (e) {
    // If localStorage is blocked or errors, fail safe to login
    const loginPage = "index.html";
    window.location.replace(loginPage);
  }
})();
