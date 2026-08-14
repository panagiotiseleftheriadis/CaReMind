class AdminPanel {
  constructor() {
    this.users = [];
    this.sessionUser = null;
    this.searchTerm = "";
    this.statusFilter = "all";
    this.typeFilter = "all";
    this.isLoading = false;

    this.elements = {
      tableBody: document.getElementById("usersTableBody"),
      loading: document.getElementById("usersLoading"),
      empty: document.getElementById("usersEmpty"),
      resultsCount: document.getElementById("resultsCount"),
      search: document.getElementById("userSearch"),
      statusFilter: document.getElementById("statusFilter"),
      typeFilter: document.getElementById("typeFilter"),
      refresh: document.getElementById("refreshUsers"),
      dialog: document.getElementById("userDialog"),
      form: document.getElementById("userForm"),
    };
  }

  async init() {
    this.bindEvents();
    const authenticated = await this.verifyAdminSession();
    if (!authenticated) return;
    document.body.classList.remove("auth-pending");
    await this.loadUsers();
  }

  async verifyAdminSession() {
    if (window.CaReMindDemo?.isActive()) {
      window.location.replace("dashboard.html");
      return false;
    }

    try {
      const profile = await api.getAccountMe();
      if (!profile || !["admin", "owner"].includes(profile.role)) {
        window.location.replace("dashboard.html");
        return false;
      }

      this.sessionUser = profile;
      localStorage.setItem(
        "currentUser",
        JSON.stringify({
          ...(this.readStoredUser() || {}),
          userId: profile.id,
          username: profile.username,
          role: profile.role,
          companyName: profile.companyName,
        })
      );
      this.renderAdminIdentity();
      return true;
    } catch (error) {
      console.error("Admin session verification failed:", error);
      if (error?.status === 403) {
        window.location.replace("dashboard.html");
      } else {
        window.location.replace("index.html");
      }
      return false;
    }
  }

  readStoredUser() {
    try {
      return JSON.parse(localStorage.getItem("currentUser") || "null");
    } catch {
      return null;
    }
  }

  renderAdminIdentity() {
    const username = this.sessionUser?.username || "Admin";
    document.getElementById("adminUsername").textContent = username;
    document.getElementById("adminEmail").textContent =
      this.sessionUser?.email || "Προστατευμένη πρόσβαση";
    document.getElementById("adminAvatar").textContent = this.initials(username);
  }

  bindEvents() {
    document.getElementById("openCreateUser").addEventListener("click", () =>
      this.openCreateDialog()
    );
    document.getElementById("closeUserDialog").addEventListener("click", () =>
      this.closeDialog()
    );
    document.getElementById("cancelUserDialog").addEventListener("click", () =>
      this.closeDialog()
    );
    document.getElementById("generatePassword").addEventListener("click", () =>
      this.generatePassword()
    );
    document.getElementById("logoutButton").addEventListener("click", () =>
      api.logout()
    );

    this.elements.form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.saveUser();
    });
    this.elements.dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.closeDialog();
    });
    this.elements.refresh.addEventListener("click", () => this.loadUsers());
    this.elements.search.addEventListener("input", (event) => {
      this.searchTerm = event.target.value.trim().toLocaleLowerCase("el");
      this.renderUsers();
    });
    this.elements.statusFilter.addEventListener("change", (event) => {
      this.statusFilter = event.target.value;
      this.renderUsers();
    });
    this.elements.typeFilter.addEventListener("change", (event) => {
      this.typeFilter = event.target.value;
      this.renderUsers();
    });
    this.elements.tableBody.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button || button.disabled) return;
      const userId = Number(button.dataset.userId);
      const user = this.users.find((item) => Number(item.id) === userId);
      if (!user) return;

      if (button.dataset.action === "edit") this.openEditDialog(user);
      if (button.dataset.action === "toggle") this.toggleUser(user);
      if (button.dataset.action === "role") {
        this.updateUserRole(user, button.dataset.role);
      }
      if (button.dataset.action === "delete") this.deleteUser(user);
    });
  }

  async loadUsers() {
    if (this.isLoading) return;
    this.isLoading = true;
    this.elements.loading.hidden = false;
    this.elements.empty.hidden = true;
    this.elements.tableBody.innerHTML = "";
    this.elements.refresh.classList.add("is-loading");
    this.elements.refresh.disabled = true;

    try {
      const users = await api.getUsers();
      this.users = Array.isArray(users) ? users : [];
      this.renderStats();
    } catch (error) {
      console.error("Loading admin users failed:", error);
      window.CaReMindUI.toast(
        error.message || "Δεν ήταν δυνατή η φόρτωση των χρηστών.",
        "error"
      );
      this.users = [];
      this.renderStats();
    } finally {
      this.isLoading = false;
      this.elements.loading.hidden = true;
      this.elements.refresh.classList.remove("is-loading");
      this.elements.refresh.disabled = false;
      this.renderUsers();
    }
  }

  renderStats() {
    const total = this.users.length;
    const active = this.users.filter((user) => this.toBoolean(user.is_active)).length;
    const unverified = this.users.filter(
      (user) => !["admin", "owner"].includes(user.role) && !this.toBoolean(user.email_verified)
    ).length;
    const vehicles = this.users.reduce(
      (sum, user) => sum + Number(user.vehicle_count || 0),
      0
    );
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recent = this.users.filter(
      (user) => user.created_at && new Date(user.created_at).getTime() >= thirtyDaysAgo
    ).length;

    document.getElementById("statTotal").textContent = total.toLocaleString("el-GR");
    document.getElementById("statActive").textContent = active.toLocaleString("el-GR");
    document.getElementById("statUnverified").textContent = unverified.toLocaleString("el-GR");
    document.getElementById("statVehicles").textContent = vehicles.toLocaleString("el-GR");
    document.getElementById("statNew").textContent = `${recent} νέοι τις τελευταίες 30 ημέρες`;
    document.getElementById("statActiveRate").textContent = total
      ? `${Math.round((active / total) * 100)}% του συνόλου`
      : "Δεν υπάρχουν λογαριασμοί";

    const admins = this.users.filter((user) => ["admin", "owner"].includes(user.role));
    document.getElementById("multipleAdminsNotice").hidden = admins.length <= 1;
  }

  filteredUsers() {
    return this.users.filter((user) => {
      const searchable = [
        user.username,
        user.full_name,
        user.email,
        user.user_number,
        user.company_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("el");
      if (this.searchTerm && !searchable.includes(this.searchTerm)) return false;

      const active = this.toBoolean(user.is_active);
      const verified = this.toBoolean(user.email_verified);
      if (this.statusFilter === "active" && !active) return false;
      if (this.statusFilter === "inactive" && active) return false;
      if (this.statusFilter === "unverified" && verified) return false;

      if (
        this.typeFilter === "admin" &&
        !["admin", "owner"].includes(user.role)
      ) return false;
      if (
        this.typeFilter !== "all" &&
        this.typeFilter !== "admin" &&
        user.account_type !== this.typeFilter
      ) {
        return false;
      }
      return true;
    });
  }

  renderUsers() {
    if (this.isLoading) return;
    const users = this.filteredUsers();
    this.elements.empty.hidden = users.length > 0;
    this.elements.tableBody.innerHTML = users.map((user) => this.userRow(user)).join("");
    this.elements.resultsCount.textContent = `Εμφάνιση ${users.length} από ${this.users.length} χρήστες`;
  }

  userRow(user) {
    const id = Number(user.id);
    const isAdmin = user.role === "admin";
    const isOwner = user.role === "owner";
    const isPrivileged = isAdmin || isOwner;
    const sessionIsOwner = this.sessionUser?.role === "owner";
    const isSelf = this.toBoolean(user.is_self) || id === Number(this.sessionUser?.id);
    const active = this.toBoolean(user.is_active);
    const verified = this.toBoolean(user.email_verified);
    const displayName = user.full_name || user.username || "Χρήστης";
    const typeLabel = isOwner
      ? "Owner"
      : isAdmin
        ? "Διαχειριστής"
      : user.account_type === "business"
        ? "Επιχείρηση"
        : "Ιδιώτης";

    const editAction = `
      <button class="row-action" type="button" data-action="edit" data-user-id="${id}" title="Επεξεργασία" aria-label="Επεξεργασία ${this.escape(displayName)}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 4 6 6M4 20l4.5-1L19 8a2.1 2.1 0 0 0-3-3L5 16.5 4 20Z" /></svg>
      </button>`;
    const userActions = `
      <button class="row-action" type="button" data-action="toggle" data-user-id="${id}" title="${active ? "Απενεργοποίηση" : "Ενεργοποίηση"}" aria-label="${active ? "Απενεργοποίηση" : "Ενεργοποίηση"} ${this.escape(displayName)}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v10M6.4 5.6a8 8 0 1 0 11.2 0" /></svg>
      </button>
      <button class="row-action row-action--danger" type="button" data-action="delete" data-user-id="${id}" title="Οριστική διαγραφή" aria-label="Διαγραφή ${this.escape(displayName)}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 10v6M14 10v6" /></svg>
      </button>`;
    const roleAction = sessionIsOwner && !isOwner
      ? `<button class="row-action row-action--role" type="button" data-action="role" data-role="${isAdmin ? "user" : "admin"}" data-user-id="${id}" title="${isAdmin ? "Αφαίρεση Admin" : "Ορισμός ως Admin"}" aria-label="${isAdmin ? "Αφαίρεση δικαιωμάτων Admin από" : "Ορισμός ως Admin του"} ${this.escape(displayName)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 6v5c0 5-3.4 8.2-8 10-4.6-1.8-8-5-8-10V6l8-3Z" /><path d="m9 12 2 2 4-4" /></svg>
        </button>`
      : "";

    let actions;
    if (isOwner) {
      actions = isSelf
        ? `${editAction}<span class="protected-label">Owner</span>`
        : '<span class="protected-label">Owner</span>';
    } else if (isAdmin) {
      actions = sessionIsOwner
        ? `${editAction}${roleAction}`
        : isSelf
          ? editAction
          : '<span class="protected-label">Προστατευμένος</span>';
    } else {
      actions = `${editAction}${roleAction}${userActions}`;
    }

    return `
      <tr>
        <td data-label="Χρήστης">
          <div class="user-identity">
            <span class="user-avatar ${isPrivileged ? "user-avatar--admin" : ""}">${this.escape(this.initials(displayName))}</span>
            <span class="user-identity__copy">
              <strong>${this.escape(displayName)}${isOwner ? '<span class="role-badge role-badge--owner">Owner</span>' : ""}${isSelf ? '<span class="role-badge">Εσύ</span>' : ""}</strong>
              <small>@${this.escape(user.username)} · ${this.escape(user.email || "χωρίς email")}</small>
            </span>
          </div>
        </td>
        <td data-label="Εταιρεία / Τύπος">
          <div class="company-copy">
            <strong>${this.escape(user.company_name || "Χωρίς εταιρεία")}</strong>
            <small>${this.escape(typeLabel)} · από ${this.escape(this.formatDate(user.created_at))}</small>
          </div>
        </td>
        <td data-label="Δεδομένα">
          <div class="resource-counts">
            <span class="resource-chip" title="Οχήματα"><strong>${Number(user.vehicle_count || 0)}</strong> οχ.</span>
            <span class="resource-chip" title="Συντηρήσεις"><strong>${Number(user.maintenance_count || 0)}</strong> συντ.</span>
            <span class="resource-chip" title="Έξοδα"><strong>${Number(user.cost_count || 0)}</strong> έξ.</span>
          </div>
        </td>
        <td data-label="Κατάσταση">
          <span class="status-stack">
            <span class="status-badge ${active ? "" : "status-badge--inactive"}">${active ? "Ενεργός" : "Ανενεργός"}</span>
            <span class="verify-label ${verified ? "" : "verify-label--warning"}">${verified ? "Email επιβεβαιωμένο" : "Email σε αναμονή"}</span>
          </span>
        </td>
        <td data-label="Ενέργειες"><div class="row-actions">${actions}</div></td>
      </tr>`;
  }

  openCreateDialog() {
    this.elements.form.reset();
    document.getElementById("editingUserId").value = "";
    document.getElementById("userDialogEyebrow").textContent = "ΝΕΟΣ ΛΟΓΑΡΙΑΣΜΟΣ";
    document.getElementById("userDialogTitle").textContent = "Δημιουργία χρήστη";
    document.getElementById("userDialogDescription").textContent =
      "Τα στοιχεία σύνδεσης θα ισχύσουν αμέσως.";
    document.getElementById("passwordLabel").textContent = "Κωδικός πρόσβασης";
    document.getElementById("passwordHint").textContent = "Τουλάχιστον 8 χαρακτήρες.";
    document.getElementById("password").required = true;
    document.getElementById("activeField").hidden = true;
    document.getElementById("saveUserButton").textContent = "Δημιουργία χρήστη";
    this.elements.dialog.showModal();
    window.setTimeout(() => document.getElementById("fullName").focus(), 0);
  }

  openEditDialog(user) {
    this.elements.form.reset();
    document.getElementById("editingUserId").value = user.id;
    document.getElementById("fullName").value = user.full_name || "";
    document.getElementById("username").value = user.username || "";
    document.getElementById("email").value = user.email || "";
    document.getElementById("userNumber").value = user.user_number || "";
    document.getElementById("companyName").value = user.company_name || "";
    document.getElementById("accountType").value = user.account_type || "individual";
    document.getElementById("isActive").checked = this.toBoolean(user.is_active);
    document.getElementById("userDialogEyebrow").textContent = `ΧΡΗΣΤΗΣ #${user.id}`;
    document.getElementById("userDialogTitle").textContent = "Επεξεργασία λογαριασμού";
    document.getElementById("userDialogDescription").textContent =
      ["admin", "owner"].includes(user.role)
        ? "Επεξεργάζεσαι έναν προστατευμένο λογαριασμό διαχείρισης."
        : "Οι αλλαγές εφαρμόζονται αμέσως.";
    document.getElementById("passwordLabel").textContent = "Νέος κωδικός (προαιρετικό)";
    document.getElementById("passwordHint").textContent =
      "Άφησέ το κενό για να παραμείνει ο υπάρχων κωδικός.";
    document.getElementById("password").required = false;
    document.getElementById("activeField").hidden = ["admin", "owner"].includes(user.role);
    document.getElementById("saveUserButton").textContent = "Αποθήκευση αλλαγών";
    this.elements.dialog.showModal();
    window.setTimeout(() => document.getElementById("fullName").focus(), 0);
  }

  closeDialog() {
    if (this.elements.dialog.open) this.elements.dialog.close();
    this.elements.form.reset();
  }

  generatePassword() {
    const alphabet =
      "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
    const values = crypto.getRandomValues(new Uint32Array(14));
    const password = Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
    const field = document.getElementById("password");
    field.value = password;
    field.type = "text";
    field.focus();
    field.select();
    window.setTimeout(() => {
      field.type = "password";
    }, 5000);
  }

  async saveUser() {
    if (!this.elements.form.reportValidity()) return;
    const userId = Number(document.getElementById("editingUserId").value || 0);
    const payload = {
      fullName: document.getElementById("fullName").value.trim(),
      username: document.getElementById("username").value.trim(),
      email: document.getElementById("email").value.trim(),
      userNumber: document.getElementById("userNumber").value.trim(),
      companyName: document.getElementById("companyName").value.trim(),
      accountType: document.getElementById("accountType").value,
      password: document.getElementById("password").value,
      isActive: document.getElementById("isActive").checked,
    };
    const button = document.getElementById("saveUserButton");
    button.disabled = true;
    const originalLabel = button.textContent;
    button.textContent = "Αποθήκευση…";

    try {
      if (userId) {
        await api.updateUser(userId, payload);
        window.CaReMindUI.toast("Ο λογαριασμός ενημερώθηκε.", "success");
        if (userId === Number(this.sessionUser?.id)) {
          this.sessionUser.username = payload.username;
          this.sessionUser.email = payload.email;
          this.renderAdminIdentity();
          const stored = this.readStoredUser() || {};
          localStorage.setItem(
            "currentUser",
            JSON.stringify({ ...stored, username: payload.username, role: this.sessionUser.role })
          );
        }
      } else {
        await api.createUser(payload);
        window.CaReMindUI.toast("Ο νέος χρήστης δημιουργήθηκε.", "success");
      }
      this.closeDialog();
      await this.loadUsers();
    } catch (error) {
      console.error("Saving admin user failed:", error);
      window.CaReMindUI.toast(
        error.message || "Δεν ήταν δυνατή η αποθήκευση του χρήστη.",
        "error"
      );
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }

  async toggleUser(user) {
    const active = this.toBoolean(user.is_active);
    if (
      active &&
      !(await window.CaReMindUI.confirm(
        `Ο χρήστης “${user.username}” θα αποσυνδεθεί και δεν θα μπορεί να μπει στην εφαρμογή.`,
        {
          title: "Απενεργοποίηση χρήστη",
          confirmLabel: "Απενεργοποίηση",
        }
      ))
    ) {
      return;
    }

    try {
      const result = await api.toggleUserActive(user.id);
      window.CaReMindUI.toast(result.message || "Η κατάσταση ενημερώθηκε.", "success");
      await this.loadUsers();
    } catch (error) {
      window.CaReMindUI.toast(
        error.message || "Δεν ήταν δυνατή η αλλαγή κατάστασης.",
        "error"
      );
    }
  }

  async updateUserRole(user, role) {
    if (this.sessionUser?.role !== "owner") {
      window.CaReMindUI.toast(
        "Μόνο ο owner μπορεί να αλλάζει δικαιώματα admin.",
        "error"
      );
      return;
    }

    const promoting = role === "admin";
    const confirmed = await window.CaReMindUI.confirm(
      promoting
        ? `Ο χρήστης “${user.username}” θα αποκτήσει πρόσβαση στο Admin Panel και στη διαχείριση χρηστών.`
        : `Ο χρήστης “${user.username}” θα χάσει αμέσως την πρόσβαση στο Admin Panel και θα αποσυνδεθεί.`,
      {
        title: promoting ? "Ορισμός ως Admin" : "Αφαίρεση Admin",
        confirmLabel: promoting ? "Ορισμός ως Admin" : "Αφαίρεση δικαιωμάτων",
      }
    );
    if (!confirmed) return;

    try {
      const result = await api.updateUserRole(user.id, role);
      window.CaReMindUI.toast(result.message || "Ο ρόλος ενημερώθηκε.", "success");
      await this.loadUsers();
    } catch (error) {
      window.CaReMindUI.toast(
        error.message || "Δεν ήταν δυνατή η αλλαγή δικαιωμάτων.",
        "error"
      );
    }
  }

  async deleteUser(user) {
    const vehicles = Number(user.vehicle_count || 0);
    const maintenances = Number(user.maintenance_count || 0);
    const costs = Number(user.cost_count || 0);
    const message =
      `Θα διαγραφεί οριστικά ο χρήστης “${user.username}” μαζί με ` +
      `${vehicles} οχήματα, ${maintenances} συντηρήσεις και ${costs} έξοδα. Η ενέργεια δεν αναιρείται.`;

    const confirmed = await window.CaReMindUI.confirm(message, {
      title: "Οριστική διαγραφή χρήστη",
      confirmLabel: "Διαγραφή οριστικά",
    });
    if (!confirmed) return;

    try {
      const result = await api.deleteUser(user.id);
      window.CaReMindUI.toast(result.message || "Ο χρήστης διαγράφηκε.", "success");
      await this.loadUsers();
    } catch (error) {
      window.CaReMindUI.toast(
        error.message || "Δεν ήταν δυνατή η διαγραφή του χρήστη.",
        "error"
      );
    }
  }

  toBoolean(value) {
    return value === true || value === 1 || value === "1";
  }

  formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("el-GR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(date);
  }

  initials(value) {
    const parts = String(value || "A").trim().split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  }

  escape(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    })[character]);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.adminPanel = new AdminPanel();
  window.adminPanel.init();
});
