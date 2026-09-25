function isOdometerHistoryEnabled(env = process.env) {
  return env.ODOMETER_HISTORY_ENABLED === "true";
}

module.exports = { isOdometerHistoryEnabled };
