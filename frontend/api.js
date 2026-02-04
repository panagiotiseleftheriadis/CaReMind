// frontend/api.js

class API {
  constructor() {
    // Βεβαιώσου ότι αυτό είναι το σωστό URL του backend σου
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

  /* ------------ Βασική μέθοδος request (ΔΙΟΡΘΩΜΕΝΗ) ------------ */

  async request(endpoint, options = {}, isRetry = false) {
    const url = `${this.baseURL}${endpoint}`;
    
    // 🔥 ΕΔΩ ΗΤΑΝ ΤΟ ΛΑΘΟΣ ΣΟΥ: Λείπει το credentials: "include"
    const config = {
      method: options.method || "GET",
      headers: this.getHeaders(),
      credentials: "include", // ✅ ΑΠΑΡΑΙΤΗΤΟ ΓΙΑ ΝΑ ΔΕΧΤΕΙ ΤΟ COOKIE O BROWSER
    };

    if (options.body) {
      config.body = JSON.stringify(options.body);
    }

    try {
      let response = await fetch(url, config);

      // --- ΛΟΓΙΚΗ AUTO-REFRESH (Που έλειπε από το αρχείο σου) ---
      if (response.status === 401 && !isRetry) {
        try {
          console.log("🔄 Token expired. Attempting refresh...");
          await this.refreshToken();
          
          // Ξαναδοκιμάζουμε με το νέο token
          config.headers = this.getHeaders();
          response = await fetch(url, config);
        } catch (refreshError) {
          console.error("Refresh failed:", refreshError);
          this.accessToken = null;
          localStorage.removeItem("currentUser");
          
          // Redirect στο login αν δεν είμαστε ήδη εκεί
          const isAuthPage = window.location.pathname.endsWith("index.html") || 
                             window.location.pathname.endsWith("login.html") ||
                             window.location.pathname.endsWith("register.html");
          if (!isAuthPage) {
             window.location.href = "index.html"; 
          }
          throw refreshError;
        }
      }
      // --------------------------------------------------------

      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (e) {
        console.error("JSON parse error:", e);
      }

      if (!response.ok) {
        const err = new Error((data && (data.message || data.error)) || `Status ${response.status}`);
        if (data && data.code) err.code = data.code;
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

  async login(username, password) {
    const response = await this.request("/login", {
      method: "POST",
      body: { username, password },
    });

    if (response.accessToken) {
      this.setToken(response.accessToken);
    } else if (response.token) {
        // Fallback για παλιά response structure αν υπάρχει
        this.setToken(response.token);
    }
    return response; 
  }

  async logout() {
    try {
        await this.request("/logout", { method: "POST" });
    } catch (e) { console.warn("Logout failed remotely"); }
    
    this.accessToken = null;
    localStorage.removeItem("currentUser");
    window.location.href = "index.html";
  }

  // ✅ Η μέθοδος που καλείται αυτόματα
  async refreshToken() {
    const response = await fetch(`${this.baseURL}/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include", // ✅ ΑΠΑΡΑΙΤΗΤΟ
    });

    if (!response.ok) throw new Error("Refresh failed");
    
    const data = await response.json();
    if (data.accessToken) {
      this.setToken(data.accessToken);
      return data;
    }
    throw new Error("No token returned");
  }

  /* ------------ EXISTING METHODS (USERS, VEHICLES, ETC) ------------ */
  // Κράτα τα υπόλοιπα ίδια, απλά σιγουρέψου ότι χρησιμοποιούν το this.request
  
  async createUser(data) { return this.request("/users", { method: "POST", body: data }); }
  async getUsers() { return this.request("/users", { method: "GET" }); }
  async updateUser(id, updates) { return this.request(`/users/${id}`, { method: "PUT", body: updates }); }
  async deleteUser(id) { return this.request(`/users/${id}`, { method: "DELETE" }); }

  async register(data) { return this.request("/register", { method: "POST", body: data }); }
  async verifyEmail(email, code) { return this.request("/verify-email", { method: "POST", body: { email, code } }); }
  async resendVerification(email) { return this.request("/resend-verification", { method: "POST", body: { email } }); }
  async forgotPassword(email) { return this.request("/forgot-password", { method: "POST", body: { email } }); }
  async verifyResetCode(email, code) { return this.request("/verify-reset-code", { method: "POST", body: { email, code } }); }
  async resetPassword(token, pass) { return this.request("/reset-password", { method: "POST", body: { resetToken: token, newPassword: pass } }); }
  
  async getAccountMe() { return this.request("/account/me", { method: "GET" }); }
  
  // Οχήματα, Κόστη, Συντηρήσεις κλπ...
  async getVehicles() { return this.request("/vehicles", { method: "GET" }); }
  async addVehicle(d) { return this.request("/vehicles", { method: "POST", body: d }); }
  async updateVehicle(id, d) { return this.request(`/vehicles/${id}`, { method: "PUT", body: d }); }
  async deleteVehicle(id) { return this.request(`/vehicles/${id}`, { method: "DELETE" }); }
  
  async getMaintenances() { return this.request("/maintenances", { method: "GET" }); }
  async addMaintenance(d) { return this.request("/maintenances", { method: "POST", body: d }); }
  async updateMaintenance(id, d) { return this.request(`/maintenances/${id}`, { method: "PUT", body: d }); }
  async deleteMaintenance(id) { return this.request(`/maintenances/${id}`, { method: "DELETE" }); }

  async getCosts() { return this.request("/costs", { method: "GET" }); }
  async addCost(d) { return this.request("/costs", { method: "POST", body: d }); }
  async updateCost(id, d) { return this.request(`/costs/${id}`, { method: "PUT", body: d }); }
  async deleteCost(id) { return this.request(`/costs/${id}`, { method: "DELETE" }); }
  
  async getNotifications() { return this.request("/notifications", { method: "GET" }); }
  async getNotificationRecipients(cid) { return this.request(`/notification-recipients/${cid}`, { method: "GET" }); }
  async addNotificationRecipient(d) { return this.request("/notification-recipients", { method: "POST", body: d }); }
  async sendInterest(d) { return this.request("/interest", { method: "POST", body: d }); }
}

const api = new API();
window.api = api;