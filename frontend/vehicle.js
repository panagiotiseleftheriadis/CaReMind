const vehicleUi = window.CaReMindUI;

class VehicleDetailManager {
  constructor() {
    if (window.CaReMindDemo?.isActive?.()) window.CaReMindDemo.setVehicleArchiveEnabled(true);
    this.vehicle = null;
    this.id = this.readId();
    this.fields = ["vehicleType", "chassisNumber", "model", "year", "currentMileage", "registrationPlate", "registrationCountry", "make", "vin", "fuelType", "purchaseDate", "purchaseAmount", "currency"];
    this.bind();
    if (this.id) this.load(); else this.showError("Ο σύνδεσμος δεν περιέχει έγκυρο αναγνωριστικό οχήματος.", false);
  }

  readId() { const raw = new URLSearchParams(window.location.search).get("id"); return /^\d+$/.test(raw || "") && Number(raw) > 0 ? Number(raw) : null; }
  bind() {
    document.getElementById("retryVehicle").addEventListener("click", () => this.load());
    document.getElementById("editVehicleButton").addEventListener("click", () => this.openEdit());
    document.getElementById("closeVehicleEdit").addEventListener("click", () => this.closeEdit());
    document.getElementById("cancelVehicleEdit").addEventListener("click", () => this.closeEdit());
    document.getElementById("editVehicleForm").addEventListener("submit", (event) => this.saveEdit(event));
    document.getElementById("archiveVehicleButton").addEventListener("click", () => this.archive());
    document.getElementById("restoreVehicleButton").addEventListener("click", () => this.restore());
    document.getElementById("editYear").max = String(new Date().getFullYear() + 1);
  }
  async load() {
    this.setLoading(true);
    try { this.vehicle = await api.getVehicle(this.id); this.render(); await this.loadHistory(); }
    catch (error) { this.showError(error.status === 404 ? "Το όχημα δεν βρέθηκε ή δεν είναι διαθέσιμο στον λογαριασμό σου." : "Παρουσιάστηκε πρόβλημα σύνδεσης. Δοκίμασε ξανά.", error.status !== 404); }
    finally { this.setLoading(false); }
  }
  async loadHistory() {
    document.getElementById("allMaintenanceLink").href = `/maintenance?vehicleId=${this.id}`;
    document.getElementById("allCostsLink").href = `/costs?vehicleId=${this.id}`;
    const [maintenance, costs] = await Promise.allSettled([api.getMaintenances(this.id), api.getCosts(this.id)]);
    this.renderMaintenanceHistory(maintenance.status === "fulfilled" && Array.isArray(maintenance.value) ? maintenance.value : null);
    this.renderCostHistory(costs.status === "fulfilled" && Array.isArray(costs.value) ? costs.value : null);
  }
  renderMaintenanceHistory(items) {
    const node = document.getElementById("vehicleMaintenanceHistory");
    if (items === null) { node.textContent = "Δεν ήταν δυνατή η φόρτωση του ιστορικού."; return; }
    if (!items.length) { node.textContent = "Δεν υπάρχουν ακόμη καταχωρήσεις συντήρησης."; return; }
    node.innerHTML = items.slice(0, 3).map((item) => { const label = window.CaReMindRecordLabels.maintenance(item); return `<div class="history-row"><div class="history-row-main"><strong>${vehicleUi.escapeHtml(label.title)}</strong>${label.description ? `<small>${vehicleUi.escapeHtml(label.description)}</small>` : ""}</div><span>${vehicleUi.escapeHtml(this.date(item.nextDate || item.lastDate) || window.CaReMindRecordLabels.status(item.status) || "—")}</span></div>`; }).join("");
  }
  renderCostHistory(items) {
    const node = document.getElementById("vehicleCostHistory");
    if (items === null) { node.textContent = "Δεν ήταν δυνατή η φόρτωση των εξόδων."; return; }
    if (!items.length) { node.textContent = "Δεν υπάρχουν ακόμη καταχωρήσεις κόστους."; return; }
    node.innerHTML = items.slice(0, 3).map((item) => { const label = window.CaReMindRecordLabels.cost(item); return `<div class="history-row"><div class="history-row-main"><strong>${vehicleUi.escapeHtml(label.title)}</strong>${label.description ? `<small>${vehicleUi.escapeHtml(label.description)}</small>` : ""}</div><span>${vehicleUi.escapeHtml(this.money(item.amount, "EUR") || "—")} · ${vehicleUi.escapeHtml(this.date(item.date) || "—")}</span></div>`; }).join("");
  }
  setLoading(active) { document.getElementById("vehicleLoading").hidden = !active; if (active) { document.getElementById("vehicleContent").hidden = true; document.getElementById("vehicleError").hidden = true; } }
  showError(message, retry = true) { document.getElementById("vehicleLoading").hidden = true; document.getElementById("vehicleContent").hidden = true; document.getElementById("vehicleError").hidden = false; document.getElementById("vehicleErrorMessage").textContent = message; document.getElementById("retryVehicle").hidden = !retry; }
  render() {
    const v = this.vehicle;
    const makeModel = vehicleUi.vehicleDisplayName(v.make, v.model);
    const title = makeModel || v.registrationPlate || v.vehicleType || "Όχημα";
    const subtitle = [v.registrationPlate, v.vehicleType].filter((value, index, values) => value && value !== title && values.indexOf(value) === index).join(" · ");
    document.title = `${title} | CaReMind`;
    document.getElementById("vehicleTitle").textContent = title;
    document.getElementById("vehicleSubtitle").textContent = subtitle;
    document.getElementById("vehicleMileage").textContent = v.currentMileage == null ? "Δεν έχει καταχωρηθεί" : `${Number(v.currentMileage).toLocaleString("el-GR")} χλμ`;
    document.getElementById("vehicleYear").textContent = v.year || "Δεν έχει καταχωρηθεί";
    const archived = v.state === "archived" || v.archivedAt != null;
    const badge = document.getElementById("vehicleStateBadge"); badge.textContent = archived ? "Αρχειοθετημένο" : "Ενεργό"; badge.classList.toggle("is-archived", archived);
    document.getElementById("archivedNotice").hidden = !archived;
    document.getElementById("editVehicleButton").hidden = archived;
    document.getElementById("archiveVehicleButton").hidden = archived;
    document.getElementById("restoreVehicleButton").hidden = !archived;
    document.getElementById("overviewGroups").innerHTML = [
      this.group("Ταυτότητα", [["Μάρκα", v.make], ["Μοντέλο", v.model], ["Τύπος", v.vehicleType], ["Πινακίδα", v.registrationPlate], ["Χώρα", v.registrationCountry], ["Αριθμός πλαισίου", v.chassisNumber], ["VIN", v.vin]]),
      this.group("Στοιχεία οχήματος", [["Έτος", v.year], ["Καύσιμο", this.fuel(v.fuelType)], ["Τρέχοντα χιλιόμετρα", v.currentMileage == null ? null : `${Number(v.currentMileage).toLocaleString("el-GR")} χλμ`]]),
      this.group("Αγορά", [["Ημερομηνία", this.date(v.purchaseDate)], ["Ποσό", this.money(v.purchaseAmount, v.currency)], ["Νόμισμα", v.currency]]),
      this.group("Κατάσταση", [["Κατάσταση οχήματος", archived ? "Αρχειοθετημένο" : "Ενεργό"]]),
    ].join("");
    document.getElementById("vehicleContent").hidden = false; document.getElementById("vehicleError").hidden = true;
  }
  group(title, entries) { const visible = entries.filter(([, value]) => value !== null && value !== undefined && value !== ""); return `<section class="overview-group"><h3>${vehicleUi.escapeHtml(title)}</h3><dl>${visible.length ? visible.map(([label, value]) => `<div><dt>${vehicleUi.escapeHtml(label)}</dt><dd>${vehicleUi.escapeHtml(value)}</dd></div>`).join("") : '<div class="overview-empty">Δεν έχει καταχωρηθεί</div>'}</dl></section>`; }
  fuel(value) { return ({ gasoline:"Βενζίνη", diesel:"Πετρέλαιο", hybrid:"Υβριδικό", plug_in_hybrid:"Plug-in υβριδικό", electric:"Ηλεκτρικό", lpg:"Υγραέριο (LPG)", cng:"Φυσικό αέριο (CNG)", hydrogen:"Υδρογόνο", other:"Άλλο" })[value] || null; }
  date(value) { if (!value) return null; const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`); return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString("el-GR"); }
  money(value, currency) { if (value == null) return null; try { return new Intl.NumberFormat("el-GR", { style:"currency", currency: currency || "EUR" }).format(Number(value)); } catch { return `${Number(value).toLocaleString("el-GR")} ${currency || "EUR"}`; } }
  openEdit() { const v = this.vehicle; this.fields.forEach((field) => { const node = document.getElementById(`edit${field[0].toUpperCase()}${field.slice(1)}`); if (node) node.value = v[field] ?? ""; }); document.getElementById("editVehicleError").hidden = true; document.getElementById("editVehicleModal").style.display = "flex"; }
  closeEdit() { document.getElementById("editVehicleModal").style.display = "none"; }
  readForm() { const result = {}; const nullableNumbers = new Set(["year", "currentMileage", "purchaseAmount"]); this.fields.forEach((field) => { const node = document.getElementById(`edit${field[0].toUpperCase()}${field.slice(1)}`); let value = node.value.trim(); if (["vehicleType", "chassisNumber"].includes(field)) value = value; else if (!value) value = null; else if (nullableNumbers.has(field)) value = Number(value); else if (["registrationCountry", "vin", "currency"].includes(field)) value = value.toUpperCase(); const original = this.vehicle[field] == null ? null : (nullableNumbers.has(field) ? Number(this.vehicle[field]) : String(this.vehicle[field])); if (value !== original) result[field] = value; }); return result; }
  async saveEdit(event) { event.preventDefault(); const patch = this.readForm(); const errorNode = document.getElementById("editVehicleError"); if (!Object.keys(patch).length) { this.closeEdit(); return; } const submit = event.currentTarget.querySelector('[type="submit"]'); submit.disabled = true; errorNode.hidden = true; try { this.vehicle = await api.patchVehicle(this.id, patch); this.render(); this.closeEdit(); vehicleUi.toast("Οι αλλαγές αποθηκεύτηκαν.", "success"); } catch (error) { errorNode.textContent = error.code === "DUPLICATE_CHASSIS_NUMBER" ? "Υπάρχει ήδη όχημα με αυτόν τον αριθμό πλαισίου." : error.status === 404 ? "Το όχημα δεν βρέθηκε ή δεν είναι πλέον διαθέσιμο." : error.status === 400 ? "Έλεγξε τα στοιχεία της φόρμας. Κάποια τιμή δεν είναι έγκυρη." : "Η ενημέρωση απέτυχε. Δοκίμασε ξανά."; errorNode.hidden = false; } finally { submit.disabled = false; } }
  archiveMessage() { return "Το όχημα θα μεταφερθεί στο αρχείο. Τα service, τα κόστη και το ιστορικό του δεν θα διαγραφούν."; }
  async archive() { const confirmed = await vehicleUi.confirm(this.archiveMessage(), { title:"Αρχειοθέτηση οχήματος", confirmLabel:"Αρχειοθέτηση", cancelLabel:"Ακύρωση" }); if (!confirmed) return; try { this.vehicle = await api.archiveVehicle(this.id); this.render(); vehicleUi.toast("Το όχημα μεταφέρθηκε στο αρχείο.", "success"); } catch (error) { vehicleUi.toast(error.code === "VEHICLE_ARCHIVE_DISABLED" ? "Η αρχειοθέτηση δεν είναι ακόμη διαθέσιμη. Το όχημα δεν διαγράφηκε." : error.status === 404 ? "Το όχημα δεν βρέθηκε ή δεν είναι διαθέσιμο." : "Η αρχειοθέτηση απέτυχε. Δοκίμασε ξανά.", "error"); } }
  async restore() { try { this.vehicle = await api.restoreVehicle(this.id); this.render(); vehicleUi.toast("Το όχημα επανήλθε στα ενεργά.", "success"); } catch (error) { vehicleUi.toast(error.code === "VEHICLE_ARCHIVE_DISABLED" ? "Η επαναφορά δεν είναι ακόμη διαθέσιμη." : error.status === 404 ? "Το όχημα δεν βρέθηκε ή δεν είναι διαθέσιμο." : "Η επαναφορά απέτυχε. Δοκίμασε ξανά.", "error"); } }
}

document.addEventListener("DOMContentLoaded", () => { window.vehicleDetailManager = new VehicleDetailManager(); });
