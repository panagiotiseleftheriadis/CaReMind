const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const frontendRoot = path.join(__dirname, "..", "..", "frontend");

function readFrontend(file) {
  return fs.readFileSync(path.join(frontendRoot, file), "utf8");
}

function readJpegDimensions(buffer) {
  assert.deepEqual([...buffer.subarray(0, 2)], [0xff, 0xd8]);
  assert.deepEqual([...buffer.subarray(-2)], [0xff, 0xd9]);

  const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;
    const segmentLength = buffer.readUInt16BE(offset);
    if (startOfFrameMarkers.has(marker)) {
      return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
    }
    offset += segmentLength;
  }
  throw new Error("JPEG dimensions not found");
}

function createStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("public landing and login are separate, canonical pages", () => {
  const landing = readFrontend("index.html");
  const login = readFrontend("login.html");
  const register = readFrontend("register.html");

  assert.match(landing, /<main id="main-content">/);
  assert.match(landing, /Όλο το ιστορικό του οχήματός σου/);
  assert.match(landing, /href="\/login"/);
  assert.doesNotMatch(landing, /id="loginForm"/);
  assert.match(landing, /aria-controls="siteNavigation"/);
  assert.match(landing, /class="skip-link"/);
  assert.match(login, /id="loginForm"/);
  assert.match(login, /class="auth-brand"/);
  assert.doesNotMatch(login, /Mind your car\.|src="logo\.svg"/);
  assert.match(login, /rel="canonical" href="https:\/\/www\.car-remind\.gr\/login"/);
  assert.match(login, /name="robots" content="noindex, follow"/);
  assert.match(register, /name="robots" content="noindex, follow"/);
});

test("landing claims map to current product behavior and omit future features", () => {
  const landing = readFrontend("index.html");
  const evidence = {
    "maintenance tracking and completion": readFrontend("maintenance.js"),
    "cost filters, charts and CSV": `${readFrontend("costs.js")}\n${readFrontend("costs-export.js")}`,
    "multiple vehicles": readFrontend("vehicles.js"),
    "browser-only Demo": readFrontend("demo-store.js"),
    "configurable reminder recipients": readFrontend("account.js"),
  };

  assert.match(landing, /Ιστορικό service/);
  assert.match(evidence["maintenance tracking and completion"], /completeMaintenance/);
  assert.match(landing, /Φίλτρα, διαγράμματα και εξαγωγή CSV/);
  assert.match(evidence["cost filters, charts and CSV"], /exportCsv/);
  assert.match(landing, /Πολλά οχήματα/);
  assert.match(evidence["multiple vehicles"], /addVehicle/);
  assert.match(landing, /χωρίς σύνδεση με το backend/);
  assert.match(evidence["browser-only Demo"], /CaReMindDemo/);
  assert.match(evidence["configurable reminder recipients"], /addRecipient/);

  const unavailableClaims = [
    /14 ημέρες δωρεάν/i,
    /premium/i,
    /συνδρομ/i,
    /ανέβασμα (?:απόδειξης|εγγράφου)/i,
    /PDF dossier/i,
    /push notification/i,
    /AI (?:σύσταση|πρόταση)/i,
    /ομάδα χρηστών/i,
  ];
  unavailableClaims.forEach((claim) => assert.doesNotMatch(landing, claim));
});

test("Vercel preserves the landing page and canonicalizes extensionless login", () => {
  const config = JSON.parse(readFrontend("vercel.json"));
  assert.deepEqual(config.redirects[0], {
    source: "/index.html",
    destination: "/",
    permanent: true,
  });
  assert.ok(config.redirects.some((rule) => rule.source === "/login.html" && rule.destination === "/login"));
  assert.ok(config.rewrites.some((rule) => rule.source === "/" && rule.destination === "/index.html"));
  assert.ok(config.rewrites.some((rule) => rule.source === "/login" && rule.destination === "/login.html"));
  assert.ok(config.rewrites.some((rule) => rule.source === "/:path" && rule.destination === "/:path.html"));
  assert.equal(config.redirects.some((rule) => rule.source === "/login"), false, "login must not redirect to itself");
});

