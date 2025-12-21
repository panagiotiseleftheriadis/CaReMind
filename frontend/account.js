// account.js

function $(id) {
  return document.getElementById(id);
}

function showMsg(el, text, type = "success") {
  if (!el) return;
  el.textContent = text;
  el.className = `form-message ${type}`;
  el.style.display = "block";
}

function hideMsg(el) {
  if (!el) return;
  el.style.display = "none";
  el.textContent = "";
  el.className = "form-message";
}

function sanitizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function buildChangeFields(type) {
  const container = $("changeFields");
  if (!container) return;

  if (type === "password") {
    container.innerHTML = `
      <div class="form-row">
        <label for="newPassword">Νέος κωδικός</label>
        <input id="newPassword" type="password" placeholder="Τουλάχιστον 6 χαρακτήρες" autocomplete="new-password" />
      </div>
      <div class="form-row">
        <label for="newPassword2">Επιβεβαίωση νέου κωδικού</label>
        <input id="newPassword2" type="password" placeholder="Επαναλάβετε τον κωδικό" autocomplete="new-password" />
      </div>
    `;
    return;
  }

  const label = type === "email" ? "Νέο email" : "Νέο username";
  const placeholder =
    type === "email" ? "name@company.gr" : "π.χ. papadopoulos";
  const inputType = type === "email" ? "email" : "text";

  container.innerHTML = `
    <div class="form-row">
      <label for="newValue">${label}</label>
      <input id="newValue" type="${inputType}" placeholder="${placeholder}" autocomplete="off" />
    </div>
  `;
}

function renderRecipients(list) {
  const wrap = $("recipientsList");
  if (!wrap) return;

  if (!Array.isArray(list) || list.length === 0) {
    wrap.innerHTML = `<div class="muted">Δεν έχετε προσθέσει επιπλέον παραλήπτες ακόμη.</div>`;
    return;
  }

  wrap.innerHTML = list
    .map((r) => {
      const email = r.value || r.email || "";
      const created = r.created_at
        ? new Date(r.created_at).toLocaleDateString("el-GR")
        : "";

      return `
        <div class="recipient-row" data-id="${r.id}">
          <div>
            <div class="recipient-email">${email}</div>
            <div class="recipient-meta">Προστέθηκε: ${created || "—"}</div>
          </div>
          <div class="recipient-actions">
            <button type="button" class="recipient-remove" data-id="${
              r.id
            }">Αφαίρεση</button>
          </div>
        </div>
      `;
    })
    .join("");

  wrap.querySelectorAll(".recipient-remove").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (!id) return;
      btn.disabled = true;
      try {
        await api.deleteRecipient(id);
        await loadRecipients();
        showMsg($("recipientMsg"), "Ο παραλήπτης αφαιρέθηκε.", "success");
      } catch (e) {
        showMsg(
          $("recipientMsg"),
          e?.message || "Αποτυχία αφαίρεσης.",
          "error"
        );
      } finally {
        btn.disabled = false;
      }
    });
  });
}

async function loadMe() {
  const hero = $("heroSubtitle");
  const note = $("accountInfoNote");

  try {
    const me = await api.getAccountMe();

    $("infoUsername").textContent = me?.username || "—";
    $("infoEmail").textContent = me?.email || "—";
    $("infoCompany").textContent = me?.companyName || "—";
    $("infoUserNumber").textContent = me?.user_number || me?.userNumber || "—";

    if (hero) {
      const who = me?.companyName
        ? `${me.companyName}`
        : `${me?.username || ""}`;
      hero.textContent = who ? `Συνδεδεμένος ως: ${who}` : "Συνδεδεμένος";
    }

    // Keep localStorage currentUser in sync (username/companyName)
    try {
      const raw = localStorage.getItem("currentUser");
      if (raw) {
        const u = JSON.parse(raw);
        if (me?.username) u.username = me.username;
        if (me?.companyName) u.companyName = me.companyName;
        localStorage.setItem("currentUser", JSON.stringify(u));
      }
    } catch (_) {}

    if (note) {
      note.style.display = "none";
    }
  } catch (e) {
    if (hero) hero.textContent = "Δεν ήταν δυνατή η φόρτωση.";
    if (note) {
      note.textContent = e?.message || "Σφάλμα φόρτωσης στοιχείων.";
      note.style.display = "block";
    }
  }
}

