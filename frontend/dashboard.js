// dashboard.js - Συνδεδεμένο με backend μέσω api.js

class DashboardManager {
  constructor() {
    // API instance από το api.js (αν έχει φορτωθεί)
    this.api = window.api || null;

    // Σύστημα ειδοποιήσεων (από notifications.js, αν υπάρχει)
    this.notificationSystem =
      typeof NotificationSystem === "function"
        ? new NotificationSystem()
        : null;

    this.charts = {
      costsChart: null,
      maintenanceChart: null,
    };

    this.vehicles = [];
    this.maintenance = [];
    this.costs = [];

    this._eventsBound = false;
    this.refreshInterval = null;

    this.init();
  }

  /* ================== INIT ================== */

  async init() {
    console.log("📊 DashboardManager initialized");

    await this.loadDashboardData();
    this.updateCompanyName(); // 🔥 ΠΡΟΣΤΕΘΗΚΕ ΕΔΩ
    this.setupCharts();
    this.setupEventListeners();
    this.updateActivityFeed();
    this.updateNotifications();
    this.setupNotificationSystem();

    // Αυτόματη ανανέωση κάθε 30 δευτερόλεπτα
    this.refreshInterval = setInterval(() => this.refreshDashboard(), 30_000);
  }

  async refreshDashboard() {
    await this.loadDashboardData();
    this.updateCharts(this.vehicles, this.maintenance, this.costs);
    this.updateActivityFeed();
    this.updateNotifications();
  }

  /* ================== DATA LOADING ================== */

  async loadDashboardData() {
    const user = JSON.parse(localStorage.getItem("currentUser"));
    if (!user) {
      console.warn("❌ Δεν βρέθηκε currentUser στο localStorage");
      return;
    }

    let vehicles = [];
    let maintenance = [];
    let costs = [];

    try {
      if (this.api) {
        console.log("🔗 Φόρτωση δεδομένων dashboard από backend...");

        const [vehiclesRes, maintenanceRes, costsRes] = await Promise.all([
          this.api.getVehicles(),
          this.api.getMaintenances(),
          this.api.getCosts(),
        ]);

        vehicles = this.normalizeList(vehiclesRes, "vehicles");
        maintenance = this.normalizeList(maintenanceRes, "maintenances");
        costs = this.normalizeList(costsRes, "costs");
      } else {
        console.warn(
          "⚠️ Δεν βρέθηκε API, χρήση localStorage για dashboard δεδομένα"
        );
        vehicles = JSON.parse(localStorage.getItem("vehicles")) || [];
        maintenance = JSON.parse(localStorage.getItem("maintenance")) || [];
        costs = JSON.parse(localStorage.getItem("costs")) || [];
      }
    } catch (error) {
      console.error(
        "❌ Σφάλμα φόρτωσης dashboard δεδομένων από backend:",
        error
      );
      this.showNotification(
        "Σφάλμα κατά τη φόρτωση δεδομένων του πίνακα ελέγχου από τον server",
        "error"
      );

      vehicles = JSON.parse(localStorage.getItem("vehicles")) || [];
      maintenance = JSON.parse(localStorage.getItem("maintenance")) || [];
      costs = JSON.parse(localStorage.getItem("costs")) || [];
    }

    const vehicleIds = new Set(vehicles.map((v) => v.id));

    // Κρατάμε μόνο εγγραφές που συνδέονται με οχήματα του χρήστη
    maintenance = maintenance.filter(
      (m) => !m.vehicleId || vehicleIds.has(m.vehicleId)
    );
    costs = costs.filter((c) => !c.vehicleId || vehicleIds.has(c.vehicleId));

    this.vehicles = vehicles;
    this.maintenance = maintenance;
    this.costs = costs;

    this.updateStats(vehicles, maintenance, costs);
  }

