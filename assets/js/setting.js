// assets/js/settings.js — FIXED
// ---------------------------------------------------------------------------
// Fixes in this version:
//   1. Only ONE onSnapshot(businessRef) listener (was two competing ones).
//   2. No listener nested inside another listener (was causing leak + dup pushes).
//   3. referralCode generation guarded so listener updates don't loop.
//   4. notifiedAccepted flag set BEFORE push — prevents repeat pushes.
//   5. marketplace/features objects seeded once, guarded.
//   6. ✅ NEW: Self-heal pending invite → accepted on page load. Ensures
//      the partner list and role-based UI are correct even if the primary
//      accept in auth.js was skipped (e.g. user was already signed in
//      when the invite was created).
// ---------------------------------------------------------------------------

import { auth, db } from "./firebase.js";
import { sendPush } from "./onesignal.js";
import { getBusinessIdByEmail } from "./shared.js";

import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  addDoc,
  serverTimestamp,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Shown on the settings page (and used as the starting point in the return
// flow) whenever a business hasn't customized its own return message yet.
// Kept in sync with the identical constant in bookings.js and setup.js.
const DEFAULT_RETURN_MESSAGE_TEMPLATE =
  "Hi {clientName}, thank you for renting with {businessName}! We've received your items back in good condition. We truly appreciate your business and look forward to serving you again soon! 🙏";

// ===== DOM =====
const businessNameInput = document.getElementById("businessName");
const saveBusinessBtn = document.getElementById("saveBusinessName");
const returnMessageInput = document.getElementById("returnMessageTemplate");
const saveReturnMessageBtn = document.getElementById("saveReturnMessageTemplate");
const brandNameMobileEl = document.getElementById("brand-name-mobile");
const topNavBrand = document.getElementById("topnav-brand");

const referralLinkInput = document.getElementById("referralLinkInput");
const copyReferralBtn = document.getElementById("copyReferralBtn");
const referralProgressLabel = document.getElementById("referralProgressLabel");
const referralStatusLabel = document.getElementById("referralStatusLabel");
const referralProgressFill = document.getElementById("referralProgressFill");
const referralUnlockedBadge = document.getElementById("referralUnlockedBadge");
const SITE_URL = "https://tracknrent.vercel.app";

const inviteForm = document.getElementById("invitePartnerForm");
const partnerEmailInput = document.getElementById("partnerEmail");
const partnerRoleInput = document.getElementById("partnerRole");
const partnersList = document.getElementById("partnersList");

const openFeedbackBtn = document.getElementById("openFeedback");
const feedbackModal = document.getElementById("feedbackModal");
const feedbackBusinessName = document.getElementById("feedbackBusinessName");
const feedbackMessage = document.getElementById("feedbackMessage");
const submitFeedbackBtn = document.getElementById("submitFeedback");

const logoutBtn = document.getElementById("logoutBtn");

// Global
let currentRole = "viewer";

/* =========================================================
   UTILITIES
========================================================= */

function showOfflineBanner() {
  if (document.getElementById("offlineBanner")) return;
  const banner = document.createElement("div");
  banner.id = "offlineBanner";
  banner.style.cssText =
    "position: fixed; top: 0; left: 0; right: 0; background: rgba(128, 0, 128, 0.95); backdrop-filter: blur(10px); color: white; text-align: center; padding: 12px; z-index: 99999; font-weight: 500; font-size: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center; gap: 8px;";
  banner.innerHTML = `<span class="material-symbols-outlined" style="font-size: 20px; vertical-align: middle;">wifi_off</span> Offline Mode — Using cached local data`;
  document.body.appendChild(banner);
}

function showErrorBanner(message) {
  if (document.getElementById("errorBanner")) return;
  const banner = document.createElement("div");
  banner.id = "errorBanner";
  banner.style.cssText =
    "position: fixed; top: 0; left: 0; right: 0; background: rgba(220, 38, 38, 0.95); backdrop-filter: blur(10px); color: white; text-align: center; padding: 12px; z-index: 99999; font-weight: 500; font-size: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center; gap: 8px;";
  banner.innerHTML = `<span class="material-symbols-outlined" style="font-size: 20px; vertical-align: middle;">error</span> Error: ${message}. Please refresh or try logging out.`;
  document.body.appendChild(banner);
}

function generateReferralCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function renderReferralProgress(data) {
  const count = data.referralCount || 0;
  const goal = 10;
  const pct = Math.min(100, Math.round((count / goal) * 100));
  const unlocked = !!(data.features && data.features.marketplace);

  if (referralProgressLabel) referralProgressLabel.textContent = `${count} / ${goal} referrals`;
  if (referralProgressFill) referralProgressFill.style.width = pct + "%";
  if (referralStatusLabel) {
    referralStatusLabel.textContent = unlocked
      ? "Marketplace unlocked 🎉"
      : `${Math.max(0, goal - count)} more to unlock Marketplace`;
  }
  if (referralUnlockedBadge) referralUnlockedBadge.style.display = unlocked ? "block" : "none";
}

/* =========================================================
   SELF-HEAL PENDING INVITE
   Runs once on settings page load. If the currently-logged-in
   user's own businessMembers doc is still "pending", flip it to
   "accepted" and link their uid. This is a safety net for the
   case where the primary accept in auth.js was skipped — e.g.
   the user was already signed in when the invite was created,
   so their signup flow never re-ran.
========================================================= */
async function selfHealPendingInvite(user, businessId) {
  try {
    const myEmail = user.email ? user.email.toLowerCase().trim() : null;
    const myPhone = user.phoneNumber
      ? user.phoneNumber.replace(/[\s\-\(\)]/g, "")
      : null;

    // Look up this user's own member doc scoped to the current business
    let mySnap = null;

    if (myEmail) {
      mySnap = await getDocs(
        query(
          collection(db, "businessMembers"),
          where("email", "==", myEmail),
          where("businessId", "==", businessId)
        )
      );
    }

    if ((!mySnap || mySnap.empty) && myPhone) {
      mySnap = await getDocs(
        query(
          collection(db, "businessMembers"),
          where("phone", "==", myPhone),
          where("businessId", "==", businessId)
        )
      );
    }

    if (!mySnap || mySnap.empty) return;

    const myDoc = mySnap.docs[0];
    const myData = myDoc.data();

    if (myData.status !== "pending") return;

    await updateDoc(doc(db, "businessMembers", myDoc.id), {
      status: "accepted",
      uid: user.uid,
      joinedAt: serverTimestamp(),
      notifiedAccepted: false
    });

    console.log("[Settings] Self-healed pending invite → accepted");
  } catch (err) {
    console.warn("[Settings] Self-heal check failed:", err.message);
  }
}

/* =========================================================
   REFERRAL ANALYTICS
========================================================= */

async function loadReferralAnalytics(businessId) {
  try {
    const referralList = document.getElementById("referralList");
    const referralStats = document.getElementById("referralStats");

    if (!referralList) {
      console.warn("Referral list element not found");
      return;
    }

    const refsSnap = await getDocs(
      query(
        collection(db, "referrals"),
        where("referrerBusinessId", "==", businessId),
        orderBy("createdAt", "desc")
      )
    );

    if (referralStats) {
      const total = refsSnap.size;
      const verified = refsSnap.docs.filter((d) => d.data().status === "valid").length;
      const pending = refsSnap.docs.filter((d) => d.data().status === "pending").length;

      referralStats.innerHTML = `
        <div class="grid grid-cols-3 gap-4 mb-4">
          <div class="bg-purple-50 p-3 rounded-xl text-center">
            <div class="text-2xl font-bold text-purple-700">${total}</div>
            <div class="text-xs text-gray-500">Total Referrals</div>
          </div>
          <div class="bg-green-50 p-3 rounded-xl text-center">
            <div class="text-2xl font-bold text-green-700">${verified}</div>
            <div class="text-xs text-gray-500">Active</div>
          </div>
          <div class="bg-yellow-50 p-3 rounded-xl text-center">
            <div class="text-2xl font-bold text-yellow-700">${pending}</div>
            <div class="text-xs text-gray-500">Pending</div>
          </div>
        </div>
      `;
    }

    if (refsSnap.empty) {
      referralList.innerHTML = `
        <div class="text-center py-8 text-gray-400">
          <i class="fas fa-users text-3xl mb-2 block"></i>
          <p>No referrals yet. Share your referral link to grow your network!</p>
        </div>
      `;
      return;
    }

    let html = `<div class="space-y-2">`;

    refsSnap.docs.forEach((docSnap, index) => {
      const ref = docSnap.data();
      const date = ref.createdAt?.toDate?.() || new Date();
      const statusColors = {
        valid: "bg-green-100 text-green-700",
        pending: "bg-yellow-100 text-yellow-700",
        invalid: "bg-red-100 text-red-700"
      };
      const statusText = ref.status || "valid";

      html += `
        <div class="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100 hover:shadow-sm transition">
          <div class="flex items-center gap-3">
            <span class="w-8 h-8 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-xs">
              ${index + 1}
            </span>
            <div>
              <p class="font-semibold text-gray-800 text-sm">
                ${ref.referredBusinessName || "Unnamed Business"}
              </p>
              <p class="text-xs text-gray-400">
                <i class="fas fa-calendar-alt mr-1"></i>
                ${date.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
          </div>
          <span class="px-2 py-1 rounded-full text-[10px] font-bold uppercase ${statusColors[statusText] || "bg-gray-100 text-gray-600"}">
            ${statusText}
          </span>
        </div>
      `;
    });

    html += `</div>`;
    referralList.innerHTML = html;
  } catch (err) {
    console.error("Failed to load referral analytics:", err);
    const referralList = document.getElementById("referralList");
    if (referralList) {
      referralList.innerHTML = `
        <div class="text-center py-4 text-red-400">
          <i class="fas fa-exclamation-circle text-2xl mb-2 block"></i>
          <p class="text-sm">Failed to load referral data. Please refresh.</p>
          <p class="text-xs text-gray-400 mt-2">Error: ${err.message}</p>
        </div>
      `;
    }
  }
}

/* =========================================================
   SHARE REFERRAL LINK (native share sheet)
========================================================= */
document.getElementById("shareReferralBtn")?.addEventListener("click", async () => {
  const input = document.getElementById("referralLinkInput");
  const url = (input?.value || "").trim();

  if (!url) {
    alert("Referral link not ready yet. Please wait a moment and try again.");
    return;
  }

const shareData = {
  title: "Tracknrent — you need to see this",
  text:
    "Omo, I finally found something that fixed my rental business stress 😅\n\n" +
    "You know how we're always writing bookings in a notebook, then one customer is calling, " +
    "another one is asking where their chairs are, and you're just there confused?\n\n" +
    "There's this app called Tracknrent. Bookings, inventory, WhatsApp receipts, payments — " +
    "everything is just there. No more \"who still has my canopy?\" wahala.\n\n" +
    "I've been using it and honestly it's a game changer. Just sign up with my link, " +
    "you'll thank me later 🙏",
  url
};


  try {
    if (navigator.share) {
      await navigator.share(shareData);
    } else {
      await navigator.clipboard.writeText(url);
      alert("Referral link copied. Share it anywhere you like.");
    }
  } catch (err) {
    if (err?.name !== "AbortError") {
      console.warn("Share failed:", err);
      try {
        await navigator.clipboard.writeText(url);
        alert("Couldn't open the share menu — link copied instead.");
      } catch {
        alert("Couldn't share or copy the link. Please copy it manually.");
      }
    }
  }
});

/* =========================================================
   NOTIFICATION PREFERENCES
========================================================= */
function wireNotificationPreferences(user) {
  const notifCheckbox = document.getElementById("toggleNotifications");
  const soundCheckbox = document.getElementById("toggleNotificationSound");
  if (!notifCheckbox || !soundCheckbox) return;

  const userSettingsRef = doc(db, "userSettings", user.email);

  (async () => {
    const snap = await getDoc(userSettingsRef);
    if (snap.exists()) {
      const data = snap.data();
      notifCheckbox.checked = data.notifications ?? true;
      soundCheckbox.checked = data.sound ?? true;
    } else {
      try {
        await updateDoc(userSettingsRef, { notifications: true, sound: true });
      } catch {
        // Doc may not exist — try setDoc fallback silently
      }
      notifCheckbox.checked = true;
      soundCheckbox.checked = true;
    }
  })();

  notifCheckbox.addEventListener("change", async () => {
    try {
      await updateDoc(userSettingsRef, { notifications: notifCheckbox.checked });
    } catch (err) {
      console.error("Error saving notification preference:", err);
    }
  });

  soundCheckbox.addEventListener("change", async () => {
    try {
      await updateDoc(userSettingsRef, { sound: soundCheckbox.checked });
    } catch (err) {
      console.error("Error saving sound preference:", err);
    }
  });
}

/* =========================================================
   PARTNERS (live list + edit/delete)
========================================================= */

let partnersUnsub = null;

function listenToPartners(membersRef, businessId) {
  if (partnersUnsub) partnersUnsub();

  const q = query(membersRef, where("businessId", "==", businessId));
  partnersUnsub = onSnapshot(q, (snap) => {
    if (!partnersList) return;
    partnersList.innerHTML = "";

    if (snap.empty) {
      partnersList.innerHTML = `<p class="text-center py-4 text-gray-400 text-sm">No partners invited yet.</p>`;
      return;
    }

    snap.forEach((docSnap) => {
      const p = docSnap.data();
      const pId = docSnap.id;
      const status = p.status || "accepted";
      const isOwnerRole = currentRole === "owner";

      const identifier = p.email || p.phone || "Unknown Partner";
      const firstChar = identifier.charAt(0).toUpperCase();

      const div = document.createElement("div");
      div.className =
        "p-3 bg-gray-50 border border-gray-200 rounded-xl mb-3 shadow-sm hover:shadow-md transition-shadow";
      div.style.display = "flex";
      div.style.flexWrap = "wrap";
      div.style.alignItems = "center";
      div.style.justifyContent = "space-between";
      div.style.gap = "8px";

      div.innerHTML = `
        <div class="flex items-center gap-3" style="flex: 1 1 200px; min-width: 150px;">
          <div class="w-8 h-8 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-xs uppercase flex-shrink-0">
            ${firstChar}
          </div>
          <div>
            <p class="font-bold text-gray-800 text-sm mb-0 break-words">${identifier}</p>
            <div class="flex items-center gap-2 flex-wrap">
              <span class="px-2 py-[2px] rounded-full text-[10px] font-bold ${
                p.role === "owner"
                  ? "bg-purple-100 text-purple-700"
                  : p.role === "partner"
                  ? "bg-blue-100 text-blue-700"
                  : "bg-gray-100 text-gray-600"
              }">
                ${p.role}
              </span>
              <span class="w-1 h-1 bg-gray-300 rounded-full"></span>
              <span class="${status === "pending" ? "text-yellow-600" : "text-green-600"} text-[10px] font-bold uppercase">${status}</span>
            </div>
          </div>
        </div>
        <div class="flex gap-1 flex-wrap" style="flex: 0 0 auto;">
          ${
            isOwnerRole
              ? `
            <button onclick="editPartner('${pId}', '${p.email || ""}', '${p.phone || ""}', '${p.role}')" 
                    class="p-2 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors">
              <span class="material-symbols-outlined" style="font-size: 20px;">edit</span>
            </button>
            <button onclick="deletePartner('${pId}', '${identifier}')" 
                    class="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors">
              <span class="material-symbols-outlined" style="font-size: 20px;">delete</span>
            </button>
          `
              : `<span class="text-[8px] text-gray-300 font-bold uppercase mr-2 italic">Protected</span>`
          }
        </div>
      `;
      partnersList.appendChild(div);
    });
  });
}

// ===== EDIT PARTNER MODAL =====
let selectedPartnerId = null;
let selectedPartnerEmail = null;

window.editPartner = function (docId, email, phone, role) {
  if (currentRole !== "owner") return;

  selectedPartnerId = docId;
  const identifier = email || phone;

  document.getElementById("editPartnerEmail").value = identifier;
  document.getElementById("editPartnerRole").value = role;
  document.getElementById("editPartnerModal").classList.remove("hidden");
};

document.getElementById("closeEditModal").onclick = () => {
  document.getElementById("editPartnerModal").classList.add("hidden");
};

document.getElementById("editPartnerModal").addEventListener("click", function (e) {
  if (e.target === this) this.classList.add("hidden");
});

document.getElementById("deletePartnerModal").addEventListener("click", function (e) {
  if (e.target === this) this.classList.add("hidden");
});

document.getElementById("savePartnerChanges").onclick = async () => {
  const inputVal = document.getElementById("editPartnerEmail").value.trim();
  const role = document.getElementById("editPartnerRole").value;

  if (!inputVal) return alert("Email or Phone required");

  const isEmail = inputVal.includes("@");
  const updateData = { role };

  if (isEmail) {
    updateData.email = inputVal.toLowerCase();
    updateData.phone = null;
  } else {
    updateData.phone = inputVal.replace(/[\s\-\(\)]/g, "");
    updateData.email = null;
  }

  const currentInviter = auth.currentUser.email || auth.currentUser.phoneNumber || "Owner";

  try {
    await updateDoc(doc(db, "businessMembers", selectedPartnerId), updateData);

    const displayId = inputVal;

    const businessId = await getBusinessIdByEmail(auth.currentUser.email, auth.currentUser);

    await addDoc(collection(db, "businesses", businessId, "notifications"), {
      message: `Team member updated: ${displayId} is now a ${role}`,
      type: "member_updated",
      triggeredBy: currentInviter,
      createdAt: serverTimestamp(),
      readBy: []
    });

    await sendPush(`Team member updated: ${displayId} is now a ${role}`, "/settings.html");

    document.getElementById("editPartnerModal").classList.add("hidden");
  } catch (err) {
    console.error(err);
    alert("Failed to update partner");
  }
};

// ===== DELETE PARTNER =====
window.deletePartner = function (docId, identifier) {
  if (currentRole !== "owner") return;

  selectedPartnerId = docId;
  selectedPartnerEmail = identifier;

  document.getElementById("deletePartnerText").textContent =
    `Are you sure you want to remove ${identifier}?`;

  document.getElementById("deletePartnerModal").classList.remove("hidden");
};

document.getElementById("cancelDeletePartner").onclick = () => {
  document.getElementById("deletePartnerModal").classList.add("hidden");
};

document.getElementById("confirmDeletePartner").onclick = async () => {
  const currentInviter = auth.currentUser.email || auth.currentUser.phoneNumber || "Owner";

  try {
    const businessId = await getBusinessIdByEmail(auth.currentUser.email, auth.currentUser);

    await deleteDoc(doc(db, "businessMembers", selectedPartnerId));

    await addDoc(collection(db, "businesses", businessId, "notifications"), {
      message: `Member Removed: ${selectedPartnerEmail} was removed from the business.`,
      type: "member_removed",
      triggeredBy: currentInviter,
      createdAt: serverTimestamp(),
      readBy: []
    });

    await sendPush(`Member Removed: ${selectedPartnerEmail} was removed from the business.`, "/settings.html");

    document.getElementById("deletePartnerModal").classList.add("hidden");
  } catch (err) {
    console.error(err);
    alert("Delete failed");
  }
};

/* =========================================================
   FEEDBACK MODAL
========================================================= */
if (openFeedbackBtn) openFeedbackBtn.onclick = () => feedbackModal.classList.add("show");
if (feedbackModal)
  feedbackModal.onclick = (e) => {
    if (e.target === feedbackModal) feedbackModal.classList.remove("show");
  };
if (submitFeedbackBtn)
  submitFeedbackBtn.onclick = async () => {
    const message = feedbackMessage.value.trim();
    if (!message) return alert("Enter a message");

    try {
      await addDoc(collection(db, "feedback"), {
        businessName: feedbackBusinessName.value,
        email: auth.currentUser.email,
        message,
        createdAt: serverTimestamp()
      });

      feedbackMessage.value = "";
      feedbackModal.classList.remove("show");
      alert("Feedback sent! ✅");
    } catch (err) {
      console.error("Error saving feedback:", err);
      alert("Failed to send feedback. Try again.");
    }
  };

/* =========================================================
   LOGOUT
========================================================= */
if (logoutBtn)
  logoutBtn.onclick = async () => {
    await signOut(auth);
    window.location.href = "signup.html";
  };

/* =========================================================
   COPY REFERRAL LINK
========================================================= */
if (copyReferralBtn) {
  copyReferralBtn.addEventListener("click", async () => {
    if (!referralLinkInput || !referralLinkInput.value) return;
    try {
      await navigator.clipboard.writeText(referralLinkInput.value);
    } catch {
      referralLinkInput.select();
      document.execCommand("copy");
    }
    copyReferralBtn.textContent = "Copied!";
    setTimeout(() => (copyReferralBtn.textContent = "Copy"), 1500);
  });
}

/* =========================================================
   MAIN AUTH + LIVE DATA
========================================================= */

onAuthStateChanged(auth, async (user) => {
  if (!user) return (window.location.href = "signup.html");

  try {
    const businessId = await getBusinessIdByEmail(user.email, user);
    if (!navigator.onLine) showOfflineBanner();

    const businessRef = doc(db, "businesses", businessId);
    const membersRef = collection(db, "businessMembers");

    // ---- ✅ SELF-HEAL: claim my own pending invite if still pending ----
    // Runs BEFORE resolving role, so the role lookup below sees the
    // freshly-accepted doc.
    await selfHealPendingInvite(user, businessId);

    // ---- Resolve current role ----
    let memberQuery;
    if (user.email) {
      memberQuery = query(membersRef, where("email", "==", user.email.toLowerCase().trim()));
    } else if (user.phoneNumber) {
      memberQuery = query(membersRef, where("phone", "==", user.phoneNumber.trim()));
    }
    const memberSnap = memberQuery ? await getDocs(memberQuery) : { empty: true };
    if (!memberSnap.empty) currentRole = memberSnap.docs[0].data().role;

    // ---- Referral analytics ----
    await loadReferralAnalytics(businessId);

    // ---- Notification preferences ----
    wireNotificationPreferences(user);

    // =====================================================
    // SINGLE business listener — no duplicates, no nesting
    // =====================================================
    let referralCodeInFlight = false;
    let marketplaceSeeded = false;
    let featuresSeeded = false;

    onSnapshot(businessRef, async (docSnap) => {
      if (!docSnap.exists()) return;
      const data = docSnap.data();
      const newName = data.name || "";

      if (businessNameInput) businessNameInput.value = newName;
      if (brandNameMobileEl) brandNameMobileEl.textContent = newName;
      if (feedbackBusinessName) feedbackBusinessName.value = newName;
      if (topNavBrand) topNavBrand.textContent = newName;

      // Pre-fill the return thank-you message template -- only on first
      // render per page load, so it doesn't clobber text the owner is
      // actively typing if this listener fires again mid-edit.
      if (returnMessageInput && !returnMessageInput.dataset.loaded) {
        returnMessageInput.value = data.returnMessageTemplate || DEFAULT_RETURN_MESSAGE_TEMPLATE;
        returnMessageInput.dataset.loaded = "true";
      }

      // Referral code — guarded so listener doesn't loop
      let referralCode = data.referralCode;
      if (!referralCode && !referralCodeInFlight) {
        referralCodeInFlight = true;
        try {
          referralCode = generateReferralCode();
          await updateDoc(businessRef, {
            referralCode,
            referralCodeGeneratedAt: serverTimestamp()
          });
        } catch (err) {
          console.warn("Referral code save failed:", err);
        } finally {
          referralCodeInFlight = false;
        }
      }
      if (referralLinkInput && referralCode) {
        referralLinkInput.value = `${SITE_URL}/signup.html?ref=${referralCode}`;
      }

      // Seed marketplace/features once
      if (!data.marketplace && !marketplaceSeeded) {
        marketplaceSeeded = true;
        try {
          await updateDoc(businessRef, {
            marketplace: {
              visible: false,
              verified: false,
              featured: false,
              highVolume: false,
              trustedPartner: false
            }
          });
        } catch {}
      }
      if (!data.features && !featuresSeeded) {
        featuresSeeded = true;
        try {
          await updateDoc(businessRef, { features: { marketplace: false } });
        } catch {}
      }

      renderReferralProgress(data);

      // Role-based UI lock
      if (currentRole !== "owner") {
        if (businessNameInput) businessNameInput.disabled = true;
        if (saveBusinessBtn) {
          saveBusinessBtn.disabled = true;
          saveBusinessBtn.textContent = "Only owner can edit";
        }
      }
    });

    // =====================================================
    // SINGLE member listener — invite-acceptance push
    // (guarded: flag written BEFORE push so failures don't repeat)
    // =====================================================
    onSnapshot(query(membersRef, where("businessId", "==", businessId)), (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type !== "modified") return;
        const data = change.doc.data();
        if (data.status !== "accepted" || data.notifiedAccepted) return;

        // Set the flag FIRST — if this fails, skip the push entirely.
        try {
          await updateDoc(doc(db, "businessMembers", change.doc.id), { notifiedAccepted: true });
        } catch (err) {
          console.warn("Could not mark accepted:", err);
          return;
        }

        await addDoc(collection(db, "businesses", businessId, "notifications"), {
          message: `Welcome! ${data.email} has accepted the invite and joined the team.`,
          type: "invite_accepted",
          triggeredBy: data.email,
          createdAt: serverTimestamp(),
          readBy: []
        });

        await sendPush(`${data.email} has joined your business!`, "/settings.html");
      });
    });

    // =====================================================
    // Save business name
    // =====================================================
    if (saveBusinessBtn) {
      saveBusinessBtn.addEventListener("click", async () => {
        if (currentRole !== "owner") return alert("Only the owner can change business names.");
        const newName = businessNameInput.value.trim();
        if (!newName) return alert("Business name cannot be empty");

        saveBusinessBtn.disabled = true;
        saveBusinessBtn.textContent = "Saving...";

        await updateDoc(businessRef, { name: newName, updatedAt: serverTimestamp() });

        await addDoc(collection(db, "businesses", businessId, "notifications"), {
          message: `Business name updated to: "${newName}"`,
          type: "settings_change",
          triggeredBy: auth.currentUser.email,
          createdAt: serverTimestamp(),
          readBy: []
        });

        await sendPush(`Business name updated to: "${newName}"`, "/settings.html");

        saveBusinessBtn.textContent = "Saved!";
        setTimeout(() => {
          saveBusinessBtn.textContent = "Save Changes";
          saveBusinessBtn.disabled = false;
        }, 1200);
      });
    }

    // =====================================================
    // Save return thank-you message template
    // =====================================================
    if (saveReturnMessageBtn) {
      saveReturnMessageBtn.addEventListener("click", async () => {
        if (currentRole !== "owner") return alert("Only the owner can change the return message.");
        const newTemplate = (returnMessageInput?.value || "").trim();
        if (!newTemplate) return alert("Return message cannot be empty");

        saveReturnMessageBtn.disabled = true;
        saveReturnMessageBtn.textContent = "Saving...";

        await updateDoc(businessRef, { returnMessageTemplate: newTemplate, updatedAt: serverTimestamp() });

        await addDoc(collection(db, "businesses", businessId, "notifications"), {
          message: `Return thank-you message template was updated`,
          type: "settings_change",
          triggeredBy: auth.currentUser.email,
          createdAt: serverTimestamp(),
          readBy: []
        });

        await sendPush(`Return thank-you message template was updated`, "/settings.html");

        saveReturnMessageBtn.textContent = "Saved!";
        setTimeout(() => {
          saveReturnMessageBtn.textContent = "Save Changes";
          saveReturnMessageBtn.disabled = false;
        }, 1200);
      });
    }

    // =====================================================
    // Invite partner
    // =====================================================
    if (inviteForm) {
      inviteForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const inputVal = partnerEmailInput.value.trim();
        const role = partnerRoleInput.value;
        if (!inputVal) return alert("Enter an email or phone number");

        const isEmail = inputVal.includes("@");
        let email = null;
        let phone = null;
        if (isEmail) email = inputVal.toLowerCase();
        else phone = inputVal.replace(/[\s\-\(\)]/g, "");

        if (!isEmail && phone.length < 5) {
          return alert("Please enter a valid phone number or email address.");
        }

        const currentInviter =
          auth.currentUser.email || auth.currentUser.phoneNumber || "Owner";

        // Already in another business?
        let globalSnap;
        if (isEmail) globalSnap = await getDocs(query(membersRef, where("email", "==", email)));
        else globalSnap = await getDocs(query(membersRef, where("phone", "==", phone)));
        if (!globalSnap.empty && globalSnap.docs[0].data().businessId !== businessId) {
          return alert("User already belongs to another business.");
        }

        // Already in this business?
        let existsSnap;
        if (isEmail)
          existsSnap = await getDocs(
            query(membersRef, where("email", "==", email), where("businessId", "==", businessId))
          );
        else
          existsSnap = await getDocs(
            query(membersRef, where("phone", "==", phone), where("businessId", "==", businessId))
          );
        if (!existsSnap.empty) return alert("User already added.");

        if (role === "owner" && currentRole !== "owner") {
          return alert("Only the business owner can assign another owner.");
        }

        const newMemberDoc = {
          role,
          status: "pending",
          invitedBy: currentInviter,
          businessId,
          notifiedAccepted: false,
          createdAt: serverTimestamp()
        };
        if (isEmail) newMemberDoc.email = email;
        else newMemberDoc.phone = phone;

        await addDoc(membersRef, newMemberDoc);

        const displayId = email || phone;

        await addDoc(collection(db, "businesses", businessId, "notifications"), {
          message: `✉️ Invite Sent: ${displayId} has been invited as a ${role}.`,
          type: "invite_pending",
          triggeredBy: currentInviter,
          createdAt: serverTimestamp(),
          readBy: []
        });

        await sendPush(`Invite Sent: ${displayId} has been invited as a ${role}.`, "/settings.html");

        inviteForm.reset();
        alert(`Invite sent to ${displayId} `);
      });
    }

    // =====================================================
    // Partners live list
    // =====================================================
    listenToPartners(membersRef, businessId);

  } catch (err) {
    console.error(err);
    if (!navigator.onLine || err.message === "OFFLINE_NO_CACHE") {
      showOfflineBanner();
    } else if (err.message === "NO_BUSINESS" || err.message === "Business not found") {
      if (user?.uid) localStorage.removeItem(`businessId_${user.uid}`);
      alert("No business setup found. Redirecting to setup...");
      window.location.href = "setup.html";
    } else {
      if (user?.uid) localStorage.removeItem(`businessId_${user.uid}`);
      showErrorBanner(err.message || err);
    }
  }
});