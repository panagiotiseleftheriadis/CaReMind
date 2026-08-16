const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const frontendRoot = path.join(__dirname, "..", "..", "frontend");
const tourSource = fs.readFileSync(path.join(frontendRoot, "demo-tour.js"), "utf8");

const pageTargets = {
  dashboard: ["dashboard-stats", "dashboard-charts", "dashboard-actions"],
  vehicles: ["vehicles-add", "vehicles-list"],
  maintenance: ["maintenance-summary", "maintenance-add", "maintenance-list"],
  costs: ["costs-intro", "costs-summary", "costs-list"],
  account: ["account-profile"],
};

test("every guided-tour chapter is wired to real page targets", () => {
  for (const [page, targets] of Object.entries(pageTargets)) {
    const html = fs.readFileSync(path.join(frontendRoot, `${page}.html`), "utf8");
    assert.match(html, /demo-tour\.css\?v=5/);
    assert.match(html, /demo-tour\.js\?v=5/);

    for (const target of targets) {
      assert.match(html, new RegExp(`data-tour=["']${target}["']`));
      assert.match(tourSource, new RegExp(`data-tour=\\\\?"${target}\\\\?"`));
    }
  }
});

test("guided tour stays concise and uses smooth, non-overlapping presentation", () => {
  const tourCss = fs.readFileSync(path.join(frontendRoot, "demo-tour.css"), "utf8");
  const configuredSteps = tourSource.match(/target: '\[data-tour=/g) || [];

  assert.equal(configuredSteps.length, 12);
  assert.match(tourSource, /behavior:\s*"smooth"/);
  assert.match(tourSource, /observeScroll/);
  assert.match(tourSource, /scrollTargetSmoothly/);
  assert.match(tourSource, /is-step-entering/);
  assert.match(tourCss, /cubic-bezier\(\.22, 1, \.36, 1\)/);
  assert.match(tourSource, /M8 80h12l2-16/);
  assert.match(tourCss, /max-height:\s*36dvh/);
  assert.match(tourCss, /is-positioning/);
  assert.match(tourSource, /is-starting/);
  assert.match(tourCss, /tourLaunchCar/);
  assert.match(tourCss, /\.demo-tour-close\s*\{[\s\S]*?z-index:\s*5/);
});

test("guided tour is demo-only, resumable and exposes the banner launcher", () => {
  const demoStore = fs.readFileSync(path.join(frontendRoot, "demo-store.js"), "utf8");
  assert.match(tourSource, /CaReMindDemo\?\.isActive/);
  assert.match(tourSource, /caremindDemoTourV1/);
  assert.match(tourSource, /startOrResume/);
  assert.match(demoStore, /id="startDemoTourBtn"/);
  assert.match(demoStore, /localStorage\.removeItem\(TOUR_KEY\)/);
});
