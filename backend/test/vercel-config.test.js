const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendRoot = path.join(__dirname, "..");

test("Express authentication is not mistaken for Vercel Edge Middleware", () => {
  assert.equal(fs.existsSync(path.join(backendRoot, "middleware.js")), false);
  assert.equal(fs.existsSync(path.join(backendRoot, "authMiddleware.js")), true);
  assert.equal(fs.existsSync(path.join(backendRoot, "api", "[...path].js")), true);
});
