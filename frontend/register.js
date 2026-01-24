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
        fullName: qs('fullName').value.trim(),
        username: qs('regUsername').value.trim(),
        email: qs('regEmail').value.trim(),
        password: qs('regPassword').value,
      };

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
const pass1 = document.getElementById("newPassword");
const pass2 = document.getElementById("regPassword");
const msg = document.getElementById("passMatchMsg");

function clearStates() {
  pass1.classList.remove("input-error", "input-success");
  pass2.classList.remove("input-error", "input-success");
  msg.style.display = "none";
  msg.textContent = "";
}

function setError(text) {
  pass1.classList.remove("input-success");
  pass2.classList.remove("input-success");

  pass1.classList.add("input-error");
  pass2.classList.add("input-error");

  msg.textContent = text;
  msg.style.display = "block";
}

function setSuccess() {
  pass1.classList.remove("input-error");
  pass2.classList.remove("input-error");

  pass1.classList.add("input-success");
  pass2.classList.add("input-success");

  msg.style.display = "none";
  msg.textContent = "";
}

function validatePasswords() {
  const p1 = pass1.value;
  const p2 = pass2.value;

  // Αν είναι άδεια, μην δείχνεις τίποτα ακόμα
  if (!p1 && !p2) {
    clearStates();
    return false;
  }

  // Αν ο χρήστης δεν έχει αρχίσει να γράφει confirm, μην “κοκκινίσεις” και τα δύο
  if (p1 && !p2) {
    pass1.classList.remove("input-error", "input-success");
    pass2.classList.remove("input-error", "input-success");
    msg.style.display = "none";
    msg.textContent = "";
    return false;
  }

  // Αν γράφει confirm
  if (p1 !== p2) {
    setError("Οι κωδικοί δεν ταιριάζουν.");
    return false;
  }

  setSuccess();
  return true;
}

// live validation
pass1.addEventListener("input", validatePasswords);
pass2.addEventListener("input", validatePasswords);

// Αν έχεις form submit, μπλοκάρουμε αν δεν ταιριάζουν
const form = document.querySelector("form"); // ή βάλε το id του form αν έχεις
if (form) {
  form.addEventListener("submit", (e) => {
    const ok = validatePasswords();
    if (!ok) {
      e.preventDefault();
      // Αν και τα 2 έχουν τιμή αλλά δεν ταιριάζουν, το μήνυμα θα φαίνεται ήδη
      if (pass1.value && pass2.value && pass1.value !== pass2.value) {
        setError("Οι κωδικοί δεν ταιριάζουν.");
      }
    }
  });
}
