const express = require("express");
const router = express.Router();
const db = require("../db");
const { requirePositiveId } = require("../validation");
const { securityTransaction } = require("../security-transaction");
const { findOwnedVehicle, userOwnsVehicle } = require("../vehicle-ownership");
const { isVehicleArchiveEnabled } = require("../vehicle-archive-capability");
const { createLegacyBaseline, mediateLegacyCurrentMileage } = require("../odometer-domain");

router.param("id", requirePositiveId);

const FUEL_TYPES = new Set([
  "gasoline", "diesel", "hybrid", "plug_in_hybrid", "electric",
  "lpg", "cng", "hydrogen", "other",
]);
const PATCH_FIELDS = new Set([
  "vehicleType", "chassisNumber", "model", "year", "currentMileage",
  "registrationPlate", "registrationCountry", "make", "vin", "fuelType",
  "purchaseDate", "purchaseAmount", "currency",
]);
const VEHICLE_PROJECTION = `
  v.id,
  v.vehicle_type AS vehicleType,
  v.chassis_number AS chassisNumber,
  v.model,
  v.year,
  v.current_mileage AS currentMileage,
  v.registration_plate AS registrationPlate,
  v.registration_country AS registrationCountry,
  v.make,
  v.vin,
  v.fuel_type AS fuelType,
  v.purchase_date AS purchaseDate,
  v.purchase_amount AS purchaseAmount,
  v.currency,
  v.archived_at AS archivedAt,
  CASE WHEN v.archived_at IS NULL THEN 'active' ELSE 'archived' END AS state,
  v.revision,
  u.company_id AS companyId,
  v.created_at`;

function routeError(status, code, error) {
  return Object.assign(new Error(error), { status, body: { error, code } });
}

function isValidDate(value) {
  const raw = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw;
}

function validateVehicleInput({ vehicleType, chassisNumber, model, year, currentMileage }) {
  if (!vehicleType || !chassisNumber) return "Τύπος οχήματος και αριθμός πλαισίου είναι υποχρεωτικά";
  if (String(vehicleType).length > 100 || String(chassisNumber).length > 50) return "Τα στοιχεία του οχήματος είναι πολύ μεγάλα";
  if (model != null && String(model).length > 100) return "Το μοντέλο είναι πολύ μεγάλο";
  const maxYear = new Date().getFullYear() + 1;
  if (year != null && year !== "" && (!Number.isInteger(Number(year)) || Number(year) < 1886 || Number(year) > maxYear)) return "Μη έγκυρο έτος οχήματος";
  if (currentMileage != null && currentMileage !== "" && (!Number.isInteger(Number(currentMileage)) || Number(currentMileage) < 0)) return "Τα χιλιόμετρα πρέπει να είναι μη αρνητικός ακέραιος";
  return null;
}

function nullableString(value, maxLength, { uppercase = false } = {}) {
  if (value == null) return null;
  if (typeof value !== "string") throw routeError(400, "INVALID_VEHICLE_FIELD", "Μη έγκυρα στοιχεία οχήματος");
  const normalized = (uppercase ? value.toUpperCase() : value).trim();
  if (!normalized) throw routeError(400, "INVALID_VEHICLE_FIELD", "Τα κενά πεδία πρέπει να καθαρίζονται με null");
  if (normalized.length > maxLength) throw routeError(400, "INVALID_VEHICLE_FIELD", "Τα στοιχεία του οχήματος είναι πολύ μεγάλα");
  return normalized;
}

