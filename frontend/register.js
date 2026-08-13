// register.js

function qs(id){return document.getElementById(id);}

function showMsg(el, text, isError=false){
  if(!el) return;
  el.textContent=text;
  el.style.display='block';
  el.classList.toggle('error', !!isError);
}

function hideMsg(el){
  if(!el) return;
  el.style.display='none';
  el.textContent='';
  el.classList.remove('error');
}

function getParams(){
  return new URLSearchParams(window.location.search);
}

function goToVerify(email){
  const e = encodeURIComponent(email||'');
  window.location.href = `register.html?verify=1&email=${e}`;
}

document.addEventListener('DOMContentLoaded', () => {
  const params = getParams();
  const verifyMode = params.get('verify') === '1';
  const emailFromUrl = params.get('email') ? decodeURIComponent(params.get('email')) : '';

  const signupBlock = qs('signupBlock');
  const verifyBlock = qs('verifyBlock');

  if(verifyMode){
    signupBlock.style.display='none';
    verifyBlock.style.display='block';
    if(emailFromUrl) qs('verEmail').value = emailFromUrl;
  }

  // SIGNUP
  const registerForm = qs('registerForm');
  const registerMsg = qs('registerMsg');
  if(registerForm){
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideMsg(registerMsg);

      const payload = {
        username: qs('newUsername').value.trim(),
        email: qs('userEmail').value.trim(),
        // ΝΕΟ: Στέλνουμε τον τύπο
        account_type: qs('accountType').value, 
        // Αν είναι ιδιώτης, στέλνουμε κενό string, αλλιώς το όνομα
        companyName: qs('accountType').value === 'company' ? qs('companyName').value.trim() : '',
        phone: qs('userNumber') ? qs('userNumber').value.trim() : '',
        password: qs('newPassword').value,
      };

      // Extra safety: μην επιτρέπεις submit αν οι κωδικοί δεν ταιριάζουν
      const confirm = qs('regPassword') ? qs('regPassword').value : '';
      if (payload.password.length < 8 || payload.password.length > 128) {
        showMsg(registerMsg, 'Ο κωδικός πρέπει να έχει 8-128 χαρακτήρες.', true);
        return;
      }
      if (payload.password !== confirm) {
        showMsg(registerMsg, 'Οι κωδικοί δεν ταιριάζουν.', true);
        return;
      }


      try{
        await api.register(payload);
        showMsg(registerMsg, 'Η εγγραφή ολοκληρώθηκε! Ελέγξτε το email σας για τον 6-ψήφιο κωδικό.');
        setTimeout(() => goToVerify(payload.email), 600);
      }catch(err){
        const msg = err.message || 'Κάτι πήγε στραβά. Δοκιμάστε ξανά.';
        showMsg(registerMsg, msg, true);
      }
    });
  }

  // VERIFY
  const verifyForm = qs('verifyForm');
  const verifyMsg = qs('verifyMsg');
  const resendBtn = qs('resendBtn');

  if(verifyForm){
    verifyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideMsg(verifyMsg);

      const email = qs('verEmail').value.trim();
      const code = qs('verCode').value.trim();

      try{
        await api.verifyEmail(email, code);
        showMsg(verifyMsg, 'Το email επιβεβαιώθηκε! Μπορείτε να συνδεθείτε.');
        setTimeout(() => { window.location.href = 'index.html'; }, 800);
      }catch(err){
        const msg = err.message || 'Λάθος κωδικός ή έληξε. Πατήστε "Αποστολή ξανά".';
        showMsg(verifyMsg, msg, true);
      }
    });
  }

  if(resendBtn){
    resendBtn.addEventListener('click', async () => {
      hideMsg(verifyMsg);
      const email = qs('verEmail').value.trim();
      if(!email){
        showMsg(verifyMsg, 'Συμπληρώστε email.', true);
        return;
      }
      resendBtn.disabled = true;
      try{
        await api.resendVerification(email);
        showMsg(verifyMsg, 'Στάλθηκε νέος κωδικός. Ελέγξτε τα εισερχόμενα / spam.');
      }catch(err){
        showMsg(verifyMsg, err.message || 'Αποτυχία αποστολής. Δοκιμάστε ξανά.', true);
      }finally{
        setTimeout(() => { resendBtn.disabled = false; }, 2000);
      }
    });
  }
});
document.querySelectorAll(".toggle-pass").forEach((btn) => {
  btn.addEventListener("click", () => {
    const inputId = btn.dataset.target;
    const input = document.getElementById(inputId);
    if (!input) return;

    const icon = btn.querySelector(".toggle-icon");
    const isHidden = input.type === "password";

    input.type = isHidden ? "text" : "password";

    // αλλάζουμε εικόνα
    if (icon) {
      icon.src = isHidden ? "visible.png" : "eye.png";
    }

    // accessibility
    btn.setAttribute("aria-label", isHidden ? "Απόκρυψη κωδικού" : "Εμφάνιση κωδικού");
  });
});
document.addEventListener("DOMContentLoaded", () => {
  const pass1 = document.getElementById("newPassword");
  const pass2 = document.getElementById("regPassword");
  const msg = document.getElementById("passMatchMsg");

  // Αν κάτι λείπει από το HTML, μην σκάει όλο το register
  if (!pass1 || !pass2) {
    console.warn("Password inputs not found. Check IDs: newPassword / regPassword");
    return;
  }

  // Αν δεν υπάρχει το message element, το δημιουργούμε δυναμικά κάτω από το confirm
  let messageEl = msg;
  if (!messageEl) {
    messageEl = document.createElement("p");
    messageEl.id = "passMatchMsg";
    messageEl.className = "pass-msg";
    messageEl.style.display = "none";
    pass2.closest(".form-group")?.insertAdjacentElement("afterend", messageEl);
  }

  function clearStates() {
    pass1.classList.remove("input-error", "input-success");
    pass2.classList.remove("input-error", "input-success");
    messageEl.style.display = "none";
    messageEl.textContent = "";
  }

  function setError(text) {
    pass1.classList.remove("input-success");
    pass2.classList.remove("input-success");

    pass1.classList.add("input-error");
    pass2.classList.add("input-error");

    messageEl.textContent = text;
    messageEl.style.display = "block";
  }

  function setSuccess() {
    pass1.classList.remove("input-error");
    pass2.classList.remove("input-error");

    pass1.classList.add("input-success");
    pass2.classList.add("input-success");

    messageEl.style.display = "none";
    messageEl.textContent = "";
  }

  function validatePasswords() {
    const p1 = pass1.value || "";
    const p2 = pass2.value || "";

    if (!p1 && !p2) {
      clearStates();
      return false;
    }

    if (p1 && !p2) {
      pass1.classList.remove("input-error", "input-success");
      pass2.classList.remove("input-error", "input-success");
      messageEl.style.display = "none";
      messageEl.textContent = "";
      return false;
    }

    if (p1 !== p2) {
      setError("Οι κωδικοί δεν ταιριάζουν.");
      return false;
    }

    setSuccess();
    return true;
  }

  pass1.addEventListener("input", validatePasswords);
  pass2.addEventListener("input", validatePasswords);

  // Βρες το form με πιο ασφαλή τρόπο
  const form = pass1.closest("form") || document.querySelector("form");
  if (form) {
    form.addEventListener("submit", (e) => {
      // Αν ο χρήστης έχει γράψει confirm και δεν ταιριάζει, μπλοκάρουμε
      const p1 = pass1.value || "";
      const p2 = pass2.value || "";

      if (p2 && p1 !== p2) {
        e.preventDefault();
        setError("Οι κωδικοί δεν ταιριάζουν.");
      }
    });
  }
});
// Συνάρτηση για εμφάνιση/απόκρυψη πεδίου εταιρίας
function toggleCompanyField() {
  const type = document.getElementById("accountType").value;
  const wrapper = document.getElementById("companyFieldWrapper");
  const input = document.getElementById("companyName");
  
  if (type === "company") {
    wrapper.style.display = "block";
    input.setAttribute("required", "true"); // Το κάνουμε υποχρεωτικό αν είναι εταιρία
  } else {
    wrapper.style.display = "none";
    input.value = ""; // Καθαρίζουμε αν το γύρισε σε ιδιώτη
    input.removeAttribute("required");
  }
}
// Καλό είναι να το τρέξουμε μία φορά στην αρχή για να είμαστε σίγουροι
window.onload = toggleCompanyField;
