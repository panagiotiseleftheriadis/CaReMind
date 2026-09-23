const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const frontendRoot = path.join(__dirname, "..", "..", "frontend");
const read = (file) => fs.readFileSync(path.join(frontendRoot, file), "utf8");

function storage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
}

function demo() {
  let networkCalls = 0;
  const localStorage = storage();
  const window = { location: { hostname: "localhost", pathname: "/vehicle" } };
  const context = { window, document: { addEventListener() {} }, localStorage, console, Date, JSON, Math, Number, String, Error, URLSearchParams, fetch: async () => { networkCalls += 1; throw new Error("network forbidden"); } };
  vm.runInNewContext(read("demo-store.js"), context);
  vm.runInNewContext(read("api.js"), context);
  window.CaReMindDemo.start();
  return { store: window.CaReMindDemo, api: window.api, networkCalls: () => networkCalls };
}

function loadUi() {
  const window = { addEventListener() {}, setTimeout };
  const document = { addEventListener() {} };
  const context = { window, document, console, String, Boolean, setTimeout };
  vm.runInNewContext(read("ui.js"), context);
  return window.CaReMindUI;
}

function loadRecordLabels() {
  const window = {};
  vm.runInNewContext(read("maintenance-labels.js"), { window, String });
  return window.CaReMindRecordLabels;
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("vehicle detail is a protected, extensionless bookmark that preserves its id", async () => {
  const html = read("vehicle.html");
  assert.match(html, /auth-guard\.js/);
  assert.match(html, /<main id="main-content"/);
  assert.equal((html.match(/<h1/g) || []).length, 1);

  const authSource = read("auth-guard.js");
  let redirect = null;
  const context = vm.createContext({
    console: { ...console, warn() {} }, setTimeout, localStorage: storage(),
    document: { addEventListener() {} }, api: { async refreshToken() { throw new Error("expired"); } },
    window: { location: { pathname: "/vehicle", search: "?id=17", replace(value) { redirect = value; } } },
  });
  vm.runInContext(authSource, context);
  await vm.runInContext("checkAuth()", context);
  assert.equal(redirect, "/login?next=vehicle%3Fid%3D17");

  const port = await freePort();
  const server = spawn(process.execPath, [path.join(__dirname, "..", "scripts", "serve-frontend.js")], { cwd: path.join(__dirname, ".."), env: { ...process.env, FRONTEND_HOST: "127.0.0.1", FRONTEND_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error("server timeout")), 5000); server.once("error", reject); server.stdout.on("data", (chunk) => { if (chunk.toString().includes("CaReMind frontend available")) { clearTimeout(timeout); resolve(); } }); });
    assert.equal((await fetch(`http://127.0.0.1:${port}/vehicle?id=17`)).status, 200);
    const canonical = await fetch(`http://127.0.0.1:${port}/vehicle.html?id=17`, { redirect: "manual" });
    assert.equal(canonical.status, 308);
    assert.equal(canonical.headers.get("location"), "/vehicle?id=17");
  } finally { server.kill(); }
});

test("Vercel generic rules support canonical vehicle detail without a redirect loop", () => {
  const config = JSON.parse(read("vercel.json"));
  assert.ok(config.redirects.some((rule) => rule.source === "/:path*.html" && rule.destination === "/:path*"));
  assert.ok(config.rewrites.some((rule) => rule.source === "/:path" && rule.destination === "/:path.html"));
  assert.equal(config.redirects.some((rule) => rule.source === "/vehicle"), false);
});

test("vehicle list has server-filtered active/archive views and deliberate empty states", () => {
  const html = read("vehicles.html");
  const source = read("vehicles.js");
  assert.match(html, /data-state="active" aria-pressed="true"/);
  assert.match(html, /data-state="archived" aria-pressed="false"/);
  assert.match(source, /api\.getVehicles\(this\.state\)/);
  assert.match(source, /api\.getVehicles\("active"\)/);
  assert.match(source, /api\.getVehicles\("archived"\)/);
  assert.match(source, /Δεν έχεις ενεργά οχήματα\./);
  assert.match(source, /Δεν έχεις αρχειοθετημένα οχήματα\./);
  assert.match(source, /href="\/vehicle\?id=\$\{id\}"/);
  assert.match(html, /class="vehicles-toolbar"/);
  assert.doesNotMatch(html, /Το αρχείο του στόλου σου/);
  for (const field of ["make", "model", "registrationPlate", "registrationCountry", "vin", "fuelType", "year", "currentMileage", "purchaseDate", "purchaseAmount", "currency"]) {
    assert.match(html, new RegExp(`id="${field}"`));
  }
  assert.match(source, /purchaseAmount: rawPurchaseAmount \? Number\(rawPurchaseAmount\) : null/);
});