function normalizePatch(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw routeError(400, "INVALID_VEHICLE_PATCH", "Μη έγκυρα στοιχεία οχήματος");
  const keys = Object.keys(body);
  const unsupported = keys.filter((key) => !PATCH_FIELDS.has(key));
  if (unsupported.length) throw routeError(400, "UNSUPPORTED_VEHICLE_FIELD", `Μη υποστηριζόμενο πεδίο: ${unsupported[0]}`);
  if (!keys.length) throw routeError(400, "EMPTY_VEHICLE_PATCH", "Δεν δόθηκαν αλλαγές οχήματος");

  const updates = [];
  const add = (column, value) => updates.push({ column, value });
  if (Object.hasOwn(body, "vehicleType")) {
    if (typeof body.vehicleType !== "string" || !body.vehicleType.trim() || body.vehicleType.length > 100) throw routeError(400, "INVALID_VEHICLE_FIELD", "Μη έγκυρος τύπος οχήματος");
    add("vehicle_type", body.vehicleType.trim());
  }
  if (Object.hasOwn(body, "chassisNumber")) {
    if (typeof body.chassisNumber !== "string" || !body.chassisNumber.trim() || body.chassisNumber.trim().length > 50) throw routeError(400, "INVALID_VEHICLE_FIELD", "Μη έγκυρος αριθμός πλαισίου");
    add("chassis_number", body.chassisNumber.trim());
  }
  if (Object.hasOwn(body, "model")) add("model", nullableString(body.model, 100));
  if (Object.hasOwn(body, "make")) add("make", nullableString(body.make, 100));
  if (Object.hasOwn(body, "registrationPlate")) add("registration_plate", nullableString(body.registrationPlate, 32));
  if (Object.hasOwn(body, "registrationCountry")) {
    const value = nullableString(body.registrationCountry, 2, { uppercase: true });
    if (value != null && !/^[A-Z]{2}$/.test(value)) throw routeError(400, "INVALID_VEHICLE_FIELD", "Μη έγκυρη χώρα ταξινόμησης");
    add("registration_country", value);
  }
  if (Object.hasOwn(body, "vin")) add("vin", nullableString(body.vin, 50, { uppercase: true }));
  if (Object.hasOwn(body, "fuelType")) {
    const value = nullableString(body.fuelType, 30);
    if (value != null && !FUEL_TYPES.has(value)) throw routeError(400, "INVALID_VEHICLE_FIELD", "Μη έγκυρος τύπος καυσίμου");
    add("fuel_type", value);
  }
  if (Object.hasOwn(body, "year")) {
    const value = body.year == null ? null : Number(body.year);
    if (body.year === "") throw routeError(400, "INVALID_VEHICLE_FIELD", "Τα κενά πεδία πρέπει να καθαρίζονται με null");
    if (value != null && (!Number.isInteger(value) || value < 1886 || value > new Date().getFullYear() + 1)) throw routeError(400, "INVALID_VEHICLE_FIELD", "Μη έγκυρο έτος οχήματος");
    add("year", value);
  }
  if (Object.hasOwn(body, "currentMileage")) {
    const value = body.currentMileage == null ? null : Number(body.currentMileage);
    if (body.currentMileage === "") throw routeError(400, "INVALID_VEHICLE_FIELD", "Τα κενά πεδία πρέπει να καθαρίζονται με null");
    if (value != null && (!Number.isInteger(value) || value < 0)) throw routeError(400, "INVALID_VEHICLE_FIELD", "Μη έγκυρα χιλιόμετρα");
    add("current_mileage", value);
  }
  if (Object.hasOwn(body, "purchaseDate")) {
    const value = body.purchaseDate == null ? null : String(body.purchaseDate);
    if (body.purchaseDate === "") throw routeError(400, "INVALID_VEHICLE_FIELD", "Τα κενά πεδία πρέπει να καθαρίζονται με null");
    if (value != null && !isValidDate(value)) throw routeError(400, "INVALID_VEHICLE_FIELD", "Μη έγκυρη ημερομηνία αγοράς");
    add("purchase_date", value);
  }
  if (Object.hasOwn(body, "purchaseAmount")) {
    const value = body.purchaseAmount == null ? null : Number(body.purchaseAmount);
    if (body.purchaseAmount === "") throw routeError(400, "INVALID_VEHICLE_FIELD", "Τα κενά πεδία πρέπει να καθαρίζονται με null");
    if (value != null && (!Number.isFinite(value) || value < 0 || value > 9999999999.99)) throw routeError(400, "INVALID_VEHICLE_FIELD", "Μη έγκυρο ποσό αγοράς");
    add("purchase_amount", value);
  }
  if (Object.hasOwn(body, "currency")) {
    const value = nullableString(body.currency, 3, { uppercase: true });
    if (value != null && !/^[A-Z]{3}$/.test(value)) throw routeError(400, "INVALID_VEHICLE_FIELD", "Μη έγκυρο νόμισμα");
    add("currency", value);
  }
  return updates;
}

