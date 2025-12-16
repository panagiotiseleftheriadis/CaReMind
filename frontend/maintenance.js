// maintenance.js - Συνδεδεμένο με backend μέσω api.js

class MaintenanceManager {
  constructor() {
    // API instance από το api.js
    this.api = window.api || null;

    // Δεδομένα από backend
    this.maintenance = [];
    this.vehicles = [];

    this.currentEditingId = null;
    this.filteredMaintenance = [];
    this._buttonsBound = false;
    this._eventsBound = false;
    this._submitting = false;

    this.init();
  }

  async init() {
    console.log("🔧 MaintenanceManager initialized (με backend)");

    // Φόρτωση οχημάτων & συντηρήσεων από backend ή fallback σε localStorage
    await this.loadInitialData();

    this.setupEventListeners();
    this.setupModalEvents();
    this.setupButtonEvents();
  }

  async loadInitialData() {
    await this.fetchVehicles();
    await this.fetchMaintenances();

    this.loadVehicleFilter();
    this.loadMaintenanceData();
  }

  /* ================== BACKEND FETCHES ================== */

  async fetchVehicles() {
    try {
      if (!this.api) {
        console.error(
          "❌ Δεν υπάρχει API instance – δεν μπορώ να φορτώσω οχήματα"
        );
        this.vehicles = [];
        return;
      }

      const data = await this.api.getVehicles();
      let list = [];

      if (Array.isArray(data)) {
        list = data;
      } else if (data && Array.isArray(data.vehicles)) {
        list = data.vehicles;
      } else if (data && Array.isArray(data.data)) {
        list = data.data;
      }

      this.vehicles = list;
      console.log("🚗 Vehicles from backend (maintenance):", this.vehicles);
    } catch (error) {
      console.error("❌ Σφάλμα φόρτωσης vehicles από backend:", error);
      this.showNotification(
        "Σφάλμα κατά τη φόρτωση οχημάτων από τον server",
        "error"
      );
      this.vehicles = [];
    }
  }

  async fetchMaintenances() {
    try {
      if (!this.api) {
        console.error(
          "❌ Δεν υπάρχει API instance – δεν μπορώ να φορτώσω συντηρήσεις"
        );
        this.maintenance = [];
        return;
      }

      const data = await this.api.getMaintenances();
      let list = [];

      if (Array.isArray(data)) {
        list = data;
      } else if (data && Array.isArray(data.maintenances)) {
        list = data.maintenances;
      } else if (data && Array.isArray(data.data)) {
        list = data.data;
      }

      this.maintenance = list;
      console.log("🔧 Maintenance from backend:", this.maintenance);
    } catch (error) {
      console.error("❌ Σφάλμα φόρτωσης συντηρήσεων από backend:", error);
      this.showNotification(
        "Σφάλμα κατά τη φόρτωση συντηρήσεων από τον server",
        "error"
      );
      this.maintenance = [];
    }
  }

  async reloadMaintenances() {
    await this.fetchMaintenances();
    this.loadMaintenanceData();
  }

  /* ================== LOAD / HELPERS ================== */

  loadVehicleFilter() {
    const user = JSON.parse(localStorage.getItem("currentUser"));
    const allVehicles = this.vehicles || [];

    const vehicles = user
      ? allVehicles.filter((v) => v.companyId == user.companyId)
      : allVehicles;

    const vehicleSelects = ["maintenanceVehicle", "vehicleFilter"];

    vehicleSelects.forEach((selectId) => {
      const select = document.getElementById(selectId);
      if (!select) return;

      const isFilter = selectId === "vehicleFilter";
      select.innerHTML = isFilter
        ? '<option value="all">Όλα τα οχήματα</option>'
        : '<option value="">Επιλέξτε όχημα</option>';

      vehicles.forEach((vehicle) => {
        const option = document.createElement("option");
        option.value = vehicle.id;
        option.textContent = `${vehicle.vehicleType} - ${vehicle.model} (${vehicle.chassisNumber})`;
        select.appendChild(option);
      });
    });
  }

  getVehicleById(id) {
    const user = JSON.parse(localStorage.getItem("currentUser"));
    let vehicles = this.vehicles || [];

    if (user) {
      vehicles = vehicles.filter((v) => v.companyId == user.companyId);
    }

    const fromState = vehicles.find((v) => v.id == id);
    if (fromState) return fromState;

    // Fallback σε database.js αν υπάρχει
    if (window.db && typeof db.getVehicleById === "function") {
      return db.getVehicleById(id) || null;
    }

    // Χωρίς fallback σε localStorage πλέον
    return null;
  }

  loadMaintenanceData() {
    const user = JSON.parse(localStorage.getItem("currentUser"));

    const allVehicles = this.vehicles || [];
    const userVehicles = user
      ? allVehicles.filter((v) => v.companyId == user.companyId)
      : allVehicles;

    const vehicleIds = new Set(userVehicles.map((v) => v.id));

    const userMaintenances = this.maintenance.filter((m) =>
      vehicleIds.has(m.vehicleId)
    );

    this.filteredMaintenance = this.sortMaintenancesForDisplay(
      userMaintenances,
      userVehicles
    );

    this.renderMaintenanceTable(this.filteredMaintenance, userVehicles);
    this.renderUpcomingMaintenance(userMaintenances, userVehicles);
    this.updateSummaryCards(this.filteredMaintenance);
  }

