const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createDemoApi({ pathname = "/index.html", active = false, dom = false, fetchImpl } = {}) {
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
    fetch: fetchImpl || (async () => { throw new Error("unexpected network request"); }),
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

test("real login ends Demo before using the backend route", async () => {
  let fetchCalls = 0;
  const page = createDemoApi({
    active: true,
    fetchImpl: async (url, options) => {
      fetchCalls += 1;
      assert.equal(page.api.isActive(), false, "Demo must end before fetch");
      assert.equal(options.headers.Authorization, undefined, "Demo token must not reach the backend");
      assert.equal(url, "http://localhost:3000/api/login");
      assert.equal(options.method, "POST");
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ accessToken: "real-access-token", user: { id: 7 } });
        },
      };
    },
  });

  await page.client.refreshToken();
  assert.equal(page.client.getToken(), "demo-access-token");
  const response = await page.client.login("real-user", "real-password");

  assert.equal(fetchCalls, 1);
  assert.equal(response.accessToken, "real-access-token");
  assert.equal(page.client.getToken(), "real-access-token");
  assert.equal(page.localStorage.getItem("caremindDemoMode"), null);
});

test("failed real login leaves Demo inactive", async () => {
  const page = createDemoApi({
    active: true,
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      async text() { return JSON.stringify({ message: "Invalid credentials" }); },
    }),
  });

  await assert.rejects(page.client.login("real-user", "wrong-password"), /Invalid credentials/);
  assert.equal(page.api.isActive(), false);
});

test("registration, verification and recovery actions leave Demo for real backend routes", async () => {
  const calls = [];
  const page = createDemoApi({
    fetchImpl: async (url, options) => {
      assert.equal(page.api.isActive(), false, "Demo must end before fetch");
      calls.push({ url, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        async text() {
          return url.endsWith("/verify-reset-code")
            ? JSON.stringify({ resetToken: "real-reset-token" })
            : JSON.stringify({ ok: true });
        },
      };
    },
  });

  const actions = [
    ["/register", () => page.client.register({ email: "user@example.test" })],
    ["/verify-email", () => page.client.verifyEmail("user@example.test", "123456")],
    ["/resend-verification", () => page.client.resendVerification("user@example.test")],
    ["/forgot-password", () => page.client.forgotPassword("user@example.test")],
    ["/verify-reset-code", () => page.client.verifyResetCode("user@example.test", "654321")],
    ["/reset-password", () => page.client.resetPassword("real-reset-token", "new-password")],
  ];

  for (const [, action] of actions) {
    page.api.start({ reset: false });
    await action();
    assert.equal(page.api.isActive(), false);
  }

  assert.deepEqual(calls.map(({ url }) => url), actions.map(([endpoint]) => `http://localhost:3000/api${endpoint}`));
});

test("unsupported Demo endpoints still fail closed without a network request", async () => {
  let fetchCalls = 0;
  const { api, client } = createDemoApi({
    active: true,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("network must remain isolated from Demo");
    },
  });

  await assert.rejects(client.request("/unsupported-demo-endpoint"), /endpoint/);
  assert.equal(api.isActive(), true);
  assert.equal(fetchCalls, 0);
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