async function loadRecipients() {
  try {
    const list = await api.getRecipients();
    renderRecipients(list);
  } catch (e) {
    renderRecipients([]);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  // Accordion behavior (Skroutz-like sections)
  function initAccordion() {
    const root = document.getElementById("accountAccordion");
    if (!root) return;

    const items = Array.from(root.querySelectorAll(".acc-item"));
    if (items.length === 0) return;

    function setOpen(item, open) {
      const btn = item.querySelector(".acc-trigger");
      const panel = item.querySelector(".acc-panel");
      if (!btn || !panel) return;

      if (open) {
        item.classList.add("is-open");
        btn.setAttribute("aria-expanded", "true");
        // set a fixed max-height for smooth open animation
        panel.style.maxHeight = panel.scrollHeight + "px";
      } else {
        item.classList.remove("is-open");
        btn.setAttribute("aria-expanded", "false");
        panel.style.maxHeight = "0px";
      }
    }

    // Initialize based on aria-expanded
    items.forEach((item) => {
      const btn = item.querySelector(".acc-trigger");
      const panel = item.querySelector(".acc-panel");
      if (!btn || !panel) return;
      const isExpanded = btn.getAttribute("aria-expanded") === "true";
      // Ensure correct starting state
      if (isExpanded) {
        item.classList.add("is-open");
        panel.style.maxHeight = panel.scrollHeight + "px";
      } else {
        item.classList.remove("is-open");
        panel.style.maxHeight = "0px";
      }
    });

    // Toggle (single-open like Skroutz sections)
    items.forEach((item) => {
      const btn = item.querySelector(".acc-trigger");
      if (!btn) return;
      btn.addEventListener("click", () => {
        const isOpen = item.classList.contains("is-open");
        items.forEach((it) => setOpen(it, false));
        setOpen(item, !isOpen);
      });
    });

    // Keep open panel height correct on resize (fonts/wrapping)
    window.addEventListener("resize", () => {
      items.forEach((item) => {
        if (!item.classList.contains("is-open")) return;
        const panel = item.querySelector(".acc-panel");
        if (!panel) return;
        panel.style.maxHeight = panel.scrollHeight + "px";
      });
    });
  }

  initAccordion();

  // logout button inside account
  $("logoutAccountBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    auth.logout();
    window.location.href = "index.html";
  });

  // default fields
  const changeType = $("changeType");
  buildChangeFields(changeType?.value || "email");

  changeType?.addEventListener("change", () => {
    buildChangeFields(changeType.value);
    $("codeArea").style.display = "none";
    $("verifyCode").value = "";
    hideMsg($("changeMsg"));
  });

  // send code
  const sendBtn = $("sendCodeBtn");
  const resendBtn = $("resendCodeBtn");

  async function doSendCode() {
    hideMsg($("changeMsg"));
    sendBtn.disabled = true;
    if (resendBtn) resendBtn.disabled = true;
    try {
      await api.sendAccountChangeCode();
      $("codeArea").style.display = "block";
      $("verifyCode").focus();
      showMsg(
        $("changeMsg"),
        "Στάλθηκε 6-ψήφιος κωδικός στο email σας.",
        "success"
      );
    } catch (e) {
      showMsg(
        $("changeMsg"),
        e?.message || "Αποτυχία αποστολής κωδικού.",
        "error"
      );
    } finally {
      sendBtn.disabled = false;
      if (resendBtn) resendBtn.disabled = false;
    }
  }

  sendBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    doSendCode();
  });
  resendBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    doSendCode();
  });

  // confirm change
  $("changeForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideMsg($("changeMsg"));

    const type = $("changeType")?.value || "email";
    const code = String($("verifyCode")?.value || "").trim();
    if (!code || code.length !== 6) {
      showMsg($("changeMsg"), "Συμπληρώστε τον 6-ψήφιο κωδικό.", "error");
      $("verifyCode")?.focus();
      return;
    }

    // validate inputs
    const updates = {};

    if (type === "password") {
      const p1 = String($("newPassword")?.value || "");
      const p2 = String($("newPassword2")?.value || "");
      if (!p1 || p1.length < 6) {
        showMsg(
          $("changeMsg"),
          "Ο κωδικός πρέπει να είναι τουλάχιστον 6 χαρακτήρες.",
          "error"
        );
        $("newPassword")?.focus();
        return;
      }
      if (p1 !== p2) {
        showMsg($("changeMsg"), "Οι κωδικοί δεν ταιριάζουν.", "error");
        $("newPassword2")?.focus();
        return;
      }
      updates.password = p1;
    } else if (type === "email") {
      const email = sanitizeEmail($("newValue")?.value);
      if (!email || !email.includes("@")) {
        showMsg($("changeMsg"), "Πληκτρολογήστε έγκυρο email.", "error");
        $("newValue")?.focus();
        return;
      }
      updates.email = email;
    } else {
      const username = String($("newValue")?.value || "").trim();
      if (!username || username.length < 3) {
        showMsg(
          $("changeMsg"),
          "Το username πρέπει να έχει τουλάχιστον 3 χαρακτήρες.",
          "error"
        );
        $("newValue")?.focus();
        return;
      }
      updates.username = username;
    }

    const confirmBtn = $("confirmChangeBtn");
    confirmBtn.disabled = true;
    try {
      const tokenResp = await api.verifyAccountChangeCode(code);
      await api.updateAccount(tokenResp.accountToken, updates);

      showMsg($("changeMsg"), "Η αλλαγή ολοκληρώθηκε επιτυχώς.", "success");

      // reset UI
      $("verifyCode").value = "";
      $("codeArea").style.display = "none";
      if (type === "password") {
        $("newPassword").value = "";
        $("newPassword2").value = "";
      } else {
        $("newValue").value = "";
      }

      await loadMe();
    } catch (err) {
      showMsg($("changeMsg"), err?.message || "Αποτυχία αλλαγής.", "error");
    } finally {
      confirmBtn.disabled = false;
    }
  });

  // recipients
  $("recipientForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideMsg($("recipientMsg"));

    const email = sanitizeEmail($("recipientEmail")?.value);
    if (!email || !email.includes("@")) {
      showMsg($("recipientMsg"), "Πληκτρολογήστε έγκυρο email.", "error");
      $("recipientEmail")?.focus();
      return;
    }

    const btn = $("addRecipientBtn");
    btn.disabled = true;
    try {
      await api.addRecipient(email);
      $("recipientEmail").value = "";
      await loadRecipients();
      showMsg(
        $("recipientMsg"),
        "Το email προστέθηκε στους παραλήπτες.",
        "success"
      );
    } catch (err) {
      showMsg(
        $("recipientMsg"),
        err?.message || "Αποτυχία προσθήκης.",
        "error"
      );
    } finally {
      btn.disabled = false;
    }
  });

  // initial load
  loadMe();
  loadRecipients();
});