test("shared vehicle display name removes only an exact duplicate make prefix", () => {
  const ui = loadUi();
  assert.equal(ui.vehicleDisplayName("Toyota", "Toyota Corolla"), "Toyota Corolla");
  assert.equal(ui.vehicleDisplayName(" Toyota ", " toyota Corolla "), "toyota Corolla");
  assert.equal(ui.vehicleDisplayName("Toyota", "Corolla"), "Toyota Corolla");
  assert.equal(ui.vehicleDisplayName(null, "Corolla"), "Corolla");
  assert.equal(ui.vehicleDisplayName("Toyota", null), "Toyota");
  assert.equal(ui.vehicleDisplayName("Mercedes-Benz", "Mercedes Atego"), "Mercedes Atego");
  assert.equal(ui.vehicleDisplayName("Land Rover", "Rover 75"), "Land Rover Rover 75");
  assert.match(read("vehicles.js"), /CaReMindUI\.vehicleDisplayName/);
  assert.match(read("vehicle.js"), /vehicleUi\.vehicleDisplayName/);
});

test("shared modal lifecycle suppresses and restores the Demo banner", async () => {
  const makeNode = () => ({
    attributes: new Set(), listeners: {}, style: {},
    addEventListener(type, callback) { this.listeners[type] = callback; },
    focus() {}, hasAttribute(name) { return this.attributes.has(name); },
    setAttribute(name) { this.attributes.add(name); }, removeAttribute(name) { this.attributes.delete(name); },
  });
  const cancel = makeNode();
  const accept = makeNode();
  const banner = makeNode();
  let overlay = null;
  const body = {
    children: [banner], style: {}, classList: { toggle() {} },
    appendChild(node) { overlay = node; },
  };
  const document = {
    activeElement: null, body,
    addEventListener() {}, removeEventListener() {},
    createElement() {
      const node = makeNode();
      node.querySelector = (selector) => selector.includes("cancel") ? cancel : accept;
      node.querySelectorAll = () => [cancel, accept];
      node.remove = () => { overlay = null; };
      return node;
    },
    getElementById(id) { return id === "demoModeBanner" ? banner : null; },
    querySelector(selector) { return selector === ".app-confirm-overlay" ? overlay : null; },
    querySelectorAll() { return []; },
  };
  const window = { addEventListener() {}, setTimeout, getComputedStyle() { return {}; } };
  vm.runInNewContext(read("ui.js"), { window, document, console, String, Boolean, setTimeout });

  const answer = window.CaReMindUI.confirm("test");
  assert.equal(banner.hidden, true);
  assert.equal(banner.attributes.has("aria-hidden"), true);
  cancel.listeners.click();
  assert.equal(await answer, false);
  assert.equal(banner.hidden, false);

  const ui = read("ui.js");
  const demoSource = read("demo-store.js");
  assert.match(ui, /demoBanner\.hidden = modalOpen/);
  assert.match(ui, /demoBanner\.setAttribute\("aria-hidden", String\(modalOpen\)\)/);
  assert.match(ui, /syncModalEnvironment\(\);\s*};\s*\n\s*syncModalState\(\)/);
  assert.match(ui, /overlay\.remove\(\);\s*syncModalEnvironment\(\)/);
  assert.match(demoSource, /#demoModeBanner\[hidden\] \{ display: none !important; \}/);
});

test("detail handles invalid IDs, owner-authoritative errors, archived reading and PATCH validation", () => {
  const html = read("vehicle.html");
  const source = read("vehicle.js");
  assert.ok(source.includes('/^\\d+$/.test'));
  assert.match(source, /δεν περιέχει έγκυρο αναγνωριστικό/);
  assert.match(source, /error\.status === 404/);
  assert.match(source, /δεν βρέθηκε ή δεν είναι διαθέσιμο στον λογαριασμό σου/);
  assert.match(source, /api\.getVehicle\(this\.id\)/);
  assert.match(source, /api\.patchVehicle\(this\.id, patch\)/);
  assert.match(source, /DUPLICATE_CHASSIS_NUMBER/);
  assert.match(source, /this\.vehicle = await api\.patchVehicle/);
  assert.match(source, /v\.state === "archived" \|\| v\.archivedAt != null/);
  assert.match(html, /id="restoreVehicleButton" hidden/);
  assert.doesNotMatch(source, /currentUser/);
});

