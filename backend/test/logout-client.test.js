const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const frontendRoot = path.join(__dirname, "..", "..", "frontend");
const apiSource = fs.readFileSync(path.join(frontendRoot, "api.js"), "utf8");

function createStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("logout clears the mobile session before waiting for the network", async () => {
  const localStorage = createStorage({ currentUser: "user", authToken: "token" });
  let finishRequest;
  let redirectedTo = null;
  const window = {
    setTimeout,
    clearTimeout,
    location: {
      hostname: "www.car-remind.gr",
      replace(url) {
        redirectedTo = url;
      },
    },
  };
  const context = vm.createContext({
    window,
    localStorage,
    console,
    AbortController,
    fetch() {
      return new Promise((resolve) => {
        finishRequest = resolve;
      });
    },
  });

  vm.runInContext(apiSource, context);
  const logoutPromise = window.api.logout();

  assert.equal(localStorage.getItem("currentUser"), null);
  assert.equal(localStorage.getItem("authToken"), null);
  assert.equal(localStorage.getItem("caremindExplicitLogout"), "1");
  assert.equal(redirectedTo, null);

  finishRequest({ ok: true });
  await logoutPromise;
  assert.equal(redirectedTo, "index.html");
});

test("account logout waits for completion and the auth guard respects explicit logout", () => {
  const accountSource = fs.readFileSync(path.join(frontendRoot, "account.js"), "utf8");
  const guardSource = fs.readFileSync(path.join(frontendRoot, "auth-guard.js"), "utf8");

  assert.match(accountSource, /addEventListener\("click", async \(e\)/);
  assert.match(accountSource, /await auth\.logout\(\)/);
  assert.doesNotMatch(accountSource, /auth\.logout\(\);\s*window\.location/);
  assert.match(guardSource, /caremindExplicitLogout/);
});
