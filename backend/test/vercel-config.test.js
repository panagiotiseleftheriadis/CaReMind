const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendRoot = path.join(__dirname, "..");

test("Vercel auto-detects the Express entry point without Edge Middleware", () => {
  assert.equal(fs.existsSync(path.join(backendRoot, "middleware.js")), false);
  assert.equal(fs.existsSync(path.join(backendRoot, "authMiddleware.js")), true);
  assert.equal(fs.existsSync(path.join(backendRoot, "server.js")), true);
  assert.equal(fs.existsSync(path.join(backendRoot, "vercel.json")), false);
});
