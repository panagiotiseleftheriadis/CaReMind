(function () {
  const STORAGE_KEY = "caremindDemoTourV1";
  const TOUR_VERSION = 2;

  const chapters = {
    dashboard: {
      title: "Πίνακας ελέγχου",
      nextLabel: "Οχήματα",
      nextHref: "vehicles.html",
      steps: [
        {
          target: '[data-tour="dashboard-stats"]',
          title: "Η εικόνα σου με μία ματιά",
          text: "Εδώ βλέπεις τα οχήματα, τα έξοδα του μήνα και τις συντηρήσεις που πλησιάζουν ή έχουν καθυστερήσει.",
        },
        {
          target: '[data-tour="dashboard-charts"]',
          title: "Κατανόησε τα δεδομένα",
          text: "Τα γραφήματα μετατρέπουν τις καταχωρήσεις σου σε χρήσιμη εικόνα: πού ξοδεύεις περισσότερο και ποιοι τύποι συντήρησης εμφανίζονται συχνότερα.",
        },
        {
          target: '[data-tour="dashboard-actions"]',
          title: "Ξεκίνα από εδώ",
          text: "Οι γρήγορες ενέργειες σε μεταφέρουν απευθείας στην προσθήκη οχήματος, συντήρησης ή κόστους. Πρώτο βήμα είναι πάντα η καταχώρηση ενός οχήματος.",
        },
      ],
    },
    vehicles: {
      title: "Οχήματα",
      nextLabel: "Συντήρηση",
      nextHref: "maintenance.html",
      steps: [
        {
          target: '[data-tour="vehicles-add"]',
          title: "Πρόσθεσε όχημα",
          text: "Από εδώ καταχωρείς τύπο, αριθμό πλαισίου, μοντέλο, έτος και τρέχοντα χιλιόμετρα.",
        },
        {
          target: '[data-tour="vehicles-list"]',
          title: "Οχήματα και ενέργειες",
          text: "Η λίστα δείχνει όλα τα βασικά στοιχεία. Σε κάθε όχημα μπορείς να ενημερώσεις δεδομένα, να πας στη συντήρηση ή να το διαγράψεις με επιβεβαίωση.",
        },
      ],
    },
    maintenance: {
      title: "Συντήρηση",
      nextLabel: "Έξοδα",
      nextHref: "costs.html",
      steps: [
        {
          target: '[data-tour="maintenance-summary"]',
          title: "Κατάσταση συντηρήσεων",
          text: "Βλέπεις αμέσως ποιες εργασίες πλησιάζουν, ποιες έχουν καθυστερήσει και ποιες ολοκληρώθηκαν.",
        },
        {
          target: '[data-tour="maintenance-add"]',
          title: "Προγραμμάτισε εργασία",
          text: "Επίλεξε όχημα και τύπο εργασίας. Μπορείς να ορίσεις επόμενο έλεγχο με ημερομηνία, χιλιόμετρα ή και με τα δύο.",
        },
        {
          target: '[data-tour="maintenance-list"]',
          title: "Πρόγραμμα και ιστορικό",
          text: "Η λίστα δείχνει όχημα, εργασία και επόμενο όριο. Με τα φίλτρα ακριβώς από πάνω βρίσκεις γρήγορα ό,τι χρειάζεσαι.",
        },
      ],
    },
    costs: {
      title: "Έξοδα",
      nextLabel: "Λογαριασμός",
      nextHref: "account.html",
      steps: [
        {
          target: '[data-tour="costs-intro"]',
          title: "Πλήρης εικόνα δαπανών",
          text: "Κατέγραψε καύσιμα, service, ασφάλειες, τέλη και οποιοδήποτε άλλο έξοδο στο όχημα που αφορά.",
        },
        {
          target: '[data-tour="costs-summary"]',
          title: "Οι δαπάνες με μία ματιά",
          text: "Οι κάρτες υπολογίζουν αυτόματα το συνολικό και μηνιαίο κόστος, καθώς και τη μεταβολή σε σχέση με πριν.",
        },
        {
          target: '[data-tour="costs-list"]',
          title: "Ιστορικό και εξαγωγή",
          text: "Η λίστα κρατά ημερομηνία, ποσό και περιγραφή. Με τα φίλτρα βρίσκεις συγκεκριμένες δαπάνες και μπορείς να τις εξαγάγεις.",
        },
      ],
    },
    account: {
      title: "Λογαριασμός",
      nextLabel: null,
      nextHref: null,
      steps: [
        {
          target: '[data-tour="account-profile"]',
          title: "Λογαριασμός και ασφάλεια",
          text: "Εδώ βλέπεις τα στοιχεία του λογαριασμού. Σε πραγματική σύνδεση μπορείς να αλλάξεις username, email ή κωδικό με επιβεβαίωση ασφαλείας.",
        },
      ],
    },
  };

  let activeChapter = null;
  let activeIndex = 0;
  let layer = null;
  let highlightedTarget = null;
  let previousFocus = null;
  let positionFrame = null;
  let stepTransition = 0;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function isDemoActive() {
    return Boolean(window.CaReMindDemo?.isActive?.());
  }

  function pageKey() {
    const lastPart = window.location.pathname.split("/").filter(Boolean).pop() || "dashboard";
    const key = lastPart.replace(/\.html$/i, "");
    return chapters[key] ? key : null;
  }

  function defaultState() {
    return {
      version: TOUR_VERSION,
      welcomed: false,
      enabled: false,
      paused: false,
      chapters: {},
    };
  }

  function loadState() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (value?.version === TOUR_VERSION) return value;
    } catch (_) {}
    return defaultState();
  }

  function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function chapterState(state, key) {
    state.chapters[key] ||= { completed: false, index: 0 };
    return state.chapters[key];
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function findTarget(selector, timeout = 4500) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      const target = document.querySelector(selector);
      if (target && target.getBoundingClientRect().width > 0) return target;
      await wait(100);
    }
    return null;
  }

  function createCarIcon() {
    return `
      <svg viewBox="0 0 320 112" aria-hidden="true">
        <path d="M8 80h12l2-16c1-7 6-11 14-13l59-14c18-11 39-16 65-16h31c27 0 52 8 73 22l17 15 21 5c8 2 12 8 12 16v3h-17" />
        <path d="M103 82h127m-222 0h31m253 0h22" />
        <path d="M101 38c17-10 36-14 59-14h26c22 0 42 6 59 17l-72 1-72 1Z" />
        <path d="M171 25l2 17m4 6v29m-72-27c45 4 99 4 160 0m-75 2h14m78 6 19 4 7 7h-21M19 58l24-5 12 6-33 8m88 17h115" />
        <path d="M39 82c0-19 13-32 32-32s32 13 32 32m127 0c0-19 13-32 32-32s32 13 32 32" />
        <circle cx="71" cy="82" r="20" />
        <circle cx="71" cy="82" r="11" />
        <circle cx="262" cy="82" r="20" />
        <circle cx="262" cy="82" r="11" />
      </svg>`;
  }

  function createLayer() {
    if (layer) return layer;
    layer = document.createElement("div");
    layer.className = "demo-tour-layer is-positioning";
    layer.innerHTML = `
      <div class="demo-tour-highlight" aria-hidden="true"></div>
      <section class="demo-tour-card" role="dialog" aria-modal="true" aria-labelledby="demoTourTitle" tabindex="-1">
        <button class="demo-tour-close" type="button" aria-label="Κλείσιμο ξενάγησης">×</button>
        <div class="demo-tour-step-content">
          <div class="demo-tour-kicker"></div>
          <h2 id="demoTourTitle"></h2>
          <p class="demo-tour-copy"></p>
          <div class="demo-tour-road" aria-hidden="true">
            <span class="demo-tour-road-fill"></span>
            <span class="demo-tour-car">${createCarIcon()}</span>
          </div>
          <div class="demo-tour-footer">
            <button class="demo-tour-skip" type="button">Παράλειψη κεφαλαίου</button>
            <div class="demo-tour-controls">
              <button class="demo-tour-back" type="button">Πίσω</button>
              <button class="demo-tour-next" type="button">Επόμενο</button>
            </div>
          </div>
        </div>
      </section>`;
    document.body.appendChild(layer);

    layer.querySelector(".demo-tour-close").addEventListener("click", pauseTour);
    layer.querySelector(".demo-tour-skip").addEventListener("click", skipChapter);
    layer.querySelector(".demo-tour-back").addEventListener("click", previousStep);
    layer.querySelector(".demo-tour-next").addEventListener("click", nextStep);
    window.addEventListener("resize", schedulePosition);
    window.addEventListener("scroll", schedulePosition, true);
    document.addEventListener("keydown", handleKeys);
    return layer;
  }

  function handleKeys(event) {
    if (!layer) return;
    if (event.key === "Escape") pauseTour();
    if (event.key === "ArrowRight") nextStep();
    if (event.key === "ArrowLeft") previousStep();
  }

  function schedulePosition() {
    if (!layer || !highlightedTarget) return;
    if (layer.classList.contains("is-positioning")) return;
    window.cancelAnimationFrame(positionFrame);
    positionFrame = window.requestAnimationFrame(positionLayer);
  }

  async function scrollTargetSmoothly(target) {
    document.body.classList.remove("demo-tour-open");
    const root = document.documentElement;
    const previousBehavior = root.style.scrollBehavior;
    const targetTop = window.innerWidth <= 700 ? 12 : 22;
    const rect = target.getBoundingClientRect();
    const destination = Math.max(0, window.scrollY + rect.top - targetTop);
    root.style.scrollBehavior = "auto";
    if (reducedMotion.matches || Math.abs(destination - window.scrollY) < 2) {
      window.scrollTo(0, destination);
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      root.style.scrollBehavior = previousBehavior;
      return;
    }

    window.scrollTo({ top: destination, left: 0, behavior: "smooth" });
    await new Promise((resolve) => {
      const startedAt = performance.now();
      let previousY = window.scrollY;
      let settledFrames = 0;

      function observeScroll(now) {
        const currentY = window.scrollY;
        const reachedTarget = Math.abs(currentY - destination) < 2;
        const stoppedMoving = Math.abs(currentY - previousY) < 0.5;
        settledFrames = stoppedMoving ? settledFrames + 1 : 0;
        previousY = currentY;

        if (
          reachedTarget ||
          (settledFrames >= 5 && now - startedAt > 160) ||
          now - startedAt > 1200
        ) {
          resolve();
          return;
        }
        window.requestAnimationFrame(observeScroll);
      }
      window.requestAnimationFrame(observeScroll);
    });
    root.style.scrollBehavior = previousBehavior;
  }

  function positionLayer() {
    if (!layer || !highlightedTarget) return;
    const rect = highlightedTarget.getBoundingClientRect();
    const highlight = layer.querySelector(".demo-tour-highlight");
    const card = layer.querySelector(".demo-tour-card");
    const isMobile = window.innerWidth <= 700;
    const margin = isMobile ? 8 : 18;
    const padding = isMobile ? 5 : 8;
    const gap = isMobile ? 10 : 16;
    const cardRect = card.getBoundingClientRect();
    const highlightTop = Math.max(margin, rect.top - padding);
    const highlightLeft = Math.max(margin, rect.left - padding);
    const highlightWidth = Math.min(
      window.innerWidth - highlightLeft - margin,
      rect.width + padding * 2,
    );

    if (isMobile) {
      const availableHeight = Math.max(72, cardRect.top - gap - highlightTop);
      const highlightHeight = Math.min(rect.height + padding * 2, availableHeight);
      highlight.style.setProperty("--tour-top", `${highlightTop}px`);
      highlight.style.setProperty("--tour-left", `${highlightLeft}px`);
      highlight.style.setProperty("--tour-width", `${highlightWidth}px`);
      highlight.style.setProperty("--tour-height", `${highlightHeight}px`);
      return;
    }

    const availableHighlightHeight = Math.max(
      86,
      window.innerHeight - highlightTop - cardRect.height - gap - margin,
    );
    const highlightHeight = Math.min(rect.height + padding * 2, availableHighlightHeight);
    const highlightBottom = highlightTop + highlightHeight;
    const cardLeft = Math.min(
      window.innerWidth - cardRect.width - margin,
      Math.max(margin, rect.left),
    );

    highlight.style.setProperty("--tour-top", `${highlightTop}px`);
    highlight.style.setProperty("--tour-left", `${highlightLeft}px`);
    highlight.style.setProperty("--tour-width", `${highlightWidth}px`);
    highlight.style.setProperty("--tour-height", `${highlightHeight}px`);
    card.style.left = `${cardLeft}px`;
    card.style.top = `${highlightBottom + gap}px`;
  }

  function clearTarget() {
    highlightedTarget?.classList.remove("demo-tour-active-target");
    highlightedTarget = null;
  }

  function closeLayer() {
    stepTransition += 1;
    clearTarget();
    layer?.remove();
    layer = null;
    document.body.classList.remove("demo-tour-open");
    document.removeEventListener("keydown", handleKeys);
    window.removeEventListener("resize", schedulePosition);
    window.removeEventListener("scroll", schedulePosition, true);
    previousFocus?.focus?.({ preventScroll: true });
    previousFocus = null;
  }

  function pauseTour() {
    const state = loadState();
    state.paused = true;
    if (activeChapter) chapterState(state, activeChapter).index = activeIndex;
    saveState(state);
    closeLayer();
    window.CaReMindUI?.toast?.("Η ξενάγηση σταμάτησε. Μπορείς να συνεχίσεις από το κουμπί «Ξενάγηση».", "info");
  }

  function skipChapter() {
    const state = loadState();
    const current = chapterState(state, activeChapter);
    current.completed = true;
    current.index = 0;
    state.paused = true;
    saveState(state);
    closeLayer();
    window.CaReMindUI?.toast?.("Το κεφάλαιο παραλείφθηκε.", "info");
  }

  function previousStep() {
    if (!layer || activeIndex <= 0) return;
    showStep(activeIndex - 1);
  }

  function nextStep() {
    if (!layer || !activeChapter) return;
    const chapter = chapters[activeChapter];
    if (activeIndex < chapter.steps.length - 1) {
      showStep(activeIndex + 1);
      return;
    }

    const state = loadState();
    const current = chapterState(state, activeChapter);
    current.completed = true;
    current.index = 0;
    state.paused = false;
    state.enabled = true;
    saveState(state);
    closeLayer();

    if (chapter.nextHref) {
      if ("scrollRestoration" in history) history.scrollRestoration = "manual";
      window.location.href = chapter.nextHref;
    } else {
      showCompletion();
    }
  }

  async function showStep(index) {
    const chapter = chapters[activeChapter];
    if (!chapter) return;
    const nextIndex = Math.max(0, Math.min(index, chapter.steps.length - 1));
    const previousIndex = activeIndex;
    const step = chapter.steps[nextIndex];
    const transition = ++stepTransition;
    const target = await findTarget(step.target);
    if (transition !== stepTransition) return;
    if (!target) {
      if (nextIndex < chapter.steps.length - 1) return showStep(nextIndex + 1);
      return nextStep();
    }

    const tourLayer = createLayer();
    const hasVisibleStep = tourLayer.classList.contains("is-ready");
    const direction = nextIndex < previousIndex ? "backward" : "forward";
    tourLayer.dataset.direction = direction;
    window.cancelAnimationFrame(positionFrame);
    tourLayer.classList.add("is-positioning");
    tourLayer.setAttribute("aria-busy", "true");
    if (hasVisibleStep && !reducedMotion.matches) {
      tourLayer.classList.add("is-step-exiting");
      await wait(150);
      if (transition !== stepTransition) return;
    }

    activeIndex = nextIndex;
    clearTarget();
    highlightedTarget = target;
    highlightedTarget.classList.add("demo-tour-active-target");
    await scrollTargetSmoothly(target);
    if (transition !== stepTransition) return;

    const progress = ((activeIndex + 1) / chapter.steps.length) * 100;
    tourLayer.querySelector(".demo-tour-kicker").textContent =
      `${chapter.title} · ${activeIndex + 1}/${chapter.steps.length}`;
    tourLayer.querySelector("#demoTourTitle").textContent = step.title;
    tourLayer.querySelector(".demo-tour-copy").textContent = step.text;
    tourLayer.querySelector(".demo-tour-road-fill").style.width = `${progress}%`;
    tourLayer.querySelector(".demo-tour-car").style.left = `${progress}%`;
    tourLayer.querySelector(".demo-tour-back").disabled = activeIndex === 0;
    tourLayer.querySelector(".demo-tour-next").textContent =
      activeIndex === chapter.steps.length - 1
        ? chapter.nextLabel
          ? `Συνέχεια: ${chapter.nextLabel}`
          : "Ολοκλήρωση"
        : "Επόμενο";

    const state = loadState();
    chapterState(state, activeChapter).index = activeIndex;
    state.paused = false;
    saveState(state);
    document.body.classList.add("demo-tour-open");
    positionLayer();
    tourLayer.classList.remove("is-step-exiting");
    tourLayer.classList.add("is-step-entering");
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    if (transition !== stepTransition) return;
    tourLayer.classList.remove("is-positioning", "is-step-entering");
    tourLayer.classList.add("is-ready");
    if (!hasVisibleStep) {
      tourLayer.classList.add("is-opening");
      window.setTimeout(() => tourLayer.classList.remove("is-opening"), 700);
    }
    tourLayer.removeAttribute("aria-busy");
    tourLayer.querySelector(".demo-tour-card").focus({ preventScroll: true });
  }

  async function startChapter(key, { restart = false } = {}) {
    if (!isDemoActive() || !chapters[key]) return;
    const state = loadState();
    const current = chapterState(state, key);
    if (restart || current.completed) {
      current.completed = false;
      current.index = 0;
    }
    state.welcomed = true;
    state.enabled = true;
    state.paused = false;
    saveState(state);
    activeChapter = key;
    previousFocus = document.activeElement;
    await showStep(current.index || 0);
  }

  function showWelcome() {
    if (!isDemoActive() || document.querySelector(".demo-tour-welcome")) return;
    const welcome = document.createElement("div");
    welcome.className = "demo-tour-welcome";
    welcome.innerHTML = `
      <section class="demo-tour-welcome-card" role="dialog" aria-modal="true" aria-labelledby="demoWelcomeTitle">
        <div class="demo-tour-welcome-car">${createCarIcon()}</div>
        <p class="demo-tour-welcome-kicker">CAREMIND GUIDED TOUR</p>
        <h2 id="demoWelcomeTitle">Γνώρισε την εφαρμογή, βήμα βήμα.</h2>
        <p>Σε λίγα λεπτά θα δεις πώς οργανώνονται τα οχήματα, οι συντηρήσεις και όλα τα σχετικά έξοδα.</p>
        <div class="demo-tour-welcome-route" aria-label="Διαδρομή ξενάγησης">
          <span>Πίνακας</span><i>→</i><span>Οχήματα</span><i>→</i><span>Συντήρηση</span><i>→</i><span>Έξοδα</span>
        </div>
        <div class="demo-tour-welcome-actions">
          <button class="demo-tour-explore" type="button">Εξερεύνηση μόνος μου</button>
          <button class="demo-tour-start" type="button">Έναρξη ξενάγησης</button>
        </div>
      </section>`;
    document.body.appendChild(welcome);
    document.body.classList.add("demo-tour-open");
    previousFocus = document.activeElement;

    welcome.querySelector(".demo-tour-explore").addEventListener("click", () => {
      const state = loadState();
      state.welcomed = true;
      state.enabled = false;
      state.paused = true;
      saveState(state);
      welcome.remove();
      document.body.classList.remove("demo-tour-open");
      previousFocus?.focus?.();
    });
    welcome.querySelector(".demo-tour-start").addEventListener("click", async () => {
      const state = loadState();
      state.welcomed = true;
      state.enabled = true;
      state.paused = false;
      saveState(state);
      welcome.classList.add("is-leaving");
      welcome.querySelectorAll("button").forEach((button) => {
        button.disabled = true;
      });
      if (!reducedMotion.matches) await wait(320);
      welcome.remove();
      document.body.classList.remove("demo-tour-open");
      startChapter("dashboard", { restart: true });
    });
    welcome.querySelector(".demo-tour-start").focus();
  }

  function showCompletion() {
    const completion = document.createElement("div");
    completion.className = "demo-tour-welcome demo-tour-completion";
    completion.innerHTML = `
      <section class="demo-tour-welcome-card" role="dialog" aria-modal="true" aria-labelledby="demoCompleteTitle">
        <div class="demo-tour-complete-mark" aria-hidden="true">✓</div>
        <p class="demo-tour-welcome-kicker">ΔΙΑΔΡΟΜΗ ΟΛΟΚΛΗΡΩΘΗΚΕ</p>
        <h2 id="demoCompleteTitle">Τώρα ξέρεις τον δρόμο.</h2>
        <p>Μπορείς να δοκιμάσεις ελεύθερα τα Demo δεδομένα. Η ξενάγηση είναι πάντα διαθέσιμη από το κουμπί κάτω δεξιά.</p>
        <div class="demo-tour-welcome-actions demo-tour-welcome-actions--single">
          <button class="demo-tour-start" type="button">Εξερεύνηση εφαρμογής</button>
        </div>
      </section>`;
    document.body.appendChild(completion);
    document.body.classList.add("demo-tour-open");
    const button = completion.querySelector("button");
    button.addEventListener("click", () => {
      completion.remove();
      document.body.classList.remove("demo-tour-open");
    });
    button.focus();
  }

  function startOrResume() {
    const key = pageKey();
    if (!key || !isDemoActive()) return;
    const state = loadState();
    const current = chapterState(state, key);
    startChapter(key, { restart: current.completed });
  }

  function initialize() {
    if (!isDemoActive()) return;
    const key = pageKey();
    if (!key) return;

    document.getElementById("startDemoTourBtn")?.addEventListener("click", startOrResume);
    const state = loadState();
    if (key === "dashboard" && !state.welcomed) {
      window.setTimeout(showWelcome, 650);
      return;
    }
    const current = chapterState(state, key);
    if (state.enabled && !state.paused && !current.completed) {
      window.setTimeout(() => startChapter(key), 500);
    }
  }

  window.CaReMindTour = {
    startOrResume,
    reset() {
      localStorage.removeItem(STORAGE_KEY);
    },
  };
  document.addEventListener("DOMContentLoaded", initialize);
})();
