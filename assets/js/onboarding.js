// assets/js/onboarding.js
// ---------------------------------------------------------------------------
// Onboarding tour + notification permission flow.
//
// Pattern:
//   1. Tour runs once (localStorage flag).
//   2. When tour ends (Finish or Skip), a branded modal appears.
//   3. User taps "Enable" → OS-level browser prompt fires.
//   4. If granted → business tag is applied → push works immediately.
//   5. If user dismisses the branded modal → 3-day cooldown before retry.
//
// The custom modal does NOT replace the OS prompt (browsers don't allow that).
// It pre-sells the ask, which is how mature SaaS apps maximize grants.
// ---------------------------------------------------------------------------

let currentStep = 0;
let overlayEl = null;
let tooltipEl = null;
let resizeHandler = null;
let notificationModalEl = null;

const ONBOARDING_FLAG = "tracknrent_onboarding_completed";
const NOTIF_DISMISS_KEY = "tracknrent_notif_prompt_dismissed_at";
const NOTIF_ATTEMPT_KEY = "tracknrent_notif_attempt_at";
const COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

/* ============================================================
   AVATAR DROPDOWN HELPERS
   ------------------------------------------------------------------
   The final three tour cards (Settings / Public Profile / Analytics)
   live INSIDE the avatar dropdown. To highlight each menu item
   individually, we open the dropdown automatically before those
   steps and close it when we leave them.
============================================================ */
function isDropdownAvailable() {
  return !!document.getElementById("user-dropdown");
}

function openAvatarDropdown() {
  const dd = document.getElementById("user-dropdown");
  const avatar = document.getElementById("user-avatar");
  if (!dd) return;
  dd.classList.remove("hidden");
  dd.style.display = "block";
  if (avatar) {
    avatar.style.outline = "3px solid purple";
    avatar.style.outlineOffset = "2px";
  }
}

function closeAvatarDropdown() {
  const dd = document.getElementById("user-dropdown");
  const avatar = document.getElementById("user-avatar");
  if (dd) {
    dd.classList.add("hidden");
    dd.style.display = "none";
  }
  if (avatar) {
    avatar.style.outline = "";
    avatar.style.outlineOffset = "";
  }
}

/* ============================================================
   TOUR STEPS
============================================================ */
const steps = [
  {
    selector: ".brand, #brand, .mobile-brand, #mobile-brand",
    title: "Welcome to Tracknrent! 🚀",
    desc: "Your all-in-one rental workspace — inventory, bookings, payments, and vendor lends in one place."
  },
  {
    selector: ".cardBox",
    title: "Today at a Glance 📊",
    desc: "Six live counters for inventory, active bookings, upcoming events, returns, overdue jobs, and overbooked stock. Tap any card to jump into the filtered list."
  },
  {
    selector: '.bookings, a[href="bookings.html"]',
    title: "Bookings 📋",
    desc: "Every rental order. Filter by status, search by client or vendor, and open any row for receipts and payment history."
  },
  {
    selector: '.add, a[href="add.html"]',
    title: "New Booking ➕",
    desc: "Create a booking in one screen. Stock is checked live, and a WhatsApp receipt is ready the moment you save."
  },
  {
    selector: '.inventory, a[href="inventory.html"]',
    title: "Inventory 📦",
    desc: "Your catalog. See what's owned, what's free now, and what's out. Low-stock alerts fire automatically."
  },
  {
    selector: '.rent, a[href="rental-to-rental.html"]',
    title: "Rental ↔ Rental 🔄",
    desc: "Track lends to other rental companies and borrows from vendors — with overdue alerts and damage logs."
  },
  {
    selector: "#notifBtn",
    title: "Notifications 🔔",
    desc: "Real-time alerts for new bookings, overdue returns, low stock, and damage. A red dot means something needs you."
  },
  {
    selector: "#user-avatar",
    title: "Your Account Menu ⚙️",
    desc: "Tap your avatar any time to reach Settings, Public Profile, and Analytics. The next three steps walk through each.",
    _isAccountIntro: true
  },
  {
    selector: '#user-dropdown a[href="settings.html"]',
    title: "Settings ⚙️",
    desc: "Profile, business name, team invites, notification prefs, and your return-message template.",
    keepDropdownOpen: true,
    _requiresDropdown: true
  },
  {
    selector: '#user-dropdown a[href="public.html"]',
    title: "Public Profile 🌐",
    desc: "Your online storefront. Pick a slug, upload a cover, and share the link so clients can browse your catalog.",
    keepDropdownOpen: true,
    _requiresDropdown: true
  },
  {
    selector: '#user-dropdown a[href="analytics.html"]',
    title: "Analytics 📈",
    desc: "Revenue trends, top customers, outstanding balances, and damage losses — filterable by any date range.",
    keepDropdownOpen: true,
    _requiresDropdown: true
  }
];

