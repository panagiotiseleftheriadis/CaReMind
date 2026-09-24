const assert = require("node:assert/strict");
const test = require("node:test");
const { securityTransaction, lockSecurityCode } = require("../security-transaction");

for (const failure of [null, "begin", "work", "commit", "rollback"]) {
  test(`security transaction cleanup: ${failure || "success"}`, async () => {
    const calls = [];
    const error = new Error("injected failure");
    const rollbackError = new Error("rollback failed");
    const connection = {
      async beginTransaction() { calls.push("begin"); if (failure === "begin") throw error; },
      async commit() { calls.push("commit"); if (failure === "commit") throw error; },
      async rollback() { calls.push("rollback"); if (failure === "rollback") throw rollbackError; },
      release(reason) { calls.push("release"); assert.equal(reason, failure === "rollback" ? rollbackError : undefined); },
    };
    const operation = securityTransaction({ async getConnection() { return connection; } }, async (executor) => {
      assert.equal(executor, connection);
      calls.push("work");
      if (["work", "rollback"].includes(failure)) throw error;
      return "result";
    });
    if (failure) await assert.rejects(operation, (actual) => actual === error);
    else assert.equal(await operation, "result");
    assert.equal(calls.filter((call) => call === "release").length, 1);
    assert.equal(calls.at(-1), "release");
    assert.equal(calls.includes("rollback"), Boolean(failure));
    if (["work", "rollback", "begin"].includes(failure)) assert.equal(calls.includes("commit"), false);
  });
}

test("checkout failure propagates without trying to release an unowned client", async () => {
  await assert.rejects(securityTransaction({ async getConnection() { throw new Error("checkout"); } }, () => assert.fail()), /checkout/);
});

test("code validity is read after locking, with ownership, purpose and wall-clock expiry", async () => {
  const queries = [];
  const connection = { async query(sql, params) { queries.push({ sql, params }); return [[{ id: 9 }]]; } };
  assert.equal(await lockSecurityCode(connection, "verification_codes", 9, 2), true);
  assert.match(queries[0].sql, /FOR UPDATE/);
  assert.match(queries[1].sql, /used_at IS NULL AND expires_at > clock_timestamp\(\)/);
  assert.match(queries[1].sql, /purpose = 'account_change'/);
  assert.deepEqual(queries.map(({ params }) => params), [[9, 2], [9, 2]]);
  await assert.rejects(lockSecurityCode(connection, "users", 9, 2), /Unsupported/);
});
