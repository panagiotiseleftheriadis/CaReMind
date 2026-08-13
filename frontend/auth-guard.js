// frontend/auth-guard.js

async function checkAuth() {
  const path = window.location.pathname;
  // Ελέγχουμε αν είμαστε σε σελίδα που δεν θέλει login (login/register)
  const isPublicPage = path.endsWith("index.html") || 
                       path.endsWith("login.html") ||
                       path.endsWith("register.html") ||
                       path === "/" ||
                       path.endsWith("/");

  // ΠΕΡΙΠΤΩΣΗ 1: Είμαστε στη σελίδα Login/Register (Public)
  if (isPublicPage) {
     // 🔥 ΕΔΩ ΗΤΑΝ ΤΟ ΠΡΟΒΛΗΜΑ: Το είχες σε σχόλια.
     // Τώρα το ενεργοποιούμε για να σε βάζει αυτόματα αν έχεις cookie.
     try {
       await api.refreshToken();
       window.location.replace("dashboard.html");
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
  const currentPath = (window.location.pathname + window.location.search).replace(/^\//, "");
  
  const inSubfolder = window.location.href.includes("/pages/") || 
                      window.location.href.includes("/views/");
                      
  const loginPage = inSubfolder ? "../index.html" : "index.html";
  
  // Αποφεύγουμε λούπα αν είμαστε ήδη στο index.html
  if (!window.location.pathname.endsWith("index.html") && !window.location.pathname.endsWith("login.html")) {
      const next = encodeURIComponent(currentPath || "dashboard.html");
      window.location.replace(`${loginPage}?next=${next}`);
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
