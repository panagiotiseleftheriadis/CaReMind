const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function classList() {
  const values = new Set();
  return {
    contains: (name) => values.has(name),
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    toggle(name) {
      if (values.has(name)) {
        values.delete(name);
        return false;
      }
      values.add(name);
      return true;
    },
  };
}

function createNavigationUi({ role = null, demoActive = false, isDemo = false } = {}) {
  const documentListeners = {};
  const windowListeners = {};
  const buttonListeners = {};
  const navigationListeners = {};
  const attributes = new Map();
  const body = { classList: classList() };
  const adminLink = { hidden: false };

  const navigation = {
    id: "",
    addEventListener: (name, handler) => (navigationListeners[name] = handler),
  };
  const header = { querySelector: (selector) => (selector === "nav" ? navigation : null) };
  const button = {
    parentElement: header,
    closest: (selector) => (selector === "header" ? header : null),
    hasAttribute: (name) => attributes.has(name),
    setAttribute: (name, value) => attributes.set(name, String(value)),
    addEventListener: (name, handler) => (buttonListeners[name] = handler),
  };
  const document = {
    body,
    querySelectorAll(selector) {
      if (selector === ".nav-toggle") return [button];
      if (selector === "[data-admin-only]") return [adminLink];
      return [];
    },
    addEventListener(name, handler) {
      documentListeners[name] ||= [];
      documentListeners[name].push(handler);
    },
  };
  const window = {
    innerWidth: 390,
    CaReMindDemo: { isActive: () => demoActive },
    addEventListener: (name, handler) => (windowListeners[name] = handler),
  };
  const localStorage = {
    getItem: (key) =>
      key === "currentUser" && role
        ? JSON.stringify({ role, isDemo })
        : null,
  };

  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "frontend", "ui.js"),
    "utf8"
  );
  vm.runInNewContext(source, {
    window,
    document,
    localStorage,
    MutationObserver: class {},
  });
  documentListeners.DOMContentLoaded[0]();

  return {
    adminLink,
    attributes,
    body,
    buttonListeners,
    documentListeners,
    window,
    windowListeners,
  };
}

test("admin navigation is visible only to real admin sessions, never in demo", () => {
  assert.equal(createNavigationUi({ role: "admin" }).adminLink.hidden, false);
  assert.equal(
    createNavigationUi({ role: "admin", demoActive: true }).adminLink.hidden,
    true
  );
  assert.equal(
    createNavigationUi({ role: "admin", isDemo: true }).adminLink.hidden,
    true
  );
  assert.equal(createNavigationUi({ role: "guest" }).adminLink.hidden, true);
  assert.equal(createNavigationUi({ role: "user" }).adminLink.hidden, true);
});

test("mobile navigation toggles, closes with Escape and resets on desktop", () => {
  const ui = createNavigationUi();

  ui.buttonListeners.click();
  assert.equal(ui.body.classList.contains("nav-open"), true);
  assert.equal(ui.attributes.get("aria-expanded"), "true");
  assert.equal(ui.attributes.get("aria-label"), "Κλείσιμο μενού");

  ui.documentListeners.keydown.forEach((handler) => handler({ key: "Escape" }));
  assert.equal(ui.body.classList.contains("nav-open"), false);
  assert.equal(ui.attributes.get("aria-expanded"), "false");

  ui.buttonListeners.click();
  ui.window.innerWidth = 1024;
  ui.windowListeners.resize();
  assert.equal(ui.body.classList.contains("nav-open"), false);
  assert.equal(ui.attributes.get("aria-label"), "Άνοιγμα μενού");
});
