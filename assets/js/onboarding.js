// assets/js/onboarding.js

let currentStep = 0;
let overlayEl = null;
let tooltipEl = null;
let resizeHandler = null;
let notificationModalEl = null;

const steps = [
  {
    selector: ".navigation, .mobile-brand, .brand",
    title: "Welcome to Tracknrent! 🚀",
    desc: "Easily manage your rental items, inventory, and event bookings all in one place. Let's show you around!"
  },
  {
    selector: ".cardBox",
    title: "Dashboard Overview 📊",
    desc: "See your total items, active bookings, completed returns, and overdue rentals at a glance."
  },
  {
    selector: '.bookings, a[href="bookings.html"]',
    title: "Bookings Record 📋",
    desc: "Track every order, from newly scheduled rentals to completed returns."
  },
  {
    selector: '.add, a[href="add.html"]',
    title: "New Booking ➕",
    desc: "Create client orders, assign rental gear, generate receipts, and alert your team instantly."
  },
  {
    selector: '.inventory, a[href="inventory.html"]',
    title: "Inventory Catalog 📦",
    desc: "Check real-time stock levels. Available items update automatically to prevent double-booking."
  },
  {
    selector: '.profile, a[href="public.html"]',
    title: "Online Storefront 🌐",
    desc: "Set up your public rental page so prospective clients can browse and reach out."
  },
  {
    selector: "#user-avatar",
    title: "Account & Settings 🤖",
    desc: "Customize settings, invite team members, view reports, or ask the AI Assistant for help."
  }
];

