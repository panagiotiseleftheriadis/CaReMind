(function () {
  const STORAGE_KEY = "caremindDemoTourV1";
  const TOUR_VERSION = 1;

  const chapters = {
    dashboard: {
      title: "Πίνακας ελέγχου",
      nextLabel: "Οχήματα",
      nextHref: "vehicles.html",
      steps: [
        {
          target: '[data-tour="dashboard-welcome"]',
          title: "Η συνολική εικόνα σου",
          text: "Ο Πίνακας ελέγχου συγκεντρώνει ό,τι χρειάζεται άμεση προσοχή. Με μια ματιά βλέπεις την κατάσταση του στόλου ή του προσωπικού σου οχήματος.",
        },
        {
          target: '[data-tour="dashboard-stats"]',
          title: "Οι σημαντικότεροι αριθμοί",
          text: "Εδώ εμφανίζονται τα ενεργά οχήματα, τα έξοδα του μήνα και οι επικείμενες ή εκπρόθεσμες συντηρήσεις.",
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
          target: '[data-tour="vehicles-intro"]',
          title: "Η βάση της εφαρμογής",
          text: "Κάθε συντήρηση και κάθε έξοδο συνδέεται με ένα όχημα. Γι’ αυτό η σωστή καταχώρηση των οχημάτων είναι το πρώτο βήμα.",
        },
        {
          target: '[data-tour="vehicles-add"]',
          title: "Πρόσθεσε όχημα",
          text: "Καταχώρησε τύπο, αριθμό πλαισίου, μοντέλο, έτος και τρέχοντα χιλιόμετρα. Ο αριθμός πλαισίου ξεχωρίζει με ασφάλεια κάθε όχημα.",
        },
        {
          target: '[data-tour="vehicles-list"]',
          title: "Ο στόλος σου σε μία λίστα",
          text: "Εδώ βλέπεις τα βασικά στοιχεία όλων των οχημάτων. Τα έτοιμα Demo δεδομένα δείχνουν πώς θα φαίνεται η δική σου λίστα.",
        },
        {
          target: '[data-tour="vehicles-list"]',
          title: "Ενημέρωση και διαγραφή",
          text: "Από τις ενέργειες κάθε γραμμής μπορείς να διορθώσεις στοιχεία ή χιλιόμετρα. Η διαγραφή οχήματος αφαιρεί και τις συνδεδεμένες συντηρήσεις και δαπάνες, γι’ αυτό ζητείται επιβεβαίωση.",
        },
      ],
    },
    maintenance: {
      title: "Συντήρηση",
      nextLabel: "Έξοδα",
      nextHref: "costs.html",
      steps: [
        {
          target: '[data-tour="maintenance-intro"]',
          title: "Πρόγραμμα και ιστορικό",
          text: "Η σελίδα Συντήρηση σε βοηθά να γνωρίζεις τι έγινε, τι έρχεται και τι έχει ήδη καθυστερήσει για κάθε όχημα.",
        },
        {
          target: '[data-tour="maintenance-summary"]',
          title: "Κατάσταση συντηρήσεων",
          text: "Επικείμενη σημαίνει ότι πλησιάζει η ημερομηνία, εκπρόθεσμη ότι χρειάζεται άμεση ενέργεια και ολοκληρωμένη ότι έχει ήδη πραγματοποιηθεί.",
        },
        {
          target: '[data-tour="maintenance-add"]',
          title: "Προγραμμάτισε εργασία",
          text: "Επίλεξε όχημα και τύπο εργασίας. Μπορείς να ορίσεις επόμενο έλεγχο με ημερομηνία, χιλιόμετρα ή και με τα δύο.",
        },
        {
          target: '[data-tour="maintenance-filters"]',
          title: "Βρες γρήγορα αυτό που ψάχνεις",
          text: "Φίλτραρε το πρόγραμμα ανά όχημα, τύπο εργασίας ή κατάσταση χωρίς να χάνονται οι υπόλοιπες καταχωρήσεις.",
        },
        {
          target: '[data-tour="maintenance-list"]',
          title: "Όλο το ιστορικό οργανωμένο",
          text: "Κάθε γραμμή δείχνει το όχημα, την εργασία και το επόμενο όριο. Από εδώ ενημερώνεις την εργασία όταν ολοκληρωθεί ή αλλάξει ο προγραμματισμός.",
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
          text: "Οι κάρτες υπολογίζουν αυτόματα συνολικό κόστος, τρέχοντα μήνα, μέσο μηνιαίο κόστος και μεταβολή σε σχέση με πριν.",
        },
        {
          target: '[data-tour="costs-filters"]',
          title: "Ανάλυση χωρίς υπολογιστικά φύλλα",
          text: "Περιόρισε τα αποτελέσματα ανά περίοδο, όχημα ή κατηγορία για να εντοπίσεις γρήγορα πού πηγαίνουν τα χρήματα.",
        },
        {
          target: '[data-tour="costs-list"]',
          title: "Ιστορικό και εξαγωγή",
          text: "Η λίστα κρατά ημερομηνία, ποσό, περιγραφή και παραστατικό. Μπορείς επίσης να εξαγάγεις τα φιλτραρισμένα δεδομένα για περαιτέρω χρήση.",
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
          title: "Το προφίλ της εγκατάστασης",
          text: "Εδώ εμφανίζονται τα στοιχεία λογαριασμού και εταιρείας. Στο Demo είναι ενδεικτικά και δεν αποστέλλονται σε κάποιον server.",
        },
        {
          target: '[data-tour="account-settings"]',
          title: "Στοιχεία και ασφάλεια",
          text: "Σε πραγματικό λογαριασμό από εδώ αλλάζεις username, email ή κωδικό με επιβεβαίωση ασφαλείας. Στο Demo μπορείς να εξερευνήσεις χωρίς να αλλάξει πραγματικό προφίλ.",
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

  function reduceMotion() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
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
      <svg viewBox="0 0 72 28" aria-hidden="true">
        <path d="M9 20h5l4-9c1-2 3-3 5-3h25c3 0 5 1 7 3l7 9h3c2 0 3 1 3 3v1H5v-1c0-2 2-3 4-3Z" />
        <circle cx="20" cy="23" r="4" /><circle cx="55" cy="23" r="4" />
        <path d="m24 9-3 9h31l-6-9" />
      </svg>`;
  }

  function createLayer() {
    if (layer) return layer;
    layer = document.createElement("div");
    layer.className = "demo-tour-layer";
    layer.innerHTML = `
      <div class="demo-tour-highlight" aria-hidden="true"></div>
      <section class="demo-tour-card" role="dialog" aria-modal="true" aria-labelledby="demoTourTitle" tabindex="-1">
        <button class="demo-tour-close" type="button" aria-label="Κλείσιμο ξενάγησης">×</button>
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
    window.cancelAnimationFrame(positionFrame);
    positionFrame = window.requestAnimationFrame(positionLayer);
  }

  function positionLayer() {
    if (!layer || !highlightedTarget) return;
    const rect = highlightedTarget.getBoundingClientRect();
    const padding = 8;
    const highlight = layer.querySelector(".demo-tour-highlight");
    const card = layer.querySelector(".demo-tour-card");
    highlight.style.setProperty("--tour-top", `${Math.max(6, rect.top - padding)}px`);
    highlight.style.setProperty("--tour-left", `${Math.max(6, rect.left - padding)}px`);
    highlight.style.setProperty("--tour-width", `${Math.min(window.innerWidth - 12, rect.width + padding * 2)}px`);
    highlight.style.setProperty("--tour-height", `${Math.min(window.innerHeight - 12, rect.height + padding * 2)}px`);

    if (window.innerWidth <= 700) {
      card.removeAttribute("style");
      return;
    }

    const cardRect = card.getBoundingClientRect();
    const gap = 18;
    let left = rect.right + gap;
    let top = Math.max(18, rect.top);
    if (left + cardRect.width > window.innerWidth - 18) {
      left = rect.left - cardRect.width - gap;
    }
    if (left < 18) {
      left = Math.min(window.innerWidth - cardRect.width - 18, Math.max(18, rect.left));
      top = rect.bottom + gap;
    }
    if (top + cardRect.height > window.innerHeight - 18) {
      top = Math.max(18, window.innerHeight - cardRect.height - 18);
    }
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  function clearTarget() {
    highlightedTarget?.classList.remove("demo-tour-active-target");
    highlightedTarget = null;
  }

  function closeLayer() {
    clearTarget();
    layer?.remove();
    layer = null;
    document.body.classList.remove("demo-tour-open");
    document.removeEventListener("keydown", handleKeys);
    window.removeEventListener("resize", schedulePosition);
    window.removeEventListener("scroll", schedulePosition, true);
    previousFocus?.focus?.();
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
      window.location.href = chapter.nextHref;
    } else {
      showCompletion();
    }
  }

  async function showStep(index) {
    const chapter = chapters[activeChapter];
    if (!chapter) return;
    activeIndex = Math.max(0, Math.min(index, chapter.steps.length - 1));
    const step = chapter.steps[activeIndex];
    const target = await findTarget(step.target);
    if (!target) {
      if (activeIndex < chapter.steps.length - 1) return showStep(activeIndex + 1);
      return nextStep();
    }

    clearTarget();
    highlightedTarget = target;
    highlightedTarget.classList.add("demo-tour-active-target");
    document.body.classList.remove("demo-tour-open");
    target.scrollIntoView({
      behavior: reduceMotion() ? "auto" : "smooth",
      block: "center",
      inline: "nearest",
    });
    await wait(reduceMotion() ? 0 : 320);

    const tourLayer = createLayer();
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
    schedulePosition();
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
    welcome.querySelector(".demo-tour-start").addEventListener("click", () => {
      const state = loadState();
      state.welcomed = true;
      state.enabled = true;
      state.paused = false;
      saveState(state);
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
