// Browser-only demo mode for portfolio visitors.
// It mirrors the REST API used by the UI, but keeps all data in localStorage.
(function () {
  const MODE_KEY = "caremindDemoMode";
  const DATA_KEY = "caremindDemoData";
  const DEMO_VERSION = 1;

  function dateOffset(days) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function timestampOffset(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString();
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createSeedData() {
    const companyId = 9999;
    const vehicles = [
      {
        id: 1,
        vehicleType: "Επιβατικό ΙΧ",
        chassisNumber: "DEMO-1001",
        model: "Toyota Corolla",
        year: 2021,
        currentMileage: 68400,
        companyId,
        created_at: timestampOffset(-210),
      },
      {
        id: 2,
        vehicleType: "Μοτοσυκλέτα",
        chassisNumber: "DEMO-2002",
        model: "Honda NC750X",
        year: 2022,
        currentMileage: 24150,
        companyId,
        created_at: timestampOffset(-150),
      },
      {
        id: 3,
        vehicleType: "Φορτηγό Μεσαίου Τύπου",
        chassisNumber: "DEMO-3003",
        model: "Mercedes Atego",
        year: 2019,
        currentMileage: 186700,
        companyId,
        created_at: timestampOffset(-95),
      },
    ];

    return {
      version: DEMO_VERSION,
      user: {
        id: 9999,
        userId: 9999,
        username: "demo",
        email: "demo@car-remind.gr",
        user_number: "69******00",
        role: "guest",
        companyId,
        companyName: "DEMO",
        isDemo: true,
      },
      vehicles,
      maintenances: [
        {
          id: 1,
          vehicleId: 1,
          maintenanceType: "service",
          lastDate: dateOffset(-175),
          nextDate: dateOffset(5),
          lastMileage: 57000,
          nextMileage: 70000,
          notificationDays: 7,
          status: "pending",
          notes: "Γενικός έλεγχος και αλλαγή φίλτρων",
          created_at: timestampOffset(-170),
        },
        {
          id: 2,
          vehicleId: 2,
          maintenanceType: "kteo",
          lastDate: dateOffset(-380),
          nextDate: dateOffset(-8),
          lastMileage: 17000,
          nextMileage: null,
          notificationDays: 14,
          status: "pending",
          notes: "Απαιτείται προγραμματισμός ραντεβού",
          created_at: timestampOffset(-300),
        },
        {
          id: 3,
          vehicleId: 3,
          maintenanceType: "tires",
          lastDate: dateOffset(-240),
          nextDate: dateOffset(58),
          lastMileage: 161000,
          nextMileage: 190000,
          notificationDays: 10,
          status: "pending",
          notes: "Έλεγχος πέλματος και ευθυγράμμιση",
          created_at: timestampOffset(-80),
        },
        {
          id: 4,
          vehicleId: 1,
          maintenanceType: "battery",
          lastDate: dateOffset(-20),
          nextDate: null,
          lastMileage: 67000,
          nextMileage: null,
          notificationDays: 7,
          status: "completed",
          notes: "Αντικατάσταση μπαταρίας",
          created_at: timestampOffset(-25),
        },
      ],
      costs: [
        {
          id: 1,
          vehicleId: 1,
          category: "service",
          amount: 285,
          date: dateOffset(-12),
          description: "Προγραμματισμένο service",
          receiptNumber: "DEMO-001",
          created_at: timestampOffset(-12),
        },
        {
          id: 2,
          vehicleId: 3,
          category: "fuel",
          amount: 420.5,
          date: dateOffset(-26),
          description: "Καύσιμα μήνα",
          receiptNumber: "DEMO-002",
          created_at: timestampOffset(-26),
        },
        {
          id: 3,
          vehicleId: 2,
          category: "insurance",
          amount: 198,
          date: dateOffset(-48),
          description: "Εξάμηνη ασφάλιση",
          receiptNumber: "DEMO-003",
          created_at: timestampOffset(-48),
        },
        {
          id: 4,
          vehicleId: 1,
          category: "battery",
          amount: 145,
          date: dateOffset(-20),
          description: "Νέα μπαταρία",
          receiptNumber: "DEMO-004",
          created_at: timestampOffset(-20),
        },
        {
          id: 5,
          vehicleId: 3,
          category: "tires",
          amount: 760,
          date: dateOffset(-82),
          description: "Σετ ελαστικών",
          receiptNumber: "DEMO-005",
          created_at: timestampOffset(-82),
        },
      ],
      recipients: [
        {
          id: 1,
          type: "email",
          value: "fleet.manager@example.com",
          created_at: timestampOffset(-30),
        },
      ],
    };
  }

  function isActive() {
    return localStorage.getItem(MODE_KEY) === "1";
  }

  function save(state) {
    localStorage.setItem(DATA_KEY, JSON.stringify(state));
  }

  function load() {
    let state = null;
    try {
      state = JSON.parse(localStorage.getItem(DATA_KEY) || "null");
    } catch (_) {}

    if (!state || state.version !== DEMO_VERSION) {
      state = createSeedData();
      save(state);
    }
    return state;
  }

  function syncCurrentUser(user) {
    localStorage.setItem(
      "currentUser",
      JSON.stringify({
        ...user,
        loginAt: new Date().toISOString(),
      })
    );
  }

  function start(options = {}) {
    localStorage.setItem(MODE_KEY, "1");
    if (options.reset !== false) save(createSeedData());
    const state = load();
    syncCurrentUser(state.user);
    return clone(state.user);
  }

  function end() {
    localStorage.removeItem(MODE_KEY);
    localStorage.removeItem(DATA_KEY);
    localStorage.removeItem("currentUser");
  }

  function reset() {
    save(createSeedData());
    syncCurrentUser(load().user);
  }

  function nextId(items) {
    return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
  }

  function resourceRequest(state, collectionName, endpoint, method, body) {
    const collection = state[collectionName];
    const idMatch = endpoint.match(/\/(\d+)$/);
    const id = idMatch ? Number(idMatch[1]) : null;

    if (method === "GET" && id === null) return clone(collection);

    if (method === "POST" && id === null) {
      const created = {
        ...body,
        id: nextId(collection),
        created_at: new Date().toISOString(),
      };
      collection.unshift(created);
      save(state);
      return clone(created);
    }

    const index = collection.findIndex((item) => Number(item.id) === id);
    if (index === -1) throw new Error("Η εγγραφή δεν βρέθηκε στο demo.");

    if (method === "PUT" || method === "PATCH") {
      collection[index] = { ...collection[index], ...body, id };
      save(state);
      return clone(collection[index]);
    }

    if (method === "DELETE") {
      collection.splice(index, 1);
      if (collectionName === "vehicles") {
        state.maintenances = state.maintenances.filter(
          (item) => Number(item.vehicleId) !== id
        );
        state.costs = state.costs.filter((item) => Number(item.vehicleId) !== id);
      }
      save(state);
      return { success: true };
    }

    throw new Error("Η ενέργεια δεν υποστηρίζεται στο demo.");
  }

  function buildNotifications(state) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return state.maintenances
      .filter((item) => item.status !== "completed" && item.nextDate)
      .map((item) => {
        const due = new Date(`${item.nextDate}T00:00:00`);
        const daysUntilDue = Math.round((due - today) / 86400000);
        const vehicle = state.vehicles.find(
          (candidate) => Number(candidate.id) === Number(item.vehicleId)
        );
        return {
          id: item.id,
          maintenanceType: item.maintenanceType,
          vehicleLabel: vehicle
            ? `${vehicle.model || vehicle.vehicleType} (${vehicle.chassisNumber})`
            : "Όχημα",
          dueDate: item.nextDate,
          daysUntilDue,
          severity: daysUntilDue < 0 ? "danger" : daysUntilDue <= 7 ? "warning" : "info",
        };
      })
      .filter((item) => item.daysUntilDue <= 14)
      .sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  }

  async function request(endpoint, options = {}) {
    if (!isActive()) throw new Error("Το demo mode δεν είναι ενεργό.");

    const method = String(options.method || "GET").toUpperCase();
    const body = options.body || {};
    const state = load();

    if (endpoint === "/refresh") {
      syncCurrentUser(state.user);
      return { accessToken: "demo-access-token", user: clone(state.user) };
    }
    if (endpoint === "/logout") {
      end();
      return { message: "Demo session ended" };
    }
    if (endpoint === "/account/me") return clone(state.user);
    if (endpoint === "/notifications") return buildNotifications(state);

    if (endpoint.startsWith("/vehicles")) {
      return resourceRequest(state, "vehicles", endpoint, method, body);
    }
    if (endpoint.startsWith("/maintenances")) {
      return resourceRequest(state, "maintenances", endpoint, method, body);
    }
    if (endpoint.startsWith("/costs")) {
      return resourceRequest(state, "costs", endpoint, method, body);
    }

    if (endpoint === "/account/send-code" && method === "POST") {
      return { ok: true, demoCode: "123456" };
    }
    if (endpoint === "/account/verify-code" && method === "POST") {
      if (!/^\d{6}$/.test(String(body.code || ""))) {
        throw new Error("Συμπληρώστε έναν 6-ψήφιο κωδικό.");
      }
      return { accountToken: "demo-account-token" };
    }
    if (endpoint === "/account/update" && method === "POST") {
      const updates = body.updates || {};
      if (updates.username) state.user.username = updates.username;
      if (updates.email) state.user.email = updates.email;
      save(state);
      syncCurrentUser(state.user);
      return { ok: true };
    }
    if (endpoint === "/account/recipients" && method === "GET") {
      return clone(state.recipients);
    }
    if (endpoint === "/account/recipients" && method === "POST") {
      const created = {
        id: nextId(state.recipients),
        type: body.type || "email",
        value: body.value,
        created_at: new Date().toISOString(),
      };
      state.recipients.unshift(created);
      save(state);
      return clone(created);
    }
    if (/^\/account\/recipients\/\d+$/.test(endpoint) && method === "DELETE") {
      const id = Number(endpoint.split("/").pop());
      state.recipients = state.recipients.filter((item) => Number(item.id) !== id);
      save(state);
      return { ok: true };
    }

    throw new Error(`Το endpoint ${endpoint} δεν είναι διαθέσιμο στο demo.`);
  }

  function installBanner() {
    if (!isActive() || document.getElementById("demoModeBanner")) return;

    const banner = document.createElement("aside");
    banner.id = "demoModeBanner";
    banner.setAttribute("aria-label", "Λειτουργία επίδειξης");
    banner.innerHTML = `
      <span><strong>Demo λειτουργία</strong> · Τα δεδομένα μένουν μόνο σε αυτόν τον browser.</span>
      <button type="button" id="resetDemoDataBtn">Επαναφορά demo</button>
    `;

    const style = document.createElement("style");
    style.textContent = `
      #demoModeBanner {
        position: fixed; right: 18px; bottom: 18px; z-index: 10000;
        display: flex; align-items: center; gap: 12px; max-width: min(520px, calc(100vw - 36px));
        padding: 11px 14px; border: 1px solid rgba(255,255,255,.3); border-radius: 12px;
        color: #fff; background: rgba(23, 55, 94, .96); box-shadow: 0 10px 28px rgba(15, 36, 64, .24);
        font: 13px/1.4 Arial, sans-serif;
      }
      #demoModeBanner button {
        flex: 0 0 auto; border: 1px solid rgba(255,255,255,.55); border-radius: 8px;
        padding: 7px 10px; color: #fff; background: transparent; cursor: pointer; font-weight: 700;
      }
      #demoModeBanner button:hover { background: rgba(255,255,255,.12); }
      @media (max-width: 620px) {
        #demoModeBanner { left: 12px; right: 12px; bottom: 12px; align-items: flex-start; }
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(banner);
    document.getElementById("resetDemoDataBtn")?.addEventListener("click", () => {
      reset();
      window.location.reload();
    });
  }

  window.CaReMindDemo = {
    isActive,
    start,
    end,
    reset,
    request,
  };

  document.addEventListener("DOMContentLoaded", installBanner);
})();
