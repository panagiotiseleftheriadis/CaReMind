// admin.js - connected to backend admin-only user management

class AdminPanel {
  constructor() {
    // Αποθήκευση κωδικών μόνο τοπικά (για να μπορείς να τους βλέπεις όταν χρειάζεται)
    this.userPasswords =
      JSON.parse(localStorage.getItem("userPasswords")) || {};
    this.init();
  }

  init() {
    this.ensureAdminAccess();
    this.setupEventListeners();
    this.loadUsers();
  }

  ensureAdminAccess() {
    const raw = localStorage.getItem("currentUser");
    if (!raw) {
      window.location.href = "login.html";
      return;
    }

    let currentUser = null;
    try {
      currentUser = JSON.parse(raw);
    } catch (e) {
      console.error("Failed to parse currentUser:", e);
      window.location.href = "login.html";
      return;
    }

    // Έλεγχος με username αντί για role
    if (!currentUser || currentUser.username !== "admin") {
      window.location.href = "dashboard.html";
    }
  }

  setupEventListeners() {
    const createUserForm = document.getElementById("createUserForm");
    if (createUserForm) {
      createUserForm.addEventListener("submit", (e) => {
        e.preventDefault();
        this.createUser();
      });
    }

    const companyInput = document.getElementById("companyName");
    if (companyInput) {
      companyInput.addEventListener("blur", () => {
        this.generateUsername();
      });
    }

    const generatePassBtn = document.getElementById("generatePassBtn");
    if (generatePassBtn) {
      generatePassBtn.addEventListener("click", (e) => {
        e.preventDefault();
        this.generateRandomPassword();
      });
    }
  }

  generateUsername() {
    const companyName = document.getElementById("companyName").value.trim();
    if (!companyName) return;

    const username = companyName
      .toLowerCase()
      .replace(/[^a-z0-9α-ωάέήίόύώ]/g, "")
      .replace(/\s+/g, "")
      .substring(0, 15);

    const usernameInput = document.getElementById("newUsername");
    if (usernameInput) {
      usernameInput.value = username;
    }
  }

