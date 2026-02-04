// frontend/api.js

class API {
  // Προσθέστε αυτό το έλεγχο στο api.js στο constructor:
  constructor() {
    this.baseURL = "https://caremind-bzv3.onrender.com/api";
    // Πλέον το token μένει μόνο στη μνήμη (RAM)
    this.token = null; 
    this.user = null;
    this.isRefreshing = false;
  }

  /* ------------ Token helpers ------------ */

  setToken(token) {
    this.token = token;
  }

  removeToken() {
    this.setToken(null);
  }

  getHeaders() {
    const headers = {
      "Content-Type": "application/json",
    };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    return headers;
  }
  async refreshToken() {
    try {
      const response = await fetch(`${this.baseURL}/refresh`, {
        method: "POST",
        credentials: "include", // ΠΟΛΥ ΣΗΜΑΝΤΙΚΟ: Στέλνει το HttpOnly cookie
      });

      if (response.ok) {
        const data = await response.json();
        this.setToken(data.accessToken);
        this.user = data.user;
        return true;
      }
      return false;
    } catch (err) {
      console.error("Refresh error:", err);
      return false;
    }
  }

  /* ------------ Βασική μέθοδος request ------------ */

async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      method: options.method || "GET",
      headers: this.getHeaders(),
      credentials: "include", // Επιτρέπει την αποστολή cookies αν χρειαστεί
    };

    if (options.body) {
      config.body = JSON.stringify(options.body);
    }

    try {
      let response = await fetch(url, config);

      // Αν το token έληξε (401) και δεν είμαστε ήδη σε φάση refresh
      if (response.status === 401 && !this.isRefreshing && !endpoint.includes("/login")) {
        this.isRefreshing = true;
        const success = await this.refreshToken();
        this.isRefreshing = false;

        if (success) {
          // Ξαναδοκιμάζουμε το αρχικό request με το νέο token
          config.headers = this.getHeaders();
          response = await fetch(url, config);
        } else {
          // Αν αποτύχει και το refresh, στέλνουμε στο login
          this.logout();
          throw new Error("Session expired");
        }
      }

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Request failed");
      return data;
    } catch (error) {
      throw error;
    }
  }

  async updateUser(id, updates) {
    return this.request(`/users/${id}`, {
      method: "PUT",
      body: updates,
    });
  }

  // async toggleUserActive(id) {
  //   return this.request(`/users/${id}/toggle-active`, {
  //     method: "PATCH",
  //   });
  // }

  async deleteUser(id) {
    return this.request(`/users/${id}`, {
      method: "DELETE",
    });
  }

  /* ------------ AUTH ------------ */
  async createUser({ username, password, companyName, email, userNumber }) {
    return this.request("/users", {
      method: "POST",
      body: { username, password, companyName, email, userNumber },
    });
  }

  async getUsers() {
    return this.request("/users", { method: "GET" });
  }

  async login(username, password) {
    const response = await this.request("/login", {
      method: "POST",
      body: { username, password },
    });

    if (response.token) {
      this.setToken(response.token);
    }

    return response; // { token, user }
  }
  async logout() {
    try {
      await fetch(`${this.baseURL}/logout`, { method: "POST", credentials: "include" });
    } catch (e) {}
    this.token = null;
    this.user = null;
    localStorage.removeItem("currentUser");
    window.location.href = "index.html";
  }
  /* ------------ ACCOUNT ------------ */

async getAccountMe() {
  return this.request("/account/me", {
    method: "GET",
  });
}


  /* ------------ REGISTER / EMAIL VERIFY ------------ */
async register({ username, email, password, fullName, companyName, phone }) {
  return this.request("/register", {
    method: "POST",
    body: { username, email, password, fullName, companyName, phone },
  });
}


  async verifyEmail(email, code) {
    return this.request("/verify-email", {
      method: "POST",
      body: { email, code },
    });
  }

  async resendVerification(email) {
    return this.request("/resend-verification", {
      method: "POST",
      body: { email },
    });
  }

  /* ------------ FORGOT PASSWORD ------------ */
  async forgotPassword(email) {
    return this.request("/forgot-password", {
      method: "POST",
      body: { email },
    });
  }

  async verifyResetCode(email, code) {
    return this.request("/verify-reset-code", {
      method: "POST",
      body: { email, code },
    });
  }

  async resetPassword(resetToken, newPassword) {
    return this.request("/reset-password", {
      method: "POST",
      body: { resetToken, newPassword },
    });
  }
  // NOTIFICATIONS
  async getNotifications() {
    return this.request("/notifications", {
      method: "GET",
    });
  }

  /* ------------ VEHICLES ------------ */

  async getVehicles() {
    return await this.request("/vehicles", { method: "GET" });
  }

  async addVehicle(vehicleData) {
    return await this.request("/vehicles", {
      method: "POST",
      body: vehicleData,
    });
  }

  async updateVehicle(id, vehicleData) {
    return await this.request(`/vehicles/${id}`, {
      method: "PUT",
      body: vehicleData,
    });
  }

  async deleteVehicle(id) {
    return await this.request(`/vehicles/${id}`, {
      method: "DELETE",
    });
  }

  /* ------------ MAINTENANCES ------------ */

  async getMaintenances() {
    return await this.request("/maintenances", { method: "GET" });
  }

  async addMaintenance(maintenanceData) {
    return await this.request("/maintenances", {
      method: "POST",
      body: maintenanceData,
    });
  }

  async updateMaintenance(id, maintenanceData) {
    return await this.request(`/maintenances/${id}`, {
      method: "PUT",
      body: maintenanceData,
    });
  }

  async deleteMaintenance(id) {
    return await this.request(`/maintenances/${id}`, {
      method: "DELETE",
    });
  }

  /* ------------ COSTS ------------ */

  async getCosts() {
    return await this.request("/costs", { method: "GET" });
  }

  async addCost(costData) {
    return await this.request("/costs", {
      method: "POST",
      body: costData,
    });
  }
  async updateCost(id, costData) {
    return await this.request(`/costs/${id}`, {
      method: "PUT",
      body: costData,
    });
  }
  async deleteCost(id) {
    return await this.request(`/costs/${id}`, {
      method: "DELETE",
    });
  }
  /* ------------ NOTIFICATION RECIPIENTS ------------ */

  // Φέρνει όλους τους παραλήπτες ειδοποιήσεων για μια εταιρία
  async getNotificationRecipients(companyId) {
    return await this.request(`/notification-recipients/${companyId}`, {
      method: "GET",
    });
  }

  // Προσθέτει νέο παραλήπτη ειδοποιήσεων
  async addNotificationRecipient(recipientData) {
    return await this.request("/notification-recipients", {
      method: "POST",
      body: recipientData,
    });
  }

  /* ------------ INTEREST FORM ------------ */

  async sendInterest(formData) {
    return await this.request("/interest", {
      method: "POST",
      body: formData,
    });
  }
}

const api = new API();
window.api = api;
