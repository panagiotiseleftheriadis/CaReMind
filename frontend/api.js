// frontend/api.js

class API {
  // Προσθέστε αυτό το έλεγχο στο api.js στο constructor:
  constructor() {
    this.baseURL = "https://caremind-bzv3.onrender.com/api";
    this.token = localStorage.getItem("authToken");

    // Έλεγχος αν ο χρήστης είναι συνδεδεμένος
    if (!this.token) {
      console.warn("⚠️ No auth token found in localStorage");
      // Μπορείτε να ανακατευθύνετε στη σελίδα login
      // window.location.href = "login.html";
    }
  }

  /* ------------ Token helpers ------------ */

  setToken(token) {
    this.token = token;
    if (token) {
      localStorage.setItem("authToken", token);
    } else {
      localStorage.removeItem("authToken");
    }
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

  /* ------------ Βασική μέθοδος request ------------ */

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;

    const response = await fetch(url, options);

    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    const data = isJson ? await response.json() : await response.text();

    if (!response.ok) {
      console.error("API failed:", response.status, data);
      throw new Error(
        typeof data === "string"
          ? data
          : data.error || `HTTP ${response.status}`
      );
    }

    return data;
  }

  // // ADMIN USERS
  // async createUser(data) {
  //   return this.request("/users", {
  //     method: "POST",
  //     body: data,
  //   });
  // }

  // async getUsers() {
  //   return this.request("/users", {
  //     method: "GET",
  //   });
  // }

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

  async updateMaintenance(id, data) {
    return this.request(`/maintenances/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
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