/* ============================================================
   ENTRY POINT
============================================================ */
export function startOnboardingTour() {
  const tourDone = localStorage.getItem(ONBOARDING_FLAG) === "true";

  if (tourDone) {
    // Tour already completed — try the permission prompt if eligible.
    maybePromptForNotifications();
    return;
  }

  currentStep = 0;
  createOverlayAndTooltip();
  showStep(currentStep);

  resizeHandler = () => {
    if (overlayEl && overlayEl.style.display !== "none") {
      updatePositions();
    }
  };
  window.addEventListener("resize", resizeHandler);
  window.addEventListener("scroll", resizeHandler);
}

/* ============================================================
   OVERLAY + TOOLTIP
============================================================ */
function createOverlayAndTooltip() {
  overlayEl = document.getElementById("onboarding-overlay");
  if (!overlayEl) {
    overlayEl = document.createElement("div");
    overlayEl.id = "onboarding-overlay";
    overlayEl.style.position = "absolute";
    overlayEl.style.zIndex = "99998";
    overlayEl.style.pointerEvents = "none";
    overlayEl.style.borderRadius = "12px";
    overlayEl.style.boxShadow = "0 0 0 9999px rgba(0, 0, 0, 0.75)";
    overlayEl.style.transition = "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)";
    overlayEl.style.border = "3px solid purple";
    document.body.appendChild(overlayEl);
  }

  tooltipEl = document.getElementById("onboarding-tooltip");
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.id = "onboarding-tooltip";
    tooltipEl.style.position = "absolute";
    tooltipEl.style.zIndex = "99999";
    tooltipEl.style.backgroundColor = "#ffffff";
    tooltipEl.style.color = "#1f2937";
    tooltipEl.style.borderRadius = "16px";
    tooltipEl.style.boxShadow =
      "0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.1)";
    tooltipEl.style.padding = "20px";
    tooltipEl.style.maxWidth = "calc(100vw - 32px)";
    tooltipEl.style.width = "320px";
    tooltipEl.style.boxSizing = "border-box";
    tooltipEl.style.transition = "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)";
    tooltipEl.style.fontFamily = "'Be Vietnam Pro', system-ui, sans-serif";
    document.body.appendChild(tooltipEl);
  }
}

