// assets/js/onboarding.js

let currentStep = 0;
let overlayEl = null;
let tooltipEl = null;
let resizeHandler = null;

const steps = [
  {
    selector: ".mobile-brand, .brand, .navigation",
    title: "Welcome to Tracknrent! 🚀",
    desc: "Tracknrent makes it simple to manage your circular economy event bookings and item inventory in one place. Let's take a quick tour!"
  },
  {
    selector: ".cardBox",
    title: "Real-Time Stats Dashboard 📊",
    desc: "Keep track of your total inventory items, active bookings, returns, and overdue items at a glance."
  }, 
  {
    selector: 'a[href="bookings.html"], .bookings',
    title: "Bookings Record",
    desc: "View all your bookings from active bookings to returned Bookings"
  },
  {
    selector: 'a[href="add.html"], .add',
    title: "Create New Rental Bookings ➕",
    desc: "Create client booking orders, assign rental items, Generate receipts and send instant push alerts to team members."
  },
  {
    selector: 'a[href="inventory.html"], .inventory',
    title: "Live Inventory Catalog 📦",
    desc: "Monitor your equipment inventory. The system auto-updates stock availability during rentals to prevent double-booking shortages."
  },
  {
    selector: 'a[href="public.html"], .profile',
    title: "Your Rental Online Storefront 🌐",
    desc: "Set up your online rental business storefront and get discovered by more customers."
  },
  {
    selector: "#user-avatar",
    title: "Settings, Analytics & AI Assistant 🤖",
    desc: "Manage settings, invite staff, view business analytics, or chat with our AI Assistant to adjust stock counts and fetch booking records."
  }
];
export function startOnboardingTour() {
  if (localStorage.getItem("tracknrent_onboarding_completed") === "true") return;

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
    overlayEl.style.border = "3px solid purple"; // brand purple border!
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
    tooltipTop = rect.top + scrollY - 220; // 220px estimate height
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
}
