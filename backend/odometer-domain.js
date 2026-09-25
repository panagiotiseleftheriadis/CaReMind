const ATHENS_TIME_ZONE = "Europe/Athens";
const ATHENS_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: ATHENS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function domainError(status, code, error) {
  return Object.assign(new Error(error), { status, body: { error, code } });
}

function athensDateAt(instant = new Date()) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) throw new TypeError("Invalid clock instant");
  const parts = Object.fromEntries(
    ATHENS_DATE_FORMATTER.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateOccurredOn(value, { clock = () => new Date() } = {}) {
  if (!isCalendarDate(value)) {
    throw domainError(400, "INVALID_ODOMETER_DATE", "Μη έγκυρη ημερομηνία ένδειξης χιλιομέτρων");
  }
  if (value > athensDateAt(clock())) {
    throw domainError(400, "FUTURE_ODOMETER_DATE", "Η ημερομηνία ένδειξης δεν μπορεί να είναι μελλοντική");
  }
  return value;
}

function validateMileageKm(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 2147483647) {
    throw domainError(400, "INVALID_ODOMETER_MILEAGE", "Μη έγκυρη ένδειξη χιλιομέτρων");
  }
  return value;
}

function assertExpectedVehicleRevision(vehicle, expectedRevision) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw domainError(400, "INVALID_VEHICLE_REVISION", "Μη έγκυρη έκδοση οχήματος");
  }
  if (Number(vehicle.revision) !== expectedRevision) {
    throw domainError(409, "VEHICLE_REVISION_CONFLICT", "Το όχημα έχει αλλάξει. Φόρτωσέ το ξανά.");
  }
}

function assertReadingAllowedForVehicle(vehicle, { correction = false } = {}) {
  if (vehicle.archivedAt != null && !correction) {
    throw domainError(409, "VEHICLE_ARCHIVED", "Δεν μπορούν να προστεθούν χιλιόμετρα σε αρχειοθετημένο όχημα");
  }
}

function validateChronology(mileageKm, { previous = null, next = null } = {}) {
  const mileage = validateMileageKm(mileageKm);
  if (previous && mileage < Number(previous.mileageKm)) {
    const code = next ? "ODOMETER_READING_CONFLICT" : "ODOMETER_RESET_UNSUPPORTED";
    throw domainError(409, code, next
      ? "Η ένδειξη δεν συμφωνεί με το ιστορικό χιλιομέτρων"
      : "Η μείωση ή αντικατάσταση οδομέτρου δεν υποστηρίζεται ακόμη");
  }
  if (next && mileage > Number(next.mileageKm)) {
    throw domainError(409, "ODOMETER_READING_CONFLICT", "Η ένδειξη δεν συμφωνεί με το ιστορικό χιλιομέτρων");
  }
  return mileage;
}

async function selectLatestAcceptedDatedReading(executor, userId, vehicleId, { forUpdate = false } = {}) {
  const [rows] = await executor.query(
    `SELECT id, mileage_km AS mileageKm, occurred_on AS occurredOn, source, created_at AS createdAt
     FROM odometer_readings
     WHERE user_id = ? AND vehicle_id = ?
       AND voided_at IS NULL AND occurred_on IS NOT NULL
     ORDER BY occurred_on DESC, created_at DESC, id DESC
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [userId, vehicleId]
  );
  return rows[0] || null;
}

async function selectActiveLegacyBaseline(executor, userId, vehicleId, { forUpdate = false } = {}) {
  const [rows] = await executor.query(
    `SELECT id, mileage_km AS mileageKm, occurred_on AS occurredOn, source, created_at AS createdAt
     FROM odometer_readings
     WHERE user_id = ? AND vehicle_id = ?
       AND source = 'legacy_baseline' AND voided_at IS NULL
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [userId, vehicleId]
  );
  return rows[0] || null;
}

async function selectAcceptedNeighbors(executor, userId, vehicleId, occurredOn, { forUpdate = false } = {}) {
  const suffix = forUpdate ? " FOR UPDATE" : "";
  const [previousRows] = await executor.query(
    `SELECT id, mileage_km AS mileageKm, occurred_on AS occurredOn
     FROM odometer_readings
     WHERE user_id = ? AND vehicle_id = ?
       AND voided_at IS NULL AND occurred_on < ?
     ORDER BY occurred_on DESC, created_at DESC, id DESC
     LIMIT 1${suffix}`,
    [userId, vehicleId, occurredOn]
  );
  const [nextRows] = await executor.query(
    `SELECT id, mileage_km AS mileageKm, occurred_on AS occurredOn
     FROM odometer_readings
     WHERE user_id = ? AND vehicle_id = ?
       AND voided_at IS NULL AND occurred_on > ?
     ORDER BY occurred_on ASC, created_at ASC, id ASC
     LIMIT 1${suffix}`,
    [userId, vehicleId, occurredOn]
  );
  return { previous: previousRows[0] || null, next: nextRows[0] || null };
}

