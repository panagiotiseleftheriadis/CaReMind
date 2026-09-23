const safeHtml = window.CaReMindUI.escapeHtml;

class VehiclesManager {
  constructor() {
    if (window.CaReMindDemo?.isActive?.()) window.CaReMindDemo.setVehicleArchiveEnabled(true);
    this.state = new URLSearchParams(window.location.search).get("state") === "archived" ? "archived" : "active";
    this.vehicles = [];
    this.setup();
    this.loadVehicles();
  }

  setup() {
    document.getElementById("year").max = String(new Date().getFullYear() + 1);
    document.querySelectorAll("[data-state]").forEach((button) => button.addEventListener("click", () => this.changeState(button.dataset.state)));
    document.getElementById("openAddVehicle").addEventListener("click", () => this.openAdd());
    document.getElementById("closeAddVehicle").addEventListener("click", () => this.closeAdd());
    document.getElementById("cancelAddVehicle").addEventListener("click", () => this.closeAdd());
    document.getElementById("vehicleForm").addEventListener("submit", (event) => this.addVehicle(event));
    document.getElementById("vehicleType").addEventListener("change", (event) => {
      const other = document.getElementById("vehicleTypeOther");
      other.hidden = event.target.value !== "other";
      other.required = event.target.value === "other";
      if (other.hidden) other.value = "";
    });
    this.syncStateControls();
    if (new URLSearchParams(window.location.search).get("add") === "1") this.openAdd();
  }

