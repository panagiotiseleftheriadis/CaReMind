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