export function startOnboardingTour() {
  if (localStorage.getItem("tracknrent_onboarding_completed") === "true") {
    // Tour already seen, but still offer the notification prompt
    // if the user hasn't granted permission.
    requestNotificationPermission();
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

function createOverlayAndTooltip() {
  // Create Highlight Overlay
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

  // Create Tooltip Card
  tooltipEl = document.getElementById("onboarding-tooltip");
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.id = "onboarding-tooltip";
    tooltipEl.style.position = "absolute";
    tooltipEl.style.zIndex = "99999";
    tooltipEl.style.backgroundColor = "#ffffff";
    tooltipEl.style.color = "#1f2937";
    tooltipEl.style.borderRadius = "16px";
    tooltipEl.style.boxShadow = "0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.1)";
    tooltipEl.style.padding = "20px";
    tooltipEl.style.width = "320px";
    tooltipEl.style.transition = "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)";
    tooltipEl.style.fontFamily = "'Be Vietnam Pro', system-ui, sans-serif";
    document.body.appendChild(tooltipEl);
  }
}

function showStep(stepIndex) {
  const step = steps[stepIndex];
  if (!step) {
    endTour();
    return;
  }

  // Find target element
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
    // If no target element found, point to top-center of body
    overlayEl.style.display = "none";
    tooltipEl.style.top = "50%";
    tooltipEl.style.left = "50%";
    tooltipEl.style.transform = "translate(-50%, -50%)";
    tooltipEl.style.position = "fixed";
  } else {
    overlayEl.style.display = "block";
    tooltipEl.style.transform = "none";
    tooltipEl.style.position = "absolute";
    
    // Smooth scroll to target element
    targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
    
    // Allow scroll to complete before updating positions
    setTimeout(updatePositions, 100);
  }

  // Render tooltip card content
  tooltipEl.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
      <span style="font-size: 0.75rem; font-weight: 700; color: purple; text-transform: uppercase; letter-spacing: 0.05em;">Step ${stepIndex + 1} of ${steps.length}</span>
      <button id="ob-skip" style="background: none; border: none; color: #6b7280; cursor: pointer; font-size: 0.85rem; font-weight: 500; transition: color 0.2s;" onmouseover="this.style.color='purple'" onmouseout="this.style.color='#6b7280'">Skip</button>
    </div>
    <h3 style="font-weight: 700; font-size: 1.15rem; margin-bottom: 8px; color: #111827;">${step.title}</h3>
    <p style="font-size: 0.875rem; color: #4b5563; line-height: 1.6; margin-bottom: 20px;">${step.desc}</p>
    <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
      <button id="ob-back" style="background: #f3f4f6; color: #4b5563; border: none; padding: 8px 16px; border-radius: 10px; cursor: pointer; font-weight: 600; font-size: 0.85rem; transition: background 0.2s; ${stepIndex === 0 ? 'visibility: hidden;' : ''}" onmouseover="this.style.backgroundColor='#e5e7eb'" onmouseout="this.style.backgroundColor='#f3f4f6'">Back</button>
      <button id="ob-next" style="background: purple; color: #ffffff; border: none; padding: 8px 20px; border-radius: 10px; cursor: pointer; font-weight: 600; font-size: 0.85rem; transition: background 0.2s; box-shadow: 0 4px 6px -1px rgba(84, 11, 158, 0.2);" onmouseover="this.style.backgroundColor='#43087e'" onmouseout="this.style.backgroundColor='#540b9e'">${stepIndex === steps.length - 1 ? 'Finish' : 'Next'}</button>
    </div>
  `;

  // Bind Events
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

  // Position highlight box
  overlayEl.style.top = `${rect.top + scrollY - 6}px`;
  overlayEl.style.left = `${rect.left + scrollX - 6}px`;
  overlayEl.style.width = `${rect.width + 12}px`;
  overlayEl.style.height = `${rect.height + 12}px`;

  // Position tooltip
  let tooltipTop = rect.bottom + scrollY + 12;
  let tooltipLeft = rect.left + scrollX;

  const tooltipWidth = 320;
  const screenWidth = window.innerWidth;

  if (tooltipLeft + tooltipWidth > screenWidth) {
    tooltipLeft = screenWidth - tooltipWidth - 20;
  }
  if (tooltipLeft < 10) {
    tooltipLeft = 10;
  }

  // Position above if there isn't enough vertical space below
  const spaceBelow = window.innerHeight - rect.bottom;
  if (spaceBelow < 260 && rect.top > 260) {
    tooltipTop = rect.top + scrollY - 220;
  }

  tooltipEl.style.top = `${tooltipTop}px`;
  tooltipEl.style.left = `${tooltipLeft}px`;
}

function endTour() {
  localStorage.setItem("tracknrent_onboarding_completed", "true");
  if (overlayEl) overlayEl.remove();
  if (tooltipEl) tooltipEl.remove();
  window.removeEventListener("resize", resizeHandler);
  window.removeEventListener("scroll", resizeHandler);

  // Once the tour is done, ask for notification access if it
  // hasn't already been granted.
  requestNotificationPermission();
}

/* ============================================================
   FLOATING NOTIFICATION PERMISSION MODAL
   ============================================================ */
function createNotificationModal() {
  // Remove existing modal if any
  if (notificationModalEl) {
    notificationModalEl.remove();
    notificationModalEl = null;
  }

  // Check if user has already granted permission
  // We'll check inside the request function

  notificationModalEl = document.createElement("div");
  notificationModalEl.id = "notification-modal";
  notificationModalEl.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 100000;
    background: #ffffff;
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2), 0 8px 24px rgba(0, 0, 0, 0.08);
    padding: 24px;
    max-width: 380px;
    width: 100%;
    border: 1px solid rgba(128, 0, 128, 0.15);
    animation: slideUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
    font-family: 'Be Vietnam Pro', system-ui, sans-serif;
  `;

  // Add animation keyframes
  if (!document.getElementById("notification-modal-styles")) {
    const styleSheet = document.createElement("style");
    styleSheet.id = "notification-modal-styles";
    styleSheet.textContent = `
      @keyframes slideUp {
        from {
          opacity: 0;
          transform: translateY(30px) scale(0.95);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
      @keyframes pulse-dot {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.5); opacity: 0.7; }
      }
    `;
    document.head.appendChild(styleSheet);
  }

  notificationModalEl.innerHTML = `
    <div style="display: flex; align-items: flex-start; gap: 14px;">
      <div style="flex-shrink: 0; width: 44px; height: 44px; background: linear-gradient(135deg, #7c3aed, #6d28d9); border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 20px; box-shadow: 0 4px 12px rgba(124, 58, 237, 0.3);">
        🔔
      </div>
      <div style="flex: 1; min-width: 0;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <h4 style="font-weight: 700; font-size: 0.95rem; color: #111827; margin: 0 0 4px 0;">Stay in the loop</h4>
          <button id="notification-close-btn" style="background: none; border: none; color: #9ca3af; cursor: pointer; font-size: 1.1rem; padding: 0 0 0 8px; transition: color 0.2s; line-height: 1;" onmouseover="this.style.color='#6b7280'" onmouseout="this.style.color='#9ca3af'">✕</button>
        </div>
        <p style="font-size: 0.85rem; color: #6b7280; margin: 0 0 14px 0; line-height: 1.5;">
          Get real-time notifications for bookings, returns, and inventory alerts.
        </p>
        <div style="display: flex; gap: 8px;">
          <button id="notification-allow-btn" style="flex: 1; background: #7c3aed; color: white; border: none; padding: 10px 16px; border-radius: 10px; font-weight: 600; font-size: 0.85rem; cursor: pointer; transition: background 0.2s, transform 0.15s;" onmouseover="this.style.backgroundColor='#6d28d9'" onmouseout="this.style.backgroundColor='#7c3aed'" onmousedown="this.style.transform='scale(0.97)'" onmouseup="this.style.transform='scale(1)'">
            Enable Notifications
          </button>
          <button id="notification-later-btn" style="background: #f3f4f6; color: #4b5563; border: none; padding: 10px 14px; border-radius: 10px; font-weight: 500; font-size: 0.85rem; cursor: pointer; transition: background 0.2s; white-space: nowrap;" onmouseover="this.style.backgroundColor='#e5e7eb'" onmouseout="this.style.backgroundColor='#f3f4f6'">
            Later
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(notificationModalEl);

  // Event Listeners
  document.getElementById("notification-allow-btn").addEventListener("click", async () => {
    await requestNotificationPermission();
    // Close modal after attempting permission
    closeNotificationModal();
  });

  document.getElementById("notification-later-btn").addEventListener("click", () => {
    // Dismiss temporarily - will show again later
    closeNotificationModal();
  });

  document.getElementById("notification-close-btn").addEventListener("click", () => {
    // Dismiss temporarily - will show again later (NO permanent dismiss)
    closeNotificationModal();
  });
}

function closeNotificationModal() {
  if (notificationModalEl) {
    notificationModalEl.style.transition = "opacity 0.3s, transform 0.3s";
    notificationModalEl.style.opacity = "0";
    notificationModalEl.style.transform = "translateY(20px) scale(0.95)";
    setTimeout(() => {
      if (notificationModalEl) {
        notificationModalEl.remove();
        notificationModalEl = null;
      }
    }, 300);
  }
}

/* ============================================================
   REQUEST NOTIFICATION PERMISSION
   ============================================================ */
async function requestNotificationPermission() {
  try {
    // Check if OneSignal is available
    if (!window.OneSignal) {
      console.log('[Onboarding] OneSignal not available');
      // Show browser notification fallback
      showBrowserNotificationFallback();
      return false;
    }

    // Check current permission status
    const currentPermission = await window.OneSignal.Notifications.permission;
    
    // If already granted, we're good
    if (currentPermission === 'granted') {
      console.log('[Onboarding] Permission already granted');
      return true;
    }

    // If denied, show a modal explaining how to re-enable
    if (currentPermission === 'denied') {
      console.log('[Onboarding] Permission was previously denied');
      showDeniedNotificationModal();
      return false;
    }

    // If default (not asked yet), show the floating modal
    if (currentPermission === 'default') {
      console.log('[Onboarding] Showing notification modal');
      createNotificationModal();
      return false;
    }

    // Try OneSignal's built-in slidedown as fallback
    const result = await window.OneSignal.Notifications.requestPermission({
      modalOptions: {
        title: "🔔 Stay Updated",
        message: "Get real-time notifications for bookings, returns, and inventory alerts.",
        buttonText: "Allow",
        cancelButtonText: "Not Now"
      }
    });
    
    const permission = await window.OneSignal.Notifications.permission;
    console.log('[Onboarding] Permission after request:', permission);
    
    if (permission === 'granted') {
      const userId = await window.OneSignal.User.getOnesignalId();
      console.log('[Onboarding] User subscribed:', userId);
      return true;
    }
    
    return false;
    
  } catch (error) {
    console.error('[Onboarding] Permission error:', error);
    // Fallback to browser notification
    showBrowserNotificationFallback();
    return false;
  }
}

/* ============================================================
   SHOW DENIED NOTIFICATION MODAL
   ============================================================ */
function showDeniedNotificationModal() {
  // Remove existing modal
  if (notificationModalEl) {
    notificationModalEl.remove();
    notificationModalEl = null;
  }

  notificationModalEl = document.createElement("div");
  notificationModalEl.id = "notification-modal-denied";
  notificationModalEl.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 100000;
    background: #ffffff;
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2), 0 8px 24px rgba(0, 0, 0, 0.08);
    padding: 24px;
    max-width: 380px;
    width: 100%;
    border: 1px solid rgba(239, 68, 68, 0.15);
    animation: slideUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
    font-family: 'Be Vietnam Pro', system-ui, sans-serif;
  `;

  notificationModalEl.innerHTML = `
    <div style="display: flex; align-items: flex-start; gap: 14px;">
      <div style="flex-shrink: 0; width: 44px; height: 44px; background: linear-gradient(135deg, #ef4444, #dc2626); border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 20px; box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);">
        ⚠️
      </div>
      <div style="flex: 1; min-width: 0;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <h4 style="font-weight: 700; font-size: 0.95rem; color: #111827; margin: 0 0 4px 0;">Notifications blocked</h4>
          <button id="notification-denied-close" style="background: none; border: none; color: #9ca3af; cursor: pointer; font-size: 1.1rem; padding: 0 0 0 8px; transition: color 0.2s; line-height: 1;" onmouseover="this.style.color='#6b7280'" onmouseout="this.style.color='#9ca3af'">✕</button>
        </div>
        <p style="font-size: 0.85rem; color: #6b7280; margin: 0 0 14px 0; line-height: 1.5;">
          You've previously blocked notifications. To enable them, please update your browser settings or click the bell icon in your browser's address bar.
        </p>
        <div style="display: flex; gap: 8px;">
          <button id="notification-retry-btn" style="flex: 1; background: #7c3aed; color: white; border: none; padding: 10px 16px; border-radius: 10px; font-weight: 600; font-size: 0.85rem; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.backgroundColor='#6d28d9'" onmouseout="this.style.backgroundColor='#7c3aed'">
            Try Again
          </button>
          <button id="notification-denied-ok" style="background: #f3f4f6; color: #4b5563; border: none; padding: 10px 14px; border-radius: 10px; font-weight: 500; font-size: 0.85rem; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.backgroundColor='#e5e7eb'" onmouseout="this.style.backgroundColor='#f3f4f6'">
            Got it
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(notificationModalEl);

  document.getElementById("notification-denied-close").addEventListener("click", () => {
    closeNotificationModal();
  });

  document.getElementById("notification-denied-ok").addEventListener("click", () => {
    closeNotificationModal();
  });

  document.getElementById("notification-retry-btn").addEventListener("click", async () => {
    // Close this modal and try the permission request again
    closeNotificationModal();
    await requestNotificationPermission();
  });
}

/* ============================================================
   BROWSER NOTIFICATION FALLBACK
   ============================================================ */
function showBrowserNotificationFallback() {
  // Check if browser notifications are supported and not already granted
  if (!("Notification" in window)) {
    console.log('[Onboarding] Browser notifications not supported');
    return;
  }

  if (Notification.permission === "granted") {
    // Already granted, send a test notification
    try {
      new Notification("🔔 Tracknrent Updates", {
        body: "You'll now receive notifications for bookings and inventory updates.",
        icon: "/favicon.png"
      });
    } catch (e) {
      console.log('[Onboarding] Could not send test notification');
    }
    return;
  }

  if (Notification.permission === "default") {
    // Show browser's native permission request
    Notification.requestPermission().then(permission => {
      if (permission === "granted") {
        try {
          new Notification("🔔 Tracknrent Updates", {
            body: "You'll now receive notifications for bookings and inventory updates.",
            icon: "/favicon.png"
          });
        } catch (e) {
          console.log('[Onboarding] Could not send test notification');
        }
      }
    });
  }
}