  generateRandomPassword() {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%";
    let password = "";
    for (let i = 0; i < 10; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const passInput = document.getElementById("newPassword");
    if (passInput) {
      passInput.value = password;
    }
  }

  // ------------------ Δημιουργία χρήστη ------------------
  async createUser() {
    const username = document.getElementById("newUsername").value.trim();
    const password = document.getElementById("newPassword").value;
    const companyName = document.getElementById("companyName").value.trim();
    const email = document.getElementById("userEmail").value.trim(); // ΝΕΟ
    const userNumber = document.getElementById("userNumber").value.trim(); // ΝΕΟ

    if (!username || !password || !companyName || !email || !userNumber) {
      alert(
        "Συμπληρώστε όλα τα πεδία (username, κωδικό, email, αριθμό χρήστη, εταιρεία)"
      );
      return;
    }

    if (password.length < 4) {
      alert("Ο κωδικός πρέπει να έχει τουλάχιστον 4 χαρακτήρες");
      return;
    }
    // πολύ απλός έλεγχος email
    if (!email.includes("@") || !email.includes(".")) {
      alert("Δώστε ένα έγκυρο email");
      return;
    }
    try {
      const result = await api.createUser({
        username,
        password,
        companyName,
        email,
        userNumber,
      });

      // Αποθήκευση κωδικού μόνο τοπικά για να τον βλέπεις
      this.userPasswords[username] = password;
      localStorage.setItem("userPasswords", JSON.stringify(this.userPasswords));

      alert(
        `✅ Ο χρήστης "${username}" δημιουργήθηκε επιτυχώς!` +
          `\n\nΣτοιχεία χρήστη:` +
          `\n• Username: ${username}` +
          `\n• Password: ${password}` +
          `\n• Company: ${companyName}` +
          `\n• Email: ${email}` +
          `\n• Αριθμός χρήστη: ${userNumber}`
      );

      const form = document.getElementById("createUserForm");
      if (form) form.reset();

      // Επαναφόρτωση λίστας χρηστών
      this.loadUsers();
    } catch (error) {
      console.error("Create user error:", error);
      alert(
        "❌ Σφάλμα: " +
          (error.message || "Δεν μπορεί να δημιουργηθεί ο χρήστης")
      );
    }
  }

  // ------------------ Φόρτωση χρηστών ------------------
  async loadUsers() {
    const usersList = document.getElementById("usersList");
    if (!usersList) return;

    usersList.innerHTML = "<p>Φόρτωση χρηστών...</p>";

    try {
      const users = await api.getUsers();

      if (!Array.isArray(users) || users.length === 0) {
        usersList.innerHTML = "<p>Δεν υπάρχουν χρήστες</p>";
        return;
      }

      const html = users
        .map((user) => {
          const savedPassword = this.userPasswords[user.username] || "";
          const createdAt = user.created_at
            ? new Date(user.created_at).toLocaleDateString("el-GR")
            : "-";

          const statusLabel = user.is_active ? "Ενεργός" : "Ανενεργός";
          const statusClass = user.is_active
            ? "status-active"
            : "status-inactive";

          return `
      <div class="user-item" id="user-${user.id}">
        <div class="user-main">
          <p><strong>👤 Username:</strong> ${user.username}</p>
          <p><strong>🔐 Password:</strong> ${
            savedPassword
              ? `<span class="password-display">${savedPassword}</span>`
              : "Δεν βρέθηκε (τοπικά)"
          }</p>
          <p><strong>📧 Email:</strong> ${user.email || "—"}</p>
          <p><strong>📱 Τηλέφωνο:</strong> ${user.user_number || "—"}</p>
          <p><strong>🏢 Εταιρεία:</strong> ${user.company_name || "—"}</p>
          <p><strong>🆔 ID:</strong> ${user.id}</p>
          <p><strong>📅 Ημερομηνία:</strong> ${createdAt}</p>
          <p><strong># Company ID:</strong> ${
            user.company_id != null ? user.company_id : "—"
          }</p>
          <p><strong>Κατάσταση:</strong> 
            <span class="${statusClass}">${statusLabel}</span>
          </p>
        </div>
        <div class="user-actions">
          <button class="btn-secondary" onclick="adminPanel.editUser(${
            user.id
          })">
            Επεξεργασία
          </button>
          <button class="btn-secondary" onclick="adminPanel.toggleUserActive(${
            user.id
          }, ${user.is_active ? 1 : 0})">
            ${user.is_active ? "Απενεργοποίηση" : "Ενεργοποίηση"}
          </button>
          <button class="btn-secondary btn-danger" onclick="adminPanel.deleteUser(${
            user.id
          })">
            Διαγραφή
          </button>
        </div>

        <!-- Εδώ θα μπαίνει η φόρμα επεξεργασίας -->
        <div class="user-edit" id="user-edit-${
          user.id
        }" style="display:none; margin-top:10px;"></div>
      </div>
    `;
        })
        .join("");

      usersList.innerHTML = html;
    } catch (error) {
      console.error("Error loading users:", error);
      usersList.innerHTML =
        "<p>Σφάλμα φόρτωσης χρηστών. Βεβαιωθείτε ότι ο server τρέχει.</p>";
    }
  }

  // ------------------ Επεξεργασία χρήστη ------------------
  // Άνοιγμα φόρμας επεξεργασίας κάτω από τον χρήστη
  async editUser(userId) {
    try {
      const users = await api.getUsers();
      const user = users.find((u) => u.id === userId);
      if (!user) {
        alert("❌ Ο χρήστης δεν βρέθηκε");
        return;
      }

      const container = document.getElementById(`user-edit-${userId}`);
      if (!container) return;

      // Αν είναι ήδη ανοιχτή, την κλείνουμε
      if (container.style.display === "block") {
        container.style.display = "none";
        container.innerHTML = "";
        return;
      }

      container.innerHTML = `
        <div class="form-section" style="margin-top:10px;">
          <h4>Επεξεργασία χρήστη #${user.id}</h4>
          <div class="form-group">
            <label>Username:</label>
            <input type="text" id="edit-username-${user.id}" value="${
        user.username
      }" />
          </div>

          <div class="form-group">
            <label>Νέος κωδικός (άφησε κενό για να μην αλλάξει):</label>
            <input type="text" id="edit-password-${
              user.id
            }" placeholder="Νέος κωδικός" />
          </div>

          <div class="form-group">
            <label>Email:</label>
            <input type="email" id="edit-email-${user.id}" value="${
        user.email || ""
      }" />
          </div>

          <div class="form-group">
            <label>Τηλέφωνο / Αριθμός χρήστη:</label>
            <input type="text" id="edit-user-number-${user.id}" value="${
        user.user_number || ""
      }" />
          </div>

          <div class="form-group">
            <label>Εταιρεία:</label>
            <input type="text" id="edit-company-${user.id}" value="${
        user.company_name || ""
      }" />
          </div>

          <div class="form-group">
            <label>
              <input type="checkbox" id="edit-active-${user.id}" ${
        user.is_active ? "checked" : ""
      } />
              Ενεργός χρήστης
            </label>
          </div>

          <div style="margin-top:10px;">
            <button class="btn-primary" onclick="adminPanel.saveUserEdits(${
              user.id
            })">
              Αποθήκευση αλλαγών
            </button>
            <button class="btn-secondary" onclick="adminPanel.cancelEditUser(${
              user.id
            })">
              Άκυρο
            </button>
          </div>
        </div>
      `;

      container.style.display = "block";
    } catch (error) {
      console.error("Edit user error:", error);
      alert("❌ Σφάλμα κατά τη φόρτωση στοιχείων χρήστη");
    }
  }
  async saveUserEdits(userId) {
    const username = document
      .getElementById(`edit-username-${userId}`)
      .value.trim();
    const password = document
      .getElementById(`edit-password-${userId}`)
      .value.trim();
    const email = document.getElementById(`edit-email-${userId}`).value.trim();
    const userNumber = document
      .getElementById(`edit-user-number-${userId}`)
      .value.trim();
    const companyName = document
      .getElementById(`edit-company-${userId}`)
      .value.trim();
    const isActive = document.getElementById(`edit-active-${userId}`).checked;

    if (!username || !email || !userNumber || !companyName) {
      alert("Συμπλήρωσε όλα τα πεδία (username, email, τηλέφωνο, εταιρεία)");
      return;
    }

    const updatePayload = {
      username,
      companyName,
      email,
      userNumber,
      isActive,
    };

    if (password.length > 0) {
      updatePayload.password = password;
    }

    try {
      await api.updateUser(userId, updatePayload);

      // Αν αλλάξαμε password, ενημερώνουμε το localStorage
      if (password.length > 0) {
        this.userPasswords[username] = password;
        localStorage.setItem(
          "userPasswords",
          JSON.stringify(this.userPasswords)
        );
      }

      alert("✅ Ο χρήστης ενημερώθηκε επιτυχώς");
      this.loadUsers();
    } catch (error) {
      console.error("Save user edits error:", error);
      alert(
        "❌ Σφάλμα κατά την ενημέρωση χρήστη: " +
          (error.message || "Δοκίμασε ξανά")
      );
    }
  }

  cancelEditUser(userId) {
    const container = document.getElementById(`user-edit-${userId}`);
    if (container) {
      container.style.display = "none";
      container.innerHTML = "";
    }
  }

  // ------------------ Ενεργοποίηση / Απενεργοποίηση ------------------
  async toggleUserActive(userId, currentStatus) {
    try {
      await api.toggleUserActive(userId);
      // Απλή ενημέρωση
      this.loadUsers();
    } catch (error) {
      console.error("Toggle active error:", error);
      alert("❌ Σφάλμα κατά την αλλαγή κατάστασης χρήστη");
    }
  }

  // ------------------ Διαγραφή χρήστη ------------------
  async deleteUser(userId) {
    if (
      !confirm("⚠️ Είστε σίγουροι ότι θέλετε να διαγράψετε αυτόν τον χρήστη;")
    ) {
      return;
    }

    try {
      const users = await api.getUsers();
      const user = users.find((u) => u.id === userId);
      const username = user ? user.username : "";

      await api.deleteUser(userId);

      // Καθαρίζουμε αποθηκευμένο password για αυτόν τον χρήστη
      if (username && this.userPasswords[username]) {
        delete this.userPasswords[username];
        localStorage.setItem(
          "userPasswords",
          JSON.stringify(this.userPasswords)
        );
      }

      alert("✅ Ο χρήστης διαγράφηκε επιτυχώς");
      this.loadUsers();
    } catch (error) {
      console.error("Delete user error:", error);
      alert("❌ Σφάλμα κατά τη διαγραφή χρήστη");
    }
  }

  // ------------------ Debug helper ------------------
  showAllPasswords() {
    console.log("Αποθηκευμένοι κωδικοί:", this.userPasswords);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.adminPanel = new AdminPanel();
});