test("bundled local server mirrors extensionless page routing without loops", async () => {
  const port = await getFreePort();
  const server = spawn(process.execPath, [path.join(__dirname, "..", "scripts", "serve-frontend.js")], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, FRONTEND_HOST: "127.0.0.1", FRONTEND_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("local frontend server did not start")), 5000);
      server.once("error", reject);
      server.stdout.on("data", (chunk) => {
        if (chunk.toString().includes("CaReMind frontend available")) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    const base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal((await fetch(`${base}/login`)).status, 200);
    assert.equal((await fetch(`${base}/register`)).status, 200);
    const canonical = await fetch(`${base}/login.html`, { redirect: "manual" });
    assert.equal(canonical.status, 308);
    assert.equal(canonical.headers.get("location"), "/login");
  } finally {
    server.kill();
  }
});

test("auth guard leaves the landing public and redirects protected routes to login with next", async () => {
  const source = readFrontend("auth-guard.js");
  const callbacks = [];
  let redirectedTo = null;
  let refreshCalls = 0;
  const api = { async refreshToken() { refreshCalls += 1; return { accessToken: "ok" }; } };
  const context = vm.createContext({
    console: { ...console, warn() {} },
    setTimeout,
    localStorage: createStorage(),
    document: { addEventListener(_event, callback) { callbacks.push(callback); } },
    api,
    window: {
      api,
      location: { pathname: "/", search: "", replace(value) { redirectedTo = value; } },
    },
  });
  vm.runInContext(source, context);
  await vm.runInContext("checkAuth()", context);
  assert.equal(refreshCalls, 0);
  assert.equal(redirectedTo, null);

  context.window.location.pathname = "/register";
  context.api.refreshToken = async () => { throw new Error("no session"); };
  await vm.runInContext("checkAuth()", context);
  assert.equal(redirectedTo, null);

  context.window.location.pathname = "/costs";
  context.window.location.search = "?period=year";
  context.api.refreshToken = async () => { throw new Error("expired"); };
  await vm.runInContext("checkAuth()", context);
  assert.equal(redirectedTo, "/login?next=costs%3Fperiod%3Dyear");
});

test("login accepts only known local protected destinations", async () => {
  const context = vm.createContext({
    console,
    URLSearchParams,
    localStorage: createStorage({ caremindExplicitLogout: "1" }),
    document: {
      addEventListener() {},
      getElementById() { return null; },
      querySelectorAll() { return []; },
    },
    window: {
      location: { pathname: "/login", search: "?next=vehicles%3FvehicleId%3D7", href: "" },
    },
    api: {
      async login() { return { user: { id: 1, username: "owner", role: "user" } }; },
      async refreshToken() { throw new Error("not expected"); },
    },
  });
  vm.runInContext(readFrontend("auth.js"), context);

  assert.equal(vm.runInContext("getSafeNextDestination('costs?period=year')", context), "/costs?period=year");
  assert.equal(vm.runInContext("getSafeNextDestination('https://evil.example')", context), null);
  assert.equal(vm.runInContext("getSafeNextDestination('//evil.example')", context), null);
  assert.equal(vm.runInContext("getSafeNextDestination('javascript:alert(1)')", context), null);
  assert.equal(vm.runInContext("getSafeNextDestination('register')", context), null);

  await vm.runInContext("auth.login('owner', 'correct-password')", context);
  assert.equal(context.window.location.href, "/vehicles?vehicleId=7");
  context.window.location.search = "?next=https%3A%2F%2Fevil.example";
  await vm.runInContext("auth.login('owner', 'correct-password')", context);
  assert.equal(context.window.location.href, "/dashboard");
});

test("landing Demo entry starts the existing browser store and opens the dashboard", () => {
  let clickHandler;
  let startOptions;
  const demoButton = { addEventListener(event, callback) { if (event === "click") clickHandler = callback; } };
  const context = vm.createContext({
    localStorage: createStorage({ caremindExplicitLogout: "1" }),
    document: {
      body: { classList: { add() {}, remove() {}, toggle() {} } },
      addEventListener() {},
      getElementById() { return null; },
      querySelectorAll(selector) { return selector === "[data-demo-start]" ? [demoButton] : []; },
    },
    window: {
      innerWidth: 1200,
      addEventListener() {},
      location: { href: "" },
      CaReMindDemo: { start(options) { startOptions = options; } },
    },
  });

  vm.runInContext(readFrontend("landing.js"), context);
  clickHandler();
  assert.equal(startOptions.reset, true);
  assert.equal(context.localStorage.getItem("caremindExplicitLogout"), null);
  assert.equal(context.window.location.href, "/dashboard");
});