  updateSummaryCards(maintenanceData) {
    const total = maintenanceData.length;

    const upcoming = maintenanceData.filter(
      (m) => this.getMaintenanceStatus(m) === "upcoming"
    ).length;
    const overdue = maintenanceData.filter(
      (m) => this.getMaintenanceStatus(m) === "overdue"
    ).length;
    const completed = maintenanceData.filter(
      (m) => m.status === "completed"
    ).length;

    const setText = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(val);
    };

    setText("pendingCount", upcoming);
    setText("overdueCount", overdue);
    setText("completedCount", completed);
    setText("totalCount", total);
  }

  getMaintenanceStatus(item) {
    if (item.status === "completed") return "completed";

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (item.nextDate) {
      const dueDate = new Date(item.nextDate);
      dueDate.setHours(0, 0, 0, 0);
      const diffDays = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));

      if (diffDays < 0) return "overdue";
      if (diffDays <= 7) return "upcoming";
    }

    const vehicle = this.getVehicleById(item.vehicleId);
    const currentMileage =
      vehicle && vehicle.currentMileage != null
        ? Number(vehicle.currentMileage)
        : null;

    if (item.nextMileage != null && currentMileage != null) {
      const diffKm = Number(item.nextMileage) - currentMileage;
      if (diffKm < 0) return "overdue";
      if (diffKm <= 500) return "upcoming";
    }

    if (!item.nextDate && !item.nextMileage) {
      return "overdue";
    }

    return "pending";
  }
  sortMaintenancesForDisplay(list, vehicles) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const toDate = (d) => {
      if (!d) return null;
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      return x;
    };

    const dateDiffDays = (d) => {
      const dt = toDate(d);
      if (!dt) return null;
      return Math.ceil((dt - today) / (1000 * 60 * 60 * 24)); // αρνητικό = καθυστέρηση
    };

    const getLastActivityDate = (m) => {
      // Για "Σε εξέλιξη" (pending) βάζουμε ως βάση: lastDate αν υπάρχει, αλλιώς created/updated αν έχεις, αλλιώς null
      // (στο δικό σου μοντέλο βλέπω lastDate/nextDate/completedDate)
      return (
        toDate(m.lastDate) ||
        toDate(m.nextDate) ||
        toDate(m.completedDate) ||
        null
      );
    };

    const groupRank = (status) => {
      // 1) overdue, 2) upcoming, 3) pending, 4) completed
      if (status === "overdue") return 0;
      if (status === "upcoming") return 1;
      if (status === "pending") return 2;
      return 3; // completed
    };

    return [...list].sort((a, b) => {
      const sa = this.getMaintenanceStatus(a);
      const sb = this.getMaintenanceStatus(b);

      const ga = groupRank(sa);
      const gb = groupRank(sb);

      // Πρώτα με βάση την ομάδα
      if (ga !== gb) return ga - gb;

      // Μέσα στην ίδια ομάδα:
      // A) overdue: αυτό που έχει καθυστερήσει περισσότερο πρώτα (πιο αρνητικό diffDays)
      if (sa === "overdue") {
        const da = dateDiffDays(a.nextDate);
        const db = dateDiffDays(b.nextDate);

        // Αν και οι δύο έχουν nextDate
        if (da != null && db != null) return da - db; // -10 πριν από -3
        // Αν λείπει nextDate, το θεωρούμε "χειρότερο" και το φέρνουμε πάνω
        if (da == null && db != null) return -1;
        if (da != null && db == null) return 1;

        // fallback: με βάση χλμ (αν υπάρχει)
        const va = vehicles.find((v) => v.id === a.vehicleId);
        const vb = vehicles.find((v) => v.id === b.vehicleId);
        const kmA =
          a.nextMileage != null && va?.currentMileage != null
            ? Number(a.nextMileage) - Number(va.currentMileage)
            : null;
        const kmB =
          b.nextMileage != null && vb?.currentMileage != null
            ? Number(b.nextMileage) - Number(vb.currentMileage)
            : null;

        if (kmA != null && kmB != null) return kmA - kmB; // πιο αρνητικό (=πιο πολύ καθυστέρηση) πρώτα
      }

      // B) upcoming: αυτό που είναι πιο κοντά πρώτα (μικρότερο diffDays, π.χ. 1 πριν από 5)
      if (sa === "upcoming") {
        const da = dateDiffDays(a.nextDate);
        const db = dateDiffDays(b.nextDate);

        if (da != null && db != null) return da - db;
        if (da == null && db != null) return 1;
        if (da != null && db == null) return -1;

        // fallback χλμ: μικρότερα kmUntilDue πρώτα
        const va = vehicles.find((v) => v.id === a.vehicleId);
        const vb = vehicles.find((v) => v.id === b.vehicleId);
        const kmA =
          a.nextMileage != null && va?.currentMileage != null
            ? Number(a.nextMileage) - Number(va.currentMileage)
            : null;
        const kmB =
          b.nextMileage != null && vb?.currentMileage != null
            ? Number(b.nextMileage) - Number(vb.currentMileage)
            : null;

        if (kmA != null && kmB != null) return kmA - kmB;
      }

      // C) pending (σε εξέλιξη): πιο πρόσφατη πρώτα (με βάση lastDate/nextDate/completedDate fallback)
      if (sa === "pending") {
        const la = getLastActivityDate(a);
        const lb = getLastActivityDate(b);
        if (la && lb) return lb - la; // πιο πρόσφατο (=μεγαλύτερο) πρώτα
        if (la && !lb) return -1;
        if (!la && lb) return 1;
      }

      // D) completed: πιο πρόσφατα ολοκληρωμένες πρώτα (ή αν θες ανάποδα πες μου)
      if (sa === "completed") {
        const ca = toDate(a.completedDate) || toDate(a.lastDate);
        const cb = toDate(b.completedDate) || toDate(b.lastDate);
        if (ca && cb) return cb - ca;
        if (ca && !cb) return -1;
        if (!ca && cb) return 1;
      }

      // Τελικό fallback σταθερό: μεγαλύτερο id πρώτα
      return (Number(b.id) || 0) - (Number(a.id) || 0);
    });
  }

  formatDaysText(diffDays) {
    if (diffDays === 0) {
      return "Σήμερα";
    }

    if (diffDays < 0) {
      return `Καθυστέρηση: ${Math.abs(diffDays)} ημέρες`;
    }
    if (diffDays === 1) {
      return `Προ/μένη Συντήρηση: ${diffDays} ημέρα`;
    }

    return `Προ/μένη Συντήρηση: ${diffDays} ημέρες`;
  }

  getDueInfo(item, vehicle) {
    if (item.status === "completed") {
      const completionDate =
        item.completedDate ||
        item.lastDate ||
        new Date().toISOString().split("T")[0];

      return `
      <div class="maintenance-completed-date">
        Ολοκλήρωση Συντήρησης: ${new Date(completionDate).toLocaleDateString(
          "el-GR"
        )}
      </div>
    `;
    }

    let dueInfo = "";
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const formatElDate = (d) => new Date(d).toLocaleDateString("el-GR");

    if (item.nextDate) {
      const dueDate = new Date(item.nextDate);
      dueDate.setHours(0, 0, 0, 0);

      const diffDays = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
      const isOverdue = diffDays < 0;

      dueInfo += `
      <div class="maintenance-detail ${isOverdue ? "overdue-text" : ""}">
        Ημ/νια Συντήρησης: ${formatElDate(dueDate)}
      </div>
      <div class="maintenance-detail ${isOverdue ? "overdue-text" : ""}">
  ${this.formatDaysText(diffDays)}
</div>

    `;
    }

    if (item.nextMileage && vehicle.currentMileage) {
      const kmUntilDue =
        Number(item.nextMileage) - Number(vehicle.currentMileage);
      const isOverdueKm = kmUntilDue < 0;

      if (kmUntilDue !== 0) {
        dueInfo += `
        <div class="maintenance-detail ${isOverdueKm ? "overdue-text" : ""}">
          Χιλιόμετρα: ${kmUntilDue} χλμ
        </div>
      `;
      }
    }

    return (
      dueInfo ||
      `<div class="maintenance-detail overdue-text">Χωρίς ορισμένη επόμενη συντήρηση</div>`
    );
  }

  renderMaintenanceTable(maintenanceData, vehicles) {
    const table = document.getElementById("maintenanceTable");
    if (!table) {
      console.warn("Maintenance table not found");
      return;
    }

    table.innerHTML = "";

    if (!maintenanceData || maintenanceData.length === 0) {
      table.innerHTML = `
                <div class="empty-state">
                    <p>Δεν βρέθηκαν εγγραφές συντήρησης</p>
                    <button class="btn-primary" data-action="add">Προσθέστε την πρώτη συντήρηση</button>
                </div>
            `;
      return;
    }

    maintenanceData.forEach((item) => {
      const vehicle = vehicles.find((v) => v.id === item.vehicleId);
      if (!vehicle) return;

      const status = this.getMaintenanceStatus(item);
      const dueInfo = this.getDueInfo(item, vehicle);

      const maintenanceItem = document.createElement("div");
      maintenanceItem.className = `maintenance-item ${status}`;
      maintenanceItem.setAttribute("data-id", item.id);

      maintenanceItem.innerHTML = `
                <div class="maintenance-info">
                    <div class="maintenance-header">
                        <span class="maintenance-type">${this.getMaintenanceTypeLabel(
                          item.maintenanceType
                        )}</span>
                        <span class="maintenance-vehicle">${
                          vehicle.vehicleType
                        } - ${vehicle.model} (${vehicle.chassisNumber})</span>
                        <span class="status-badge status-${status}">${this.getStatusLabel(
        status
      )}</span>
                    </div>
                    <div class="maintenance-details">
                        ${dueInfo}
                        ${
                          item.lastDate
                            ? `<div class="maintenance-detail">
         Τελευταία Συντήρηση: ${new Date(item.lastDate).toLocaleDateString(
           "el-GR"
         )}
       </div>`
                            : ""
                        }

                    </div>
                    ${
                      item.notes
                        ? `<div class="maintenance-notes">Σημειώσεις: ${item.notes}</div>`
                        : ""
                    }
                </div>
                <div class="maintenance-actions">
                 <span class="status-badge status-${status}">
    ${this.getStatusLabel(status)}
  </span>
                    <button class="btn-secondary" data-action="edit" data-id="${
                      item.id
                    }">Επεξεργασία</button>
                    ${
                      item.status !== "completed"
                        ? `<button class="btn-secondary" data-action="complete" data-id="${item.id}">Ολοκλήρωση</button>`
                        : `<button class="btn-secondary btn-placeholder" disabled>
           Ολοκλήρωση
         </button>`
                    }
                    <button class="btn-secondary" data-action="delete" data-id="${
                      item.id
                    }">Διαγραφή</button>
                </div>
            `;

      table.appendChild(maintenanceItem);
    });
  }

  renderUpcomingMaintenance(maintenanceData, vehicles) {
    const upcomingList = document.getElementById("upcomingMaintenance");
    if (!upcomingList) return;

    const today = new Date();
    const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

    const upcoming = maintenanceData
      .filter((item) => {
        if (!item.nextDate || item.status === "completed") return false;
        const dueDate = new Date(item.nextDate);
        return dueDate >= today && dueDate <= nextWeek;
      })
      .sort((a, b) => new Date(a.nextDate) - new Date(b.nextDate));

    upcomingList.innerHTML = "";

    if (upcoming.length === 0) {
      upcomingList.innerHTML =
        "<p>Δεν υπάρχει επικείμενη συντήρηση για τις επόμενες 7 μέρες</p>";
      return;
    }

    upcoming.forEach((item) => {
      const vehicle = vehicles.find((v) => v.id === item.vehicleId);
      if (!vehicle) return;
      const dueDate = new Date(item.nextDate);
      const daysUntilDue = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));

      const upcomingItem = document.createElement("div");
      upcomingItem.className = "upcoming-item";
      upcomingItem.setAttribute("data-id", item.id);
      upcomingItem.innerHTML = `
                <div class="upcoming-info">
                    <strong>${this.getMaintenanceTypeLabel(
                      item.maintenanceType
                    )}</strong> - 
                    ${vehicle.vehicleType} ${vehicle.model}
                    <div class="upcoming-date">
                        Ημερομηνία λήξης: ${daysUntilDue} μέρες (${dueDate.toLocaleDateString(
        "el-GR"
      )})
                    </div>
                </div>
                <div class="maintenance-actions">
                    <button class="btn-primary" data-action="edit" data-id="${
                      item.id
                    }">Διαχείριση</button>
                </div>
            `;
      upcomingList.appendChild(upcomingItem);
    });
  }

  getStatusLabel(status) {
    const labels = {
      pending: "Σε εξέλιξη",
      upcoming: "Επικείμενη",
      overdue: "Καθυστερημένη",
      completed: "Ολοκληρωμένη",
    };
    return labels[status] || status;
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
      alignment: "Ευθυγράμμιση",
      inspection: "Γενικός Έλεγχος",
      insurance: "Ασφάλιση",
      kteo: "ΚΤΕΟ",
      other: "Άλλο",
    };
    return labels[type] || type;
  }

  saveMaintenance() {
    // Προαιρετικό local cache
    // localStorage.setItem("maintenance", JSON.stringify(this.maintenance));
  }

  /* ================== EVENTS / ΦΙΛΤΡΑ ================== */

  setupButtonEvents() {
    if (this._buttonsBound) return;
    this._buttonsBound = true;

    document.addEventListener("click", (e) => {
      const el = e.target.closest("[data-action]");
      if (!el) return;

      if (el.tagName === "A" || el.hasAttribute("href")) {
        e.preventDefault();
      }

      const action = el.getAttribute("data-action");
      const idAttr = el.getAttribute("data-id");
      const id = idAttr ? parseInt(idAttr, 10) : null;

      switch (action) {
        case "edit":
        case "manage":
          if (id != null) this.editMaintenance(id);
          break;
        case "complete":
          if (id != null) this.completeMaintenance(id);
          break;
        case "delete":
          if (id != null) this.deleteMaintenance(id);
          break;
        case "add":
          this.showMaintenanceModal();
          break;
        default:
          break;
      }
    });
  }
  toggleOtherField() {
    const typeSelect = document.getElementById("maintenanceType");
    const otherInput = document.getElementById("maintenanceTypeOther");

    if (typeSelect && otherInput) {
      const isOther = typeSelect.value === "other";

      // ✅ ΜΗΝ αλλάζετε την τιμή αν είναι edit mode!
      if (this.currentEditingId && otherInput.value) {
        // Αν έχουμε ήδη τιμή (από edit), απλά εμφανίστε το
        otherInput.style.display = "block";
        otherInput.style.visibility = "visible";
      } else {
        // Για νέο entry
        otherInput.style.display = isOther ? "block" : "none";
        otherInput.style.visibility = isOther ? "visible" : "hidden";
        if (!isOther) otherInput.value = "";
      }
    }
  }
  setupEventListeners() {
    if (this._eventsBound) return;
    this._eventsBound = true;
    const form = document.getElementById("maintenanceForm");
    if (form) {
      form.addEventListener("submit", (e) => this.handleFormSubmit(e));
    }
    const vehicleSelect = document.getElementById("maintenanceVehicle");
    if (vehicleSelect) {
      vehicleSelect.addEventListener("change", (e) =>
        this.autoFillMileage(e.target.value)
      );
    }
    const maintenanceType = document.getElementById("maintenanceType");
    if (maintenanceType) {
      maintenanceType.addEventListener("change", () => {
        this.toggleOtherField();
        this.toggleMaintenanceFields();
      });
      // Αρχική κλήση
      this.toggleOtherField();
    } else {
      console.error("❌ maintenanceType element NOT FOUND!");
    }

    const addBtn = document.getElementById("addMaintenanceBtn");
    if (addBtn) {
      addBtn.addEventListener("click", () => this.showMaintenanceModal());
    }

    const searchInput = document.getElementById("searchVehicle");
    if (searchInput)
      searchInput.addEventListener("input", () => this.filterMaintenance());

    ["vehicleFilter", "typeFilter", "statusFilter"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("change", () => this.filterMaintenance());
    });

    this.toggleMaintenanceFields();
    this.filterMaintenance();
  }
  filterMaintenance() {
    const searchInput = document.getElementById("searchVehicle");
    const term = (searchInput && searchInput.value ? searchInput.value : "")
      .toLowerCase()
      .trim();

    const vehicleFilterEl = document.getElementById("vehicleFilter");
    const vehicleFilter =
      vehicleFilterEl && vehicleFilterEl.value ? vehicleFilterEl.value : "all";

    const typeFilterEl = document.getElementById("typeFilter");
    const typeFilter =
      typeFilterEl && typeFilterEl.value ? typeFilterEl.value : "all";

    const statusFilterEl = document.getElementById("statusFilter");
    const statusFilter =
      statusFilterEl && statusFilterEl.value ? statusFilterEl.value : "all";

    const user = JSON.parse(localStorage.getItem("currentUser")) || null;

    const allVehicles = this.vehicles || [];
    const vehicles = user
      ? allVehicles.filter((v) => v.companyId == user.companyId)
      : allVehicles;

    const filtered = this.maintenance.filter((item) => {
      const veh = vehicles.find((v) => v.id === item.vehicleId);
      if (!veh) return false;

      const matchesText =
        !term ||
        [
          veh.chassisNumber || "",
          veh.model || "",
          veh.vehicleType || "",
          this.getMaintenanceTypeLabel(item.maintenanceType).toLowerCase(),
          item.notes || "",
        ].some((s) => String(s).toLowerCase().includes(term));

      const matchesVehicle =
        vehicleFilter === "all" || item.vehicleId == vehicleFilter;
      const matchesType =
        typeFilter === "all" || item.maintenanceType === typeFilter;
      const status = this.getMaintenanceStatus(item);
      const matchesStatus = statusFilter === "all" || status === statusFilter;

      return matchesText && matchesVehicle && matchesType && matchesStatus;
    });

    const sorted = this.sortMaintenancesForDisplay(filtered, vehicles);
    this.filteredMaintenance = sorted;
    this.renderMaintenanceTable(sorted, vehicles);

    this.updateSummaryCards(filtered);
  }

  autoFillMileage(vehicleId) {
    const user = JSON.parse(localStorage.getItem("currentUser"));
    if (!user) return;

    const allVehicles = this.vehicles || [];
    const vehicles = allVehicles.filter(
      (vehicle) => vehicle.companyId == user.companyId
    );
    const vehicle = vehicles.find((v) => v.id == vehicleId);

    if (vehicle && vehicle.currentMileage) {
      const lastMileageInput = document.getElementById("lastMileage");
      if (lastMileageInput && !lastMileageInput.value) {
        lastMileageInput.value = vehicle.currentMileage;
      }
    }
  }

  /* ================== FORM / CRUD ================== */

  async handleFormSubmit(e) {
    if (e) e.preventDefault();
    if (this._submitting) return;
    this._submitting = true;

    try {
      const formData = this.getFormData();
      if (!formData) return;

      if (this.currentEditingId) {
        await this.updateMaintenance(this.currentEditingId, formData);
      } else {
        await this.addMaintenance(formData);
      }

      this.closeMaintenanceModal();
    } finally {
      this._submitting = false;
    }
  }

  getFormData() {
    const vehicleEl = document.getElementById("maintenanceVehicle");
    const typeEl = document.getElementById("maintenanceType");
    const otherInput = document.getElementById("maintenanceTypeOther"); // Προσθήκη

    const vehicleIdRaw = vehicleEl ? vehicleEl.value : "";
    let type = (typeEl?.value || "").trim();

    // Αν είναι "other", χρησιμοποίησε το custom input
    if (type === "other" && otherInput?.value.trim()) {
      type = otherInput.value.trim();
    }

    const hasVehicle =
      vehicleIdRaw !== "" &&
      vehicleIdRaw !== "all" &&
      !Number.isNaN(parseInt(vehicleIdRaw, 10));

    if (!hasVehicle) {
      this.showNotification("Επιλέξτε όχημα", "error");
      return null;
    }

    if (!type) {
      this.showNotification("Επιλέξτε τύπο συντήρησης", "error");
      return null;
    }

    const vehicleId = parseInt(vehicleIdRaw, 10);

    const lastDate = document.getElementById("lastDate").value || null;
    const nextDate = document.getElementById("nextDate").value || null;

    const lastMileageVal = document.getElementById("lastMileage").value;
    const nextMileageVal = document.getElementById("nextMileage").value;

    const lastMileage = lastMileageVal ? parseInt(lastMileageVal, 10) : null;
    const nextMileage = nextMileageVal ? parseInt(nextMileageVal, 10) : null;

    const notificationDays = parseInt(
      document.getElementById("notificationDays").value || "7",
      10
    );
    const notes = document.getElementById("maintenanceNotes").value || null;
    const status =
      document.getElementById("maintenanceStatus").value || "pending";

    const dateBasedTypes = ["insurance", "kteo", "battery"];
    const mileageBasedTypes = ["oil", "service", "tires", "brakes"];

    // ΣΗΜΕΙΩΣΗ: Τώρα η 'type' μπορεί να είναι custom string, όχι μόνο από τις προκαθορισμένες
    if (dateBasedTypes.includes(type) && !nextDate) {
      this.showNotification("Συμπληρώστε την Ημερομηνία", "error");
      return null;
    }

    if (!dateBasedTypes.includes(type) && !mileageBasedTypes.includes(type)) {
      if (!nextDate && (nextMileage === null || Number.isNaN(nextMileage))) {
        this.showNotification(
          "Συμπληρώστε ημερομηνία ή χιλιόμετρα για την επόμενη συντήρηση",
          "error"
        );
        return null;
      }
    }

    return {
      vehicleId,
      maintenanceType: type, // Εδώ θα είναι το custom value αν έχει επιλεγεί "Άλλο"
      lastDate,
      nextDate,
      lastMileage,
      nextMileage,
      notificationDays: Number.isNaN(notificationDays) ? 7 : notificationDays,
      notes,
      status,
    };
  }

  async addMaintenance(data) {
    try {
      if (!this.api) {
        throw new Error("API not available");
      }

      await this.api.addMaintenance(data);

      this.showNotification("Η συντήρηση προστέθηκε με επιτυχία!", "success");
      await this.reloadMaintenances();
    } catch (error) {
      console.error("❌ Σφάλμα addMaintenance:", error);
      this.showNotification(
        "Αποτυχία προσθήκης συντήρησης στον server",
        "error"
      );
    }
  }

  async updateMaintenance(id, updates) {
    const index = this.maintenance.findIndex((m) => m.id == id);
    if (index === -1) {
      this.showNotification("Η συντήρηση δεν βρέθηκε", "error");
      return;
    }

    try {
      if (!this.api) throw new Error("API not available");

      const current = this.maintenance[index];

      // ✅ ΠΛΗΡΕΣ payload για PUT
      const payload = {
        vehicleId: current.vehicleId,
        maintenanceType: current.maintenanceType,
        lastDate: updates.lastDate ?? current.lastDate ?? null,
        nextDate: updates.nextDate ?? current.nextDate ?? null,
        lastMileage: updates.lastMileage ?? current.lastMileage ?? null,
        nextMileage: updates.nextMileage ?? current.nextMileage ?? null,
        notificationDays:
          updates.notificationDays ?? current.notificationDays ?? 7,
        status: updates.status ?? current.status ?? "active",
        notes: updates.notes ?? current.notes ?? null,
      };

      await this.api.updateMaintenance(id, payload);

      this.showNotification("Η συντήρηση ενημερώθηκε με επιτυχία!", "success");
      await this.reloadMaintenances();
    } catch (error) {
      console.error("❌ Σφάλμα updateMaintenance:", error);
      this.showNotification(
        "Αποτυχία ενημερωσης συντήρησης στον server",
        "error"
      );
    }
  }

  async deleteMaintenance(id) {
    try {
      if (!this.api) {
        throw new Error("API not available");
      }

      await this.api.deleteMaintenance(id);

      this.showNotification("Η συντήρηση διαγράφηκε", "success");
      await this.reloadMaintenances();
    } catch (error) {
      console.error("❌ Σφάλμα deleteMaintenance:", error);
      this.showNotification(
        "Αποτυχία διαγραφής συντήρησης στον server",
        "error"
      );
    }
  }

  async completeMaintenance(id) {
    Object.keys(payload).forEach(
      (k) => payload[k] === undefined && delete payload[k]
    );

    const maintenanceId = parseInt(id, 10);
    const item = this.maintenance.find((m) => m.id === maintenanceId);
    if (!item) {
      this.showNotification("Δεν βρέθηκε η συντήρηση", "error");
      return;
    }
    const toYMD = (d) => (d ? new Date(d).toISOString().split("T")[0] : null);

    const today = new Date().toISOString().split("T")[0];

    const payload = {
      vehicleId: parseInt(item.vehicleId, 10),
      maintenanceType: item.maintenanceType,
      lastDate: toYMD(item.nextDate) || today,
      nextDate: toYMD(item.nextDate), // ή null αν θες να το καθαρίζεις
      lastMileage: item.nextMileage ?? item.lastMileage ?? null,
      nextMileage: item.nextMileage ?? null,
      notificationDays: item.notificationDays ?? 7,
      status: "completed",
      notes: item.notes ?? null,
    };

    console.log("PUT payload:", JSON.stringify(payload, null, 2));

    try {
      await this.api.updateMaintenance(maintenanceId, payload);
      this.showNotification(
        "Η συντήρηση σημειώθηκε ως ολοκληρωμένη",
        "success"
      );
      await this.reloadMaintenances();
    } catch (error) {
      console.error("❌ Σφάλμα completeMaintenance:", error);
      this.showNotification(
        "Αποτυχία ενημέρωσης συντήρησης στον server",
        "error"
      );
    }
  }

  /* ================== MODAL ================== */

  showNotification(message, type = "info") {
    const container = document.createElement("div");
    container.className = `notification ${type}`;
    container.innerHTML = `
            <div class="notification-content">
                <span class="notification-message">${message}</span>
                <button class="notification-close" aria-label="Κλείσιμο">×</button>
            </div>
        `;
    document.body.appendChild(container);

    const closeBtn = container.querySelector(".notification-close");
    closeBtn.addEventListener("click", () => container.remove());

    setTimeout(() => container.remove(), 3000);
  }

  setupModalEvents() {
    const modal = document.getElementById("maintenanceModal");
    const closeButton = document.querySelector("#maintenanceModal .close");
    const cancelButton = document.querySelector(
      "#maintenanceModal .btn-secondary"
    );

    if (closeButton) {
      closeButton.addEventListener("click", () => this.closeMaintenanceModal());
    }
    if (cancelButton) {
      cancelButton.addEventListener("click", () =>
        this.closeMaintenanceModal()
      );
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.closeMaintenanceModal();
      }
    });
  }

  closeMaintenanceModal() {
    const modal = document.getElementById("maintenanceModal");
    if (modal) {
      modal.style.display = "none";
      this.currentEditingId = null; // ΜΗΔΕΝΙΣΜΟΣ του ID
      // const form = document.getElementById("maintenanceForm");
      // if (form) form.reset(); // Αυτό διαγράφει τα δεδομένα

      // ΜΗΝ ορίζετε τιμές εδώ - θα οριστούν στο showMaintenanceModal()
    }
  }

  showMaintenanceModal() {
    const modal = document.getElementById("maintenanceModal");
    if (modal) {
      modal.style.display = "flex";
      const form = document.getElementById("maintenanceForm");

      // ✅ Διαφοροποιήστε μεταξύ νέου και επεξεργασίας
      if (!this.currentEditingId) {
        // ΜΟΝΟ για νέο entry
        if (form) form.reset();

        const otherInput = document.getElementById("maintenanceTypeOther");
        if (otherInput) {
          otherInput.value = "";
          otherInput.style.display = "none";
        }

        const status = document.getElementById("maintenanceStatus");
        if (status) status.value = "pending";

        const type = document.getElementById("maintenanceType");
        if (type) type.value = ""; // ✅ ΚΕΝΟ για νέο!

        const vehicleSelect = document.getElementById("maintenanceVehicle");
        if (vehicleSelect) vehicleSelect.value = "";

        // // Ορίστε σημερινή ημερομηνία μόνο για νέα εγγραφή
        // const today = new Date().toISOString().split("T")[0];
        // const nextDateField = document.getElementById("nextDate");
        // if (nextDateField) nextDateField.value = today;
      }
      // ✅ Αν είναι edit, ΔΕΝ κάνουμε τίποτα εδώ - τα πεδία θα γεμίσουν στην editMaintenance()

      this.toggleMaintenanceFields();
      this.toggleOtherField();

      console.log(
        "🔧 Maintenance modal opened",
        this.currentEditingId ? "(edit)" : "(new)"
      );
    }
  }

  editMaintenance(id) {
    const maintenanceId = parseInt(id);
    const maintenance = this.maintenance.find((m) => m.id === maintenanceId);

    if (!maintenance) {
      this.showNotification("Δεν βρέθηκε η συντήρηση", "error");
      return;
    }

    // ✅ Ορίστε πρώτα το ID
    this.currentEditingId = maintenanceId;

    // ✅ Άνοιξε το modal
    const modal = document.getElementById("maintenanceModal");
    if (!modal) {
      console.log("❌ Modal not found");
      return;
    }

    modal.style.display = "flex";

    // ✅ Μετά γεμίστε τα πεδία - χρησιμοποιήστε setTimeout για να είστε σίγουροι
    setTimeout(() => {
      console.log("📝 Filling edit form for ID:", maintenanceId);

      // Όχημα
      document.getElementById("maintenanceVehicle").value =
        maintenance.vehicleId;

      // Τύπος Συντήρησης
      const typeSelect = document.getElementById("maintenanceType");
      const otherInput = document.getElementById("maintenanceTypeOther");
      const predefinedTypes = [
        "oil",
        "service",
        "tires",
        "brakes",
        "battery",
        "insurance",
        "kteo",
      ];

      if (predefinedTypes.includes(maintenance.maintenanceType)) {
        typeSelect.value = maintenance.maintenanceType;
        if (otherInput) {
          otherInput.style.display = "none";
          otherInput.value = "";
        }
      } else {
        typeSelect.value = "other";
        if (otherInput) {
          otherInput.value = maintenance.maintenanceType;
          otherInput.style.display = "block";
        }
      }

      // Ημερομηνίες
      if (maintenance.lastDate) {
        const lastDate = new Date(maintenance.lastDate);
        document.getElementById("lastDate").value = lastDate
          .toISOString()
          .split("T")[0];
      } else {
        document.getElementById("lastDate").value = "";
      }

      if (maintenance.nextDate) {
        const nextDate = new Date(maintenance.nextDate);
        document.getElementById("nextDate").value = nextDate
          .toISOString()
          .split("T")[0];
      } else {
        document.getElementById("nextDate").value = "";
      }

      // Χιλιόμετρα
      document.getElementById("lastMileage").value =
        maintenance.lastMileage || "";
      document.getElementById("nextMileage").value =
        maintenance.nextMileage || "";
      document.getElementById("notificationDays").value =
        maintenance.notificationDays || 7;
      document.getElementById("maintenanceNotes").value =
        maintenance.notes || "";
      document.getElementById("maintenanceStatus").value =
        maintenance.status || "pending";

      // Ενημέρωση UI
      this.toggleMaintenanceFields();
      this.toggleOtherField();
    }, 100); // ✅ 100ms καθυστέρηση για να φορτωθεί το modal
  }

  toggleMaintenanceFields() {
    const typeSelect = document.getElementById("maintenanceType");
    if (!typeSelect) return;

    const type = typeSelect.value;
    const dateBased = ["insurance", "kteo", "battery"];
    const mileageBased = ["oil", "service", "tires", "brakes"];

    const lastDateGroup = document.getElementById("lastDateGroup");
    const nextDateGroup = document.getElementById("nextDateGroup");
    const lastMileageGroup = document.getElementById("lastMileageGroup");
    const nextMileageGroup = document.getElementById("nextMileageGroup");

    if (dateBased.includes(type)) {
      if (lastDateGroup) lastDateGroup.style.display = "block";
      if (nextDateGroup) nextDateGroup.style.display = "block";
      if (lastMileageGroup) lastMileageGroup.style.display = "none";
      if (nextMileageGroup) nextMileageGroup.style.display = "none";
    } else if (mileageBased.includes(type)) {
      if (lastDateGroup) lastDateGroup.style.display = "none";
      if (nextDateGroup) nextDateGroup.style.display = "none";
      if (lastMileageGroup) lastMileageGroup.style.display = "block";
      if (nextMileageGroup) nextMileageGroup.style.display = "block";
    } else {
      if (lastDateGroup) lastDateGroup.style.display = "block";
      if (nextDateGroup) nextDateGroup.style.display = "block";
      if (lastMileageGroup) lastMileageGroup.style.display = "block";
      if (nextMileageGroup) nextMileageGroup.style.display = "block";
    }
  }
}

