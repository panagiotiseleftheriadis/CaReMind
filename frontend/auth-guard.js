// frontend/auth-guard.js

async function checkAuth() {
  // 1. Έλεγχος αν είμαστε σε σελίδα που ΔΕΝ χρειάζεται προστασία
  const path = window.location.pathname;
  const isPublicPage = path.endsWith("index.html") || 
                       path.endsWith("login.html") ||
                       path.endsWith("register.html") ||
                       path === "/" ||
                       path.endsWith("/");

  if (isPublicPage) {
     // Αν είμαστε ήδη στο login και έχουμε cookie, ίσως θέλουμε να πάμε dashboard
     // Προαιρετικό: Αν θες auto-redirect από login σε dashboard, ξε-σχολίασε τα παρακάτω:
     /*
     try {
       await api.refreshToken();
       window.location.replace("dashboard.html");
     } catch (e) { } // Αν αποτύχει, μένουμε στο login
     */
     return;
  }

  // 2. Προσπάθεια ανανέωσης Token
  try {
    console.log("🔒 Auth Guard: Validating session...");
    
    // Αυτό θα στείλει το cookie στο /refresh
    const data = await api.refreshToken();
    
    if (!data || !data.accessToken) {
      throw new Error("No access token received");
    }

    console.log("✅ Session verified. Access Token set.");
    // Δεν χρειάζεται να κάνουμε κάτι άλλο, ο χρήστης μένει στη σελίδα.

  } catch (error) {
    console.warn("⛔ Auth Guard: Session invalid or expired.", error);
    redirectToLogin();
  }
}

function redirectToLogin() {
  // Κρατάμε πού ήθελε να πάει
  const currentPath = (window.location.pathname + window.location.search).replace(/^\//, "");
  
  // Έλεγχος αν είμαστε σε υποφάκελο
  const inSubfolder = window.location.href.includes("/pages/") || 
                      window.location.href.includes("/views/");
                      
  const loginPage = inSubfolder ? "../index.html" : "index.html";
  
  // Αποφεύγουμε λούπα αν είμαστε ήδη στο index.html
  if (!window.location.pathname.endsWith(loginPage)) {
      const next = encodeURIComponent(currentPath || "dashboard.html");
      window.location.replace(`${loginPage}?next=${next}`);
  }
}

// Εκτέλεση μόλις φορτώσει το DOM, για να είμαστε σίγουροι ότι το api.js υπάρχει
document.addEventListener("DOMContentLoaded", () => {
    // Αν το window.api δεν υπάρχει ακόμα, περιμένουμε λίγο
    if (window.api) {
        checkAuth();
    } else {
        console.error("Critical: api.js not loaded before auth-guard.js");
        // Fallback: προσπάθεια μετά από 100ms
        setTimeout(checkAuth, 100);
    }
});