async function selectAuthoritativeReading(executor, userId, vehicleId, options = {}) {
  const dated = await selectLatestAcceptedDatedReading(executor, userId, vehicleId, options);
  if (dated) return dated;
  return selectActiveLegacyBaseline(executor, userId, vehicleId, options);
}

async function deriveAuthoritativeCurrentMileage(executor, userId, vehicleId, options = {}) {
  const reading = await selectAuthoritativeReading(executor, userId, vehicleId, options);
  return reading ? Number(reading.mileageKm) : null;
}

async function reconcileMileageCache(connection, userId, vehicleId) {
  const mileage = await deriveAuthoritativeCurrentMileage(connection, userId, vehicleId, { forUpdate: true });
  await connection.query(
    `UPDATE vehicles SET current_mileage = ?
     WHERE id = ? AND user_id = ? AND current_mileage IS DISTINCT FROM ?`,
    [mileage, vehicleId, userId, mileage]
  );
  return mileage;
}

async function createLegacyBaseline(connection, userId, vehicleId, mileageKm, replacesReadingId = null) {
  const mileage = validateMileageKm(mileageKm);
  const [result] = await connection.query(
    `INSERT INTO odometer_readings
       (user_id, vehicle_id, mileage_km, occurred_on, source, notes, replaces_reading_id)
     VALUES (?, ?, ?, NULL, 'legacy_baseline', NULL, ?)`,
    [userId, vehicleId, mileage, replacesReadingId]
  );
  return result.insertId;
}

async function mediateLegacyCurrentMileage(connection, { userId, vehicle, requestedMileage }) {
  const requested = requestedMileage == null ? null : validateMileageKm(requestedMileage);
  const dated = await selectLatestAcceptedDatedReading(connection, userId, vehicle.id, { forUpdate: true });
  if (dated) {
    const derived = Number(dated.mileageKm);
    if (requested !== derived) {
      throw domainError(409, "ODOMETER_HISTORY_REQUIRED", "Τα χιλιόμετρα ενημερώνονται πλέον μέσω ιστορικού ενδείξεων");
    }
    return {
      cacheMileage: derived,
      evidenceChanged: false,
      cacheChanged: vehicle.currentMileage == null || Number(vehicle.currentMileage) !== derived,
    };
  }

  const baseline = await selectActiveLegacyBaseline(connection, userId, vehicle.id, { forUpdate: true });
  const baselineMileage = baseline ? Number(baseline.mileageKm) : null;
  const cacheMileage = vehicle.currentMileage == null ? null : Number(vehicle.currentMileage);
  if (baselineMileage === requested && cacheMileage === requested) {
    return { cacheMileage: requested, evidenceChanged: false, cacheChanged: false };
  }

  if (baseline) {
    await connection.query(
      `UPDATE odometer_readings
       SET voided_at = clock_timestamp(),
           void_reason = 'Superseded by legacy currentMileage write'
       WHERE id = ? AND user_id = ? AND vehicle_id = ? AND voided_at IS NULL`,
      [baseline.id, userId, vehicle.id]
    );
  }
  if (requested != null) {
    await createLegacyBaseline(connection, userId, vehicle.id, requested, baseline?.id || null);
  }
  return {
    cacheMileage: requested,
    evidenceChanged: baselineMileage !== requested,
    cacheChanged: cacheMileage !== requested,
  };
}

module.exports = {
  ATHENS_TIME_ZONE,
  athensDateAt,
  isCalendarDate,
  validateOccurredOn,
  validateMileageKm,
  assertExpectedVehicleRevision,
  assertReadingAllowedForVehicle,
  validateChronology,
  selectLatestAcceptedDatedReading,
  selectActiveLegacyBaseline,
  selectAcceptedNeighbors,
  selectAuthoritativeReading,
  deriveAuthoritativeCurrentMileage,
  reconcileMileageCache,
  createLegacyBaseline,
  mediateLegacyCurrentMileage,
};
