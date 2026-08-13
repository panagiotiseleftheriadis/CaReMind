(function () {
  const focusableSelector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  let previouslyFocused = null;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    })[character]);
  }

  function toast(message, type = "info", duration = 4500) {
    let region = document.getElementById("appToastRegion");
    if (!region) {
      region = document.createElement("div");
      region.id = "appToastRegion";
      region.className = "app-toast-region";
      region.setAttribute("aria-live", type === "error" ? "assertive" : "polite");
      region.setAttribute("aria-atomic", "true");
      document.body.appendChild(region);
    }

    const item = document.createElement("div");
    item.className = `app-toast app-toast-${type}`;
    item.setAttribute("role", type === "error" ? "alert" : "status");

    const text = document.createElement("span");
    text.textContent = String(message || "");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "app-toast-close";
    close.setAttribute("aria-label", "Κλείσιμο ειδοποίησης");
    close.textContent = "×";
    close.addEventListener("click", () => item.remove());

    item.append(text, close);
    region.appendChild(item);
    window.setTimeout(() => item.remove(), duration);
  }

  function setBusy(isBusy, label = "Φόρτωση δεδομένων…") {
    const main = document.querySelector("main, .container, .admin-container") || document.body;
    main.setAttribute("aria-busy", String(Boolean(isBusy)));

    let indicator = document.getElementById("appLoadingIndicator");
    if (isBusy) {
      if (!indicator) {
        indicator = document.createElement("div");
        indicator.id = "appLoadingIndicator";
        indicator.className = "app-loading-indicator";
        indicator.setAttribute("role", "status");
        indicator.innerHTML = '<span class="app-loading-spinner" aria-hidden="true"></span><span></span>';
        document.body.appendChild(indicator);
      }
      indicator.querySelector("span:last-child").textContent = label;
    } else {
      indicator?.remove();
    }
  }

  function confirmAction(message, options = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "app-confirm-overlay";
      overlay.innerHTML = `
        <div class="app-confirm" role="alertdialog" aria-modal="true" aria-labelledby="appConfirmTitle" aria-describedby="appConfirmMessage">
          <h2 id="appConfirmTitle">${escapeHtml(options.title || "Επιβεβαίωση")}</h2>
          <p id="appConfirmMessage">${escapeHtml(message)}</p>
          <div class="app-confirm-actions">
            <button type="button" class="app-confirm-cancel">${escapeHtml(options.cancelLabel || "Ακύρωση")}</button>
            <button type="button" class="app-confirm-accept">${escapeHtml(options.confirmLabel || "Συνέχεια")}</button>
          </div>
        </div>`;

      const finish = (answer) => {
        overlay.remove();
        document.removeEventListener("keydown", onKeyDown);
        previouslyFocused?.focus?.();
        resolve(answer);
      };
      const onKeyDown = (event) => {
        if (event.key === "Escape") finish(false);
      };

      previouslyFocused = document.activeElement;
      overlay.querySelector(".app-confirm-cancel").addEventListener("click", () => finish(false));
      overlay.querySelector(".app-confirm-accept").addEventListener("click", () => finish(true));
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) finish(false);
      });
      document.addEventListener("keydown", onKeyDown);
      document.body.appendChild(overlay);
      overlay.querySelector(".app-confirm-cancel").focus();
    });
  }

  function isVisible(modal) {
    const style = window.getComputedStyle(modal);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function prepareModal(modal) {
    if (modal.dataset.accessibleModal === "true") return;
    modal.dataset.accessibleModal = "true";
    modal.setAttribute("role", modal.getAttribute("role") || "dialog");
    modal.setAttribute("aria-modal", "true");
    if (!modal.hasAttribute("aria-hidden")) modal.setAttribute("aria-hidden", "true");

    const content = modal.querySelector(".modal-content");
    if (content && !content.hasAttribute("tabindex")) content.tabIndex = -1;

    const syncModalState = () => {
      const open = isVisible(modal);
      modal.setAttribute("aria-hidden", String(!open));
      modal.toggleAttribute("inert", !open);
      if (open) {
        previouslyFocused = document.activeElement;
        window.setTimeout(() => {
          const target = modal.querySelector(focusableSelector) || content;
          target?.focus?.();
        }, 0);
      }
    };

    syncModalState();
    const observer = new MutationObserver(syncModalState);
    observer.observe(modal, { attributes: true, attributeFilter: ["class", "style"] });
  }

  function initializeAccessibility() {
    document.querySelectorAll(".modal").forEach(prepareModal);
    document.querySelectorAll(".nav-toggle").forEach((button) => {
      if (!button.hasAttribute("aria-expanded")) button.setAttribute("aria-expanded", "false");
      const header = button.closest("header") || button.parentElement;
      const navigation = header?.querySelector("nav");
      if (navigation) {
        if (!navigation.id) navigation.id = `navigation-${Math.random().toString(36).slice(2, 8)}`;
        button.setAttribute("aria-controls", navigation.id);
        button.addEventListener("click", () => {
          const expanded = document.body.classList.toggle("nav-open");
          button.setAttribute("aria-expanded", String(expanded));
          button.setAttribute("aria-label", expanded ? "Κλείσιμο μενού" : "Άνοιγμα μενού");
        });

        navigation.addEventListener("click", (event) => {
          if (!event.target.closest("a")) return;
          document.body.classList.remove("nav-open");
          button.setAttribute("aria-expanded", "false");
          button.setAttribute("aria-label", "Άνοιγμα μενού");
        });
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !document.body.classList.contains("nav-open")) return;
      document.body.classList.remove("nav-open");
      document.querySelectorAll(".nav-toggle").forEach((button) => {
        button.setAttribute("aria-expanded", "false");
        button.setAttribute("aria-label", "Άνοιγμα μενού");
      });
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth <= 768) return;
      document.body.classList.remove("nav-open");
      document.querySelectorAll(".nav-toggle").forEach((button) => {
        button.setAttribute("aria-expanded", "false");
        button.setAttribute("aria-label", "Άνοιγμα μενού");
      });
    });

    document.querySelectorAll(".modal .close").forEach((close) => {
      if (close.tagName === "BUTTON") return;
      close.setAttribute("role", "button");
      close.setAttribute("tabindex", "0");
      close.setAttribute("aria-label", close.getAttribute("aria-label") || "Κλείσιμο");
      close.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          close.click();
        }
      });
    });

    document.addEventListener("keydown", (event) => {
      const modal = [...document.querySelectorAll(".modal")].reverse().find(isVisible);
      if (!modal) return;

      if (event.key === "Escape") {
        const close = modal.querySelector(".close, .modal-close, [data-action='close'], .btn-secondary");
        close?.click();
        previouslyFocused?.focus?.();
        return;
      }

      if (event.key === "Tab") {
        const focusable = [...modal.querySelectorAll(focusableSelector)].filter((element) => !element.hidden);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });
  }

  window.CaReMindUI = { escapeHtml, toast, confirm: confirmAction, setBusy };
  document.addEventListener("DOMContentLoaded", initializeAccessibility);
})();
