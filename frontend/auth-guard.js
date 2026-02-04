// frontend/auth-guard.js
(async function () {
  const isAuthPage = window.location.pathname.endsWith("index.html") || 
                     window.location.pathname.endsWith("login.html") ||
                     window.location.pathname.endsWith("register.html");

  // Αν είμαστε ήδη στη σελίδα login/register, δεν κάνουμε έλεγχο
  if (isAuthPage) return;

  try {
    // 🔥 Η ΑΛΛΑΓΗ: Αντί να ψάχνουμε localStorage, καλούμε το refresh
    // Αυτό ελέγχει αν υπάρχει το HttpOnly Cookie στον browser
    console.log("🔒 Auth Guard: Checking session...");
    await api.refreshToken();
    
    // Αν πετύχει, το token μπήκε στη μνήμη (RAM) και ο χρήστης μένει στη σελίδα.
    console.log("✅ Session valid.");

  } catch (e) {
    console.warn("⛔ Auth Guard: No valid session, redirecting...", e);

    // Αν αποτύχει, κρατάμε πού ήθελε να πάει ο χρήστης
    const attempted = (window.location.pathname + window.location.search).replace(/^\//, "");
    
    const inSubfolder = window.location.href.includes("/pages/") || 
                        window.location.href.includes("/views/");
                        
    const loginPage = inSubfolder ? "../index.html" : "index.html";
    const next = encodeURIComponent(attempted || "dashboard.html");

    // Redirect στο Login
    window.location.replace(`${loginPage}?next=${next}`);
  }
})();