function normalizeCreate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw routeError(400, "INVALID_VEHICLE_CREATE", "Μη έγκυρα στοιχεία οχήματος");
  const normalized = { ...body };
  for (const field of PATCH_FIELDS) {
    if (!["vehicleType", "chassisNumber"].includes(field) && normalized[field] === "") normalized[field] = null;
  }
  const updates = normalizePatch(normalized);
  if (!updates.some((item) => item.column === "vehicle_type") || !updates.some((item) => item.column === "chassis_number")) {
    throw routeError(400, "INVALID_VEHICLE_FIELD", "Τύπος οχήματος και αριθμός πλαισίου είναι υποχρεωτικά");
  }
  return updates;
}

async function selectVehicle(executor, userId, vehicleId) {
  const [rows] = await executor.query(
    `SELECT ${VEHICLE_PROJECTION}
     FROM vehicles v
     JOIN users u ON u.id = v.user_id
     WHERE v.id = ? AND v.user_id = ?`,
    [vehicleId, userId]
  );
  return rows[0] || null;
}

async function lockUser(connection, userId) {
  const [rows] = await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [userId]);
  if (!rows.length) throw routeError(404, "VEHICLE_NOT_FOUND", "Το όχημα δεν βρέθηκε");
}

const VEHICLE_COLUMN_FIELDS = {
  vehicle_type: "vehicleType",
  chassis_number: "chassisNumber",
  model: "model",
  year: "year",
  registration_plate: "registrationPlate",
  registration_country: "registrationCountry",
  make: "make",
  vin: "vin",
  fuel_type: "fuelType",
  purchase_date: "purchaseDate",
  purchase_amount: "purchaseAmount",
  currency: "currency",
};

function sameVehicleValue(vehicle, column, value) {
  const current = vehicle[VEHICLE_COLUMN_FIELDS[column]];
  if (current == null || current === "") return value == null;
  if (["year", "purchase_amount"].includes(column)) return Number(current) === Number(value);
  return String(current) === String(value);
}

function sendRouteError(res, error, fallback) {
  if (error.body) return res.status(error.status).json(error.body);
  if (error.code === "23505") return res.status(409).json({ error: "Υπάρχει ήδη όχημα με αυτόν τον αριθμό πλαισίου", code: "DUPLICATE_CHASSIS_NUMBER" });
  console.error(fallback, error);
  return res.status(500).json({ error: "Σφάλμα διακομιστή" });
}

router.get("/", async (req, res) => {
  try {
    const requestedState = req.query.state;
    if (requestedState !== undefined && (typeof requestedState !== "string" || !["active", "archived", "all"].includes(requestedState))) return res.status(400).json({ error: "Μη έγκυρη κατάσταση οχήματος", code: "INVALID_VEHICLE_STATE" });
    const state = requestedState || (isVehicleArchiveEnabled() ? "active" : "all");
    const predicate = state === "active" ? "AND v.archived_at IS NULL" : state === "archived" ? "AND v.archived_at IS NOT NULL" : "";
    const [rows] = await db.query(
      `SELECT ${VEHICLE_PROJECTION}
       FROM vehicles v
       JOIN users u ON v.user_id = u.id
       WHERE v.user_id = ? ${predicate}
       ORDER BY v.id DESC`,
      [req.user.id]
    );
    return res.json(rows);
  } catch (error) {
    return sendRouteError(res, error, "Get vehicles error:");
  }
});

