// All work in the callback must use this checked-out connection, never db.query.
async function securityTransaction(db, work) {
  const connection = await db.getConnection();
  let discard;
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      // A client with an uncertain transaction state must not return to the pool.
      discard = rollbackError;
    }
    throw error;
  } finally {
    connection.release(discard);
  }
}

function securityFailure(status, body) {
  return Object.assign(new Error("Security operation rejected"), { status, body });
}

// Call only after locking the owning users row. Lock by identity first, then
// re-read validity: NOW() is the transaction start time, not time after a wait.
async function lockSecurityCode(connection, table, id, userId) {
  if (!["password_reset_codes", "verification_codes", "email_verification_codes"].includes(table)) {
    throw new Error("Unsupported security code table");
  }
  await connection.query(`SELECT id FROM ${table} WHERE id = ? AND user_id = ? FOR UPDATE`, [id, userId]);
  const [rows] = await connection.query(
    `SELECT id FROM ${table} WHERE id = ? AND user_id = ?
     AND used_at IS NULL AND expires_at > clock_timestamp()
     ${table === "verification_codes" ? "AND purpose = 'account_change'" : ""}`,
    [id, userId]
  );
  return rows.length > 0;
}

module.exports = { securityTransaction, securityFailure, lockSecurityCode };
