function isVehicleArchiveEnabled(env = process.env) {
  return env.VEHICLE_ARCHIVE_ENABLED === "true";
}

module.exports = { isVehicleArchiveEnabled };
