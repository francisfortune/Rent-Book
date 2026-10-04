// assets/js/history.js
// ============================================================================
// Full-page notification history.
//
// Difference from the dashboard dropdown:
//   • Loads up to 200 at a time (with "Load older" pagination)
//   • Filters by read/unread + free-text search
//   • "Clear All" clears only what's currently loaded, per-user only
//
// Read/delete/redirect behavior is IDENTICAL to the dropdown because both
// import from notification-helpers.js.
// ============================================================================

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getBusinessIdByEmail } from "./shared.js";
import {
  collection,
  query,
  orderBy,
  limit,
  startAfter,
  getDocs,
  doc,
  updateDoc,
  arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  markNotificationReadAndRedirect,
  deleteNotificationForMe
} from "./notification-helpers.js";

const PAGE_SIZE = 200;

let businessId = null;
let currentUser = null;
let loadedNotifications = [];
let lastDocSnapshot = null;
let hasMore = true;
let isLoadingMore = false;

/* ============================================================
   HELPERS
============================================================ */
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}

function iconForType(type) {
  const t = String(type || "").toLowerCase();
  if (t.includes("booking")) return "calendar_today";
  if (t === "add") return "add_circle";
  if (t === "welcome" || t === "welcome_message") return "auto_awesome";
  if (t === "inventory_damage") return "report";
  if (t.startsWith("inventory")) return "inventory_2";
  if (t.startsWith("rental")) return "swap_horiz";
  if (t.includes("overdue")) return "error";
  if (t.includes("return")) return "task_alt";
  return "notifications";
}

function formatStamp(ts) {
  if (!ts) return "";
  const d = ts?.toDate?.() ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-NG", {
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true
  });
}

function showToast(message, ms = 3000) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("show"), ms);
}

/* ============================================================
   RENDER
============================================================ */
function renderList() {
  const container = document.getElementById("notifList");
  const filter = document.getElementById("filterRead").value;
  const search = (document.getElementById("searchInput").value || "").toLowerCase().trim();

  const visible = loadedNotifications.filter(n => {
    const isRead = (n.readBy || []).includes(currentUser?.uid);
    if (filter === "read" && !isRead) return false;
    if (filter === "unread" && isRead) return false;
    if (search) {
      const hay = `${n.message || ""} ${n.type || ""} ${n.triggeredBy || ""}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  if (!visible.length) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-outlined">notifications_off</span>
        ${loadedNotifications.length ? "No notifications match your filters" : "No notifications yet"}
      </div>`;
    return;
  }

  container.innerHTML = visible.map(n => {
    const isRead = (n.readBy || []).includes(currentUser?.uid);
    const tickIcon = isRead
      ? `<span class="material-symbols-outlined notif-tick read-tick">done_all</span>`
      : `<span class="material-symbols-outlined notif-tick unread-tick">check</span>`;

    const safeMsg = escapeHtml(n.message || "(no message)");
    const safeBy = escapeHtml(n.triggeredBy || "System");
    const safeType = escapeHtml(n.type || "");

    return `
      <div class="notif-card ${isRead ? "read" : "unread"}">
        <div class="notif-icon">
          <span class="material-symbols-outlined">${iconForType(n.type)}</span>
        </div>

        <div class="notif-body"
             data-action="open"
             data-id="${n.id}"
             data-type="${safeType}"
             data-booking="${escapeHtml(n.bookingId || "")}">
          <p class="notif-msg">${safeMsg}</p>
          <div class="notif-meta">
            <span>${formatStamp(n.createdAt)}</span>
            <span class="by">By: ${safeBy}</span>
          </div>
        </div>

        <div class="notif-actions">
          ${tickIcon}
          <button class="notif-delete"
                  data-action="delete"
                  data-id="${n.id}"
                  title="Delete">✖</button>
        </div>
      </div>`;
  }).join("");

  container.querySelectorAll("[data-action]").forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = el.dataset.action;
      const id = el.dataset.id;
      if (action === "open") {
        const type = el.dataset.type;
        const bookingId = el.dataset.booking;
        markNotificationReadAndRedirect(businessId, id, type, bookingId);
      } else if (action === "delete") {
        deleteNotificationForMe(businessId, id).then(() => {
          loadedNotifications = loadedNotifications.filter(x => x.id !== id);
          renderList();
          updateClearAllButton();
          showToast("Notification removed for you");
        });
      }
    });
  });
}

function updateClearAllButton() {
  const btn = document.getElementById("clearAllBtn");
  if (!btn) return;
  const count = loadedNotifications.length;
  if (count === 0) {
    btn.disabled = true;
    btn.innerHTML = `<span class="material-symbols-outlined">delete_sweep</span> Clear All`;
  } else {
    btn.disabled = false;
    btn.innerHTML = `<span class="material-symbols-outlined">delete_sweep</span> Clear All (${count})`;
  }
}

