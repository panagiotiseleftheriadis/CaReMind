const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const frontendRoot = path.join(__dirname, "..", "..", "frontend");
const tourSource = fs.readFileSync(path.join(frontendRoot, "demo-tour.js"), "utf8");

const pageTargets = {
  dashboard: ["dashboard-welcome", "dashboard-stats", "dashboard-charts", "dashboard-actions"],
  vehicles: ["vehicles-intro", "vehicles-add", "vehicles-list"],
  maintenance: [
    "maintenance-intro",
    "maintenance-summary",
    "maintenance-add",
    "maintenance-filters",
    "maintenance-list",
  ],
  costs: ["costs-intro", "costs-summary", "costs-filters", "costs-list"],
  account: ["account-profile", "account-settings"],
};

test("every guided-tour chapter is wired to real page targets", () => {
  for (const [page, targets] of Object.entries(pageTargets)) {
    const html = fs.readFileSync(path.join(frontendRoot, `${page}.html`), "utf8");
    assert.match(html, /demo-tour\.css\?v=1/);
    assert.match(html, /demo-tour\.js\?v=1/);

    for (const target of targets) {
      assert.match(html, new RegExp(`data-tour=["']${target}["']`));
      assert.match(tourSource, new RegExp(`data-tour=\\\\?"${target}\\\\?"`));
    }
  }
});

test("guided tour is demo-only, resumable and exposes the banner launcher", () => {
  const demoStore = fs.readFileSync(path.join(frontendRoot, "demo-store.js"), "utf8");
  assert.match(tourSource, /CaReMindDemo\?\.isActive/);
  assert.match(tourSource, /caremindDemoTourV1/);
  assert.match(tourSource, /startOrResume/);
  assert.match(demoStore, /id="startDemoTourBtn"/);
  assert.match(demoStore, /localStorage\.removeItem\(TOUR_KEY\)/);
});
