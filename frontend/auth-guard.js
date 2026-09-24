// frontend/auth-guard.js
const AUTH_GUARD_LOGOUT_KEY = "caremindExplicitLogout";

async function checkAuth() {
  const path = window.location.pathname;
  const normalizedPath = path.replace(/\/+$/, "") || "/";
  const isLandingPage = normalizedPath === "/" || normalizedPath === "/index.html";
  const isLoginPage = normalizedPath === "/login" || normalizedPath === "/login.html";
  const isRegisterPage = normalizedPath === "/register" || normalizedPath === "/register.html";
  const isPublicPage = isLandingPage || isLoginPage || isRegisterPage;

  if (localStorage.getItem(AUTH_GUARD_LOGOUT_KEY) === "1") {
    if (!isPublicPage) redirectToLogin();
    return;
  }

  // ΠΕΡΙΠΤΩΣΗ 1: Είμαστε στη σελίδα Login/Register (Public)
  if (isLandingPage) {
     return;
  }

  if (isLoginPage || isRegisterPage) {
     // 🔥 ΕΔΩ ΗΤΑΝ ΤΟ ΠΡΟΒΛΗΜΑ: Το είχες σε σχόλια.
     // Τώρα το ενεργοποιούμε για να σε βάζει αυτόματα αν έχεις cookie.
     try {
       await api.refreshToken();
       window.location.replace("/dashboard");
     } catch (e) { 
     } 
     return;
  }

  // ΠΕΡΙΠΤΩΣΗ 2: Είμαστε σε Protected Page (π.χ. Dashboard)
  try {
    
    // Αυτό στέλνει το cookie στο /refresh για να δει αν είναι έγκυρο
    const data = await api.refreshToken();
    
    if (!data || !data.accessToken) {
      throw new Error("No access token received");
    }

    // Ο χρήστης μένει εδώ, όλα καλά.

  } catch (error) {
    console.warn("⛔ Auth Guard: Session invalid or expired.", error);
    redirectToLogin();
  }
}

function redirectToLogin() {
  // Κρατάμε πού ήθελε να πάει ο χρήστης
  const requestedPath = window.location.pathname + window.location.search;
  const currentPath = window.location.pathname.replace(/\/+$/, "") === "/onboarding"
    ? requestedPath
    : requestedPath.replace(/^\//, "");
  
  if (window.location.pathname !== "/login" && window.location.pathname !== "/login.html") {
      const next = encodeURIComponent(currentPath || "dashboard.html");
      window.location.replace(`/login?next=${next}`);
  }
}

// Εκτέλεση μόλις φορτώσει το DOM
document.addEventListener("DOMContentLoaded", () => {
    // Αν το window.api δεν υπάρχει ακόμα, περιμένουμε λίγο
    if (window.api) {
        checkAuth();
    } else {
        // Fallback: προσπάθεια μετά από 100ms αν το api.js δεν έχει φορτώσει ακόμα
        setTimeout(checkAuth, 100);
    }
});
