// Browser-only demo mode for portfolio visitors.
// It mirrors the REST API used by the UI, but keeps all data in localStorage.
(function () {
  const MODE_KEY = "caremindDemoMode";
  const DATA_KEY = "caremindDemoData";
  const TOUR_KEY = "caremindDemoTourV1";
  const DEMO_VERSION = 2;

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
        registrationPlate: "ΙΒΧ-1001",
        registrationCountry: "GR",
        make: "Toyota",
        vin: null,
        fuelType: "hybrid",
        purchaseDate: null,
        purchaseAmount: null,
        currency: null,
        archivedAt: null,
        state: "active",
        revision: 1,
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
        registrationPlate: "ΜΟΤ-2002",
        registrationCountry: "GR",
        make: "Honda",
        vin: null,
        fuelType: "gasoline",
        purchaseDate: null,
        purchaseAmount: null,
        currency: null,
        archivedAt: null,
        state: "active",
        revision: 1,
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
        registrationPlate: "ΦΟΡ-3003",
        registrationCountry: "GR",
        make: "Mercedes-Benz",
        vin: null,
        fuelType: "diesel",
        purchaseDate: null,
        purchaseAmount: null,
        currency: null,
        archivedAt: null,
        state: "active",
        revision: 1,
        companyId,
        created_at: timestampOffset(-95),
      },
    ];

    return {
      version: DEMO_VERSION,
      vehicleArchiveEnabled: false,
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
    if (options.reset !== false) {
      save(createSeedData());
      localStorage.removeItem(TOUR_KEY);
    }
    const state = load();
    syncCurrentUser(state.user);
    return clone(state.user);
  }

  function end() {
    localStorage.removeItem(MODE_KEY);
    localStorage.removeItem(DATA_KEY);
    localStorage.removeItem(TOUR_KEY);
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
    const [path, rawQuery = ""] = endpoint.split("?", 2);
    const idMatch = path.match(/\/(\d+)$/);
    const id = idMatch ? Number(idMatch[1]) : null;

    if (method === "GET" && id === null) {
      const vehiclePart = rawQuery.split("&").find((part) => part.startsWith("vehicle_id="));
      const vehicleId = vehiclePart ? decodeURIComponent(vehiclePart.slice(11)) : null;
      if (vehicleId == null) return clone(collection);
      if (!/^\d+$/.test(vehicleId) || Number(vehicleId) < 1) throw demoError("Μη έγκυρο αναγνωριστικό οχήματος.", "INVALID_VEHICLE_ID");
      if (!state.vehicles.some((vehicle) => Number(vehicle.id) === Number(vehicleId))) throw demoError("Το όχημα δεν βρέθηκε.", "VEHICLE_NOT_FOUND", 404);
      return clone(collection.filter((item) => Number(item.vehicleId) === Number(vehicleId)));
    }

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

  const VEHICLE_PATCH_FIELDS = new Set([
    "vehicleType", "chassisNumber", "model", "year", "currentMileage",
    "registrationPlate", "registrationCountry", "make", "vin", "fuelType",
    "purchaseDate", "purchaseAmount", "currency",
  ]);

  function demoError(message, code, status = 400) {
    return Object.assign(new Error(message), { code, status });
  }

  function demoVehicleDefaults(vehicle) {
    return {
      registrationPlate: null,
      registrationCountry: null,
      make: null,
      vin: null,
      fuelType: null,
      purchaseDate: null,
      purchaseAmount: null,
      currency: null,
      archivedAt: null,
      state: "active",
      revision: 1,
      ...vehicle,
    };
  }

  function validateDemoVehiclePatch(body) {
    if (!body || typeof body !== "object" || Array.isArray(body) || !Object.keys(body).length) {
      throw demoError("Δεν δόθηκαν αλλαγές οχήματος.", "EMPTY_VEHICLE_PATCH");
    }
    const unsupported = Object.keys(body).find((key) => !VEHICLE_PATCH_FIELDS.has(key));
    if (unsupported) throw demoError(`Μη υποστηριζόμενο πεδίο: ${unsupported}`, "UNSUPPORTED_VEHICLE_FIELD");
    if (Object.hasOwn(body, "vehicleType") && (typeof body.vehicleType !== "string" || !body.vehicleType.trim() || body.vehicleType.length > 100)) throw demoError("Μη έγκυρος τύπος οχήματος.", "INVALID_VEHICLE_FIELD");
    if (Object.hasOwn(body, "chassisNumber") && (typeof body.chassisNumber !== "string" || !body.chassisNumber.trim() || body.chassisNumber.trim().length > 50)) throw demoError("Μη έγκυρος αριθμός πλαισίου.", "INVALID_VEHICLE_FIELD");
    if (Object.hasOwn(body, "currentMileage") && body.currentMileage != null && (!Number.isInteger(Number(body.currentMileage)) || Number(body.currentMileage) < 0)) throw demoError("Μη έγκυρα χιλιόμετρα.", "INVALID_VEHICLE_FIELD");
    if (Object.hasOwn(body, "year") && body.year != null && (!Number.isInteger(Number(body.year)) || Number(body.year) < 1886 || Number(body.year) > new Date().getFullYear() + 1)) throw demoError("Μη έγκυρο έτος.", "INVALID_VEHICLE_FIELD");
    if (Object.hasOwn(body, "purchaseAmount") && body.purchaseAmount != null && (!Number.isFinite(Number(body.purchaseAmount)) || Number(body.purchaseAmount) < 0 || Number(body.purchaseAmount) > 9999999999.99)) throw demoError("Μη έγκυρο ποσό αγοράς.", "INVALID_VEHICLE_FIELD");
    for (const key of ["model", "make", "registrationPlate", "registrationCountry", "vin", "fuelType", "currency", "purchaseDate", "year", "currentMileage", "purchaseAmount"]) {
      if (body[key] === "") throw demoError("Τα κενά πεδία πρέπει να καθαρίζονται με null.", "INVALID_VEHICLE_FIELD");
    }
    const lengths = { model: 100, make: 100, registrationPlate: 32, registrationCountry: 2, vin: 50, fuelType: 30, currency: 3 };
    for (const [key, maximum] of Object.entries(lengths)) {
      if (body[key] != null && (typeof body[key] !== "string" || !body[key].trim() || body[key].trim().length > maximum)) throw demoError("Μη έγκυρα στοιχεία οχήματος.", "INVALID_VEHICLE_FIELD");
    }
    if (body.registrationCountry != null && !/^[A-Za-z]{2}$/.test(body.registrationCountry.trim())) throw demoError("Μη έγκυρη χώρα ταξινόμησης.", "INVALID_VEHICLE_FIELD");
    if (body.currency != null && !/^[A-Za-z]{3}$/.test(body.currency.trim())) throw demoError("Μη έγκυρο νόμισμα.", "INVALID_VEHICLE_FIELD");
    if (body.fuelType != null && !["gasoline", "diesel", "hybrid", "plug_in_hybrid", "electric", "lpg", "cng", "hydrogen", "other"].includes(body.fuelType)) throw demoError("Μη έγκυρος τύπος καυσίμου.", "INVALID_VEHICLE_FIELD");
    if (body.purchaseDate != null) {
      const date = new Date(`${body.purchaseDate}T00:00:00.000Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.purchaseDate) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== body.purchaseDate) throw demoError("Μη έγκυρη ημερομηνία αγοράς.", "INVALID_VEHICLE_FIELD");
    }
  }

  function vehicleRequest(state, endpoint, method, body) {
    const [path, rawQuery = ""] = endpoint.split("?", 2);
    const idMatch = path.match(/^\/vehicles\/(\d+)$/);
    const transitionMatch = path.match(/^\/vehicles\/(\d+)\/(archive|restore)$/);

    if (path === "/vehicles" && method === "GET") {
      const statePart = rawQuery.split("&").find((part) => part.startsWith("state="));
      const requested = statePart ? decodeURIComponent(statePart.slice(6)) : null;
      if (requested != null && !["active", "archived", "all"].includes(requested)) throw demoError("Μη έγκυρη κατάσταση οχήματος.", "INVALID_VEHICLE_STATE");
      const filter = requested || (state.vehicleArchiveEnabled ? "active" : "all");
      return clone(state.vehicles.filter((vehicle) => filter === "all" || (filter === "active" ? vehicle.archivedAt == null : vehicle.archivedAt != null)));
    }
    if (path === "/vehicles" && method === "POST") {
      if (!body.vehicleType || !body.chassisNumber) throw demoError("Απαιτούνται τύπος οχήματος και αριθμός πλαισίου.", "INVALID_VEHICLE_FIELD");
      validateDemoVehiclePatch(body);
      if (state.vehicles.some((vehicle) => vehicle.chassisNumber === String(body.chassisNumber).trim())) throw demoError("Υπάρχει ήδη όχημα με αυτόν τον αριθμό πλαισίου.", "DUPLICATE_CHASSIS_NUMBER", 409);
      const created = demoVehicleDefaults({
        ...body,
        id: nextId(state.vehicles),
        vehicleType: body.vehicleType.trim(),
        chassisNumber: String(body.chassisNumber).trim(),
        make: body.make ? body.make.trim() : null,
        model: body.model ? body.model.trim() : null,
        registrationPlate: body.registrationPlate ? body.registrationPlate.trim() : null,
        registrationCountry: body.registrationCountry ? body.registrationCountry.trim().toUpperCase() : null,
        vin: body.vin ? body.vin.trim().toUpperCase() : null,
        fuelType: body.fuelType || null,
        year: body.year == null ? null : Number(body.year),
        currentMileage: body.currentMileage == null ? null : Number(body.currentMileage),
        purchaseDate: body.purchaseDate || null,
        purchaseAmount: body.purchaseAmount == null ? null : Number(body.purchaseAmount),
        currency: body.currency ? body.currency.trim().toUpperCase() : null,
        companyId: state.user.companyId,
        created_at: new Date().toISOString(),
      });
      state.vehicles.unshift(created);
      save(state);
      return clone(created);
    }

    const id = Number((idMatch || transitionMatch)?.[1]);
    const index = state.vehicles.findIndex((vehicle) => Number(vehicle.id) === id);
    if ((!idMatch && !transitionMatch) || index === -1) throw demoError("Το όχημα δεν βρέθηκε στο demo.", "VEHICLE_NOT_FOUND", 404);
    const vehicle = state.vehicles[index];

    if (idMatch && method === "GET") return clone(vehicle);
    if (idMatch && (method === "PATCH" || method === "PUT")) {
      const patch = method === "PUT"
        ? { vehicleType: body.vehicleType, chassisNumber: body.chassisNumber, model: body.model ?? null, year: body.year ?? null, currentMileage: body.currentMileage ?? null }
        : body;
      validateDemoVehiclePatch(patch);
      if (Object.hasOwn(patch, "chassisNumber") && state.vehicles.some((candidate) => Number(candidate.id) !== id && candidate.chassisNumber === String(patch.chassisNumber).trim())) throw demoError("Υπάρχει ήδη όχημα με αυτόν τον αριθμό πλαισίου.", "DUPLICATE_CHASSIS_NUMBER", 409);
      Object.assign(vehicle, patch, {
        chassisNumber: Object.hasOwn(patch, "chassisNumber") ? String(patch.chassisNumber).trim() : vehicle.chassisNumber,
        registrationCountry: patch.registrationCountry ? String(patch.registrationCountry).trim().toUpperCase() : patch.registrationCountry ?? vehicle.registrationCountry,
        vin: patch.vin ? String(patch.vin).trim().toUpperCase() : patch.vin ?? vehicle.vin,
        currency: patch.currency ? String(patch.currency).trim().toUpperCase() : patch.currency ?? vehicle.currency,
        revision: Number(vehicle.revision) + 1,
      });
      save(state);
      return clone(vehicle);
    }
    if (transitionMatch && method === "POST") {
      if (!state.vehicleArchiveEnabled) throw demoError("Η αρχειοθέτηση οχημάτων δεν είναι ακόμη ενεργή.", "VEHICLE_ARCHIVE_DISABLED", 409);
      const archive = transitionMatch[2] === "archive";
      if (archive && vehicle.archivedAt == null) {
        vehicle.archivedAt = new Date().toISOString();
        vehicle.state = "archived";
        vehicle.revision += 1;
      } else if (!archive && vehicle.archivedAt != null) {
        vehicle.archivedAt = null;
        vehicle.state = "active";
        vehicle.revision += 1;
      }
      save(state);
      return clone(vehicle);
    }
    if (idMatch && method === "DELETE") {
      if (state.vehicleArchiveEnabled) throw demoError("Χρησιμοποιήστε αρχειοθέτηση αντί για οριστική διαγραφή οχήματος.", "VEHICLE_ARCHIVE_REQUIRED", 409);
      state.vehicles.splice(index, 1);
      state.maintenances = state.maintenances.filter((item) => Number(item.vehicleId) !== id);
      state.costs = state.costs.filter((item) => Number(item.vehicleId) !== id);
      save(state);
      return { success: true };
    }
    throw demoError("Η ενέργεια δεν υποστηρίζεται στο demo.", "DEMO_OPERATION_UNSUPPORTED", 405);
  }

  function buildNotifications(state) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return state.maintenances
      .filter((item) => item.status !== "completed" && item.nextDate)
      .filter((item) => state.vehicles.some((vehicle) => Number(vehicle.id) === Number(item.vehicleId) && vehicle.archivedAt == null))
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
      return vehicleRequest(state, endpoint, method, body);
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
    const publicPaths = new Set(["/", "/index", "/index.html", "/login", "/login.html", "/register", "/register.html"]);
    const pathname = (window.location.pathname || "/").replace(/\/+$/, "") || "/";
    if (publicPaths.has(pathname) || !isActive() || document.getElementById("demoModeBanner")) return;

    const banner = document.createElement("aside");
    banner.id = "demoModeBanner";
    banner.setAttribute("aria-label", "Λειτουργία επίδειξης");
    banner.innerHTML = `
      <span><strong>Demo λειτουργία</strong> · Τα δεδομένα μένουν μόνο σε αυτόν τον browser.</span>
      <span class="demo-banner-actions">
        <button type="button" id="startDemoTourBtn">Ξενάγηση</button>
        <button type="button" id="resetDemoDataBtn">Επαναφορά demo</button>
      </span>
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
      #demoModeBanner[hidden] { display: none !important; }
      #demoModeBanner button {
        flex: 0 0 auto; border: 1px solid rgba(255,255,255,.55); border-radius: 8px;
        padding: 7px 10px; color: #fff; background: transparent; cursor: pointer; font-weight: 700;
      }
      #demoModeBanner button:hover { background: rgba(255,255,255,.12); }
      #demoModeBanner .demo-banner-actions { display:flex; gap:7px; flex:0 0 auto; }
      #startDemoTourBtn { background: #f16f69 !important; border-color:#f16f69 !important; }
      #startDemoTourBtn:hover { background: #d65250 !important; }
      :root.caremind-demo-active {
        --demo-banner-clearance: calc(var(--demo-banner-height, 0px) + 36px);
        scroll-padding-bottom: var(--demo-banner-clearance);
      }
      body.caremind-demo-active {
        padding-bottom: var(--demo-banner-clearance);
      }
      body.caremind-demo-active :where(a, button, input, select, textarea, [tabindex]):focus-visible {
        scroll-margin-bottom: var(--demo-banner-clearance);
      }
      @media (max-width: 620px) {
        :root.caremind-demo-active {
          --demo-banner-clearance: calc(var(--demo-banner-height, 0px) + 24px + env(safe-area-inset-bottom, 0px));
        }
        #demoModeBanner { left: 12px; right: 12px; bottom: 12px; align-items: flex-start; flex-wrap:wrap; }
        #demoModeBanner .demo-banner-actions { width:100%; }
        #demoModeBanner .demo-banner-actions button { flex:1; }
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(banner);
    document.documentElement.classList.add("caremind-demo-active");
    document.body.classList.add("caremind-demo-active");
    const syncBannerHeight = () => {
      const height = Math.ceil(banner.getBoundingClientRect().height);
      if (height > 0) document.documentElement.style.setProperty("--demo-banner-height", `${height}px`);
    };
    syncBannerHeight();
    window.addEventListener("resize", syncBannerHeight);
    if (typeof ResizeObserver === "function") new ResizeObserver(syncBannerHeight).observe(banner);
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
    setVehicleArchiveEnabled(enabled) {
      const state = load();
      state.vehicleArchiveEnabled = enabled === true;
      save(state);
    },
  };

  document.addEventListener("DOMContentLoaded", installBanner);
})();
