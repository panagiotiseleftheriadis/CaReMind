class VehiclesManager {
  constructor() {
    this.init();
  }

  init() {
    console.log("🚗 VehiclesManager initialized");
    this.loadVehicles();
    this.setupEventListeners();
    this.setupModalEvents();
  }

  setupModalEvents() {
    // Close buttons
    const closeButtons = document.querySelectorAll(".modal .close");
    closeButtons.forEach((button) => {
      button.addEventListener("click", (e) => {
        const modal = e.target.closest(".modal");
        if (modal.id === "addVehicleModal") {
          this.closeAddVehicleForm();
        } else if (modal.id === "editVehicleModal") {
          this.closeEditVehicleModal();
        }
      });
    });

    // Cancel buttons
    const cancelButtons = document.querySelectorAll(
      'button.btn-secondary[data-action="cancel"]'
    );

    cancelButtons.forEach((button) => {
      button.addEventListener("click", (e) => {
        // ✅ Αν είναι submit κουμπί, ΜΗΝ το θεωρείς cancel
        if (button.type === "submit") return;

        const modal = e.target.closest(".modal");
        if (!modal) return;

        if (modal.id === "addVehicleModal") this.closeAddVehicleForm();
        if (modal.id === "editVehicleModal") this.closeEditVehicleModal();
      });
    });

    // // Close when clicking outside modal
    // const modals = document.querySelectorAll(".modal");
    // modals.forEach((modal) => {
    //   modal.addEventListener("click", (e) => {
    //     if (e.target === modal) {
    //       if (modal.id === "addVehicleModal") {
    //         this.closeAddVehicleForm();
    //       } else if (modal.id === "editVehicleModal") {
    //         this.closeEditVehicleModal();
    //       }
    //     }
    //   });
    // });

    // Close with Escape key
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (
          document.getElementById("addVehicleModal").style.display === "flex"
        ) {
          this.closeAddVehicleForm();
        } else if (
          document.getElementById("editVehicleModal").style.display === "flex"
        ) {
          this.closeEditVehicleModal();
        }
      }
    });
  }

  async loadVehicles() {
    console.log("📥 Loading vehicles from API...");
    const user = JSON.parse(localStorage.getItem("currentUser"));
    console.log("User:", user);

    if (!user) {
      console.log("❌ No user found");
      this.showNoVehiclesMessage();
      return;
    }

    try {
      const userVehicles = await api.getVehicles();
      this.currentVehicles = userVehicles;
      console.log("User vehicles from API:", userVehicles);

      if (!userVehicles || userVehicles.length === 0) {
        this.showNoVehiclesMessage();
      } else {
        this.renderVehiclesTable(userVehicles);
        this.updateStats(userVehicles);
      }
    } catch (error) {
      console.error("❌ Error loading vehicles:", error);
      this.showNoVehiclesMessage();
      this.showNotification("❌ Σφάλμα κατά τη φόρτωση των οχημάτων", "error");
    }
  }

  renderVehiclesTable(vehicles) {
    const tbody = document.getElementById("vehiclesTableBody");
    if (!tbody) {
      console.log("❌ Table body not found");
      return;
    }

    console.log("🔄 Rendering", vehicles.length, "vehicles");
    tbody.innerHTML = "";

    if (vehicles.length === 0) {
      this.showNoVehiclesMessage();
      return;
    }

    vehicles.forEach((vehicle) => {
      // Ασφαλής έλεγχος για year
      const yearText =
        vehicle.year != null && vehicle.year !== "" ? vehicle.year : "-";

      // Ασφαλής έλεγχος για currentMileage
      const mileageText =
        vehicle.currentMileage != null
          ? vehicle.currentMileage.toLocaleString("el-GR")
          : "-";

      const row = document.createElement("tr");
      row.dataset.vehicleId = vehicle.id;
      // Στο αρχείο vehicles.js, μέσα στη μέθοδο renderVehiclesTable(vehicles):

      row.innerHTML = `
  <td>${vehicle.chassisNumber}</td>
  <td>${vehicle.vehicleType}</td>
  <td>${vehicle.model || "-"}</td>
  <td>${yearText}</td>
  <td>${mileageText} χλμ</td>
  <td>
    <div class="vehicle-actions-row">
      <button class="btn-secondary" onclick="editVehicle(${
        vehicle.id
      })">Επεξεργασία</button>
      
      <button class="btn-secondary delete-btn" onclick="deleteVehicle(${
        vehicle.id
      })">Διαγραφή</button>
    </div>
  </td>
`;
      tbody.appendChild(row);
    });
  }

  showNoVehiclesMessage() {
    const tbody = document.getElementById("vehiclesTableBody");
    if (!tbody) return;

    tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 3rem; color: #666; font-style: italic;">
                    Δεν υπάρχει καταχωρημένο όχημα
                </td>
            </tr>
        `;
  }

  updateStats(vehicles) {
    const totalElement = document.getElementById("totalVehicles");
    if (totalElement) {
      totalElement.textContent = vehicles.length;
    }
  }

  setupEventListeners() {
    // Add vehicle form
    const vehicleForm = document.getElementById("vehicleForm");
    if (vehicleForm) {
      console.log("✅ Add form event listener added");
      vehicleForm.addEventListener("submit", (e) =>
        this.handleVehicleSubmit(e)
      );
    }

    // Edit vehicle form
    const editVehicleForm = document.getElementById("editVehicleForm");
    if (editVehicleForm) {
      console.log("✅ Edit form event listener added");
      editVehicleForm.addEventListener("submit", (e) =>
        this.handleEditVehicleSubmit(e)
      );
    }
  }

  async handleVehicleSubmit(e) {
    e.preventDefault();
    console.log("✅ Form submission started");

    const user = JSON.parse(localStorage.getItem("currentUser"));
    if (!user) {
      this.showNotification("❌ Δεν βρέθηκε χρήστης", "error");
      return;
    }

    const chassisNumber = document.getElementById("chassisNumber").value.trim();
    const vehicleTypeSelect = document.getElementById("vehicleType").value;
    const vehicleTypeOther = document
      .getElementById("vehicleTypeOther")
      .value.trim();
    const model = document.getElementById("model").value.trim();
    const year = document.getElementById("year").value;
    const currentMileage = document.getElementById("currentMileage").value;

    // Χειρισμός vehicleType
    const vehicleType =
      vehicleTypeSelect === "other" ? vehicleTypeOther : vehicleTypeSelect;

    if (!chassisNumber || !vehicleType) {
      this.showNotification(
        "❌ Συμπληρώστε Αριθμό Πλαισίου και Τύπο Οχήματος",
        "warning"
      );
      return;
    }

    try {
      // Έλεγχος για διπλό αριθμό πλαισίου από τη βάση
      const existingVehicles = await api.getVehicles();
      const existing = existingVehicles.find(
        (v) => v.chassisNumber === chassisNumber
      );
      if (existing) {
        this.showNotification(
          "❌ Υπάρχει ήδη όχημα με αυτόν τον αριθμό πλαισίου",
          "warning"
        );
        return;
      }

      const newVehicle = {
        chassisNumber: chassisNumber,
        vehicleType: vehicleType,
        model: model || null,
        year: year ? parseInt(year) : null,
        currentMileage: parseInt(currentMileage) || 0,
        companyId: user.companyId,
      };

      await api.addVehicle(newVehicle);

      await this.loadVehicles();
      this.closeAddVehicleForm();
      this.showNotification(
        `✅ Το όχημα ${vehicleType} ${model || ""} προστέθηκε επιτυχώς`
      );
    } catch (error) {
      console.error("Save error:", error);
      this.showNotification(
        "❌ Σφάλμα κατά την αποθήκευση του οχήματος",
        "error"
      );
    }
  }

  async handleEditVehicleSubmit(e) {
    e.preventDefault();
    console.log("✅ Edit form submission started");
    const user = JSON.parse(localStorage.getItem("currentUser"));
    if (!user) {
      this.showNotification("❌ Δεν βρέθηκε χρήστης", "error");
      return;
    }
    const vehicleId = parseInt(document.getElementById("editVehicleId").value);
    const chassisNumber = document
      .getElementById("editChassisNumber")
      .value.trim();
    const vehicleTypeSelect = document.getElementById("editVehicleType").value;
    const vehicleTypeOther = document
      .getElementById("editVehicleTypeOther")
      .value.trim();

    const vehicleType =
      vehicleTypeSelect === "other" ? vehicleTypeOther : vehicleTypeSelect;
    const model = document.getElementById("editModel").value.trim();
    const year = document.getElementById("editYear").value;
    const currentMileage = document.getElementById("editCurrentMileage").value;

    console.log("📝 Edit form values:", {
      vehicleId,
      chassisNumber,
      vehicleType,
      model,
      year,
      currentMileage,
    });

    if (!chassisNumber || !vehicleType) {
      this.showNotification(
        "❌ Συμπληρώστε Αριθμό Πλαισίου και Τύπο Οχήματος",
        "warning"
      );
      return;
    }

    try {
      // Φέρνουμε πάντα τα τελευταία οχήματα από το API
      const vehicles = await api.getVehicles();

      // Έλεγχος για διπλό πλάισιο (εκτός από το τρέχον)
      const existing = vehicles.find(
        (v) => v.chassisNumber === chassisNumber && v.id !== vehicleId
      );
      if (existing) {
        this.showNotification(
          "❌ Υπάρχει ήδη όχημα με αυτόν τον αριθμό πλαισίου",
          "warning"
        );
        return;
      }

      const updatedVehicle = {
        chassisNumber: chassisNumber,
        vehicleType: vehicleType,
        model: model || null,
        year: year ? parseInt(year) : null,
        currentMileage: parseInt(currentMileage) || 0,
        companyId: user.companyId,
      };

      await api.updateVehicle(vehicleId, updatedVehicle);

      await this.loadVehicles();
      this.closeEditVehicleModal();
      this.showNotification(
        `✅ Το όχημα ${vehicleType} ${model || ""} ενημερώθηκε επιτυχώς`
      );
    } catch (error) {
      console.error("❌ Edit error:", error);
      this.showNotification(
        "❌ Σφάλμα κατά την ενημέρωση του οχήματος",
        "error"
      );
    }
  }

  closeAddVehicleForm() {
    console.log("🔒 Closing add modal");
    const modal = document.getElementById("addVehicleModal");
    if (modal) {
      modal.style.display = "none";
    }
    const form = document.getElementById("vehicleForm");
    if (form) {
      form.reset();
      // Επαναφορά του dropdown
      const otherInput = document.getElementById("vehicleTypeOther");
      if (otherInput) {
        otherInput.style.display = "none";
        otherInput.value = "";
      }
    }
  }

  closeEditVehicleModal() {
    console.log("🔒 Closing edit modal");
    const modal = document.getElementById("editVehicleModal");
    if (modal) {
      modal.style.display = "none";
    }
    const form = document.getElementById("editVehicleForm");
    if (form) {
      form.reset();
      const otherInput = document.getElementById("editVehicleTypeOther");
      if (otherInput) {
        otherInput.style.display = "none";
        otherInput.value = "";
        otherInput.required = false;
      }
    }
  }

  // ΜΕΘΟΔΟΣ ΓΙΑ NOTIFICATIONS
  showNotification(message, type = "success") {
    // Δημιουργία notification element
    const notification = document.createElement("div");
    notification.className = `notification ${type}`;
    notification.innerHTML = `
            <div class="notification-content">
                <span class="notification-message">${message}</span>
                <button class="notification-close" onclick="this.parentElement.parentElement.remove()">×</button>
            </div>
        `;

    // Προσθήκη στο body
    document.body.appendChild(notification);

    // Αυτόματη αφαίρεση μετά από 4 δευτερόλεπτα
    setTimeout(() => {
      if (notification.parentNode) {
        notification.remove();
      }
    }, 4000);
  }
}

// Global functions
function showAddVehicleForm() {
  console.log("🔄 Opening add vehicle form");
  const modal = document.getElementById("addVehicleModal");
  if (modal) {
    modal.style.display = "flex";
  }
}

function closeAddVehicleForm() {
  if (window.vehiclesManager) {
    vehiclesManager.closeAddVehicleForm();
  }
}

async function editVehicle(vehicleId) {
  console.log("✏️ Editing vehicle:", vehicleId);

  try {
    // Πάντα παίρνουμε τα οχήματα από το API
    const vehicles = await api.getVehicles();
    const vehicle = vehicles.find((v) => v.id == vehicleId);

    if (!vehicle) {
      if (window.vehiclesManager) {
        vehiclesManager.showNotification("❌ Δεν βρέθηκε το όχημα", "error");
      }
      return;
    }

    // Γέμισε τη φόρμα επεξεργασίας
    document.getElementById("editVehicleId").value = vehicle.id;
    document.getElementById("editChassisNumber").value =
      vehicle.chassisNumber || "";

    // ΝΕΟ: χειρισμός select + "Άλλο…" για τον τύπο
    const editTypeSelect = document.getElementById("editVehicleType");
    const editTypeOther = document.getElementById("editVehicleTypeOther");
    const existingType = vehicle.vehicleType || "";

    // ελέγχουμε αν ο τύπος υπάρχει στις επιλογές του select
    const optionExists =
      editTypeSelect &&
      Array.from(editTypeSelect.options).some(
        (opt) => opt.value === existingType
      );

    if (editTypeSelect && editTypeOther) {
      if (optionExists) {
        // Ο τύπος είναι μία από τις επιλογές
        editTypeSelect.value = existingType;
        editTypeOther.style.display = "none";
        editTypeOther.value = "";
        editTypeOther.required = false;
      } else if (existingType) {
        // Custom τύπος → πάμε στο "Άλλο…" και γεμίζουμε input
        editTypeSelect.value = "other";
        editTypeOther.style.display = "block";
        editTypeOther.value = existingType;
        editTypeOther.required = true;
      } else {
        // Κενό
        editTypeSelect.value = "";
        editTypeOther.style.display = "none";
        editTypeOther.value = "";
        editTypeOther.required = false;
      }
    }

    document.getElementById("editModel").value = vehicle.model || "";
    document.getElementById("editYear").value = vehicle.year || "";
    document.getElementById("editCurrentMileage").value =
      vehicle.currentMileage || 0;

    // Άνοιξε το modal
    const modal = document.getElementById("editVehicleModal");
    if (modal) {
      modal.style.display = "flex";
    }
  } catch (error) {
    console.error("Edit error:", error);
    if (window.vehiclesManager) {
      vehiclesManager.showNotification("❌ Σφάλμα φόρτωσης δεδομένων", "error");
    }
  }
}

function closeEditVehicleModal() {
  if (window.vehiclesManager) {
    vehiclesManager.closeEditVehicleModal();
  }
}

function manageMaintenance(vehicleId) {
  window.location.href = `maintenance.html?vehicleId=${vehicleId}`;
}

async function deleteVehicle(vehicleId) {
  console.log("🗑️ Delete vehicle:", vehicleId);

  try {
    // Παίρνουμε τα οχήματα για να βρούμε όνομα για το μήνυμα
    const vehicles = await api.getVehicles();
    const vehicleToDelete = vehicles.find((v) => v.id == vehicleId);
    const vehicleName = vehicleToDelete
      ? `${vehicleToDelete.vehicleType} - ${vehicleToDelete.model || ""}`
      : "Όχημα";

    if (!vehicleToDelete) {
      const vm = window.vehiclesManager;
      if (vm && typeof vm.showNotification === "function") {
        vm.showNotification("❌ Δεν βρέθηκε το όχημα για διαγραφή", "error");
      }
      return;
    }

    // API διαγραφή
    await api.deleteVehicle(vehicleId);

    // Animation στη γραμμή
    const row = document.querySelector(`tr[data-vehicle-id="${vehicleId}"]`);
    if (row) {
      row.classList.add("row-fade-out");
      setTimeout(async () => {
        row.remove();
        if (
          window.vehiclesManager &&
          typeof window.vehiclesManager.loadVehicles === "function"
        ) {
          await window.vehiclesManager.loadVehicles();
        }
      }, 300);
    }

    // ✅ Notification στο πλάι
    const vm = window.vehiclesManager;
    if (vm && typeof vm.showNotification === "function") {
      vm.showNotification(`✅ Το όχημα ${vehicleName} διαγράφηκε επιτυχώς`);
    }
  } catch (error) {
    console.error("Delete error:", error);
    const vm = window.vehiclesManager;
    if (vm && typeof vm.showNotification === "function") {
      vm.showNotification("❌ Σφάλμα κατά τη διαγραφή του οχήματος", "error");
    }
  }
}
let vehiclesManager = null;

// Initialize
document.addEventListener("DOMContentLoaded", function () {
  console.log("🚗 DOM loaded - Initializing Vehicles Manager...");
  vehiclesManager = new VehiclesManager();
  window.vehiclesManager = vehiclesManager; // 👈 το κάνουμε global
});