/* ============================================================
   LOADING
============================================================ */
async function loadInitial() {
  const ref = collection(db, "businesses", businessId, "notifications");
  const q = query(ref, orderBy("createdAt", "desc"), limit(PAGE_SIZE));
  const snap = await getDocs(q);

  loadedNotifications = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(n => !(n.deletedFor || []).includes(currentUser.uid));

  lastDocSnapshot = snap.docs[snap.docs.length - 1] || null;
  hasMore = snap.docs.length === PAGE_SIZE;

  renderList();
  updateClearAllButton();
  updateLoadMoreVisibility();
}

async function loadMore() {
  if (isLoadingMore || !hasMore || !lastDocSnapshot) return;
  isLoadingMore = true;
  const btn = document.getElementById("loadMoreBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Loading..."; }

  try {
    const ref = collection(db, "businesses", businessId, "notifications");
    const q = query(ref, orderBy("createdAt", "desc"), startAfter(lastDocSnapshot), limit(PAGE_SIZE));
    const snap = await getDocs(q);

    const fresh = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(n => !(n.deletedFor || []).includes(currentUser.uid));

    loadedNotifications = loadedNotifications.concat(fresh);
    lastDocSnapshot = snap.docs[snap.docs.length - 1] || lastDocSnapshot;
    hasMore = snap.docs.length === PAGE_SIZE;

    renderList();
    updateClearAllButton();
    updateLoadMoreVisibility();
  } catch (err) {
    console.error("Load more failed:", err);
    showToast("Couldn't load older notifications");
  } finally {
    isLoadingMore = false;
    if (btn) { btn.disabled = false; btn.textContent = "Load older notifications"; }
  }
}

function updateLoadMoreVisibility() {
  const wrap = document.getElementById("loadMoreWrap");
  if (!wrap) return;
  wrap.style.display = hasMore ? "flex" : "none";
}

/* ============================================================
   CLEAR ALL (only what's loaded)
============================================================ */
async function clearAll() {
  if (!loadedNotifications.length) return;

  const count = loadedNotifications.length;
  const ok = confirm(
    `Clear ${count} notification${count === 1 ? "" : "s"} from your view?\n\n` +
    `This only affects YOUR account. Other team members will still see them.`
  );
  if (!ok) return;

  const btn = document.getElementById("clearAllBtn");
  btn.disabled = true;
  btn.innerHTML = `<span class="material-symbols-outlined">hourglass_empty</span> Clearing...`;

  // Batch in parallel groups of 20 to keep it fast but not flood Firestore.
  const BATCH = 20;
  const items = [...loadedNotifications];

  try {
    for (let i = 0; i < items.length; i += BATCH) {
      const slice = items.slice(i, i + BATCH);
      await Promise.all(slice.map(n =>
        updateDoc(doc(db, "businesses", businessId, "notifications", n.id), {
          deletedFor: arrayUnion(currentUser.uid)
        }).catch(err => console.warn("Clear failed for", n.id, err))
      ));
    }

    loadedNotifications = [];
    renderList();
    updateClearAllButton();

    if (hasMore) {
      showToast(`Cleared the ${count} you can see. Load older notifications to clear more.`, 5000);
    } else {
      showToast(`Cleared all ${count} notification${count === 1 ? "" : "s"}.`, 3000);
    }
  } catch (err) {
    console.error("Clear all failed:", err);
    showToast("Couldn't clear all — please try again");
  } finally {
    updateClearAllButton();
  }
}

/* ============================================================
   BOOT
============================================================ */
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "signup.html"; return; }
  currentUser = user;

  try {
    businessId = await getBusinessIdByEmail(user.email, user);
  } catch (err) {
    console.error("Auth error:", err);
    return;
  }

  // Brand name
  try {
    const { getDoc, doc: docRef } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    const snap = await getDoc(docRef(db, "businesses", businessId));
    if (snap.exists()) {
      const name = snap.data().name || "Tracknrent";
      const el1 = document.getElementById("brand-name-mobile");
      const el2 = document.getElementById("brand-name-mobile-2");
      if (el1) el1.textContent = name;
      if (el2) el2.textContent = name;
    }
  } catch {}

  await loadInitial();

  document.getElementById("filterRead").addEventListener("change", renderList);
  document.getElementById("searchInput").addEventListener("input", renderList);
  document.getElementById("clearAllBtn").addEventListener("click", clearAll);
  document.getElementById("loadMoreBtn").addEventListener("click", loadMore);
});