router.post("/", async (req, res) => {
  try {
    const userId = req.user.id;
    const values = normalizeCreate(req.body);
    const normalizedChassis = values.find((item) => item.column === "chassis_number").value;
    const vehicle = await securityTransaction(db, async (connection) => {
      await lockUser(connection, userId);
      const [duplicates] = await connection.query("SELECT id FROM vehicles WHERE user_id = ? AND chassis_number = ? LIMIT 1", [userId, normalizedChassis]);
      if (duplicates.length) throw routeError(409, "DUPLICATE_CHASSIS_NUMBER", "Υπάρχει ήδη όχημα με αυτόν τον αριθμό πλαισίου");
      const columns = values.map((item) => item.column);
      const [result] = await connection.query(
        `INSERT INTO vehicles (user_id, ${columns.join(", ")})
         VALUES (?, ${columns.map(() => "?").join(", ")})`,
        [userId, ...values.map((item) => item.value)]
      );
      const mileage = values.find((item) => item.column === "current_mileage")?.value;
      if (mileage != null) await createLegacyBaseline(connection, userId, result.insertId, mileage);
      return selectVehicle(connection, userId, result.insertId);
    });
    return res.status(201).json(vehicle);
  } catch (error) {
    return sendRouteError(res, error, "Add vehicle error:");
  }
});

router.get("/:id", async (req, res) => {
  try {
    const vehicle = await selectVehicle(db, req.user.id, req.params.id);
    if (!vehicle) return res.status(404).json({ error: "Το όχημα δεν βρέθηκε", code: "VEHICLE_NOT_FOUND" });
    return res.json(vehicle);
  } catch (error) {
    return sendRouteError(res, error, "Get vehicle detail error:");
  }
});

router.put("/:id", async (req, res) => {
  try {
    const userId = req.user.id;
    const body = req.body || {};
    const hasCurrentMileage = Object.hasOwn(body, "currentMileage");
    const { vehicleType, chassisNumber, model, year, currentMileage } = body;
    const validationError = validateVehicleInput({ vehicleType, chassisNumber, model, year, currentMileage });
    if (validationError) return res.status(400).json({ error: validationError });
    const normalizedChassis = String(chassisNumber).trim();
    const normalized = {
      vehicle_type: vehicleType,
      chassis_number: normalizedChassis,
      model: model || null,
      year: year === "" || year == null ? null : Number(year),
    };
    const vehicle = await securityTransaction(db, async (connection) => {
      await lockUser(connection, userId);
      const owned = await findOwnedVehicle(connection, userId, req.params.id, { forUpdate: true });
      if (!owned) throw routeError(404, "VEHICLE_NOT_FOUND", "Το όχημα δεν βρέθηκε");
      const current = await selectVehicle(connection, userId, req.params.id);
      const [duplicates] = await connection.query("SELECT id FROM vehicles WHERE user_id = ? AND chassis_number = ? AND id <> ? LIMIT 1", [userId, normalizedChassis, req.params.id]);
      if (duplicates.length) throw routeError(409, "DUPLICATE_CHASSIS_NUMBER", "Υπάρχει ήδη όχημα με αυτόν τον αριθμό πλαισίου");
      const mileage = hasCurrentMileage
        ? await mediateLegacyCurrentMileage(connection, {
          userId,
          vehicle: { ...owned, currentMileage: current.currentMileage },
          requestedMileage: currentMileage === "" || currentMileage == null ? null : Number(currentMileage),
        })
        : null;
      const normalChanged = Object.entries(normalized).some(([column, value]) => !sameVehicleValue(current, column, value));
      if (normalChanged || (mileage && (mileage.evidenceChanged || mileage.cacheChanged))) {
        if (mileage) {
          await connection.query(
            `UPDATE vehicles SET vehicle_type = ?, chassis_number = ?, model = ?, year = ?, current_mileage = ?, revision = revision + 1 WHERE id = ? AND user_id = ?`,
            [normalized.vehicle_type, normalized.chassis_number, normalized.model, normalized.year, mileage.cacheMileage, req.params.id, userId]
          );
        } else {
          await connection.query(
            `UPDATE vehicles SET vehicle_type = ?, chassis_number = ?, model = ?, year = ?, revision = revision + 1 WHERE id = ? AND user_id = ?`,
            [normalized.vehicle_type, normalized.chassis_number, normalized.model, normalized.year, req.params.id, userId]
          );
        }
      }
      return selectVehicle(connection, userId, req.params.id);
    });
    return res.json(vehicle);
  } catch (error) {
    return sendRouteError(res, error, "Update vehicle error:");
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const updates = normalizePatch(req.body);
    const vehicle = await securityTransaction(db, async (connection) => {
      await lockUser(connection, req.user.id);
      const owned = await findOwnedVehicle(connection, req.user.id, req.params.id, { forUpdate: true });
      if (!owned) throw routeError(404, "VEHICLE_NOT_FOUND", "Το όχημα δεν βρέθηκε");
      const current = await selectVehicle(connection, req.user.id, req.params.id);
      const chassis = updates.find((item) => item.column === "chassis_number");
      if (chassis) {
        const [duplicates] = await connection.query("SELECT id FROM vehicles WHERE user_id = ? AND chassis_number = ? AND id <> ? LIMIT 1", [req.user.id, chassis.value, req.params.id]);
        if (duplicates.length) throw routeError(409, "DUPLICATE_CHASSIS_NUMBER", "Υπάρχει ήδη όχημα με αυτόν τον αριθμό πλαισίου");
      }
      const mileageUpdate = updates.find((item) => item.column === "current_mileage");
      const mileage = mileageUpdate
        ? await mediateLegacyCurrentMileage(connection, {
          userId: req.user.id,
          vehicle: { ...owned, currentMileage: current.currentMileage },
          requestedMileage: mileageUpdate.value,
        })
        : null;
      const actual = updates.filter((item) => item.column !== "current_mileage" && !sameVehicleValue(current, item.column, item.value));
      if (mileage && (mileage.evidenceChanged || mileage.cacheChanged)) {
        actual.push({ column: "current_mileage", value: mileage.cacheMileage });
      }
      if (actual.length) {
        const assignments = actual.map((item) => `${item.column} = ?`).join(", ");
        await connection.query(`UPDATE vehicles SET ${assignments}, revision = revision + 1 WHERE id = ? AND user_id = ?`, [...actual.map((item) => item.value), req.params.id, req.user.id]);
      }
      return selectVehicle(connection, req.user.id, req.params.id);
    });
    return res.json(vehicle);
  } catch (error) {
    return sendRouteError(res, error, "Patch vehicle error:");
  }
});

