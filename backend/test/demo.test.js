const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createDemoApi() {
  const values = new Map();
  const localStorage = {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  const window = {
    location: {
      hostname: "localhost",
      pathname: "/index.html",
      reload() {},
    },
  };
  const document = { addEventListener() {} };
  const demoSource = fs.readFileSync(
    path.join(__dirname, "..", "..", "frontend", "demo-store.js"),
    "utf8"
  );
  const apiSource = fs.readFileSync(
    path.join(__dirname, "..", "..", "frontend", "api.js"),
    "utf8"
  );

  const context = {
    window,
    document,
    localStorage,
    console,
    Date,
    JSON,
    Math,
    Number,
    String,
    Error,
  };

  vm.runInNewContext(demoSource, context);
  vm.runInNewContext(apiSource, context);

  return { api: window.CaReMindDemo, client: window.api, localStorage };
}

test("demo session refresh sets the API token used by protected pages", async () => {
  const { api, client } = createDemoApi();
  api.start();

  const response = await client.refreshToken();

  assert.equal(response.accessToken, "demo-access-token");
  assert.equal(client.getToken(), "demo-access-token");
  assert.equal(client.getHeaders().Authorization, "Bearer demo-access-token");
});

test("portfolio demo starts without backend and persists a complete vehicle flow", async () => {
  const { api, localStorage } = createDemoApi();
  const user = api.start();

  assert.equal(api.isActive(), true);
  assert.equal(user.isDemo, true);
  assert.ok(localStorage.getItem("currentUser"));

  const vehicle = await api.request("/vehicles", {
    method: "POST",
    body: {
      vehicleType: "car",
      chassisNumber: "PORTFOLIO-1",
      model: "Portfolio Car",
      year: 2026,
      currentMileage: 1000,
    },
  });
  const maintenance = await api.request("/maintenances", {
    method: "POST",
    body: {
      vehicleId: vehicle.id,
      maintenanceType: "service",
      nextDate: new Date().toISOString().slice(0, 10),
      notificationDays: 7,
      status: "pending",
    },
  });
  const cost = await api.request("/costs", {
    method: "POST",
    body: {
      vehicleId: vehicle.id,
      category: "maintenance",
      amount: 75,
      date: new Date().toISOString().slice(0, 10),
    },
  });

  assert.ok(maintenance.id);
  assert.ok(cost.id);
  assert.ok((await api.request("/vehicles")).some((item) => item.id === vehicle.id));
  assert.ok((await api.request("/maintenances")).some((item) => item.vehicleId === vehicle.id));
  assert.ok((await api.request("/costs")).some((item) => item.vehicleId === vehicle.id));

  const notifications = await api.request("/notifications");
  assert.ok(notifications.some((item) => item.id === maintenance.id));
});

test("deleting a demo vehicle also removes its related maintenance and costs", async () => {
  const { api } = createDemoApi();
  api.start();
  const vehicle = await api.request("/vehicles", {
    method: "POST",
    body: { vehicleType: "car", chassisNumber: "CASCADE-1" },
  });
  await api.request("/maintenances", {
    method: "POST",
    body: { vehicleId: vehicle.id, maintenanceType: "service" },
  });
  await api.request("/costs", {
    method: "POST",
    body: { vehicleId: vehicle.id, category: "service", amount: 10 },
  });

  await api.request(`/vehicles/${vehicle.id}`, { method: "DELETE" });
  assert.equal((await api.request("/maintenances")).some((item) => item.vehicleId === vehicle.id), false);
  assert.equal((await api.request("/costs")).some((item) => item.vehicleId === vehicle.id), false);
});
