// auth-guard.js
(async function () {
  const isLoginPage = window.location.pathname.endsWith("index.html") || 
                      window.location.pathname.endsWith("login.html") ||
                      window.location.pathname.endsWith("register.html");

  if (isLoginPage) return;

  try {
    // Προσπάθεια ανανέωσης του token αμέσως μόλις φορτώσει η σελίδα
    // Αυτό ελέγχει αν υπάρχει έγκυρο HttpOnly cookie
    const data = await api.refreshToken();
    
    // Αν πετύχει, αποθηκεύουμε το access token στη μνήμη
    api.setToken(data.accessToken);
    
    // Προαιρετικά: Ενημερώνουμε το UI με το όνομα χρήστη
    if (data.user) {
        localStorage.setItem("currentUser", JSON.stringify(data.user));
    }

  } catch (e) {
    console.warn("🔒 Auth guard: No valid session found, redirecting...");
    
    // Αν αποτύχει, κρατάμε που ήθελε να πάει ο χρήστης
    const attempted = (window.location.pathname + window.location.search).replace(/^\//, "");
    const next = encodeURIComponent(attempted || "dashboard.html");
    
    const inSubfolder = window.location.href.includes("/pages/") || window.location.href.includes("/views/");
    const loginPage = inSubfolder ? "../index.html" : "index.html";

    window.location.replace(`${loginPage}?next=${next}`);
  }
})();