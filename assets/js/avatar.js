// assets/js/avatar.js
import { auth, db } from "./firebase.js";
import { getBusinessIdByEmail } from "./shared.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const BRAND = "#800080";
const BRAND_HOVER_BG = "#f3e8ff";

/**
 * Which dropdown item should be "active" — based on the current page's
 * filename. Returns null if the current page isn't in the menu.
 */
function getActiveDropdownKey() {
  const path = window.location.pathname.toLowerCase();
  if (path.endsWith("dashboard.html") || path === "/" || path.endsWith("index.html")) return "dashboard";
  if (path.endsWith("analytics.html")) return "analytics";
  if (path.endsWith("settings.html")) return "settings";
  if (path.endsWith("public.html")) return "public";
  if (path.endsWith("ai-assistant.html")) return "ai";
  return null;
}

/**
 * Build one dropdown row (anchor). Handles hover + active styling in
 * one place so every row behaves identically.
 */
function dropdownRow({ key, href, icon, label, activeKey }) {
  const isActive = key === activeKey;

  const baseStyle = `
    display: flex;
    align-items: center;
    padding: 10px 16px;
    font-size: 0.875rem;
    text-decoration: none;
    transition: background 0.2s, color 0.2s;
    border-left: 3px solid transparent;
    color: #374151;
    background: transparent;
  `;

  const activeStyle = `
    color: ${BRAND};
    background: ${BRAND_HOVER_BG};
    font-weight: 700;
    border-left: 3px solid ${BRAND};
  `;

  return `
    <a href="${href}"
       data-dropdown-key="${key}"
       style="${isActive ? activeStyle : baseStyle}"
       onmouseover="this.style.backgroundColor='${BRAND_HOVER_BG}'; this.style.color='${BRAND}';"
       onmouseout="if(!this.dataset.active){this.style.backgroundColor='transparent'; this.style.color='#374151';}">
      <span class="material-symbols-outlined" style="margin-right: 12px; font-size: 1.25rem;">${icon}</span>
      ${label}
    </a>`;
}

async function initAvatarAndDropdown() {
  const avatarEl = document.getElementById("user-avatar");
  if (!avatarEl) return;

  // 1. Ensure the parent of avatar has relative styling so dropdown is positioned correctly
  const parent = avatarEl.parentElement;
  const isWrapped = parent && parent.classList.contains("user");
  const relativeContainer = isWrapped ? parent.parentElement : parent;
  if (relativeContainer) {
    relativeContainer.style.position = "relative";
  }

  // 2. Create the dropdown element if it doesn't exist
  let dropdownEl = document.getElementById("user-dropdown");
  if (!dropdownEl) {
    const activeKey = getActiveDropdownKey();

    dropdownEl = document.createElement("div");
    dropdownEl.id = "user-dropdown";
    dropdownEl.className = "hidden absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-100 z-50 overflow-hidden transform origin-top-right transition-all";

    // Inline fallback styling (works even if Tailwind is delayed)
    dropdownEl.style.position = "absolute";
    dropdownEl.style.right = "0";
    dropdownEl.style.paddingTop = "40px";
    dropdownEl.style.width = "200px";
    dropdownEl.style.backgroundColor = "#ffffff";
    dropdownEl.style.borderRadius = "12px";
    dropdownEl.style.boxShadow = "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)";
    dropdownEl.style.border = "1px solid #f1f5f9";
    dropdownEl.style.zIndex = "999";
    dropdownEl.style.overflow = "hidden";
    dropdownEl.style.display = "none"; // starts closed; toggled by click handler

    dropdownEl.innerHTML = `
      <div style="padding: 4px 0;">
        ${dropdownRow({ key: "dashboard", href: "dashboard.html", icon: "home", label: "Dashboard", activeKey })}
       ${dropdownRow({ key: "ai", href: "ai-assistant.html", icon: "chat", label: "AI Assistant", activeKey })}

        ${dropdownRow({ key: "analytics", href: "analytics.html", icon: "bar_chart", label: "Analytics", activeKey })}
        ${dropdownRow({ key: "public", href: "public.html", icon: "public", label: "Public Profile", activeKey })}
                ${dropdownRow({ key: "settings", href: "settings.html", icon: "settings", label: "Settings", activeKey })}

        <div style="height: 1px; background-color: #f1f5f9; margin: 4px 0;"></div>

        <button id="logoutBtn" style="width: 100%; display: flex; align-items: center; padding: 10px 16px; font-size: 0.875rem; color: #e71a1a; border: none; background: transparent; text-align: left; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.backgroundColor='#fef2f2';" onmouseout="this.style.backgroundColor='transparent';">
          <span class="material-symbols-outlined" style="margin-right: 12px; font-size: 1.25rem;">logout</span>
          Logout
        </button>
      </div>
    `;

    // Mark the active row so onmouseout knows not to reset it
    const activeRow = dropdownEl.querySelector(`a[data-dropdown-key="${activeKey}"]`);
    if (activeRow) activeRow.dataset.active = "true";

    if (isWrapped) {
      parent.after(dropdownEl);
    } else {
      avatarEl.after(dropdownEl);
    }
  }

  // 3. Handle click event on avatar
  avatarEl.addEventListener("click", (e) => {
    e.stopPropagation();

    // Close other modals if any (e.g. notifModal on dashboard)
    const notifModal = document.getElementById("notifModal");
    if (notifModal) notifModal.style.display = "none";

    if (dropdownEl.classList.contains("hidden")) {
      dropdownEl.classList.remove("hidden");
      dropdownEl.style.display = "block";
    } else {
      dropdownEl.classList.add("hidden");
      dropdownEl.style.display = "none";
    }
  });

  // 4. Close dropdown on click outside
  window.addEventListener("click", (e) => {
    if (dropdownEl && !dropdownEl.contains(e.target) && e.target !== avatarEl) {
      dropdownEl.classList.add("hidden");
      dropdownEl.style.display = "none";
    }
  });

  // 5. Handle Logout
  const logoutBtn = dropdownEl.querySelector("#logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        await signOut(auth);
        window.location.href = "signup.html";
      } catch (err) {
        console.error("Signout error:", err);
      }
    });
  }

  // 6. Auth State to set avatar letter and handle redirection
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      const pathname = window.location.pathname;
      if (!pathname.includes("signup.html") &&
          !pathname.includes("log-in.html") &&
          !pathname.includes("profile.html") &&
          !pathname.includes("terms.html") &&
          !pathname.includes("reset.html") &&
          !pathname.includes("offline.html") &&
          pathname !== "/" &&
          !pathname.endsWith("index.html")) {
        window.location.href = "signup.html";
      }
      return;
    }

    try {
      const businessId = await getBusinessIdByEmail(user.email, user).catch(() => null);
      if (!businessId) return;

      const businessSnap = await getDoc(doc(db, "businesses", businessId));
      if (!businessSnap.exists()) return;

      const business = businessSnap.data();
      avatarEl.textContent = business.name.charAt(0).toUpperCase();
    } catch (err) {
      console.error("Error setting avatar name:", err);
    }
  });
}

// Run on load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAvatarAndDropdown);
} else {
  initAvatarAndDropdown();
}