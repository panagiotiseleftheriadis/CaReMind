// frontend/api.js

class API {
  constructor() {
    // ΣΗΜΕΙΩΣΗ: Άλλαξε το URL αν τρέχεις τοπικά (π.χ. "http://localhost:3000/api")
    // Τώρα είναι ρυθμισμένο στο production URL που είχες.
    this.baseURL = "https://caremind-bzv3.onrender.com/api";
    
    // Το token αποθηκεύεται ΜΟΝΟ στη μνήμη (RAM), όχι στο localStorage
    this.accessToken = null; 
  }

  /* ------------ Token helpers ------------ */

  setToken(token) {
    this.accessToken = token;
  }

  getToken() {
    return this.accessToken;
  }

  removeToken() {
    this.accessToken = null;
  }

  getHeaders() {
    const headers = {
      "Content-Type": "application/json",
    };
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }
    return headers;
  }

  /* ------------ Βασική μέθοδος request (με Auto-Refresh) ------------ */

  async request(endpoint, options = {}, isRetry = false) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      method: options.method || "GET",
      headers: this.getHeaders(),
      credentials: "include", // ✅ ΣΗΜΑΝΤΙΚΟ: Επιτρέπει την αποστολή cookies (Refresh Token)
    };

    if (options.body) {
      config.body = JSON.stringify(options.body);
    }

    try {
      let response = await fetch(url, config);

      // --- ΛΟΓΙΚΗ ΑΥΤΟΜΑΤΗΣ ΑΝΑΝΕΩΣΗΣ (INTERCEPTOR) ---
      // Αν πάρουμε 401 Unauthorized και δεν είναι ήδη προσπάθεια επαανάληψης (retry)
      if (response.status === 401 && !isRetry) {
        try {
          console.log("🔄 Access token expired. Refreshing...");
          await this.refreshToken();
          
          // Αν το refresh πετύχει, ενημερώνουμε τα headers με το νέο token
          config.headers = this.getHeaders();
          // Ξανακάνουμε το αρχικό request
          response = await fetch(url, config);
        } catch (refreshError) {
          console.error("Session expired completely.", refreshError);
          // Αν αποτύχει και το refresh, ο χρήστης πρέπει να κάνει login
          this.setToken(null);
          localStorage.removeItem("currentUser"); // Καθαρίζουμε και τα user data
          
          // Redirect στο login (αν δεν είμαστε ήδη εκεί)
          const isAuthPage = window.location.pathname.endsWith("index.html") || 
                             window.location.pathname.endsWith("login.html") ||
                             window.location.pathname.endsWith("register.html");
                             
          if (!isAuthPage) {
             window.location.href = "index.html"; 
          }
          throw refreshError;
        }
      }
      // --------------------------------------------------

      const text = await response.text();

      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (e) {
        console.error("JSON parse error:", e, text);
      }

      if (!response.ok) {
        const err = new Error(
          (data && (data.message || data.error)) ||
            `Request failed with status ${response.status}`
        );
        if (data && data.code) {
          err.code = data.code;
        }
        err.status = response.status;
        throw err;
      }

      return data;
    } catch (error) {
      console.error("API Error:", error);
      throw error;
    }
  }

  /* ------------ AUTH Methods ------------ */

  // ΝΕΟ: Login που αποθηκεύει το token στη μνήμη
  async login(username, password) {
    const response = await this.request("/login", {
      method: "POST",
      body: { username, password },
    });

    // Το backend επιστρέφει { accessToken, user }
    if (response.accessToken) {
      this.setToken(response.accessToken);
    }

    return response; 
  }

  // ΝΕΟ: Logout που καλεί το server για να καθαρίσει το cookie
  async logout() {
    try {
        await this.request("/logout", { method: "POST" });
    } catch (e) {
        console.warn("Logout request failed, clearing local state anyway");
    }
    this.removeToken();
    localStorage.removeItem("currentUser");
    window.location.href = "index.html";
  }

  // ΝΕΟ: Refresh Token Method
  async refreshToken() {
    // Κάνει POST στο /refresh. Ο browser στέλνει αυτόματα το HttpOnly cookie.
    // Χρησιμοποιούμε fetch απευθείας για να αποφύγουμε λούπα στο request()
    const response = await fetch(`${this.baseURL}/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include", 
    });

    if (!response.ok) {
      throw new Error("Refresh failed");
    }

    const data = await response.json();
    if (data.accessToken) {
      this.setToken(data.accessToken);
      return data;
    } else {
      throw new Error("No access token returned");
    }
  }

  /* ------------ USERS (ADMIN) ------------ */

  async createUser({ username, password, companyName, email, userNumber }) {
    return this.request("/users", {
      method: "POST",
      body: { username, password, companyName, email, userNumber },
    });
  }

  async getUsers() {
    return this.request("/users", { method: "GET" });
  }

  async updateUser(id, updates) {
    return this.request(`/users/${id}`, {
      method: "PUT",
      body: updates,
    });
  }

  async deleteUser(id) {
    return this.request(`/users/${id}`, {
      method: "DELETE",
    });
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

  /* ------------ NOTIFICATIONS ------------ */
  
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

  async getNotificationRecipients(companyId) {
    return await this.request(`/notification-recipients/${companyId}`, {
      method: "GET",
    });
  }

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