  normalizeList(data, key) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data[key])) return data[key];
    if (data && Array.isArray(data.data)) return data.data;
    return [];
  }

  /* ================== STATS ================== */
  updateCompanyName() {
    const user = JSON.parse(localStorage.getItem("currentUser"));
    if (!user) return;

    const companyNameEl = document.getElementById("companyName");
    if (companyNameEl) {
      companyNameEl.textContent = user.companyName || "Χωρίς Επωνυμία";
    }
  }

  updateStats(vehicles, maintenance, costs) {
    const totalVehiclesEl = document.getElementById("totalVehicles");
    if (totalVehiclesEl) totalVehiclesEl.textContent = vehicles.length;

    const today = new Date();
    const startOfToday = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );
    const nextWeek = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Επικείμενη συντήρηση (επόμενες 7 ημέρες)
    const pendingMaintenance = maintenance.filter((m) => {
      if (!m.nextDate || m.status === "completed") return false;
      const dueDate = new Date(m.nextDate);
      return dueDate >= startOfToday && dueDate <= nextWeek;
    }).length;

    const pendingEl = document.getElementById("pendingMaintenance");
    if (pendingEl) pendingEl.textContent = pendingMaintenance;

    // Μηνιαία κόστη (τρέχων μήνας)
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const monthlyCosts = costs
      .filter((cost) => {
        if (!cost.date) return false;
        const d = new Date(cost.date);
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
      })
      .reduce((sum, cost) => sum + (Number(cost.amount) || 0), 0);

    const monthlyCostsEl = document.getElementById("monthlyCosts");
    if (monthlyCostsEl)
      monthlyCostsEl.textContent = "€" + monthlyCosts.toFixed(2);

    // Εκπρόθεσμη συντήρηση
    const overdueMaintenance = maintenance.filter((m) => {
      if (!m.nextDate || m.status === "completed") return false;
      const dueDate = new Date(m.nextDate);
      return dueDate < startOfToday;
    }).length;

    const overdueEl = document.getElementById("overdueMaintenance");
    if (overdueEl) overdueEl.textContent = overdueMaintenance;

    console.log("📊 Stats updated", {
      vehicles: vehicles.length,
      pendingMaintenance,
      monthlyCosts,
      overdueMaintenance,
    });
  }

  /* ================== CHARTS ================== */

  setupCharts() {
    const costsCtx = document.getElementById("costsChart");
    const maintenanceCtx = document.getElementById("maintenanceChart");

    if (costsCtx && window.Chart) {
      this.charts.costsChart = new Chart(costsCtx, {
        type: "doughnut",
        data: {
          labels: [
            "Καύσιμα",
            "Συντήρηση",
            "Ασφάλεια",
            "Επισκευές",
            "Τέλη",
            "Άλλο",
          ],
          datasets: [
            {
              data: [0, 0, 0, 0, 0, 0],
              backgroundColor: [
                "#FF6384",
                "#36A2EB",
                "#FFCE56",
                "#4BC0C0",
                "#9966FF",
                "#FF9F40",
              ],
              borderWidth: 1,
            },
          ],
        },
        options: {
          responsive: true,
          plugins: {
            legend: { position: "bottom" },
          },
        },
      });
    }

    if (maintenanceCtx && window.Chart) {
      this.charts.maintenanceChart = new Chart(maintenanceCtx, {
        type: "bar",
        data: {
          labels: ["Λάδια", "Σέρβις", "ΚΤΕΟ", "Ασφάλεια", "Λάστιχα", "Άλλο"],
          datasets: [
            {
              label: "Πλήθος",
              data: [0, 0, 0, 0, 0, 0],
              backgroundColor: "#3498db",
              borderColor: "#2980b9",
              borderWidth: 1,
            },
          ],
        },
        options: {
          responsive: true,
          scales: {
            y: { beginAtZero: true },
          },
        },
      });
    }

    // Αρχική ενημέρωση αν υπάρχουν ήδη δεδομένα
    if (this.vehicles.length || this.maintenance.length || this.costs.length) {
      this.updateCharts(this.vehicles, this.maintenance, this.costs);
    }
  }

  updateCharts(vehicles, maintenance, costs) {
    // Κόστη ανά κατηγορία
    if (this.charts.costsChart) {
      const costsByCategory = this.getCostsByCategory(costs);
      this.charts.costsChart.data.datasets[0].data = [
        costsByCategory.fuel || 0,
        costsByCategory.maintenance || 0,
        costsByCategory.insurance || 0,
        costsByCategory.repair || 0,
        costsByCategory.taxes || 0,
        costsByCategory.other || 0,
      ];
      this.charts.costsChart.update("none");
    }

    // Συντηρήσεις ανά τύπο
    if (this.charts.maintenanceChart) {
      const maintenanceByType = this.getMaintenanceByType(maintenance);
      this.charts.maintenanceChart.data.datasets[0].data = [
        maintenanceByType.oil || 0,
        maintenanceByType.service || 0,
        maintenanceByType.kteo || 0,
        maintenanceByType.insurance || 0,
        maintenanceByType.tires || 0,
        maintenanceByType.other || 0,
      ];
      this.charts.maintenanceChart.update("none");
    }

    console.log("📈 Charts updated");
  }

  getCostsByCategory(costs) {
    const categories = {};
    costs.forEach((cost) => {
      const raw = String(cost.category || "other")
        .trim()
        .toLowerCase();
      const key = [
        "fuel",
        "maintenance",
        "insurance",
        "repair",
        "taxes",
      ].includes(raw)
        ? raw
        : "other";

      categories[key] = (categories[key] || 0) + (Number(cost.amount) || 0);
    });
    return categories;
  }

  getMaintenanceByType(maintenance) {
    const types = {};
    maintenance.forEach((item) => {
      const raw = String(item.maintenanceType || "other")
        .trim()
        .toLowerCase();
      const key = ["oil", "service", "kteo", "insurance", "tires"].includes(raw)
        ? raw
        : "other";

      types[key] = (types[key] || 0) + 1;
    });
    return types;
  }

  /* ================== ACTIVITY FEED ================== */

  updateActivityFeed() {
    const activityList = document.getElementById("recentActivity");
    if (!activityList) return;

    const user = JSON.parse(localStorage.getItem("currentUser"));
    if (!user) {
      activityList.innerHTML = `
        <div class="activity-item">
          <div class="activity-content">
            <div class="activity-message">Δεν βρέθηκε συνδεδεμένος χρήστης</div>
          </div>
        </div>
      `;
      return;
    }

    const vehicles = this.vehicles;
    const maintenance = this.maintenance;
    const costs = this.costs;

    const allActivities = [];

    // Συντηρήσεις
    maintenance.forEach((item) => {
      const vehicle = vehicles.find((v) => v.id === item.vehicleId);
      if (!vehicle) return;

      allActivities.push({
        type: "maintenance",
        message: `Συντήρηση ${this.getMaintenanceTypeLabel(
          item.maintenanceType
        )} για ${vehicle.vehicleType} ${vehicle.model || ""}`,
        time: item.createdAt || item.date || new Date().toISOString(),
      });
    });

    // Κόστη
    costs.forEach((cost) => {
      const vehicle = vehicles.find((v) => v.id === cost.vehicleId);
      if (!vehicle) return;

      allActivities.push({
        type: "cost",
        message: `Κόστος €${(Number(cost.amount) || 0).toFixed(2)} για ${
          vehicle.vehicleType
        } ${vehicle.model || ""}`,
        time: cost.date || new Date().toISOString(),
      });
    });

    // Οχήματα
    vehicles.forEach((vehicle) => {
      allActivities.push({
        type: "vehicle",
        message: `Προστέθηκε νέο όχημα: ${vehicle.vehicleType} ${
          vehicle.model || ""
        }`,
        time: vehicle.createdAt || new Date().toISOString(),
      });
    });

    // Ταξινόμηση - πιο πρόσφατα πρώτα
    allActivities.sort((a, b) => new Date(b.time) - new Date(a.time));

    const recentActivities = allActivities.slice(0, 5);

    if (!recentActivities.length) {
      activityList.innerHTML = `
        <div class="activity-item">
          <div class="activity-content">
            <div class="activity-message">Δεν υπάρχει πρόσφατη δραστηριότητα</div>
            <div class="activity-time">Προσθέστε οχήματα, συντήρηση ή κόστη</div>
          </div>
        </div>
      `;
      return;
    }

    activityList.innerHTML = recentActivities
      .map(
        (activity) => `
        <div class="activity-item">
          <div class="activity-content">
            <div class="activity-message">${activity.message}</div>
            <div class="activity-time">${this.formatTime(activity.time)}</div>
          </div>
          <span class="activity-type ${activity.type}">
            ${this.getActivityTypeLabel(activity.type)}
          </span>
        </div>
      `
      )
      .join("");
  }

  getActivityTypeLabel(type) {
    const labels = {
      maintenance: "Συντήρηση",
      cost: "Κόστος",
      vehicle: "Όχημα",
    };
    return labels[type] || type;
  }

  getMaintenanceTypeLabel(type) {
    const labels = {
      oil: "Αλλαγή Λαδιών",
      service: "Γενικό Service",
      tires: "Αλλαγή Λάστιχων",
      brakes: "Φρένα",
      battery: "Μπαταρία",
      filters: "Φίλτρα",
      coolant: "Ψυκτικό Υγρό",
      transmission: "Κιβώτιο Ταχυτήτων",
      ac_service: "Service A/C",
      spark_plugs: "Μπουζί",
      timing_belt: "Ιμάντας Χρονισμού",
      insurance: "Ασφάλιση",
      kteo: "ΚΤΕΟ",
      other: "Άλλο",
    };
    const key = String(type || "other")
      .trim()
      .toLowerCase();
    return labels[key] || labels.other;
  }

  formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Μόλις τώρα";
    if (diffMins < 60) return `${diffMins} λεπτά πριν`;
    if (diffHours < 24) return `${diffHours} ώρες πριν`;
    if (diffDays < 7) return `${diffDays} μέρες πριν`;
    return date.toLocaleDateString("el-GR");
  }

  /* ================== NOTIFICATIONS ================== */

  updateNotifications() {
    const badge = document.getElementById("notificationCount");
    if (!badge) return;

    const unread = this.notificationSystem
      ? this.notificationSystem.getUnreadCount()
      : 0;

    badge.textContent = unread;
  }

  setupNotificationSystem() {
    if (
      this.notificationSystem &&
      typeof this.notificationSystem.requestNotificationPermission ===
        "function"
    ) {
      this.notificationSystem.requestNotificationPermission();
    }
  }

  showNotificationModal() {
    const modal = document.getElementById("notificationModal");
    const list = document.getElementById("notificationList");
    if (!modal || !list) return;

    if (!this.notificationSystem) {
      list.innerHTML = `
        <div class="notification-modal-item">
          <div class="notification-content">
            <div class="notification-message">Δεν υπάρχουν διαθέσιμες ειδοποιήσεις</div>
          </div>
        </div>
      `;
      modal.style.display = "flex";
      return;
    }

    list.innerHTML = this.notificationSystem.notifications
      .map(
        (notification) => `
        <div class="notification-modal-item ${
          notification.read ? "read" : "unread"
        }">
          <div class="notification-priority ${notification.priority}"></div>
          <div class="notification-content">
            <div class="notification-message">${notification.message}</div>
            <div class="notification-details">
              <span class="notification-type">${
                notification.maintenanceType || ""
              }</span>
              <span class="notification-time">${this.formatTime(
                notification.timestamp
              )}</span>
            </div>
          </div>
          ${
            !notification.read
              ? `<button class="mark-read-btn" onclick="markNotificationAsRead(${notification.id})">
                    Σημείωση ως αναγνωσμένη
                 </button>`
              : ""
          }
        </div>
      `
      )
      .join("");

    modal.style.display = "flex";
  }

  /* ================== EVENTS / ACTION BUTTONS ================== */

  setupEventListeners() {
    if (this._eventsBound) return;
    this._eventsBound = true;

    // Καμπανάκι ειδοποιήσεων
    const notificationBell = document.getElementById("notificationBell");
    if (notificationBell) {
      notificationBell.addEventListener("click", () =>
        this.showNotificationModal()
      );
    }

    // Logout
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", (e) => {
        e.preventDefault();
        this.handleLogout();
      });
    }

    // Γρήγορες ενέργειες
    const addVehicleBtn = document.getElementById("addVehicleBtn");
    if (addVehicleBtn) {
      addVehicleBtn.addEventListener("click", () =>
        this.openVehiclesWithModal()
      );
    }

    const addMaintenanceBtn = document.getElementById("addMaintenanceBtn");
    if (addMaintenanceBtn) {
      addMaintenanceBtn.addEventListener("click", () =>
        this.openMaintenanceWithModal()
      );
    }

    const addCostBtn = document.getElementById("addCostBtn");
    if (addCostBtn) {
      addCostBtn.addEventListener("click", () => this.openCostsWithModal());
    }
  }

  openVehiclesWithModal() {
    window.location.href = "vehicles.html";
  }

  openMaintenanceWithModal() {
    window.location.href = "maintenance.html";
  }

  openCostsWithModal() {
    window.location.href = "costs.html";
  }

  handleLogout() {
    localStorage.removeItem("currentUser");
    localStorage.removeItem("authToken");
    window.location.href = "index.html";
  }

  /* ================== TOAST NOTIFICATIONS ================== */

  showNotification(message, type = "info") {
    // Απλό toast, ίδιο στυλ με άλλα modules
    const containerId = "toastContainer";
    let container = document.getElementById(containerId);

    if (!container) {
      container = document.createElement("div");
      container.id = containerId;
      container.className = "toast-container";
      document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-message">${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add("toast-hide");
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}

/* ================== GLOBAL HELPERS ================== */

function markNotificationAsRead(notificationId) {
  if (!window.dashboardManager || !dashboardManager.notificationSystem) return;
  dashboardManager.notificationSystem.markAsRead(notificationId);
  dashboardManager.updateNotifications();
}

function closeNotificationModal() {
  const modal = document.getElementById("notificationModal");
  if (modal) modal.style.display = "none";
}

// Initialize dashboard
let dashboardManager;
document.addEventListener("DOMContentLoaded", function () {
  dashboardManager = new DashboardManager();
  window.dashboardManager = dashboardManager;
});
