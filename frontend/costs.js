// costs.js - Enhanced version with API integration

const safeHtml = window.CaReMindUI.escapeHtml;

class CostsManager {
  constructor() {
    this.api = window.api || null;
    this.costs = [];
    this.filteredCosts = [];
    this.currentEditingId = null;
    this._buttonsBound = false;
    this._eventsBound = false;
    this._submitting = false;
    this.charts = {};
    this.currentPage = 1;
    this.itemsPerPage = 5;
    this.currentFilters = {
      period: "all",
      vehicle: "all",
      category: "all",
      startDate: null,
      endDate: null,
    };

    this.init();
  }

  async init() {

    await this.loadInitialData();
    this.setupEventListeners();
    this.setupModalEvents();
    this.setupButtonEvents();
    this.setupCharts();
    this._isDesktopCharts = window.matchMedia("(min-width: 769px)").matches;

    window.addEventListener("resize", () => {
      this.updateCharts();
    });

    this.filterCosts();

  }

  async loadInitialData() {
    window.CaReMindUI.setBusy(true, "Φόρτωση εξόδων…");
    try {
      await this.fetchVehicles();
      await this.fetchCosts();
      this.loadVehicleFilter();
      this.loadCostsData();
    } finally {
      window.CaReMindUI.setBusy(false);
    }
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
    } catch (error) {
      console.error("❌ Σφάλμα φόρτωσης vehicles από backend:", error);
      this.showNotification(
        "Σφάλμα κατά τη φόρτωση οχημάτων από τον server",
        "error"
      );
      // Χωρίς fallback σε localStorage
      this.vehicles = [];
    }
  }

  async fetchCosts() {
    try {
      if (!this.api) {
        console.error(
          "❌ Δεν υπάρχει API instance – δεν μπορώ να φορτώσω κόστη"
        );
        this.costs = [];
        return;
      }

      const data = await this.api.getCosts();
      let list = [];

      if (Array.isArray(data)) {
        list = data;
      } else if (data && Array.isArray(data.costs)) {
        list = data.costs;
      } else if (data && Array.isArray(data.data)) {
        list = data.data;
      }

      this.costs = list;
    } catch (error) {
      console.error("❌ Σφάλμα φόρτωσης costs από backend:", error);
      this.showNotification(
        "Σφάλμα κατά τη φόρτωση κόστους από τον server",
        "error"
      );

      // Χωρίς fallback σε localStorage
      this.costs = [];
    }
  }

  async reloadCosts() {
    await this.fetchCosts();
    this.loadCostsData();
  }

  /* ================== LOAD / RENDER ================== */

  async loadVehicleFilter() {
    const user = JSON.parse(localStorage.getItem("currentUser"));
    const allVehicles = this.vehicles || [];

    const vehicles = user
      ? allVehicles.filter((v) => v.companyId == user.companyId)
      : allVehicles;

    const vehicleSelects = ["costVehicle", "costVehicleSelect"];

    vehicleSelects.forEach((selectId) => {
      const select = document.getElementById(selectId);
      if (select) {
        const isFilter = selectId === "costVehicle";
        select.innerHTML = isFilter
          ? '<option value="all">Όλα τα οχήματα</option>'
          : '<option value="">Επιλέξτε όχημα</option>';

        vehicles.forEach((vehicle) => {
          const option = document.createElement("option");
          option.value = vehicle.id;
          option.textContent = `${vehicle.vehicleType} - ${vehicle.model} (${vehicle.chassisNumber})`;
          select.appendChild(option);
        });
      }
    });
  }

  getVehicleById(id) {
    // Πρώτα από this.vehicles (backend)
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

    // Fallback σε localStorage
    const all = JSON.parse(localStorage.getItem("vehicles")) || [];
    const fromLocal = user
      ? all.filter((v) => v.companyId == user.companyId).find((v) => v.id == id)
      : all.find((v) => v.id == id);

    return fromLocal || null;
  }

  loadCostsData() {
    const user = JSON.parse(localStorage.getItem("currentUser"));
    const allVehicles = this.vehicles || [];
    const userVehicles = user
      ? allVehicles.filter((v) => v.companyId == user.companyId)
      : allVehicles;

    const vehicleIds = new Set(userVehicles.map((v) => v.id));
    const userCosts = this.costs.filter((c) => vehicleIds.has(c.vehicleId));

    this.filteredCosts = userCosts;

    this.renderCostsTable(this.filteredCosts, userVehicles);
    this.updateSummaryCards(this.filteredCosts);
    this.updateCharts();
    this.updateBreakdowns();
    this.updatePagination();
  }

  updateSummaryCards(costsData) {
    const total = costsData.reduce((sum, cost) => sum + Number(cost.amount), 0);

    // Monthly cost (current month)
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const monthlyCost = costsData
      .filter((cost) => {
        const costDate = new Date(cost.date);
        return (
          costDate.getMonth() === currentMonth &&
          costDate.getFullYear() === currentYear
        );
      })
      .reduce((sum, cost) => sum + Number(cost.amount), 0);

    // Average monthly cost (last 12 months)
    const last12MonthsCost = this.getLast12MonthsCost();
    const averageCost = last12MonthsCost > 0 ? last12MonthsCost / 12 : 0;

    // Trend calculation
    const trend = this.calculateCostTrend();


    document.getElementById("totalCost").textContent = `€${total.toFixed(2)}`;
    document.getElementById(
      "monthlyCost"
    ).textContent = `€${monthlyCost.toFixed(2)}`;
    document.getElementById(
      "averageCost"
    ).textContent = `€${averageCost.toFixed(2)}`;

    const trendElement = document.getElementById("costTrend");
    if (trendElement) {
      trendElement.textContent = trend.symbol;
      trendElement.className = `trend-indicator ${trend.class}`;
    }
  }

  getLast12MonthsCost() {
    const now = new Date();
    let total = 0;

    for (let i = 0; i < 12; i++) {
      const month = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthCost = (this.filteredCosts || [])
        .filter((cost) => {
          const costDate = new Date(cost.date);
          return (
            costDate.getMonth() === month.getMonth() &&
            costDate.getFullYear() === month.getFullYear()
          );
        })
        .reduce((sum, cost) => sum + Number(cost.amount), 0);
      total += monthCost;
    }

    return total;
  }

  calculateCostTrend() {
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const previousMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const previousYear = currentMonth === 0 ? currentYear - 1 : currentYear;

    const currentMonthCost = this.costs
      .filter((cost) => {
        const costDate = new Date(cost.date);
        return (
          costDate.getMonth() === currentMonth &&
          costDate.getFullYear() === currentYear
        );
      })
      .reduce((sum, cost) => sum + Number(cost.amount), 0);

    const previousMonthCost = this.costs
      .filter((cost) => {
        const costDate = new Date(cost.date);
        return (
          costDate.getMonth() === previousMonth &&
          costDate.getFullYear() === previousYear
        );
      })
      .reduce((sum, cost) => sum + Number(cost.amount), 0);

    if (previousMonthCost === 0) return { symbol: "→", class: "trend-neutral" };

    const change =
      ((currentMonthCost - previousMonthCost) / previousMonthCost) * 100;

    if (change > 5) return { symbol: "↗", class: "trend-up" };
    if (change < -5) return { symbol: "↘", class: "trend-down" };
    return { symbol: "→", class: "trend-neutral" };
  }

  renderCostsTable(costsData, vehicles) {
    const tbody = document.getElementById("costsTableBody");
    if (!tbody) {
      console.warn("Costs table body not found");
      return;
    }

    tbody.innerHTML = "";

    if (!costsData || costsData.length === 0) {
      tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="6">
          <div class="empty-state">
            <span>Δεν βρέθηκαν κόστη</span>
            <button class="btn-primary" data-action="add">Προσθέστε το πρώτο κόστος</button>
          </div>
        </td>
      </tr>
    `;
      return;
    }

    const paginatedCosts = this.getPaginatedCosts(costsData);

    paginatedCosts.forEach((cost) => {
      const vehicle = vehicles.find((v) => v.id == cost.vehicleId);
      if (!vehicle) return;

      const costItem = document.createElement("tr");
      costItem.className = "cost-item";
      costItem.setAttribute("data-id", cost.id);

      costItem.innerHTML = `
      <td data-label="Ημερομηνία">
        ${new Date(cost.date).toLocaleDateString("el-GR")}
      </td>

      <td data-label="Όχημα">
        <div class="cost-vehicle">${safeHtml(vehicle.vehicleType)} - ${safeHtml(
        vehicle.model
      )}</div>
        <div class="cost-chassis">${safeHtml(vehicle.chassisNumber)}</div>
      </td>

      <td data-label="Κατηγορία">
        <span class="category-badge">
          ${safeHtml(this.getCategoryLabel(cost.category))}
        </span>
      </td>

      <td data-label="Ποσό">
        <div class="cost-amount">€${Number(cost.amount).toFixed(2)}</div>
      </td>

      <td data-label="Περιγραφή">
        <div class="cost-description">${safeHtml(cost.description || "-")}</div>
        ${
          cost.receipt
            ? `<div class="cost-receipt">Απόδειξη: ${safeHtml(cost.receipt)}</div>`
            : ""
        }
      </td>

      <td data-label="Ενέργειες">
        <div class="cost-actions">
          <button class="btn-secondary" data-action="edit" data-id="${cost.id}">
            Επεξεργασία
          </button>
          <button class="btn-secondary" data-action="delete" data-id="${
            cost.id
          }">
            Διαγραφή
          </button>
        </div>
      </td>
    `;

      tbody.appendChild(costItem);
    });
  }

  getPaginatedCosts(costs) {
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    return costs.slice(startIndex, endIndex);
  }

  updatePagination() {
    const pagination = document.getElementById("costsPagination");
    if (!pagination) return;

    const totalPages = Math.ceil(this.filteredCosts.length / this.itemsPerPage);

    if (totalPages <= 1) {
      pagination.innerHTML = "";
      pagination.style.display = "none";
      return;
    }

    pagination.style.display = "flex";

    pagination.innerHTML = `
      <button class="pagination-btn" data-action="previous-page" ${
        this.currentPage === 1 ? "disabled" : ""
      }>
          <i class="fas fa-chevron-left"></i> <span class="btn-text">Προηγούμενο</span>
      </button>
      
      <span class="pagination-info">
          <span class="pagination-label">Σελίδα </span><strong>${
            this.currentPage
          }</strong> από <strong>${totalPages}</strong>
      </span>
      
      <button class="pagination-btn" data-action="next-page" ${
        this.currentPage === totalPages ? "disabled" : ""
      }>
          <span class="btn-text">Επόμενο</span> <i class="fas fa-chevron-right"></i>
      </button>
  `;
  }

  /* ================== FILTERS ================== */

  filterCosts() {

    // Get current filter values
    const period =
      document.getElementById("costPeriod")?.value ||
      this.currentFilters.period ||
      "all";
    const vehicleId = document.getElementById("costVehicle")?.value || "all";
    const category = document.getElementById("costCategory")?.value || "all";


    // Get user and vehicles
    const user = JSON.parse(localStorage.getItem("currentUser"));
    const allVehicles = this.vehicles || [];


    // Get allowed vehicle IDs for this user
    const allowedIds = allVehicles
      .filter((v) => !user || v.companyId == user.companyId)
      .map((v) => Number(v.id));


    // Start filtering from ALL costs
    let filtered = this.costs.filter((c) => {
      const hasVehicle = c.vehicleId != null;
      const isAllowed = allowedIds.includes(Number(c.vehicleId));
      return hasVehicle && isAllowed;
    });


    // Apply period filter
    if (period !== "all") {
      const beforePeriod = filtered.length;
      filtered = this.filterByPeriod(filtered, period);
    } else {
    }

    // Apply vehicle filter
    if (vehicleId !== "all") {
      const beforeVehicle = filtered.length;
      filtered = filtered.filter((cost) => cost.vehicleId == vehicleId);
    }

    // Apply category filter
    if (category !== "all") {
      const beforeCategory = filtered.length;
      filtered = filtered.filter((cost) => cost.category === category);
    }

    // Apply custom date range filter
    if (period === "custom") {
      const startDate = document.getElementById("startDate")?.value;
      const endDate = document.getElementById("endDate")?.value;
      if (startDate && endDate) {
        this.currentFilters.startDate = startDate;
        this.currentFilters.endDate = endDate;
        const beforeCustom = filtered.length;
        filtered = filtered.filter((cost) => {
          const costDate = new Date(cost.date);
          return (
            costDate >= new Date(startDate) && costDate <= new Date(endDate)
          );
        });
      }
    }

    // Update state with completely new arrays
    this.currentPage = 1;
    this.filteredCosts = [
      ...filtered.sort((a, b) => new Date(b.date) - new Date(a.date)),
    ];
    this.currentFilters.period = period;
    this.currentFilters.vehicle = vehicleId;
    this.currentFilters.category = category;


    // Get vehicles for rendering
    const userVehicles = allVehicles.filter(
      (v) => !user || v.companyId == user.companyId
    );

    // Update UI
    this.renderCostsTable(this.filteredCosts, userVehicles);
    this.updateSummaryCards(this.filteredCosts);
    this.updateCharts();
    this.updateBreakdowns();
    this.updatePagination();

  }

  filterByPeriod(costs, period) {
    const now = new Date();
    let startDate;


    switch (period) {
      case "today":
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        break;
      case "week":
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 7);
        break;
      case "month":
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "quarter":
        startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        break;
      case "year":
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        return costs;
    }


    const filtered = costs.filter((cost) => {
      const costDate = new Date(cost.date);
      const isIncluded = costDate >= startDate;
      return isIncluded;
    });

    return filtered;
  }

  /* ================== FORM / CRUD ================== */

  async handleFormSubmit(e) {
    if (e) e.preventDefault();

    if (this._submitting) return;
    this._submitting = true;

    try {
      const formData = this.getFormData();
      if (!formData) return;

      // Store current editing state
      const wasEditing = this.currentEditingId;

      if (this.currentEditingId) {
        await this.updateCost(this.currentEditingId, formData);
      } else {
        await this.addCost(formData);
      }

      this.closeCostModal();

      // CRITICAL FIX: Properly handle filter state after add/update
      const periodSel = document.getElementById("costPeriod");
      if (periodSel) {
        // Only reset to "all" if we're adding a new cost (not editing)
        // This prevents losing the current filter context during edits
        if (!wasEditing) {
          periodSel.value = "all";
          this.currentFilters.period = "all";
        }
      }

      // Refresh data
      await this.reloadCosts();
      this.filterCosts();
    } finally {
      setTimeout(() => {
        this._submitting = false;
      }, 50);
    }
  }

  getFormData() {
    const vehicleEl = document.getElementById("costVehicleSelect");
    const categoryEl = document.getElementById("costCategorySelect");
    const amountEl = document.getElementById("costAmount");
    const dateEl = document.getElementById("costDate");
    const otherInput = document.getElementById("costCategoryOther");

    const vehicleId = vehicleEl?.value;
    let category = categoryEl?.value;
    const amount = amountEl?.value ? parseFloat(amountEl.value) : null;
    const date = dateEl?.value;

    if (category === "other" && otherInput?.value.trim()) {
      category = otherInput.value.trim();
    }
    if (!vehicleId) {
      this.showNotification("Επιλέξτε όχημα", "error");
      return null;
    }
    if (!category) {
      this.showNotification("Επιλέξτε κατηγορία", "error");
      return null;
    }
    if (!amount || amount <= 0 || isNaN(amount)) {
      this.showNotification("Εισάγετε έγκυρο ποσό", "error");
      return null;
    }
    if (!date) {
      this.showNotification("Επιλέξτε ημερομηνία", "error");
      return null;
    }

    return {
      vehicleId: parseInt(vehicleId),
      category,
      amount: parseFloat(amount), // Εξασφαλίζουμε ότι είναι number
      date,
      description: document.getElementById("costDescription")?.value || null,
      receipt: document.getElementById("costReceiptNumber")?.value || null,
    };
  }

  async addCost(data) {
    try {
      if (!this.api) {
        throw new Error("API not available");
      }

      // ΜΗΝ ΣΤΕΙΛΕΤΕ companyId - το backend θα βρει το user_id από το token
      const cleanData = {
        vehicleId: data.vehicleId,
        category: data.category,
        amount: data.amount,
        date: data.date,
        createdAt: new Date().toISOString(), // ✅ ημερομηνία καταχώρησης
        description: data.description,
        receiptNumber: data.receiptNumber, // Προσέξτε: receiptNumber, όχι receipt
      };

      await this.api.addCost(cleanData);

      this.showNotification("Το κόστος προστέθηκε με επιτυχία!", "success");
      await this.reloadCosts();
    } catch (error) {
      console.error("❌ Σφάλμα addCost:", error);
      this.showNotification("Αποτυχία προσθήκης κόστους στον server", "error");
    }
  }

  async updateCost(id, updates) {
    const index = this.costs.findIndex((c) => c.id == id);
    if (index === -1) {
      this.showNotification("Δεν βρέθηκε το κόστος", "error");
      return;
    }

    const updated = { ...this.costs[index], ...updates };

    try {
      if (!this.api) {
        throw new Error("API not available");
      }

      await this.api.updateCost(id, updated);

      this.showNotification("Το κόστος ενημερώθηκε με επιτυχία!", "success");
      await this.reloadCosts();
    } catch (error) {
      console.error("❌ Σφάλμα updateCost:", error);
      this.showNotification("Αποτυχία ενημέρωσης κόστους στον server", "error");
    }
  }

  async deleteCost(id) {
    try {
      if (!this.api) {
        throw new Error("API not available");
      }

      await this.api.deleteCost(id);

      this.showNotification("Το κόστος διαγράφηκε!", "success");
      await this.reloadCosts();
    } catch (error) {
      console.error("❌ Σφάλμα deleteCost:", error);
      this.showNotification("Αποτυχία διαγραφής κόστους στον server", "error");
    }
  }

  saveCostsLocal() {
    // localStorage.setItem("costs", JSON.stringify(this.costs));
  }

  /* ================== EDIT / MODAL ================== */

  editCost(id) {
    const cost = this.costs.find((c) => c.id == id);
    if (!cost) {
      this.showNotification("Δεν βρέθηκε το κόστος", "error");
      return;
    }

    this.currentEditingId = id;

    document.getElementById("costVehicleSelect").value = cost.vehicleId;
    document.getElementById("costCategorySelect").value = cost.category;
    document.getElementById("costAmount").value = Number(cost.amount);
    document.getElementById("costDate").value = cost.date;
    if (costDate && cost.date) {
      // Μετατρέψτε τη ημερομηνία σε μορφή YYYY-MM-DD
      const dateObj = new Date(cost.date);
      const year = dateObj.getFullYear();
      const month = String(dateObj.getMonth() + 1).padStart(2, "0");
      const day = String(dateObj.getDate()).padStart(2, "0");
      costDate.value = `${year}-${month}-${day}`;
    }
    document.getElementById("costDescription").value = cost.description || "";
    document.getElementById("costReceipt").value = cost.receipt || "";
    document.getElementById("costId").value = cost.id;

    // Update modal title
    const modalTitle = document.getElementById("costModalTitle");
    if (modalTitle) {
      modalTitle.textContent = "Επεξεργασία Κόστους";
    }

    const modal = document.getElementById("addCostModal");
    if (modal) {
      modal.style.display = "flex";
    }
  }

  showCostModal() {
    const modal = document.getElementById("addCostModal");
    if (modal) {
      modal.style.display = "flex";

      const form = document.getElementById("costForm");
      if (form) {
        if (!this.currentEditingId) {
          form.reset();
        }
        // Update modal title
        const modalTitle = document.getElementById("costModalTitle");
        if (modalTitle && !this.currentEditingId) {
          modalTitle.textContent = "Καταχώρηση Νέου Κόστους";
          if (!this.currentEditingId) {
            const today = new Date();
            const year = today.getFullYear();
            const month = String(today.getMonth() + 1).padStart(2, "0");
            const day = String(today.getDate()).padStart(2, "0");
            costDate.value = `${year}-${month}-${day}`;
          }
        }
      }

      const costDate = document.getElementById("costDate");
      if (costDate && !this.currentEditingId) {
        costDate.valueAsDate = new Date();
      }

      // Προσθήκη: Reset το "Άλλο" field
      const otherInput = document.getElementById("costCategoryOther");
      if (otherInput && !this.currentEditingId) {
        otherInput.value = "";
        otherInput.style.display = "none";
      }

      // Προσθήκη: Αρχική κλήση για το other field
      this.toggleCostOtherField();

    }
  }

  closeCostModal() {
    const modal = document.getElementById("addCostModal");
    if (modal) {
      modal.style.display = "none";
      this.currentEditingId = null;
      const form = document.getElementById("costForm");
      if (form) form.reset();
      // const costDate = document.getElementById("costDate");
      // if (costDate) costDate.valueAsDate = new Date();
    }
  }

  /* ================== CHARTS ================== */

  setupCharts() {
    this.setupCostByCategoryChart();
    this.setupMonthlyCostsChart();
    this.setupCostByVehicleChart();
    this.setupCostTrendChart();
  }
  getChartCommonOptions() {
    const isDesktop = window.matchMedia("(min-width: 769px)").matches;

    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: isDesktop ? "right" : "bottom",
          labels: {
            boxWidth: 12,
            padding: 10,
            font: { size: isDesktop ? 12 : 11 },
          },
        },
        title: { display: false },
      },
    };
  }

  setupCostByCategoryChart() {
    const ctx = document.getElementById("costByCategoryChart");
    if (!ctx) return;

    const costsByCategory = this.groupCostsByCategory(this.filteredCosts || []);
    const common = this.getChartCommonOptions();

    this.charts.costByCategory = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: Object.keys(costsByCategory).map((cat) =>
          this.getCategoryLabel(cat)
        ),
        datasets: [
          {
            data: Object.values(costsByCategory),
            backgroundColor: [
              "#FF6384",
              "#36A2EB",
              "#FFCE56",
              "#4BC0C0",
              "#9966FF",
              "#FF9F40",
            ],
            borderWidth: 0,
          },
        ],
      },
      options: {
        ...common,
        cutout: "55%",
        layout: { padding: 0 },
      },
    });
  }

  setupMonthlyCostsChart() {
    const ctx = document.getElementById("monthlyCostsChart");
    if (!ctx) return;

    const monthlyData = this.getMonthlyCostsData();
    const common = this.getChartCommonOptions();

    this.charts.monthlyCosts = new Chart(ctx, {
      type: "bar",
      data: {
        labels: [
          "Ιαν",
          "Φεβ",
          "Μαρ",
          "Απρ",
          "Μαι",
          "Ιουν",
          "Ιουλ",
          "Αυγ",
          "Σεπ",
          "Οκτ",
          "Νοε",
          "Δεκ",
        ],
        datasets: [
          {
            label: "Κόστος (€)",
            data: monthlyData,
            backgroundColor: "#3498db",
            borderColor: "#2980b9",
            borderWidth: 1,
          },
        ],
      },
      options: {
        ...common,
        // στα bar/line θέλουμε legend συνήθως πάνω ή κρυφή (εδώ είναι 1 dataset, άρα την κρύβουμε)
        plugins: {
          ...common.plugins,
          legend: { display: false },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { maxTicksLimit: 6 },
          },
          x: {
            ticks: { maxTicksLimit: 12 },
          },
        },
      },
    });
  }

  setupCostByVehicleChart() {
    const ctx = document.getElementById("costByVehicleChart");
    if (!ctx) return;

    const costsByVehicle = this.groupCostsByVehicle(this.filteredCosts || []);
    const common = this.getChartCommonOptions();

    this.charts.costByVehicle = new Chart(ctx, {
      type: "pie",
      data: {
        labels: Object.keys(costsByVehicle).map((vehicleId) => {
          const vehicle = this.getVehicleById(parseInt(vehicleId));
          return vehicle ? `${vehicle.model}` : `Όχημα ${vehicleId}`;
        }),
        datasets: [
          {
            data: Object.values(costsByVehicle),
            backgroundColor: [
              "#FF6384",
              "#36A2EB",
              "#FFCE56",
              "#4BC0C0",
              "#9966FF",
              "#FF9F40",
              "#C9CBCF",
              "#8e44ad",
            ],
            borderWidth: 0,
          },
        ],
      },
      options: {
        ...common,
        layout: { padding: 0 },
      },
    });
  }

  setupCostTrendChart() {
    const ctx = document.getElementById("costTrendChart");
    if (!ctx) return;

    const monthlyTrends = this.getMonthlyTrends();
    const common = this.getChartCommonOptions();

    this.charts.costTrend = new Chart(ctx, {
      type: "line",
      data: {
        labels: monthlyTrends.labels,
        datasets: [
          {
            label: "Κόστος (€)",
            data: monthlyTrends.data,
            borderColor: "#27ae60",
            backgroundColor: "rgba(39, 174, 96, 0.1)",
            fill: true,
            tension: 0.4,
            pointRadius: 2,
          },
        ],
      },
      options: {
        ...common,
        plugins: {
          ...common.plugins,
          legend: { display: false },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { maxTicksLimit: 6 },
          },
          x: {
            ticks: { maxTicksLimit: 12 },
          },
        },
      },
    });
  }

  getMonthlyCostsData() {
    const monthlyData = Array(12).fill(0);
    const currentYear = new Date().getFullYear();

    (this.filteredCosts || []).forEach((cost) => {
      const d = new Date(cost.date);
      if (d.getFullYear() === currentYear) {
        monthlyData[d.getMonth()] += Number(cost.amount) || 0;
      }
    });

    return monthlyData;
  }

  getMonthlyTrends() {
    const months = [];
    const data = [];
    const now = new Date();

    for (let i = 11; i >= 0; i--) {
      const month = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthName = month.toLocaleDateString("el-GR", { month: "short" });
      months.push(monthName);

      const monthCost = this.costs
        .filter((cost) => {
          const costDate = new Date(cost.date);
          return (
            costDate.getMonth() === month.getMonth() &&
            costDate.getFullYear() === month.getFullYear()
          );
        })
        .reduce((sum, cost) => sum + Number(cost.amount), 0);

      data.push(monthCost);
    }

    return { labels: months, data };
  }

  updateCharts() {
    // detect breakpoint change (desktop vs mobile)
    const isDesktop = window.matchMedia("(min-width: 769px)").matches;
    const prevIsDesktop = this._isDesktopCharts;
    this._isDesktopCharts = isDesktop;

    // Αν άλλαξε breakpoint, κάνε destroy & recreate για σωστά options/legend
    if (prevIsDesktop !== undefined && prevIsDesktop !== isDesktop) {
      Object.values(this.charts || {}).forEach((ch) => {
        try {
          ch?.destroy();
        } catch (e) {}
      });
      this.charts = {};

      // ξαναστήνουμε όλα
      this.setupCostByCategoryChart();
      this.setupMonthlyCostsChart();
      this.setupCostByVehicleChart();
      this.setupCostTrendChart();
      return;
    }

    // ====== normal data updates ======
    const costsByCategory = this.groupCostsByCategory(this.filteredCosts || []);
    if (this.charts.costByCategory) {
      this.charts.costByCategory.data.labels = Object.keys(costsByCategory).map(
        (cat) => this.getCategoryLabel(cat)
      );
      this.charts.costByCategory.data.datasets[0].data =
        Object.values(costsByCategory);
      this.charts.costByCategory.update();
    }

    const monthlyData = this.getMonthlyCostsData();
    if (this.charts.monthlyCosts) {
      this.charts.monthlyCosts.data.datasets[0].data = monthlyData;
      this.charts.monthlyCosts.update();
    }

    const costsByVehicle = this.groupCostsByVehicle(this.filteredCosts || []);
    if (this.charts.costByVehicle) {
      this.charts.costByVehicle.data.labels = Object.keys(costsByVehicle).map(
        (vehicleId) => {
          const vehicle = this.getVehicleById(parseInt(vehicleId));
          return vehicle ? `${vehicle.model}` : `Όχημα ${vehicleId}`;
        }
      );
      this.charts.costByVehicle.data.datasets[0].data =
        Object.values(costsByVehicle);
      this.charts.costByVehicle.update();
    }

    const monthlyTrends = this.getMonthlyTrends();
    if (this.charts.costTrend) {
      this.charts.costTrend.data.labels = monthlyTrends.labels;
      this.charts.costTrend.data.datasets[0].data = monthlyTrends.data;
      this.charts.costTrend.update();
    }
  }

  groupCostsByCategory(costs) {
    const groups = {};
    costs.forEach((cost) => {
      groups[cost.category] =
        (groups[cost.category] || 0) + Number(cost.amount);
    });
    return groups;
  }

  groupCostsByVehicle(costs) {
    const groups = {};
    costs.forEach((cost) => {
      groups[cost.vehicleId] =
        (groups[cost.vehicleId] || 0) + Number(cost.amount);
    });
    return groups;
  }

  /* ================== BREAKDOWNS ================== */

  updateBreakdowns() {
    this.updateCategoryBreakdown();
    this.updateVehicleBreakdown();
    this.updateMonthlyComparison();
  }

  updateCategoryBreakdown() {
    const container = document.getElementById("categoryBreakdown");
    if (!container) return;

    const costsByCategory = this.groupCostsByCategory(this.filteredCosts || []);
    const totalCost = Object.values(costsByCategory).reduce(
      (sum, amount) => sum + amount,
      0
    );

    container.innerHTML = Object.entries(costsByCategory)
      .sort(([, a], [, b]) => b - a)
      .map(([category, amount]) => {
        const percentage =
          totalCost > 0 ? ((amount / totalCost) * 100).toFixed(1) : 0;
        return `
                    <div class="breakdown-item">
                        <span class="breakdown-label">${safeHtml(
                          this.getCategoryLabel(category)
                        )}</span>
                        <div>
                            <span class="breakdown-value">€${amount.toFixed(
                              2
                            )}</span>
                            <span class="breakdown-percentage">${percentage}%</span>
                        </div>
                    </div>
                `;
      })
      .join("");
  }

  updateVehicleBreakdown() {
    const container = document.getElementById("vehicleBreakdown");
    if (!container) return;

    const user = JSON.parse(localStorage.getItem("currentUser"));
    const vehicles = this.getVehicles(user?.companyId);
    const costsByVehicle = this.groupCostsByVehicle(this.filteredCosts);
    const totalCost = Object.values(costsByVehicle).reduce(
      (sum, amount) => sum + amount,
      0
    );

    container.innerHTML = Object.entries(costsByVehicle)
      .sort(([, a], [, b]) => b - a)
      .map(([vehicleId, amount]) => {
        const vehicle = vehicles.find((v) => v.id == vehicleId);
        const percentage =
          totalCost > 0 ? ((amount / totalCost) * 100).toFixed(1) : 0;
        return `
                    <div class="breakdown-item">
                        <span class="breakdown-label">${
                          safeHtml(vehicle ? vehicle.model : "Unknown")
                        }</span>
                        <div>
                            <span class="breakdown-value">€${amount.toFixed(
                              2
                            )}</span>
                            <span class="breakdown-percentage">${percentage}%</span>
                        </div>
                    </div>
                `;
      })
      .join("");
  }

  updateMonthlyComparison() {
    const container = document.getElementById("monthlyComparison");
    if (!container) return;

    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const previousMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const previousYear = currentMonth === 0 ? currentYear - 1 : currentYear;

    const currentMonthCost = this.filteredCosts
      .filter((cost) => {
        const costDate = new Date(cost.date);
        return (
          costDate.getMonth() === currentMonth &&
          costDate.getFullYear() === currentYear
        );
      })
      .reduce((sum, cost) => sum + Number(cost.amount), 0);

    const previousMonthCost = this.filteredCosts
      .filter((cost) => {
        const costDate = new Date(cost.date);
        return (
          costDate.getMonth() === previousMonth &&
          costDate.getFullYear() === previousYear
        );
      })
      .reduce((sum, cost) => sum + Number(cost.amount), 0);

    const change =
      previousMonthCost > 0
        ? ((currentMonthCost - previousMonthCost) / previousMonthCost) * 100
        : 0;

    container.innerHTML = `
            <div class="breakdown-item">
                <span class="breakdown-label">Τρέχων Μήνας</span>
                <span class="breakdown-value">€${currentMonthCost.toFixed(
                  2
                )}</span>
            </div>
            <div class="breakdown-item">
                <span class="breakdown-label">Προηγούμενος Μήνας</span>
                <span class="breakdown-value">€${previousMonthCost.toFixed(
                  2
                )}</span>
            </div>
            <div class="breakdown-item">
                <span class="breakdown-label">Μεταβολή</span>
                <span class="breakdown-value ${
                  change >= 0 ? "trend-up" : "trend-down"
                }">
                    ${change >= 0 ? "+" : ""}${change.toFixed(1)}%
                </span>
            </div>
        `;
  }

  getVehicles(companyId) {
    const all = this.vehicles || [];
    if (companyId == null) return all;
    return all.filter((v) => v.companyId == companyId);
  }

  /* ================== EXPORT ================== */

  exportCosts() {
    const list =
      Array.isArray(this.filteredCosts) && this.filteredCosts.length
        ? this.filteredCosts
        : this.costs || [];

    if (!list.length) {
      this.showNotification("Δεν υπάρχουν δεδομένα προς εξαγωγή", "info");
      return;
    }

    const user = JSON.parse(localStorage.getItem("currentUser")) || null;
    window.CaReMindCostsExport.exportCsv({
      costs: list,
      vehicles: this.getVehicles(user?.companyId),
      categoryLabel: (category) => this.getCategoryLabel(category),
    });
  }

  normalizeCategory(cat) {
    return String(cat || "")
      .trim()
      .toLowerCase();
  }

  /* ================== HELPERS ================== */

  getCategoryLabel(category) {
    const key = String(category || "")
      .trim()
      .toLowerCase();
    const labels = {
      fuel: "Καύσιμα",
      maintenance: "Συντήρηση",
      insurance: "Ασφάλεια",
      repair: "Επισκευές",
      taxes: "Τέλη",
      tolls: "Διόδια",
      parking: "Στάθμευση",
      wash: "Πλύσιμο",
      fines: "Πρόστιμα",
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
      kteo: "ΚΤΕΟ",

      other: "Άλλο",
    };
    return labels[key] || category;
  }

  showNotification(message, type = "info") {
    window.CaReMindUI.toast(message, type);
  }

  /* ================== EVENT HANDLERS ================== */

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
        case "export":
          this.exportCosts();
          break;
        case "edit":
          if (id != null) this.editCost(id);
          break;
        case "delete":
          if (id != null) this.deleteCost(id);
          break;
        case "add":
          this.showCostModal();
          break;
        case "previous-page":
          this.previousPage();
          break;
        case "next-page":
          this.nextPage();
          break;
        default:
          break;
      }
    });
  }

  // Πρόσθεσε αυτή τη μέθοδο στην κλάση CostsManager
  toggleCostOtherField() {

    const categorySelect = document.getElementById("costCategorySelect");
    const otherInput = document.getElementById("costCategoryOther");

    if (categorySelect && otherInput) {
      const isOther = categorySelect.value === "other";

      if (isOther) {
        otherInput.style.display = "block";
        otherInput.style.visibility = "visible";
        otherInput.required = true;
      } else {
        otherInput.style.display = "none";
        otherInput.style.visibility = "hidden";
        otherInput.required = false;
        otherInput.value = "";
      }
    } else {
      console.error("❌ Cost elements not found!");
    }
  }

  setupEventListeners() {
    if (this._eventsBound) return;
    this._eventsBound = true;


    // Cost form
    const form = document.getElementById("costForm");
    if (form) {
      form.addEventListener("submit", (e) => this.handleFormSubmit(e));
    }

    // ΠΡΟΣΘΗΚΗ: Event listener για το costCategorySelect dropdown
    const costCategorySelect = document.getElementById("costCategorySelect");
    if (costCategorySelect) {
      costCategorySelect.addEventListener("change", () => {
        this.toggleCostOtherField(); // ΠΡΟΣΘΗΚΗ ΑΥΤΗΣ ΤΗΣ ΓΡΑΜΜΗΣ
      });
      // Αρχική κλήση για να εμφανιστεί/αποκρυφθεί σωστά
      this.toggleCostOtherField(); // ΠΡΟΣΘΗΚΗ ΑΥΤΗΣ ΤΗΣ ΓΡΑΜΜΗΣ
    } else {
      console.error("❌ costCategorySelect element NOT FOUND!");
    }

    // Filters
    ["costPeriod", "costVehicle", "costCategory"].forEach((id) => {
      const element = document.getElementById(id);
      if (element) {
        element.addEventListener("change", () => this.handleFilterChange());
      }
    });

    // Custom date range
    const startDate = document.getElementById("startDate");
    const endDate = document.getElementById("endDate");
    if (startDate)
      startDate.addEventListener("change", () => this.handleFilterChange());
    if (endDate)
      endDate.addEventListener("change", () => this.handleFilterChange());

    // Set today's date as default
    const costDate = document.getElementById("costDate");
    if (costDate) costDate.valueAsDate = new Date();
  }

  handleFilterChange() {
    const period = document.getElementById("costPeriod")?.value || "month";
    this.currentFilters.period = period;

    // Show/hide custom date range group
    const customRange = document.getElementById("customDateRange");
    if (customRange) {
      if (period === "custom") {
        customRange.style.display = "block";
      } else {
        customRange.style.display = "none";
        this.currentFilters.startDate = null;
        this.currentFilters.endDate = null;
      }
    }

    // Recompute immediately
    this.filterCosts();
  }

  setupModalEvents() {
    const modal = document.getElementById("addCostModal");
    const closeButton = document.querySelector("#addCostModal .close");
    const cancelButton = document.querySelector("#addCostModal .btn-secondary");

    if (closeButton) {
      closeButton.addEventListener("click", () => this.closeCostModal());
    }
    if (cancelButton) {
      cancelButton.addEventListener("click", () => this.closeCostModal());
    }

    // if (modal) {
    //   modal.addEventListener("click", (e) => {
    //     if (e.target === modal) {
    //       this.closeCostModal();
    //     }
    //   });
    // }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.closeCostModal();
      }
    });

    // Also support specific ID buttons used in some templates
    const closeBtnById = document.getElementById("modalCloseBtn");
    if (closeBtnById) {
      closeBtnById.addEventListener("click", () => this.closeCostModal());
    }
    const cancelBtnById = document.getElementById("modalCancelBtn");
    if (cancelBtnById) {
      cancelBtnById.addEventListener("click", () => this.closeCostModal());
    }
  }

  previousPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.loadCostsData();
    }
  }

  nextPage() {
    const totalPages = Math.ceil(this.filteredCosts.length / this.itemsPerPage);

    if (this.currentPage < totalPages) {
      this.currentPage++;
      this.loadCostsData();
    }
  }

  resetFilters() {
    this.currentFilters = {
      period: "all",
      vehicle: "all",
      category: "all",
      startDate: null,
      endDate: null,
    };

    document.getElementById("costPeriod").value = "all";
    document.getElementById("costVehicle").value = "all";
    document.getElementById("costCategory").value = "all";

    const customRange = document.getElementById("customDateRange");
    if (customRange) customRange.style.display = "none";

    document.getElementById("startDate").value = "";
    document.getElementById("endDate").value = "";

    this.filterCosts();
  }
}

// Global functions
window.showAddCostModal = () => {
  if (window.costsManager) window.costsManager.showCostModal();
};

window.closeAddCostModal = () => {
  if (window.costsManager) window.costsManager.closeCostModal();
};

window.filterCosts = () => {
  if (window.costsManager) window.costsManager.filterCosts();
};

window.resetFilters = () => {
  if (window.costsManager) window.costsManager.resetFilters();
};

window.exportCosts = () => {
  if (window.costsManager) window.costsManager.exportCosts();
};

// Initialize costs manager
let costsManager;

function initializeCostsManager() {
  if (window.costsManager) {
    return;
  }
  try {
    costsManager = new CostsManager();
    window.costsManager = costsManager;
  } catch (error) {
    console.error("❌ Error initializing Costs Manager:", error);
  }
}

// Event listener
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeCostsManager);
} else {
  initializeCostsManager();
}
