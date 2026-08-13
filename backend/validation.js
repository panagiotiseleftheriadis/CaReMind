function isPositiveId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0;
}

function requirePositiveId(req, res, next, value, name) {
  if (!isPositiveId(value)) {
    return res.status(400).json({ error: `Invalid ${name || "id"}` });
  }
  return next();
}

module.exports = { isPositiveId, requirePositiveId };
