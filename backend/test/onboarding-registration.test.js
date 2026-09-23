const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const frontendRoot = path.join(__dirname, "..", "..", "frontend");
const read = (name) => fs.readFileSync(path.join(frontendRoot, name), "utf8");

test("registration keeps backend-required fields and browser semantics", () => {
  const html = read("register.html");
  assert.match(html, /<form id="registerForm"/);
  assert.match(html, /type="email" id="userEmail" name="email" autocomplete="email"[^>]*required/);
  assert.match(html, /id="newUsername" name="username" autocomplete="username"[^>]*required/);
  assert.match(html, /id="newPassword" name="password"[^>]*autocomplete="new-password"[^>]*required/);
  assert.match(html, /id="regPassword" name="passwordConfirmation"[^>]*autocomplete="new-password"[^>]*required/);
  assert.match(html, /type="tel" id="userNumber" name="phone" autocomplete="tel"/);
  assert.equal((html.match(/<label\b/g) || []).length >= 8, true);
  assert.match(html, /class="toggle-pass"[^>]*aria-pressed="false"/);
  assert.match(html, /role="status" aria-live="polite"/);
});

test("individual is default and business metadata is conditional and optional", () => {
  const html = read("register.html");
  const script = read("register.js");
  assert.match(html, /name="account_type" value="individual" checked/);
  assert.match(html, /name="account_type" value="business"/);
  assert.match(html, /id="businessFields"[^>]*hidden/);
  assert.doesNotMatch(html.match(/id="companyName"[^>]*>/)?.[0] || "", /required/);
  assert.match(script, /selected !== "business"/);
  assert.match(script, /companyName: accountType === "business"/);
  assert.match(script, /phone: accountType === "business"/);
  assert.doesNotMatch(script, /fake|fabricat/i);
});

test("verification navigates through authenticated login to onboarding", () => {
  const registration = read("register.js");
  const login = read("auth.js");
  assert.match(registration, /verifyEmail\(email, code\)/);
  assert.match(registration, /\/login\?verified=1&next=%2Fonboarding/);
  assert.match(login, /dashboard\|vehicles\|vehicle\|maintenance\|costs\|account\|admin\|onboarding/);
  assert.match(login, /safeNext \|\| "\/dashboard"/);
});

test("registration maps known and network errors without exposing raw backend errors", () => {
  const script = read("register.js");
  for (const code of ["USERNAME_TAKEN", "EMAIL_TAKEN", "VERIFICATION_EMAIL_UNAVAILABLE"]) {
    assert.match(script, new RegExp(code));
  }
  assert.match(script, /error\?\.status === 400/);
  assert.match(script, /error\?\.status === 429/);
  assert.match(script, /error\?\.status === 503/);
  assert.doesNotMatch(script, /showMessage\([^\n]*error\.message/);
  assert.match(script, /RESEND_COOLDOWN_SECONDS = 30/);
  assert.match(script, /Αν το email είναι διαθέσιμο για επιβεβαίωση/);
});

test("onboarding is a single protected handoff into the existing vehicle flow", () => {
  const html = read("onboarding.html");
  const guard = read("auth-guard.js");
  const vehicles = read("vehicles.js");
  assert.match(html, /src="auth-guard\.js/);
  assert.match(html, /id="addFirstVehicle" href="\/vehicles\?add=1"/);
  assert.match(html, /id="skipOnboarding" href="\/dashboard"/);
  assert.doesNotMatch(html, /<form/);
  assert.doesNotMatch(guard, /isOnboardingPage/);
  assert.match(vehicles, /new URLSearchParams\(window\.location\.search\)\.get\("add"\) === "1"/);
  assert.match(vehicles, /this\.openAdd\(\)/);
  assert.match(vehicles, /replaceState\(\{\}, "", "\/vehicles"\)/);
});

test("onboarding Demo stays browser-only and registration does not advertise or activate billing", () => {
  const onboarding = `${read("onboarding.html")}\n${read("onboarding.js")}`;
  const registration = `${read("register.html")}\n${read("register.js")}`;
  assert.match(onboarding, /CaReMindDemo\?\.isActive/);
  assert.doesNotMatch(onboarding, /api\.(?:register|verifyEmail|resendVerification)/);
  assert.doesNotMatch(`${onboarding}\n${registration}`, /14[- ]?day|14 ημέρ|trial|billing|subscription|pricing|Plus|Fleet/i);
});

test("registration and onboarding include narrow-screen, touch-target and focus treatment", () => {
  const registerCss = read("register.css");
  const onboardingCss = read("onboarding.css");
  assert.match(registerCss, /@media \(max-width: 520px\)/);
  assert.match(onboardingCss, /@media \(max-width: 430px\)/);
  assert.match(registerCss, /min-height: 44px/);
  assert.match(onboardingCss, /min-height: 52px/);
  assert.match(registerCss, /:focus-visible/);
  assert.match(onboardingCss, /:focus-visible/);
  assert.match(onboardingCss, /overflow-x: hidden/);
});
