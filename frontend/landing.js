(function () {
  "use strict";

  const toggle = document.getElementById("navToggle");
  const navigation = document.getElementById("siteNavigation");

  function closeNavigation(restoreFocus) {
    if (!toggle || !navigation) return;
    const wasOpen = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Άνοιγμα μενού");
    navigation.classList.remove("is-open");
    document.body.classList.remove("nav-open");
    if (restoreFocus && wasOpen) toggle.focus();
  }

  toggle?.addEventListener("click", function () {
    const willOpen = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(willOpen));
    toggle.setAttribute("aria-label", willOpen ? "Κλείσιμο μενού" : "Άνοιγμα μενού");
    navigation?.classList.toggle("is-open", willOpen);
    document.body.classList.toggle("nav-open", willOpen);
  });

  navigation?.querySelectorAll("a").forEach(function (link) {
    link.addEventListener("click", closeNavigation);
  });

  window.addEventListener("resize", function () {
    if (window.innerWidth > 980) closeNavigation();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && toggle?.getAttribute("aria-expanded") === "true") {
      closeNavigation(true);
    }
  });

  document.querySelectorAll(".faq-list details").forEach(function (item) {
    const summary = item.querySelector("summary");
    item.addEventListener("toggle", function () {
      summary?.setAttribute("aria-expanded", String(item.open));
    });
  });

  document.querySelectorAll("[data-demo-start]").forEach(function (button) {
    button.addEventListener("click", function () {
      const error = document.getElementById("demoError");
      if (!window.CaReMindDemo) {
        if (error) {
          error.textContent = "Το Demo δεν μπόρεσε να φορτώσει. Δοκίμασε ξανά.";
          error.hidden = false;
        }
        return;
      }

      localStorage.removeItem("caremindExplicitLogout");
      window.CaReMindDemo.start({ reset: true });
      window.location.href = "/dashboard";
    });
  });
})();
