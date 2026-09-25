const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { canonicalMigrationBytes, hashMigrationContent } = require("../scripts/migrate");

function rawSha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

test("LF migration content retains the existing raw SHA-256 checksum", () => {
  const content = Buffer.from("exports.up = async () => {\n  return 'migration';\n};\n", "utf8");
  assert.equal(hashMigrationContent(content), rawSha256(content));
});

test("equivalent LF and CRLF migration content have the same checksum", () => {
  const lf = Buffer.from("exports.up = async () => {\n  return 'migration';\n};\n");
  const crlf = Buffer.from(lf.toString().replace(/\n/g, "\r\n"));
  assert.equal(hashMigrationContent(crlf), hashMigrationContent(lf));
  assert.deepEqual(canonicalMigrationBytes(crlf), lf);
});

test("substantive migration edits still change the canonical checksum", () => {
  const original = Buffer.from("exports.up = async () => {\n  return 'migration';\n};\n");
  const modified = Buffer.from("exports.up = async () => {\n  return 'modified';\n};\n");
  assert.notEqual(hashMigrationContent(modified), hashMigrationContent(original));
});

test("canonicalization preserves lone carriage-return bytes", () => {
  const content = Buffer.from("first\rsecond");
  assert.deepEqual(canonicalMigrationBytes(content), content);
  assert.equal(hashMigrationContent(content), rawSha256(content));
  assert.notEqual(hashMigrationContent(content), hashMigrationContent(Buffer.from("first\nsecond")));
});

test("canonicalization preserves arbitrary non-UTF8 bytes except CRLF pairs", () => {
  const content = Buffer.from([0xff, 0xc0, 0xaf, 0x0d, 0x0a, 0x80, 0x0d, 0xfe]);
  const expected = Buffer.from([0xff, 0xc0, 0xaf, 0x0a, 0x80, 0x0d, 0xfe]);
  assert.deepEqual(canonicalMigrationBytes(content), expected);
  assert.equal(hashMigrationContent(content), rawSha256(expected));
});