test("normal vehicle UI archives with accessible confirmation and never hard deletes", () => {
  const list = read("vehicles.js");
  const detail = read("vehicle.js");
  const ui = read("ui.js");
  assert.doesNotMatch(`${list}\n${detail}`, /deleteVehicle|method:\s*["']DELETE["']/);
  assert.match(detail, /api\.archiveVehicle\(this\.id\)/);
  assert.match(detail, /api\.restoreVehicle\(this\.id\)/);
  assert.match(detail, /VEHICLE_ARCHIVE_DISABLED/);
  assert.match(detail, /Το όχημα δεν διαγράφηκε/);
  assert.match(detail, /Τα service, τα κόστη και το ιστορικό του δεν θα διαγραφούν/);
  assert.match(ui, /role="alertdialog" aria-modal="true"/);
  assert.match(ui, /event\.key !== "Tab"/);
  assert.match(ui, /event\.key === "Escape"/);
  assert.match(ui, /previouslyFocused\?\.focus/);
  assert.match(ui, /setAttribute\("inert", ""\)/);
  assert.match(read("vehicle.html"), /class="btn-primary" id="archiveVehicleButton"/);
  assert.doesNotMatch(read("vehicle.css"), /\.archive-action/);
});

test("detail shares canonical maintenance and cost labels, descriptions and safe wrapping", () => {
  const labels = loadRecordLabels();
  const maintenance = labels.maintenance({ maintenanceType: "tires", notes: "Έλεγχος πίεσης" });
  assert.equal(maintenance.title, "Αλλαγή Λάστιχων");
  assert.equal(maintenance.description, "Έλεγχος πίεσης");
  const cost = labels.cost({ category: "fuel", description: "Γέμισμα πριν από ταξίδι" });
  assert.equal(cost.title, "Καύσιμα");
  assert.equal(cost.description, "Γέμισμα πριν από ταξίδι");
  assert.equal(labels.maintenance({ maintenanceType: "Ειδικός έλεγχος πολύ μεγάλου μήκους" }).title, "Ειδικός έλεγχος πολύ μεγάλου μήκους");
  assert.equal(labels.cost({ category: "Εξειδικευμένη εργασία πολύ μεγάλου μήκους" }).title, "Εξειδικευμένη εργασία πολύ μεγάλου μήκους");

  const detail = read("vehicle.js");
  assert.match(detail, /CaReMindRecordLabels\.maintenance\(item\)/);
  assert.match(detail, /CaReMindRecordLabels\.cost\(item\)/);
  assert.doesNotMatch(detail, /escapeHtml\(item\.maintenanceType/);
  assert.doesNotMatch(detail, /escapeHtml\(item\.category/);
  assert.match(read("maintenance.js"), /CaReMindRecordLabels\.type\(type\)/);
  assert.match(read("costs.js"), /CaReMindRecordLabels\.costCategory\(category\)/);
  assert.match(read("vehicle.css"), /\.history-row strong,\.history-row small[^{]*\{[^}]*overflow-wrap:anywhere;[^}]*word-break:break-word/);
});

test("Demo supports detail, edit, archive lists and restore without network fallback", async () => {
  const page = demo();
  page.store.setVehicleArchiveEnabled(true);
  const active = await page.api.getVehicles("active");
  const original = active[0];
  const detail = await page.api.getVehicle(original.id);
  assert.equal(detail.id, original.id);
  const patched = await page.api.patchVehicle(original.id, { make: "Toyota", model: "Corolla" });
  assert.equal(patched.revision, detail.revision + 1);
  const archived = await page.api.archiveVehicle(original.id);
  assert.equal(archived.state, "archived");
  assert.equal((await page.api.getVehicles("active")).some((item) => item.id === original.id), false);
  assert.equal((await page.api.getVehicles("archived")).some((item) => item.id === original.id), true);
  const restored = await page.api.restoreVehicle(original.id);
  assert.equal(restored.state, "active");
  assert.equal((await page.api.getVehicles("active")).some((item) => item.id === original.id), true);
  assert.equal(page.networkCalls(), 0);
});

test("Demo create and vehicle-scoped history preserve P3a fields without network fallback", async () => {
  const page = demo();
  const created = await page.api.addVehicle({
    vehicleType: "Επιβατικό ΙΧ", chassisNumber: "DEMO-NEW", make: "Toyota", model: "Yaris",
    registrationPlate: "ΙΟΧ-1234", registrationCountry: "gr", vin: "demo-vin",
    fuelType: "hybrid", year: 2025, currentMileage: 500, purchaseDate: "2026-01-10",
    purchaseAmount: 22000, currency: "eur",
  });
  assert.equal(created.registrationCountry, "GR");
  assert.equal(created.vin, "DEMO-VIN");
  assert.equal(created.currency, "EUR");
  const vehicleId = (await page.api.getVehicles("all"))[0].id;
  const maintenance = await page.api.getMaintenances(vehicleId);
  const costs = await page.api.getCosts(vehicleId);
  assert.ok(maintenance.every((item) => Number(item.vehicleId) === Number(vehicleId)));
  assert.ok(costs.every((item) => Number(item.vehicleId) === Number(vehicleId)));
  assert.equal(page.networkCalls(), 0);
});

test("detail layout exposes semantic state, labels and narrow-screen card rules", () => {
  const html = read("vehicle.html");
  const listCss = read("vehicles.css");
  const detailCss = read("vehicle.css");
  assert.match(html, /aria-labelledby="vehicleTitle"/);
  assert.match(html, /role="alert"/);
  assert.match(html, /<button[^>]+id="archiveVehicleButton"/);
  assert.match(listCss, /@media \(max-width: 430px\)/);
  assert.match(detailCss, /@media \(max-width:520px\)/);
  assert.match(detailCss, /grid-template-columns:1fr/);
  assert.match(listCss, /#addVehicleModal \.vehicle-form-dialog > \.close[\s\S]*width: 44px/);
  assert.match(detailCss, /\.vehicle-edit-dialog > \.close[\s\S]*width:44px/);
  const demoSource = read("demo-store.js");
  assert.match(demoSource, /:root\.caremind-demo-active[\s\S]*--demo-banner-clearance:[\s\S]*scroll-padding-bottom/);
  assert.match(demoSource, /body\.caremind-demo-active[\s\S]*padding-bottom: var\(--demo-banner-clearance\)/);
  assert.match(demoSource, /:focus-visible[\s\S]*scroll-margin-bottom: var\(--demo-banner-clearance\)/);
  assert.match(demoSource, /@media \(max-width: 620px\)[\s\S]*env\(safe-area-inset-bottom/);
  assert.match(demoSource, /if \(height > 0\)/);
  assert.doesNotMatch(detailCss, /overflow-x:\s*scroll/);
  assert.match(read("dashboard.js"), /href="\/vehicle\?id=\$\{Number\(activity\.vehicleId\)\}"/);
  assert.match(read("dashboard.js"), /activity-link/);
  assert.match(read("dashboard.css"), /\.activity-link:visited[\s\S]*color: inherit/);
  assert.match(read("vehicle.html"), /class="vehicles-header-main"/);
  assert.match(read("vehicle.html"), /id="vehicleMaintenanceHistory"/);
  assert.match(read("vehicle.js"), /api\.getMaintenances\(this\.id\)/);
  assert.match(read("vehicle.js"), /api\.getCosts\(this\.id\)/);
});

test("vehicle identity hero is compact, informative and keeps textual state", () => {
  const html = read("vehicle.html");
  const css = read("vehicle.css");
  const source = read("vehicle.js");
  assert.doesNotMatch(html, /class="vehicle-mark"|>CR</);
  assert.doesNotMatch(css, /\.vehicle-mark|\.vehicle-eyebrow|vehicle-identity::after/);

  const title = html.indexOf('id="vehicleTitle"');
  const state = html.indexOf('id="vehicleStateBadge"');
  const subtitle = html.indexOf('id="vehicleSubtitle"');
  const mileage = html.indexOf('id="vehicleMileage"');
  const year = html.indexOf('id="vehicleYear"');
  assert.ok(title >= 0 && title < state && state < subtitle && subtitle < mileage && mileage < year);
  assert.match(source, /archived \? "Αρχειοθετημένο" : "Ενεργό"/);
  assert.match(html, />Χιλιόμετρα<[^]*id="vehicleMileage"/);
  assert.match(html, />Έτος<[^]*id="vehicleYear"/);
  assert.match(css, /\.vehicle-identity-header[^}]*flex-wrap:wrap/);
  assert.match(css, /\.vehicle-identity h2[^}]*min-width:0[^}]*overflow-wrap:anywhere/);
  assert.match(css, /@media \(max-width:520px\)[^]*\.vehicle-identity \{ padding:18px/);
  assert.match(css, /\.vehicle-identity-metrics[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});