  syncStateControls() {
    document.querySelectorAll("[data-state]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.state === this.state)));
  }

  async changeState(state) {
    if (state === this.state) return;
    this.state = state;
    this.syncStateControls();
    window.history.replaceState({}, "", `/vehicles?state=${state}`);
    await this.loadVehicles();
  }

  async loadVehicles() {
    const grid = document.getElementById("vehiclesGrid");
    const status = document.getElementById("vehiclesStatus");
    grid.setAttribute("aria-busy", "true");
    grid.innerHTML = '<div class="vehicles-loading"><span class="app-loading-spinner" aria-hidden="true"></span><p>Φόρτωση οχημάτων…</p></div>';
    status.textContent = "";
    try {
      const [vehicles, active, archived] = await Promise.all([api.getVehicles(this.state), api.getVehicles("active"), api.getVehicles("archived")]);
      this.vehicles = Array.isArray(vehicles) ? vehicles : [];
      document.getElementById("activeCount").textContent = `(${Array.isArray(active) ? active.length : 0})`;
      document.getElementById("archivedCount").textContent = `(${Array.isArray(archived) ? archived.length : 0})`;
      this.render();
    } catch (error) {
      console.error("Vehicle list error:", error);
      grid.innerHTML = '<div class="vehicles-empty vehicles-error"><h3>Δεν μπορέσαμε να φορτώσουμε τα οχήματα.</h3><p>Έλεγξε τη σύνδεσή σου και δοκίμασε ξανά.</p><button type="button" class="btn-secondary" id="retryVehicles">Νέα προσπάθεια</button></div>';
      document.getElementById("retryVehicles")?.addEventListener("click", () => this.loadVehicles());
      status.textContent = "Η φόρτωση απέτυχε.";
    } finally { grid.setAttribute("aria-busy", "false"); }
  }

  render() {
    const grid = document.getElementById("vehiclesGrid");
    if (!this.vehicles.length) {
      const active = this.state === "active";
      grid.innerHTML = `<div class="vehicles-empty"><span class="empty-glyph" aria-hidden="true">${active ? "+" : "↺"}</span><h3>${active ? "Δεν έχεις ενεργά οχήματα." : "Δεν έχεις αρχειοθετημένα οχήματα."}</h3>${active ? '<button type="button" class="btn-primary" id="emptyAddVehicle">Πρόσθεσε όχημα</button>' : '<p>Όταν αρχειοθετήσεις ένα όχημα, θα παραμείνει εδώ μαζί με το ιστορικό του.</p>'}</div>`;
      document.getElementById("emptyAddVehicle")?.addEventListener("click", () => this.openAdd());
      return;
    }
    grid.innerHTML = this.vehicles.map((vehicle) => this.card(vehicle)).join("");
  }

  card(vehicle) {
    const id = Number(vehicle.id);
    const makeModel = window.CaReMindUI.vehicleDisplayName(vehicle.make, vehicle.model);
    const title = makeModel || vehicle.registrationPlate || vehicle.vehicleType || `Όχημα ${id}`;
    const subtitle = vehicle.registrationPlate || vehicle.vehicleType || vehicle.chassisNumber;
    const mileage = vehicle.currentMileage == null ? "Δεν έχει καταχωρηθεί" : `${Number(vehicle.currentMileage).toLocaleString("el-GR")} χλμ`;
    const archived = this.state === "archived";
    return `<article class="vehicle-card${archived ? " is-archived" : ""}"><a class="vehicle-card-link" href="/vehicle?id=${id}" aria-label="Άνοιγμα οχήματος ${safeHtml(title)}"><div class="vehicle-card-top"><span class="vehicle-state-badge">${archived ? "Αρχειοθετημένο" : "Ενεργό"}</span><span aria-hidden="true" class="vehicle-card-arrow">↗</span></div><h3>${safeHtml(title)}</h3>${subtitle && subtitle !== title ? `<p class="vehicle-card-subtitle">${safeHtml(subtitle)}</p>` : ""}<dl><div><dt>Χιλιόμετρα</dt><dd>${safeHtml(mileage)}</dd></div><div><dt>Αριθμός πλαισίου</dt><dd>${safeHtml(vehicle.chassisNumber || "Δεν έχει καταχωρηθεί")}</dd></div></dl></a></article>`;
  }

  openAdd() { document.getElementById("addVehicleModal").style.display = "flex"; window.history.replaceState({}, "", "/vehicles"); }
  closeAdd() { document.getElementById("addVehicleModal").style.display = "none"; document.getElementById("vehicleForm").reset(); document.getElementById("vehicleTypeOther").hidden = true; document.getElementById("addVehicleError").hidden = true; }

  async addVehicle(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const errorNode = document.getElementById("addVehicleError");
    const selectedType = document.getElementById("vehicleType").value;
    const vehicleType = selectedType === "other" ? document.getElementById("vehicleTypeOther").value.trim() : selectedType;
    const rawMileage = document.getElementById("currentMileage").value;
    const rawYear = document.getElementById("year").value;
    const value = (id, uppercase = false) => {
      const raw = document.getElementById(id).value.trim();
      return raw ? (uppercase ? raw.toUpperCase() : raw) : null;
    };
    const rawPurchaseAmount = document.getElementById("purchaseAmount").value;
    const payload = {
      vehicleType,
      chassisNumber: document.getElementById("chassisNumber").value.trim(),
      make: value("make"), model: value("model"), registrationPlate: value("registrationPlate"),
      registrationCountry: value("registrationCountry", true), vin: value("vin", true), fuelType: value("fuelType"),
      year: rawYear ? Number(rawYear) : null, currentMileage: rawMileage ? Number(rawMileage) : null,
      purchaseDate: value("purchaseDate"), purchaseAmount: rawPurchaseAmount ? Number(rawPurchaseAmount) : null,
      currency: value("currency", true),
    };
    errorNode.hidden = true;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const created = await api.addVehicle(payload);
      this.closeAdd();
      window.CaReMindUI.toast("Το όχημα προστέθηκε.", "success");
      window.location.href = `/vehicle?id=${Number(created.id)}`;
    } catch (error) {
      errorNode.textContent = error.code === "DUPLICATE_CHASSIS_NUMBER" ? "Υπάρχει ήδη όχημα με αυτόν τον αριθμό πλαισίου." : "Δεν ήταν δυνατή η αποθήκευση. Έλεγξε τα στοιχεία και δοκίμασε ξανά.";
      errorNode.hidden = false;
    } finally { submit.disabled = false; }
  }
}

document.addEventListener("DOMContentLoaded", () => { window.vehiclesManager = new VehiclesManager(); });
