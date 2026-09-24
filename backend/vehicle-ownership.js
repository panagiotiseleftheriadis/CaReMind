async function findOwnedVehicle(executor, userId, vehicleId, { forUpdate = false } = {}) {
  const [rows] = await executor.query(
    `SELECT id, user_id, archived_at AS archivedAt, revision
     FROM vehicles
     WHERE id = ? AND user_id = ?
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [vehicleId, userId]
  );
  return rows[0] || null;
}

async function userOwnsVehicle(executor, userId, vehicleId) {
  const [rows] = await executor.query(
    "SELECT id FROM vehicles WHERE id = ? AND user_id = ? LIMIT 1",
    [vehicleId, userId]
  );
  return rows.length > 0;
}

module.exports = { findOwnedVehicle, userOwnsVehicle };