async function transitionArchive(req, res, archive) {
  if (!isVehicleArchiveEnabled()) return res.status(409).json({ error: "Η αρχειοθέτηση οχημάτων δεν είναι ακόμη ενεργή", code: "VEHICLE_ARCHIVE_DISABLED" });
  try {
    const vehicle = await securityTransaction(db, async (connection) => {
      await lockUser(connection, req.user.id);
      const owned = await findOwnedVehicle(connection, req.user.id, req.params.id, { forUpdate: true });
      if (!owned) throw routeError(404, "VEHICLE_NOT_FOUND", "Το όχημα δεν βρέθηκε");
      const shouldChange = archive ? owned.archivedAt == null : owned.archivedAt != null;
      if (shouldChange) {
        await connection.query(
          `UPDATE vehicles SET archived_at = ${archive ? "clock_timestamp()" : "NULL"}, revision = revision + 1 WHERE id = ? AND user_id = ?`,
          [req.params.id, req.user.id]
        );
      }
      return selectVehicle(connection, req.user.id, req.params.id);
    });
    return res.json(vehicle);
  } catch (error) {
    return sendRouteError(res, error, archive ? "Archive vehicle error:" : "Restore vehicle error:");
  }
}

router.post("/:id/archive", (req, res) => transitionArchive(req, res, true));
router.post("/:id/restore", (req, res) => transitionArchive(req, res, false));

router.delete("/:id", async (req, res) => {
  if (isVehicleArchiveEnabled()) return res.status(409).json({ error: "Χρησιμοποιήστε αρχειοθέτηση αντί για οριστική διαγραφή οχήματος", code: "VEHICLE_ARCHIVE_REQUIRED" });
  try {
    if (!(await userOwnsVehicle(db, req.user.id, req.params.id))) return res.status(404).json({ error: "Το όχημα δεν βρέθηκε", code: "VEHICLE_NOT_FOUND" });
    await db.query("DELETE FROM vehicles WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
    return res.json({ success: true });
  } catch (error) {
    return sendRouteError(res, error, "Delete vehicle error:");
  }
});

module.exports = router;
module.exports.normalizePatch = normalizePatch;
module.exports.normalizeCreate = normalizeCreate;
module.exports.VEHICLE_PROJECTION = VEHICLE_PROJECTION;
