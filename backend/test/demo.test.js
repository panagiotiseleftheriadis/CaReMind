const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createDemoApi({ pathname = "/index.html", active = false, dom = false } = {}) {
  const values = new Map();
  if (active) values.set("caremindDemoMode", "1");
  const localStorage = {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  const window = {
    location: {
      hostname: "localhost",
      pathname,
      reload() {},
    },
  };
  let domReadyHandler;
  const appended = [];
  const document = dom ? {
    head: { appendChild(node) { appended.push(node); } },
    body: { appendChild(node) { appended.push(node); } },
    addEventListener(event, handler) { if (event === "DOMContentLoaded") domReadyHandler = handler; },
    getElementById() { return null; },
    createElement(tagName) {
      return {
        tagName,
        id: "",
        innerHTML: "",
        textContent: "",
        setAttribute() {},
      };
    },
  } : { addEventListener() {} };
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

  return { api: window.CaReMindDemo, client: window.api, localStorage, appended, runDomReady: () => domReadyHandler?.() };
}

test("active demo sessions do not install the banner on public pages", () => {
  ["/", "/index.html", "/login", "/login.html", "/register"].forEach((pathname) => {
    const page = createDemoApi({ pathname, active: true, dom: true });
    page.runDomReady();
    assert.equal(page.appended.length, 0, `${pathname} must stay free of the demo banner`);
  });
});

test("active demo sessions keep the banner on application pages", () => {
  const page = createDemoApi({ pathname: "/dashboard", active: true, dom: true });
  page.runDomReady();
  assert.equal(page.appended.some((node) => node.id === "demoModeBanner"), true);
});

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
  localStorage.setItem("caremindDemoTourV1", JSON.stringify({ welcomed: true }));
  const user = api.start();

  assert.equal(api.isActive(), true);
  assert.equal(user.isDemo, true);
  assert.ok(localStorage.getItem("currentUser"));
  assert.equal(localStorage.getItem("caremindDemoTourV1"), null);

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