test("landing mobile menu closes on Escape, restores focus, and does not scroll", () => {
  const handlers = {};
  const classes = new Set();
  let expanded = "false";
  let focused = false;
  const toggle = {
    addEventListener(event, callback) { handlers[`toggle:${event}`] = callback; },
    getAttribute(name) { return name === "aria-expanded" ? expanded : null; },
    setAttribute(name, value) { if (name === "aria-expanded") expanded = value; },
    focus() { focused = true; },
  };
  const navigation = {
    classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); }, remove(name) { classes.delete(name); } },
    querySelectorAll() { return []; },
  };
  const bodyClasses = new Set();
  const bodyClassList = {
    toggle(name, enabled) { enabled ? bodyClasses.add(name) : bodyClasses.delete(name); },
    remove(name) { bodyClasses.delete(name); },
  };
  const context = vm.createContext({
    localStorage: createStorage(),
    document: {
      body: { classList: bodyClassList },
      addEventListener(event, callback) { handlers[`document:${event}`] = callback; },
      getElementById(id) { return id === "navToggle" ? toggle : id === "siteNavigation" ? navigation : null; },
      querySelectorAll() { return []; },
    },
    window: { innerWidth: 390, scrollY: 420, addEventListener() {}, location: { href: "" } },
  });

  vm.runInContext(readFrontend("landing.js"), context);
  handlers["toggle:click"]();
  assert.equal(expanded, "true");
  assert.equal(classes.has("is-open"), true);
  assert.equal(bodyClasses.has("nav-open"), true);
  assert.equal(context.window.scrollY, 420);

  handlers["document:keydown"]({ key: "Escape" });
  assert.equal(expanded, "false");
  assert.equal(classes.has("is-open"), false);
  assert.equal(bodyClasses.has("nav-open"), false);
  assert.equal(focused, true);
  assert.equal(context.window.scrollY, 420);
});

test("landing FAQ and mobile product images retain accessible, bounded layouts", () => {
  const landing = readFrontend("index.html");
  const styles = readFrontend("landing.css");

  assert.match(landing, /<details><summary aria-expanded="false">Μπορώ να το δοκιμάσω χωρίς λογαριασμό;/);
  assert.match(readFrontend("landing.js"), /setAttribute\("aria-expanded", String\(item\.open\)\)/);
  assert.match(styles, /\.faq-list details\[open\] \{ padding-bottom:/);
  assert.match(styles, /\.faq-list details\[open\] summary span::before \{ content: "−";/);
  assert.match(styles, /\.product-frame-image \{ overflow: hidden;/);
  assert.match(styles, /\.gallery-image \{ overflow: hidden;/);
  assert.match(landing, /width="1400" height="1732" loading="lazy"/);
  assert.match(landing, /width="1400" height="2824" loading="lazy"/);
});

test("landing art-directs real mobile product screenshots without changing desktop sources", () => {
  const landing = readFrontend("index.html");
  const styles = readFrontend("landing.css");
  const names = ["dashboard", "vehicles", "maintenances", "costs"];

  names.forEach((name) => {
    assert.match(
      landing,
      new RegExp(`<source media="\\(max-width: 700px\\)" srcset="assets/product/mobile/${name}\\.jpg" width="780" height="1688"`)
    );
    assert.match(landing, new RegExp(`<img src="assets/product/${name}\\.jpg"`));
  });

  assert.equal((landing.match(/<picture>/g) || []).length, 4);
  assert.match(styles, /\.preview-window img \{ width: 100%; height: 100%; object-fit: contain;/);
  assert.match(styles, /\.gallery-image-landscape, \.gallery-image-tall \{ aspect-ratio: 780 \/ 1688; \}/);
  assert.doesNotMatch(styles, /\.preview-window img \{ width: 175%/);
  assert.doesNotMatch(styles, /\.product-frame img \{ width: 158%/);
});

test("mobile product assets are optimized JPEGs with the declared intrinsic dimensions", () => {
  const names = ["dashboard", "vehicles", "maintenances", "costs"];
  names.forEach((name) => {
    const file = path.join(frontendRoot, "assets", "product", "mobile", `${name}.jpg`);
    const contents = fs.readFileSync(file);
    assert.deepEqual(readJpegDimensions(contents), { width: 780, height: 1688 });
    assert.ok(contents.length >= 70 * 1024, `${name}.jpg should retain readable image quality`);
    assert.ok(contents.length <= 200 * 1024, `${name}.jpg should remain reasonably lightweight`);
  });

  const landing = readFrontend("index.html");
  assert.doesNotMatch(landing, /dashboard\.jpg"[^>]*loading="lazy"/);
  ["vehicles", "maintenances", "costs"].forEach((name) => {
    assert.match(landing, new RegExp(`${name}\\.jpg"[^>]*loading="lazy"`));
  });
});