/* ============================================================
   STEP NAVIGATION
============================================================ */
function showStep(stepIndex) {
  const step = steps[stepIndex];
  if (!step) {
    endTour();
    return;
  }

  // Dropdown lifecycle: open for dropdown-backed account steps,
  // close as soon as we leave them.
  if (step.keepDropdownOpen) {
    openAvatarDropdown();
  } else {
    closeAvatarDropdown();
  }

  let targetEl = null;
  const selectors = step.selector.split(",");
  for (const sel of selectors) {
    const el = document.querySelector(sel.trim());
    if (el && el.getBoundingClientRect().width > 0) {
      targetEl = el;
      break;
    }
  }

  if (!targetEl) {
    overlayEl.style.display = "none";
    tooltipEl.style.top = "50%";
    tooltipEl.style.left = "50%";
    tooltipEl.style.transform = "translate(-50%, -50%)";
    tooltipEl.style.position = "fixed";
  } else {
    overlayEl.style.display = "block";
    tooltipEl.style.transform = "none";
    tooltipEl.style.position = "absolute";
    targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(updatePositions, 100);
  }

  tooltipEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <span style="font-size:0.75rem;font-weight:700;color:purple;text-transform:uppercase;letter-spacing:0.05em;">Step ${stepIndex + 1} of ${steps.length}</span>
      <button id="ob-skip" style="background:none;border:none;color:#6b7280;cursor:pointer;font-size:0.85rem;font-weight:500;padding:4px 8px;">Skip</button>
    </div>
    <h3 style="font-weight:700;font-size:1.15rem;margin:0 0 8px;color:#111827;">${step.title}</h3>
<div style="font-size:0.875rem;color:#4b5563;line-height:1.6;margin:0 0 20px;">${step.desc}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <button id="ob-back" style="background:#f3f4f6;color:#4b5563;border:none;padding:8px 16px;border-radius:10px;cursor:pointer;font-weight:600;font-size:0.85rem;${stepIndex === 0 ? "visibility:hidden;" : ""}">Back</button>
      <button id="ob-next" style="background:purple;color:#ffffff;border:none;padding:8px 20px;border-radius:10px;cursor:pointer;font-weight:600;font-size:0.85rem;box-shadow:0 4px 6px -1px rgba(84,11,158,0.2);">${stepIndex === steps.length - 1 ? "Finish" : "Next"}</button>
    </div>
  `;

  tooltipEl.querySelector("#ob-skip").onclick = endTour;
  tooltipEl.querySelector("#ob-next").onclick = () => {
    currentStep++;
    showStep(currentStep);
  };
  const backBtn = tooltipEl.querySelector("#ob-back");
  if (backBtn) {
    backBtn.onclick = () => {
      currentStep--;
      showStep(currentStep);
    };
  }

  // Dropdown steps shift layout; re-measure once it's painted.
  if (step.keepDropdownOpen) {
    setTimeout(updatePositions, 60);
  }
}

function updatePositions() {
  const step = steps[currentStep];
  if (!step) return;

  let targetEl = null;
  const selectors = step.selector.split(",");
  for (const sel of selectors) {
    const el = document.querySelector(sel.trim());
    if (el && el.getBoundingClientRect().width > 0) {
      targetEl = el;
      break;
    }
  }
  if (!targetEl) return;

  const rect = targetEl.getBoundingClientRect();
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  overlayEl.style.top = `${rect.top + scrollY - 6}px`;
  overlayEl.style.left = `${rect.left + scrollX - 6}px`;
  overlayEl.style.width = `${rect.width + 12}px`;
  overlayEl.style.height = `${rect.height + 12}px`;

  const tooltipWidth = Math.min(320, window.innerWidth - 32);
  let tooltipTop = rect.bottom + scrollY + 12;
  let tooltipLeft = rect.left + scrollX;

  const screenWidth = window.innerWidth;
  if (tooltipLeft + tooltipWidth > screenWidth) {
    tooltipLeft = screenWidth - tooltipWidth - 16;
  }
  if (tooltipLeft < 16) {
    tooltipLeft = 16;
  }

  const spaceBelow = window.innerHeight - rect.bottom;
  if (spaceBelow < 260 && rect.top > 260) {
    tooltipTop = rect.top + scrollY - 220;
  }

  tooltipEl.style.top = `${tooltipTop}px`;
  tooltipEl.style.left = `${tooltipLeft}px`;
}

function endTour() {
  closeAvatarDropdown();
  localStorage.setItem(ONBOARDING_FLAG, "true");
  if (overlayEl) overlayEl.remove();
  if (tooltipEl) tooltipEl.remove();
  window.removeEventListener("resize", resizeHandler);
  window.removeEventListener("scroll", resizeHandler);

  // Small delay so the tour overlay fully disappears before the
  // branded modal slides up.
  setTimeout(() => {
    maybePromptForNotifications({ force: true });
  }, 400);
}

/* ============================================================
   PERMISSION HELPERS
============================================================ */
function normalizePermission(raw) {
  if (raw === true) return "granted";
  if (raw === false) return "denied";
  return raw; // "granted" | "denied" | "default"
}

async function waitForOneSignal(maxMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (
      window.OneSignal &&
      window.OneSignal.Notifications &&
      typeof window.OneSignal.Notifications.requestPermission === "function"
    ) {
      return window.OneSignal;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

/* ============================================================
   COOLDOWN-GATED PROMPT LOGIC
   Called on every dashboard load for users who've finished the tour,
   and also right after the tour ends (with { force: true }).
============================================================ */
async function maybePromptForNotifications({ force = false } = {}) {
  const OneSignal = await waitForOneSignal();
  if (!OneSignal) {
    console.log("[Onboarding] OneSignal not ready — skipping prompt");
    return;
  }

  const current = normalizePermission(OneSignal.Notifications.permission);
  console.log("[Onboarding] Permission state:", current);

  /* ---------- Already granted: verify tag, no prompt ---------- */
  if (current === "granted") {
    await ensureBusinessTag(OneSignal);
    return;
  }

  /* ---------- Denied: show unblock instructions, throttled ---------- */
  if (current === "denied") {
    const lastAttempt = Number(localStorage.getItem(NOTIF_ATTEMPT_KEY) || 0);
    if (force || Date.now() - lastAttempt > COOLDOWN_MS) {
      localStorage.setItem(NOTIF_ATTEMPT_KEY, Date.now().toString());
      showDeniedModal();
    }
    return;
  }

  /* ---------- Default: show branded modal, throttled ---------- */
  if (!force) {
    const lastDismiss = Number(localStorage.getItem(NOTIF_DISMISS_KEY) || 0);
    if (Date.now() - lastDismiss < COOLDOWN_MS) {
      console.log("[Onboarding] Within cooldown window — skipping prompt");
      return;
    }
  }

  createNotificationModal();
}

/* ============================================================
   BRANDED MODAL — mobile bottom sheet
============================================================ */
function createNotificationModal() {
  if (document.getElementById("notification-modal")) return;

  if (!document.getElementById("notification-modal-styles")) {
    const styleSheet = document.createElement("style");
    styleSheet.id = "notification-modal-styles";
    styleSheet.textContent = `
      @keyframes slideUp {
        from { opacity: 0; transform: translateY(30px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes fadeIn {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
      #notification-modal {
        animation: slideUp 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      #notification-modal-backdrop {
        animation: fadeIn 0.25s ease;
      }
    `;
    document.head.appendChild(styleSheet);
  }

  // Backdrop for mobile focus
  const backdrop = document.createElement("div");
  backdrop.id = "notification-modal-backdrop";
  backdrop.style.cssText = `
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.45);
    z-index: 99999;
  `;
  backdrop.addEventListener("click", () => {
    dismissNotificationModal();
  });
  document.body.appendChild(backdrop);

  notificationModalEl = document.createElement("div");
  notificationModalEl.id = "notification-modal";
  notificationModalEl.style.cssText = `
    position: fixed;
    bottom: 0; left: 0; right: 0;
    z-index: 100000;
    background: #ffffff;
    border-top-left-radius: 20px;
    border-top-right-radius: 20px;
    box-shadow: 0 -8px 40px rgba(0,0,0,0.15);
    padding: 24px 20px calc(24px + env(safe-area-inset-bottom, 0px));
    width: 100%;
    max-width: 480px;
    margin: 0 auto;
    box-sizing: border-box;
    font-family: 'Be Vietnam Pro', system-ui, sans-serif;
  `;
  if (window.innerWidth >= 640) {
    // Desktop: centered card, not full-width bottom sheet
    notificationModalEl.style.cssText = `
      position: fixed;
      bottom: 24px; left: 50%; transform: translateX(-50%);
      z-index: 100000;
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.2), 0 8px 24px rgba(0,0,0,0.08);
      padding: 24px;
      width: 380px;
      box-sizing: border-box;
      border: 1px solid rgba(128,0,128,0.15);
      font-family: 'Be Vietnam Pro', system-ui, sans-serif;
    `;
  }

  notificationModalEl.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:14px;">
      <div style="flex-shrink:0;width:44px;height:44px;background:linear-gradient(135deg,#800080,#780578);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 4px 12px rgba(124,58,237,0.3);">
        🔔
      </div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <h4 style="font-weight:700;font-size:1rem;color:#111827;margin:0 0 4px 0;">Stay in the loop</h4>
          <button id="notification-close-btn" aria-label="Close" style="background:none;border:none;color:#9ca3af;cursor:pointer;font-size:1.2rem;padding:0;line-height:1;">✕</button>
        </div>
        <p style="font-size:0.9rem;color:#6b7280;margin:0 0 16px 0;line-height:1.5;">
          Get real-time alerts for new bookings, overdue returns, and low stock.
        </p>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button id="notification-allow-btn" style="width:100%;background:#800080;color:white;border:none;padding:14px;border-radius:12px;font-weight:600;font-size:0.95rem;cursor:pointer;">
            Enable Notifications
          </button>
          <button id="notification-later-btn" style="width:100%;background:#f3f4f6;color:#4b5563;border:none;padding:12px;border-radius:12px;font-weight:500;font-size:0.9rem;cursor:pointer;">
            Maybe Later
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(notificationModalEl);

  document
    .getElementById("notification-allow-btn")
    .addEventListener("click", async () => {
      // Fire the OS prompt directly from the user gesture
      await requestOsPermission();
      dismissNotificationModal();
    });

  document
    .getElementById("notification-later-btn")
    .addEventListener("click", dismissNotificationModal);

  document
    .getElementById("notification-close-btn")
    .addEventListener("click", dismissNotificationModal);
}

function dismissNotificationModal() {
  localStorage.setItem(NOTIF_DISMISS_KEY, Date.now().toString());
  const backdrop = document.getElementById("notification-modal-backdrop");
  if (backdrop) backdrop.remove();
  if (notificationModalEl) {
    notificationModalEl.style.transition = "opacity 0.25s, transform 0.25s";
    notificationModalEl.style.opacity = "0";
    notificationModalEl.style.transform =
      window.innerWidth < 640
        ? "translateY(40px)"
        : "translateX(-50%) translateY(40px)";
    setTimeout(() => {
      if (notificationModalEl) {
        notificationModalEl.remove();
        notificationModalEl = null;
      }
    }, 250);
  }
}

/* ============================================================
   FIRE THE OS PROMPT
============================================================ */
async function requestOsPermission() {
  try {
    const OneSignal = await waitForOneSignal();
    if (!OneSignal) {
      showBrowserNotificationFallback();
      return;
    }

    console.log("[Onboarding] Firing OS-level permission prompt…");
    await OneSignal.Notifications.requestPermission();
    const after = normalizePermission(OneSignal.Notifications.permission);
    console.log("[Onboarding] Permission after prompt:", after);

    if (after === "granted") {
      // Give OneSignal a moment to finish creating the subscription
      await new Promise((r) => setTimeout(r, 1200));
      await ensureBusinessTag(OneSignal);
      console.log("[Onboarding] ✅ Notifications enabled and tagged");
    }
  } catch (err) {
    console.error("[Onboarding] Permission flow error:", err);
    showBrowserNotificationFallback();
  }
}

/* ============================================================
   ENSURE BUSINESS TAG IS APPLIED
============================================================ */
async function ensureBusinessTag(OneSignal) {
  try {
    const sub = OneSignal.User?.PushSubscription;
    if (!sub) return;

    let tags = {};
    try {
      tags = (await OneSignal.User.getTags()) || {};
    } catch {}
    if (tags.businessId) {
      console.log("[Onboarding] Tag already present:", tags.businessId);
      return;
    }

    const { auth } = await import("./firebase.js");
    const { getBusinessIdByEmail } = await import("./shared.js");
    const user = auth.currentUser;
    if (!user) return;

    const businessId = await getBusinessIdByEmail(user.email, user);
    if (!businessId) return;

    await OneSignal.login(user.uid);
    await OneSignal.User.removeTags(["businessId", "role"]);
    await OneSignal.User.addTags({ businessId, role: "member" });
    console.log("[Onboarding] ✅ Tag applied:", businessId);
  } catch (err) {
    console.warn("[Onboarding] ensureBusinessTag failed:", err.message);
  }
}

/* ============================================================
   DENIED MODAL — mobile bottom sheet
============================================================ */
function showDeniedModal() {
  if (document.getElementById("notification-modal-denied")) return;

  const backdrop = document.createElement("div");
  backdrop.id = "notification-modal-backdrop-denied";
  backdrop.style.cssText = `
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.45);
    z-index: 99999;
  `;
  backdrop.addEventListener("click", closeDeniedModal);
  document.body.appendChild(backdrop);

  const el = document.createElement("div");
  el.id = "notification-modal-denied";
  el.style.cssText = `
    position: fixed;
    bottom: 0; left: 0; right: 0;
    z-index: 100000;
    background: #ffffff;
    border-top-left-radius: 20px;
    border-top-right-radius: 20px;
    box-shadow: 0 -8px 40px rgba(0,0,0,0.15);
    padding: 24px 20px calc(24px + env(safe-area-inset-bottom, 0px));
    width: 100%;
    max-width: 480px;
    margin: 0 auto;
    box-sizing: border-box;
    font-family: 'Be Vietnam Pro', system-ui, sans-serif;
    animation: slideUp 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
  `;
  if (window.innerWidth >= 640) {
    el.style.cssText = `
      position: fixed;
      bottom: 24px; left: 50%; transform: translateX(-50%);
      z-index: 100000;
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.2);
      padding: 24px;
      width: 380px;
      box-sizing: border-box;
      border: 1px solid rgba(239,68,68,0.15);
      font-family: 'Be Vietnam Pro', system-ui, sans-serif;
    `;
  }

  el.innerHTML = `
    <div style="display:flex;gap:14px;align-items:flex-start;">
      <div style="flex-shrink:0;width:44px;height:44px;background:#fee2e2;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;">🔕</div>
      <div style="flex:1;min-width:0;">
        <h4 style="font-weight:700;font-size:1rem;color:#111827;margin:0 0 4px 0;">Notifications are blocked</h4>
        <p style="font-size:0.9rem;color:#6b7280;margin:0 0 16px 0;line-height:1.5;">
          To enable them, open your browser or phone settings and allow notifications for Tracknrent.
        </p>
        <button id="notification-denied-ok" style="width:100%;background:#800080;color:white;border:none;padding:14px;border-radius:12px;font-weight:600;font-size:0.95rem;cursor:pointer;">
          Got it
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(el);

  document.getElementById("notification-denied-ok").onclick = closeDeniedModal;
}

function closeDeniedModal() {
  const el = document.getElementById("notification-modal-denied");
  const backdrop = document.getElementById("notification-modal-backdrop-denied");
  if (backdrop) backdrop.remove();
  if (el) {
    el.style.transition = "opacity 0.25s, transform 0.25s";
    el.style.opacity = "0";
    el.style.transform =
      window.innerWidth < 640
        ? "translateY(40px)"
        : "translateX(-50%) translateY(40px)";
    setTimeout(() => el.remove(), 250);
  }
}

/* ============================================================
   FALLBACK — if OneSignal never loads
============================================================ */
function showBrowserNotificationFallback() {
  if (!("Notification" in window)) return;

  if (Notification.permission === "default") {
    Notification.requestPermission().then((p) => {
      if (p === "granted") {
        try {
          new Notification("Tracknrent", {
            body: "You'll now receive booking and inventory alerts.",
            icon: "/favicon.png"
          });
        } catch (e) {
          console.log("[Onboarding] Test notification failed:", e);
        }
      }
    });
  }
}

/* ============================================================
   EXPORT for dashboard.js / other callers
============================================================ */
export async function requestNotificationPermission() {
  return maybePromptForNotifications();
}