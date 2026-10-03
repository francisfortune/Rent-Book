// assets/js/setup.js
// assets/js/setup.js
import { auth, db } from "./firebase.js";
import { sendPush } from "./onesignal.js";

import {
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  setDoc,
  updateDoc 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";


/* =========================
   GUARD: ENSURE USER HAS NO BUSINESS
========================= */
async function ensureNoExistingBusiness(user) {
  let businessId = null;
  if (user.email) {
    const emailLower = user.email.toLowerCase().trim();
    const q = query(
      collection(db, "businessMembers"),
      where("email", "==", emailLower)
    );
    let snap = await getDocs(q);
    if (snap.empty && user.email.trim() !== emailLower) {
      const qRaw = query(
        collection(db, "businessMembers"),
        where("email", "==", user.email.trim())
      );
      snap = await getDocs(qRaw);
    }
    if (!snap.empty) {
      businessId = snap.docs[0].data().businessId;
    }
  }
  if (!businessId && user.phoneNumber) {
    const q = query(
      collection(db, "businessMembers"),
      where("phone", "==", user.phoneNumber.trim())
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      businessId = snap.docs[0].data().businessId;
    }
  }

  if (businessId && navigator.onLine) {
    try {
      const bizSnap = await getDoc(doc(db, "businesses", businessId));
      if (bizSnap.exists()) {
        return false;
      }
    } catch (e) {
      console.error("Error verifying existing business doc:", e);
      return false;
    }
  }
  return true;
}

/* =========================
   CREATE INVENTORY
========================= */
async function createInitialInventory(businessId) {
  const inventoryItems = document.querySelectorAll(".inventory-item");

  for (const item of inventoryItems) {
    const name = item.querySelector(".item-name")?.value.trim();
    const qty = Number(item.querySelector(".item-qty")?.value || 0);
    const price = Number(item.querySelector(".item-price")?.value || 0);

    if (!name || qty <= 0) continue;

    await addDoc(collection(db, "inventory"), {
      businessId,
      name,
      quantity: qty,
      price,
      createdAt: serverTimestamp()
    });
  }
}





// Maps the "Business Type" radio (step 1) to a marketplace category so
// the storefront/marketplace card has something sensible to show before
// the owner picks their own service tags in public.html.
function businessTypeToCategory(type) {
  switch (type) {
    case "event": return "Event Rentals";
    case "equipment": return "Equipment";
    case "mixed": return "Mixed Rentals";
    default: return "Equipment";
  }
}

function generateReferralCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// assets/js/setup.js
// ============================================
// FIX: TIERED REFERRAL REWARDS
// ============================================

async function processReferral(user, newBusinessId) {
  try {
    const userSnap = await getDoc(doc(db, "users", user.uid));
    const refCode = userSnap.exists() ? userSnap.data().referredByCode : null;
    if (!refCode) return;

    const q = query(collection(db, "businesses"), where("referralCode", "==", refCode));
    const snap = await getDocs(q);
    if (snap.empty) return;

    const referrerDoc = snap.docs[0];
    if (referrerDoc.id === newBusinessId) return; // no self-referrals

    // Get referrer business data
    const referrerData = referrerDoc.data();
    const referrerBusinessId = referrerDoc.id;

    // Check if this referral already exists
    const existingRefs = await getDocs(query(
      collection(db, "referrals"),
      where("referrerBusinessId", "==", referrerBusinessId),
      where("referredBusinessId", "==", newBusinessId)
    ));
    if (!existingRefs.empty) return; // Already counted

    // Get referred business name
    const referredBizSnap = await getDoc(doc(db, "businesses", newBusinessId));
    const referredBizName = referredBizSnap.exists() ? referredBizSnap.data().name : "New Business";

    // Create referral record
    await addDoc(collection(db, "referrals"), {
      referrerBusinessId: referrerDoc.id,
      referredBusinessId: newBusinessId,
      referredBusinessName: referredBizName,
      referralCode: refCode,
      status: "valid",
      createdAt: serverTimestamp()
    });

    // Calculate new referral count
    const newCount = (referrerData.referralCount || 0) + 1;
    const updates = { referralCount: newCount };

    // ============================================
    // 🏆 TIERED REWARDS SYSTEM
    // Only tier 4 (10 referrals) uses "badge/unlocked" language.
    // Earlier tiers are momentum nudges to push them toward 10.
    // ============================================

    // ─────────────────────────────────────────
    // TIER 1 — first referral: momentum nudge.
    // ─────────────────────────────────────────
    if (newCount >= 1 && !referrerData.marketplace?.verified) {
      updates["marketplace.verified"] = true;
      updates["verification.verifiedAt"] = serverTimestamp();

      const msg = `You just brought your first business to Tracknrent. That's how it starts — now keep going. 9 more and you unlock the Featured spot on the Marketplace.`;
      await addDoc(collection(db, "businesses", referrerBusinessId, "notifications"), {
        message: msg,
        type: "referral_milestone",
        triggeredBy: "Tracknrent",
        createdAt: serverTimestamp(),
        readBy: [],
        deletedFor: []
      });
      await sendPush(msg, "/settings.html");
    }

    // ─────────────────────────────────────────
    // TIER 2 — 3 referrals: reinforce + countdown.
    // ─────────────────────────────────────────
    if (newCount >= 3) {
      updates["marketplace.highVolume"] = true;

      const msg = `3 referrals and counting. Other rental owners are clearly listening to you. ${10 - newCount} more to Featured.`;
      await addDoc(collection(db, "businesses", referrerBusinessId, "notifications"), {
        message: msg,
        type: "referral_milestone",
        triggeredBy: "Tracknrent",
        createdAt: serverTimestamp(),
        readBy: [],
        deletedFor: []
      });
      await sendPush(msg, "/settings.html");
    }

    // ─────────────────────────────────────────
    // TIER 3 — 5 referrals: halfway, social proof.
    // ─────────────────────────────────────────
    if (newCount >= 5) {
      updates["marketplace.trustedPartner"] = true;

      const msg = `Halfway there — ${newCount} businesses joined through you. Your name is already trusted in the rental community. Keep pushing — Featured is ${10 - newCount} away.`;
      await addDoc(collection(db, "businesses", referrerBusinessId, "notifications"), {
        message: msg,
        type: "referral_milestone",
        triggeredBy: "Tracknrent",
        createdAt: serverTimestamp(),
        readBy: [],
        deletedFor: []
      });
      await sendPush(msg, "/settings.html");
    }

    // ─────────────────────────────────────────
    // TIER 4 — 10 referrals: THE badge moment.
    // Only message with "badge / unlocked" language.
    // ─────────────────────────────────────────
    if (newCount >= 10) {
      updates["marketplace.featured"] = true;
      updates["marketplace.verified"] = true;
      updates["features.marketplace"] = true;

      const msg = `🏆 Featured Badge Unlocked. You brought ${newCount} businesses onto Tracknrent. Your business now appears in the Featured row on the Marketplace — where new customers look first. This is the one that matters.`;
      await addDoc(collection(db, "businesses", referrerBusinessId, "notifications"), {
        message: msg,
        type: "referral_milestone",
        triggeredBy: "Tracknrent",
        createdAt: serverTimestamp(),
        readBy: [],
        deletedFor: []
      });
      await sendPush(msg, "/settings.html");
    }

    // ─────────────────────────────────────────
    // AFTER 10 — anniversary kudos, no badge language.
    // ─────────────────────────────────────────
    if (newCount > 10 && newCount % 5 === 0) {
      const msg = `${newCount} referrals now — that's not a fluke, that's a reputation. Thanks for putting Tracknrent in front of the right people.`;
      await addDoc(collection(db, "businesses", referrerBusinessId, "notifications"), {
        message: msg,
        type: "referral_milestone",
        triggeredBy: "Tracknrent",
        createdAt: serverTimestamp(),
        readBy: [],
        deletedFor: []
      });
      await sendPush(msg, "/settings.html");
    }

    // Update the referrer business
    await updateDoc(doc(db, "businesses", referrerDoc.id), updates);

    // Referral analytics tracking
    await addDoc(collection(db, "businesses", referrerBusinessId, "referralAnalytics"), {
      referredBusinessId: newBusinessId,
      referredBusinessName: referredBizName,
      referralCount: newCount,
      milestone: newCount >= 10 ? "featured" : newCount >= 5 ? "trusted" : newCount >= 3 ? "high_volume" : "verified",
      createdAt: serverTimestamp()
    });

    // "Someone joined using your link" — informational, not a milestone.
    const joinedMsg = `${referredBizName} just completed setup using your referral! (${newCount}/10 referrals)`;
    await addDoc(collection(db, "businesses", referrerDoc.id, "notifications"), {
      message: joinedMsg,
      type: "referral",
      triggeredBy: "Tracknrent",
      createdAt: serverTimestamp(),
      readBy: [],
      deletedFor: []
    });
    await sendPush(joinedMsg, "/settings.html");

    // Welcome notification to the referred business (no push — they just signed up, don't spam).
    await addDoc(collection(db, "businesses", newBusinessId, "notifications"), {
      message: `Welcome ${referredBizName}! You were referred by ${referrerData.name || "another Tracknrent business"}. Welcome to the community!`,
      type: "welcome_referral",
      triggeredBy: "Tracknrent",
      createdAt: serverTimestamp(),
      readBy: [],
      deletedFor: []
    });

  } catch (err) {
    console.error("Referral processing failed:", err);
  }
}

/* =========================
   SETUP SUBMIT
========================= */async function handleSetupSubmit(user) {
  const btn = document.getElementById("submit-btn");
  btn.disabled = true;
  btn.textContent = "Setting up...";

  try {
    const businessName = document.getElementById("businessName").value.trim();
    const businessTypeInput = document.querySelector('input[name="businessType"]:checked');
    const businessType = businessTypeInput ? businessTypeInput.value : "equipment";
    const city = (document.getElementById("city")?.value || "").trim();
    const state = (document.getElementById("state")?.value || "").trim();

    // 1️⃣ Create business
    const businessRef = await addDoc(collection(db, "businesses"), {
      name: businessName,
      ownerId: user.uid,
      currency: "NGN",
      // city/state come straight from the setup wizard (step 2) and drive
      // the "· City" line on marketplace cards and the storefront address
      // fallback. `location` is kept as a human-readable combo for any
      // older UI that still reads a single string field.
      city,
      state,
      location: [city, state].filter(Boolean).join(", ") || "Enugu",
      category: businessTypeToCategory(businessType),
      businessType,

  referralCode: generateReferralCode(),   // ← add
  referralCount: 0,                       // ← add
  features: { marketplace: false },       // ← add
  marketplace: { visible: false, featured: false, verified: false }, // ← add
      settings: {
        inventoryEditableByStaff: false
      },
      // Default return thank-you message -- editable anytime from Settings.
      // Kept in sync with the identical constant in setting.js and bookings.js.
      returnMessageTemplate:
        "Hi {clientName}, thank you for renting with {businessName}! We've received your items back in good condition. We truly appreciate your business and look forward to serving you again soon! 🙏",
      createdAt: serverTimestamp()
    });

    await addDoc(collection(db, "businessMembers"), {
      businessId: businessRef.id,
      uid: user.uid,
      email: user.email ? user.email.toLowerCase().trim() : null,
      phone: user.phoneNumber || null,
      role: "owner",
      addedAt: serverTimestamp()
    });

    // Update users/{uid} document with businessId
    await setDoc(doc(db, "users", user.uid), {
      businessId: businessRef.id
    }, { merge: true });

    // 3️⃣ SAVE INVENTORY (NESTED)
    const items = document.querySelectorAll(".inventory-item");

    for (const item of items) {
      const name = item.querySelector(".item-name").value.trim();
      const qty = Number(item.querySelector(".item-qty").value);
      const price =
        Number(item.querySelector(".item-price").value) || 0;

      if (!name || !qty) continue;

      await addDoc(
        collection(db, "businesses", businessRef.id, "inventory"),
        {
          name,
          totalQuantity: qty,
          availableQuantity: qty,
          price,
          createdAt: serverTimestamp()
        }
      );
    }

    // ✅ ADD THIS LINE HERE (Right before redirect)
    await sendWelcomeNotification(businessRef.id, businessName);
    await processReferral(user, businessRef.id);

    window.location.href = "dashboard.html";

  } catch (err) {
    console.error("Setup failed:", err);
    alert("Setup failed. Check Firestore rules.");
    btn.disabled = false;
    btn.textContent = "Complete Setup";
  }
}

/* =========================
   AUTH GUARD
========================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "signup.html";
    return;
  }

  const allowed = await ensureNoExistingBusiness(user);

  if (!allowed) {
    window.location.href = "dashboard.html";
    return;
  }

  const form = document.getElementById("setupForm");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      handleSetupSubmit(user);
    });
  }
});
/* =========================
   WELCOME NOTIFICATION
========================= */
async function sendWelcomeNotification(businessId, businessName) {
  try {
    await addDoc(collection(db, "businesses", businessId, "notifications"), {
      message: `Welcome ${businessName}! To get started, go to the Inventory tab to manage your items, or use the Bookings tab to schedule your first client event. We're here to help you grow!`,
      type: "welcome",
      triggeredBy: "Tracknrent",
      createdAt: serverTimestamp(),
      readBy: [],
      deletedFor: []
    });
  } catch (err) {
    console.error("Welcome notification failed:", err);
  }
}