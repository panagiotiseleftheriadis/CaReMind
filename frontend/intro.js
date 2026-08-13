(function () {
  "use strict";

  const body = document.body;
  const intro = document.getElementById("introScreen");

  if (!intro) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let finished = false;
  let finishTimer;
  let removeTimer;

  function finishIntro() {
    if (finished) return;
    finished = true;

    window.clearTimeout(finishTimer);
    window.clearTimeout(window.__caremindIntroFallback);
    body.classList.add("intro-complete");
    body.classList.remove("is-intro");

    removeTimer = window.setTimeout(
      function () {
        intro.remove();
      },
      reducedMotion ? 0 : 850,
    );
  }

  function scheduleIntro() {
    finishTimer = window.setTimeout(finishIntro, reducedMotion ? 80 : 2100);
  }

  intro.addEventListener("click", finishIntro);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
      finishIntro();
    }
  });

  if (document.readyState === "complete") {
    scheduleIntro();
  } else {
    window.addEventListener("load", scheduleIntro, { once: true });
  }

  window.addEventListener(
    "pagehide",
    function () {
      window.clearTimeout(finishTimer);
      window.clearTimeout(removeTimer);
    },
    { once: true },
  );
})();