// Initialize maintenance manager
let maintenanceManager;

function initializeMaintenanceManager() {
  console.log("🔧 Initializing Maintenance Manager...");
  if (window.maintenanceManager) {
    console.log("⚠️ Maintenance Manager already initialized");
    return;
  }
  try {
    maintenanceManager = new MaintenanceManager();
    window.maintenanceManager = maintenanceManager;
    console.log("✅ Maintenance Manager initialized successfully");
  } catch (error) {
    console.error("❌ Error initializing Maintenance Manager:", error);
  }
}

window.showMaintenanceModal = () => {
  if (window.maintenanceManager)
    window.maintenanceManager.showMaintenanceModal();
};

window.editMaintenance = (id) => {
  if (window.maintenanceManager) window.maintenanceManager.editMaintenance(id);
};

window.completeMaintenance = (id) => {
  if (window.maintenanceManager)
    window.maintenanceManager.completeMaintenance(id);
};

window.deleteMaintenance = (id) => {
  if (window.maintenanceManager)
    window.maintenanceManager.deleteMaintenance(id);
};

window.filterMaintenance = () => {
  if (window.maintenanceManager) window.maintenanceManager.filterMaintenance();
};

window.closeMaintenanceModal = () => {
  if (window.maintenanceManager)
    window.maintenanceManager.closeMaintenanceModal();
};

window.toggleMaintenanceFields = () => {
  if (window.maintenanceManager)
    window.maintenanceManager.toggleMaintenanceFields();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeMaintenanceManager);
} else {
  initializeMaintenanceManager();
}
