// frontend/notifications.js
// Σύστημα ειδοποιήσεων για dashboard – βασισμένο στα δεδομένα του backend

class NotificationCenter {
  constructor() {
    this.notifications = [];
    this.modal = document.getElementById("notificationModal");
    this.listEl = document.getElementById("notificationList");
    this.countEl = document.getElementById("notificationCount");
    this.bellEl = document.getElementById("notificationBell");

    this.init();
  }

  init() {
    if (!this.modal || !this.listEl || !this.countEl || !this.bellEl) {
      console.warn("NotificationCenter: missing DOM elements");
      return;
    }

    this.bellEl.addEventListener("click", () => {
      this.toggleModal();
    });

    // Πρώτη φόρτωση
    this.refreshNotifications();

    // Ανανεώνει τις ειδοποιήσεις κάθε 5 λεπτά
    setInterval(() => this.refreshNotifications(), 5 * 60 * 1000);
  }

  async refreshNotifications() {
    try {
      const data = await api.getNotifications();
      this.notifications = Array.isArray(data) ? data : [];
      this.render();
    } catch (error) {
      console.error("Error loading notifications:", error);
    }
  }

  render() {
    // Badge count
    const count = this.notifications.length;
    this.countEl.textContent = count;
    this.countEl.style.display = count > 0 ? "inline-block" : "none";

    // Λίστα στο modal
    this.listEl.innerHTML = "";

    if (count === 0) {
      this.listEl.innerHTML = "<p>Δεν υπάρχουν ειδοποιήσεις συντήρησης.</p>";
      return;
    }

    this.notifications.forEach((n) => {
      const item = document.createElement("div");
      item.classList.add("notification-item");

      if (n.severity === "danger") item.classList.add("notif-danger");
      else if (n.severity === "warning") item.classList.add("notif-warning");
      else item.classList.add("notif-info");

      const daysText =
        n.daysUntilDue < 0
          ? `Καθυστερημένη κατά ${Math.abs(n.daysUntilDue)} ημέρες`
          : n.daysUntilDue === 0
          ? "Λήγει σήμερα"
          : `Σε ${n.daysUntilDue} ημέρες`;

      const dateText = n.dueDate
        ? new Date(n.dueDate).toLocaleDateString("el-GR")
        : "-";

      item.innerHTML = `
        <div class="notification-title">
          ${n.maintenanceType} - ${n.vehicleLabel}
        </div>
        <div class="notification-meta">
          <span>Ημ/νία: ${dateText}</span>
          <span>${daysText}</span>
        </div>
      `;

      this.listEl.appendChild(item);
    });
  }

  toggleModal() {
    if (this.modal.style.display === "none" || !this.modal.style.display) {
      this.modal.style.display = "block";
    } else {
      this.modal.style.display = "none";
    }
  }
}

// Αυτόματη αρχικοποίηση στο dashboard
document.addEventListener("DOMContentLoaded", () => {
  // Πρέπει να έχει φορτωθεί πρώτα το api.js
  if (typeof api === "undefined") {
    console.error("NotificationCenter: api is not defined. Φόρτωσε πρώτα το api.js.");
    return;
  }
  new NotificationCenter();
});
