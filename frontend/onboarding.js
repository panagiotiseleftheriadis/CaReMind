(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    const card = document.querySelector(".welcome-card");
    if (window.CaReMindDemo?.isActive()) {
      card?.setAttribute("data-demo", "true");
    }
  });
})();
