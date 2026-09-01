// assets/js/settings.js
import { auth, db } from "./firebase.js";
import { sendPush } from "./onesignal.js";
import { getBusinessIdByEmail } from "./shared.js";



import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc, // Added for deleting partners
  collection,
  getDocs,
  query,
  where,
  addDoc,
  serverTimestamp,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ===== DOM =====
const businessNameInput = document.getElementById("businessName");
const saveBusinessBtn = document.getElementById("saveBusinessName");
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

// Global variable to hold user role for conditional UI
let currentRole = "viewer"; 

// ===== UTILS =====





function showOfflineBanner() {
  if (document.getElementById("offlineBanner")) return;
  const banner = document.createElement("div");
  banner.id = "offlineBanner";
  banner.style.cssText = "position: fixed; top: 0; left: 0; right: 0; background: rgba(128, 0, 128, 0.95); backdrop-filter: blur(10px); color: white; text-align: center; padding: 12px; z-index: 99999; font-weight: 500; font-size: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center; gap: 8px;";
  banner.innerHTML = `<span class="material-symbols-outlined" style="font-size: 20px; vertical-align: middle;">wifi_off</span> Offline Mode — Using cached local data`;
  document.body.appendChild(banner);
}

function showErrorBanner(message) {
  if (document.getElementById("errorBanner")) return;
  const banner = document.createElement("div");
  banner.id = "errorBanner";
  banner.style.cssText = "position: fixed; top: 0; left: 0; right: 0; background: rgba(220, 38, 38, 0.95); backdrop-filter: blur(10px); color: white; text-align: center; padding: 12px; z-index: 99999; font-weight: 500; font-size: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center; gap: 8px;";
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




// ===== AUTH GUARD =====
onAuthStateChanged(auth, async (user) => {
  if (!user) return window.location.href = "signup.html";

  try {
    const businessId = await getBusinessIdByEmail(user.email, user);
    if (!navigator.onLine) {
      showOfflineBanner();
    }
    const businessRef = doc(db, "businesses", businessId);
    const membersRef = collection(db, "businessMembers");

    let memberQuery;
    if (user.email) {
      memberQuery = query(membersRef, where("email", "==", user.email.toLowerCase().trim()));
    } else if (user.phoneNumber) {
      memberQuery = query(membersRef, where("phone", "==", user.phoneNumber.trim()));
    }
    const memberSnap = memberQuery ? await getDocs(memberQuery) : { empty: true };
    if (!memberSnap.empty) {
      currentRole = memberSnap.docs[0].data().role;
    }

// ✅ TRIGGER 1: WATCH FOR ACCEPTANCE
onSnapshot(query(membersRef, where("businessId", "==", businessId)), (snapshot) => {
  snapshot.docChanges().forEach(async (change) => {
    if (change.type === "modified") {
      const data = change.doc.data();
      // Only fire if they just accepted and we haven't sent the 'Join' alert yet
      if (data.status === "accepted" && !data.notifiedAccepted) {
        await addDoc(collection(db, "businesses", businessId, "notifications"), {
          message: `🎉 Welcome! ${data.email} has accepted the invite and joined the team.`,
          type: "invite_accepted",
          triggeredBy: data.email,
          createdAt: serverTimestamp(),
          readBy: []
        });


        // onesignal push notification
        await sendPush(`🎉 ${data.email} has joined your business!`, "/settings.html");

        


        
        // Flag it so it doesn't notify again if you change their role later
        await updateDoc(doc(db, "businessMembers", change.doc.id), { notifiedAccepted: true });
      }
    }
  });
});
    
    // ===== 2. LIVE BUSINESS NAME UPDATE =====
  onSnapshot(businessRef, async (docSnap) => {
  if (!docSnap.exists()) return;
  const data = docSnap.data();
  const newName = data.name || "";
  if (businessNameInput) businessNameInput.value = newName;
  if (brandNameMobileEl) brandNameMobileEl.textContent = newName;
  if (feedbackBusinessName) feedbackBusinessName.value = newName;
  if (topNavBrand) topNavBrand.textContent = newName;

  // ===== REFERRAL PROGRAM =====
  let referralCode = data.referralCode;
  if (!referralCode) {
    referralCode = generateReferralCode();
    try {
      await updateDoc(businessRef, { referralCode });
    } catch (err) {
      console.error("Failed to save referral code:", err);
    }
  }
  if (referralLinkInput) {
   referralLinkInput.value = `${SITE_URL}/signup.html?ref=${referralCode}`;
  }
  renderReferralProgress(data);
});



// ===== SEND NEW MEMBER NOTIFICATION =====
async function sendNewMemberNotification(businessId, newUserEmail) {
  try {
    const notifRef = collection(db, "businesses", businessId, "notifications");
    
    await addDoc(notifRef, {
      message: `🤝 New Team Member: ${newUserEmail} has joined the business!`,
      type: "member_joined",
      triggeredBy: auth.currentUser.email, // Shows who invited them
      createdAt: serverTimestamp(),
      readBy: [],
      deletedFor: []
    });
  } catch (err) {
    console.error("Member notification failed:", err);
  }
}


// ===== 8. NOTIFICATION PREFERENCES =====
const notifCheckbox = document.getElementById("toggleNotifications");
const soundCheckbox = document.getElementById("toggleNotificationSound");

if (notifCheckbox && soundCheckbox) {
  const userSettingsRef = doc(db, "userSettings", user.email); // Firestore collection for user preferences

  // Load preferences
  const loadPrefs = async () => {
    const snap = await getDoc(userSettingsRef);
    if (snap.exists()) {
      const data = snap.data();
      notifCheckbox.checked = data.notifications ?? true; // default true
      soundCheckbox.checked = data.sound ?? true; // default true
    } else {
      // Default preferences if none exist
      await updateDoc(userSettingsRef, { notifications: true, sound: true }).catch(() => {});
      notifCheckbox.checked = true;
      soundCheckbox.checked = true;
    }
  };

  loadPrefs();

  // Save on change
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

    // ===== 3. OWNER UI LOCKS =====
    if (currentRole !== "owner") {
      if (businessNameInput) businessNameInput.disabled = true;
      if (saveBusinessBtn) {
        saveBusinessBtn.disabled = true;
        saveBusinessBtn.textContent = "Only owner can edit";
      }
    }

    // ===== 4. SAVE BUSINESS NAME =====
    if (saveBusinessBtn) {
      saveBusinessBtn.addEventListener("click", async () => {
        if (currentRole !== "owner") return alert("Only the owner can change business names.");
        const newName = businessNameInput.value.trim();
        if (!newName) return alert("Business name cannot be empty");

        saveBusinessBtn.disabled = true;
        saveBusinessBtn.textContent = "Saving...";
        await updateDoc(businessRef, { name: newName, updatedAt: serverTimestamp() });

        // 🔔 TRIGGER NOTIFICATION
    await addDoc(collection(db, "businesses", businessId, "notifications"), {
      message: `📝 Business name updated to: "${newName}"`,
      type: "settings_change",
      triggeredBy: auth.currentUser.email,
      createdAt: serverTimestamp(),
      readBy: []
    });

    // onesignal push notification
    await sendPush(`Business name updated to: "${newName}"`, "/settings.html");



        saveBusinessBtn.textContent = "Saved!";
        setTimeout(() => {
          saveBusinessBtn.textContent = "Save Changes";
          saveBusinessBtn.disabled = false;
        }, 1200);
      });
    }

    // ===== 5. INVITE PARTNER (ANYONE CAN// ===== 5. INVITE PARTNER =====
if (inviteForm) {
  inviteForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const inputVal = partnerEmailInput.value.trim();
    const role = partnerRoleInput.value;
    if (!inputVal) return alert("Enter an email or phone number");

    const isEmail = inputVal.includes("@");
    let email = null;
    let phone = null;

    if (isEmail) {
      email = inputVal.toLowerCase();
    } else {
      phone = inputVal.replace(/[\s\-\(\)]/g, "");
      if (phone.length < 5) {
        return alert("Please enter a valid phone number or email address.");
      }
    }

    const currentInviter = auth.currentUser.email || auth.currentUser.phoneNumber || "Owner";

    // Prevent user joining another business
    let globalSnap;
    if (isEmail) {
      globalSnap = await getDocs(query(membersRef, where("email", "==", email)));
    } else {
      globalSnap = await getDocs(query(membersRef, where("phone", "==", phone)));
    }
    
    if (!globalSnap.empty) {
      const existing = globalSnap.docs[0].data();
      if (existing.businessId !== businessId) {
        return alert("User already belongs to another business.");
      }
    }

    // Prevent duplicate in same business
    let existsSnap;
    if (isEmail) {
      existsSnap = await getDocs(query(
        membersRef,
        where("email", "==", email),
        where("businessId", "==", businessId)
      ));
    } else {
      existsSnap = await getDocs(query(
        membersRef,
        where("phone", "==", phone),
        where("businessId", "==", businessId)
      ));
    }

    if (!existsSnap.empty) {
      return alert("User already added.");
    }

    // Add partner doc
    const newMemberDoc = {
      role,
      status: "pending",
      invitedBy: currentInviter,
      businessId,
      notifiedAccepted: false,
      createdAt: serverTimestamp()
    };
    if (isEmail) {
      newMemberDoc.email = email;
    } else {
      newMemberDoc.phone = phone;
    }
    
    await addDoc(membersRef, newMemberDoc);

    const displayId = email || phone;

    // ✅ TRIGGER 2: NOTIFICATION FOR INVITE SENT
    await addDoc(collection(db, "businesses", businessId, "notifications"), {
      message: `✉️ Invite Sent: ${displayId} has been invited as a ${role}.`,
      type: "invite_pending",
      triggeredBy: currentInviter,
      createdAt: serverTimestamp(),
      readBy: []
    });

    // onesignal push notification
    await sendPush(`✉️ Invite Sent: ${displayId} has been invited as a ${role}.`, "/settings.html");

    inviteForm.reset();
    alert(`Invite sent to ${displayId} ✅`);
  });
}

// ===== 6. LOAD PARTNERS (LIVE WITH EDIT/DELETE) =====
function listenToPartners() {
  const q = query(membersRef, where("businessId", "==", businessId));
  onSnapshot(q, (snap) => {
    partnersList.innerHTML = "";
    
    snap.forEach(docSnap => {
      const p = docSnap.data();
      const pId = docSnap.id;
      const status = p.status || "accepted";
      const isOwner = (currentRole === "owner");
      
      const identifier = p.email || p.phone || "Unknown Partner";
      const firstChar = identifier.charAt(0).toUpperCase();

      const div = document.createElement("div");
      div.className = "p-3 bg-gray-50 border border-gray-200 rounded mb-2 flex justify-between items-center shadow-sm hover:shadow-md transition-shadow";

      div.innerHTML = `
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-xs uppercase">
            ${firstChar}
          </div>
          <div>
            <p class="font-bold text-gray-800 text-sm mb-0">${identifier}</p>
            <div class="flex items-center gap-2">
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
               <span class="${status === 'pending' ? 'text-yellow-600' : 'text-green-600'} text-[10px] font-bold uppercase">${status}</span>
            </div>
          </div>
        </div>
        <div class="flex gap-1">
          ${isOwner ? `
            <button onclick="editPartner('${pId}', '${p.email || ''}', '${p.phone || ''}', '${p.role}')" class="p-2 text-blue-500 hover:bg-blue-50 rounded-lg">
              <span class="material-symbols-outlined">edit</span>
            </button>
            <button onclick="deletePartner('${pId}', '${identifier}')" class="p-2 text-red-500 hover:bg-red-50 rounded-lg">
              <span class="material-symbols-outlined">delete</span>
            </button>
          ` : `<span class="text-[8px] text-gray-300 font-bold uppercase mr-2 italic">Protected</span>`}
        </div>
      `;
      partnersList.appendChild(div);
    });
    
    if (snap.empty) {
      partnersList.innerHTML = `<p class="text-center py-4 text-gray-400 text-sm">No partners invited yet.</p>`;
    }
  });
}

listenToPartners();

// ===== MODAL STATE =====
let selectedPartnerId = null;
let selectedPartnerEmail = null;

// ===== EDIT PARTNER =====
window.editPartner = function (docId, email, phone, role) {
  if (currentRole !== "owner") return;

  selectedPartnerId = docId;
  const identifier = email || phone;

  document.getElementById("editPartnerEmail").value = identifier;
  document.getElementById("editPartnerRole").value = role;

  document.getElementById("editPartnerModal").classList.remove("hidden");
};

// CLOSE EDIT MODAL
document.getElementById("closeEditModal").onclick = () => {
  document.getElementById("editPartnerModal").classList.add("hidden");
};

// SAVE EDIT
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
    const cleanedPhone = inputVal.replace(/[\s\-\(\)]/g, "");
    updateData.phone = cleanedPhone;
    updateData.email = null;
  }

  const currentInviter = auth.currentUser.email || auth.currentUser.phoneNumber || "Owner";

  try {
    await updateDoc(doc(db, "businessMembers", selectedPartnerId), updateData);

    const displayId = inputVal;

    // 🔔 TRIGGER NOTIFICATION
    await addDoc(collection(db, "businesses", businessId, "notifications"), {
      message: `⚙️ Team member updated: ${displayId} is now a ${role}`,
      type: "member_updated",
      triggeredBy: currentInviter,
      createdAt: serverTimestamp(),
      readBy: []
    });

    // onesignal push notification
    await sendPush(`⚙️ Team member updated: ${displayId} is now a ${role}`, "/settings.html");

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

// CANCEL DELETE
document.getElementById("cancelDeletePartner").onclick = () => {
  document.getElementById("deletePartnerModal").classList.add("hidden");
};

// CONFIRM DELETE
document.getElementById("confirmDeletePartner").onclick = async () => {
  const currentInviter = auth.currentUser.email || auth.currentUser.phoneNumber || "Owner";
  try {
    await deleteDoc(doc(db, "businessMembers", selectedPartnerId));

    // 🔔 TRIGGER NOTIFICATION
    await addDoc(collection(db, "businesses", businessId, "notifications"), {
      message: `🚫 Member Removed: ${selectedPartnerEmail} was removed from the business.`,
      type: "member_removed",
      triggeredBy: currentInviter,
      createdAt: serverTimestamp(),
      readBy: []
    });

    // onesignal push notification
    await sendPush(`🚫 Member Removed: ${selectedPartnerEmail} was removed from the business.`, "/settings.html");

    document.getElementById("deletePartnerModal").classList.add("hidden");

  } catch (err) {
    console.error(err);
    alert("Delete failed");
  }
};


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


// ===== FEEDBACK MODAL =====
    if (openFeedbackBtn) openFeedbackBtn.onclick = () => feedbackModal.classList.add("show");
    if (feedbackModal) feedbackModal.onclick = (e) => { if (e.target === feedbackModal) feedbackModal.classList.remove("show"); };
    if (submitFeedbackBtn) submitFeedbackBtn.onclick = async () => {
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

    // ===== LOGOUT =====
    if (logoutBtn) logoutBtn.onclick = async () => {
      await signOut(auth);
      window.location.href = "signup.html";
    };

  } catch (err) {
    console.error(err);
    if (!navigator.onLine || err.message === "OFFLINE_NO_CACHE") {
      showOfflineBanner();
    } else if (err.message === "NO_BUSINESS" || err.message === "Business not found") {
      if (user && user.uid) {
        localStorage.removeItem(`businessId_${user.uid}`);
      }
      alert("No business setup found. Redirecting to setup...");
      window.location.href = "setup.html";
    } else {
      if (user && user.uid) {
        localStorage.removeItem(`businessId_${user.uid}`);
      }
      showErrorBanner(err.message || err);
    }
  }
});
// // ===== DYNAMIC BUY ME A COFFEE BUTTON WITH FLOATING ANIMATION =====
// (function() {
//   const bmcLink = "https://www.buymeacoffee.com/francisfortune"; // your profile link

//   // Create Buy Me a Coffee button
//   const coffeeBtn = document.createElement("button");
//   coffeeBtn.id = "buyCoffeeBtn";
//   coffeeBtn.innerHTML = "☕ Support Me";
//   coffeeBtn.style.position = "fixed";
//   coffeeBtn.style.bottom = "80px"; // leave space for bottom nav
//   coffeeBtn.style.right = "20px";
//   coffeeBtn.style.background = "Purple";
//   coffeeBtn.style.color = "#ffffff";
//   coffeeBtn.style.padding = "0.7rem 1.5rem";
//   coffeeBtn.style.fontWeight = "700";
//   coffeeBtn.style.borderRadius = "50px";
//   coffeeBtn.style.border = "none";
//   coffeeBtn.style.cursor = "pointer";
//   coffeeBtn.style.boxShadow = "0 8px 16px rgba(0,0,0,0.3)";
//   coffeeBtn.style.zIndex = "9999";
//   coffeeBtn.style.display = "flex";
//   coffeeBtn.style.alignItems = "center";
//   coffeeBtn.style.justifyContent = "center";
//   coffeeBtn.style.transition = "transform 0.3s, box-shadow 0.3s";
//   coffeeBtn.style.fontSize = "1.3rem";

//   // Hover effect
//   coffeeBtn.onmouseover = () => {
//     coffeeBtn.style.transform = "translateY(-6px)";
//     coffeeBtn.style.boxShadow = "0 12px 24px rgba(0,0,0,0.35)";
//   };
//   coffeeBtn.onmouseout = () => {
//     coffeeBtn.style.transform = "translateY(0)";
//     coffeeBtn.style.boxShadow = "0 8px 16px rgba(0,0,0,0.3)";
//   };

//   // Floating animation CSS
//   const style = document.createElement("style");
//   style.innerHTML = `
//     @keyframes floatButton {
//       0% { transform: translateY(0px); }
//       50% { transform: translateY(-8px); }
//       100% { transform: translateY(0px); }
//     }
//     #buyCoffeeBtn {
//       animation: floatButton 3s ease-in-out infinite;
//     }
//     /* Optional: Product Hunt button styles if used */
//     #productHuntBtn {
//       animation: floatButton 3s ease-in-out infinite;
//       background: linear-gradient(135deg, #DA552F, #FF6F4C);
//       color: #fff;
//       font-weight: 700;
//       border-radius: 50px;
//       border: none;
//       cursor: pointer;
//       box-shadow: 0 8px 16px rgba(0,0,0,0.3);
//       padding: 0.7rem 1.5rem;
//       display: flex;
//       align-items: center;
//       justify-content: center;
//       transition: transform 0.3s, box-shadow 0.3s;
//       z-index: 9999;
//       position: fixed;
//       bottom: 20px; /* will adjust dynamically */
//       right: 20px;
//     }
//     #productHuntBtn:hover {
//       transform: translateY(-6px);
//       box-shadow: 0 12px 24px rgba(0,0,0,0.35);
//     }
//   `;
//   document.head.appendChild(style);

//   // Responsive function
//   function updateBtnSize() {
//     const bottomMargin = 20; // default bottom spacing
//     if (window.innerWidth < 768) {
//       coffeeBtn.style.padding = "0.5rem 1.3rem";
//       coffeeBtn.style.fontSize = "1.4rem";
//       coffeeBtn.style.bottom = "130px"; // extra space for bottom nav
//       coffeeBtn.style.right = "15px";
//       // If Product Hunt button is used
//       const phBtn = document.getElementById("productHuntBtn");
//       if (phBtn) phBtn.style.bottom = "40px"; // below coffee button
//     } else {
//       coffeeBtn.style.padding = "0.7rem 1.5rem";
//       coffeeBtn.style.fontSize = "1rem";
//       coffeeBtn.style.bottom = "80px";
//       coffeeBtn.style.right = "20px";
//       const phBtn = document.getElementById("productHuntBtn");
//       if (phBtn) phBtn.style.bottom = "20px";
//     }
//   }
//   window.addEventListener("resize", updateBtnSize);
//   updateBtnSize();

//   // Append Buy Me a Coffee button
//   document.body.appendChild(coffeeBtn);

//   // Popup portal
//   coffeeBtn.addEventListener("click", () => {
//     const popupWidth = 500;
//     const popupHeight = 700;
//     const left = (window.innerWidth / 2) - (popupWidth / 2);
//     const top = (window.innerHeight / 2) - (popupHeight / 2);

//     window.open(
//       bmcLink,
//       "BuyMeACoffee",
//       `width=${popupWidth},height=${popupHeight},top=${top},left=${left},resizable=yes,scrollbars=yes`
//     );
//   });

//   // Tooltip/Bio
//   coffeeBtn.title = `
// Hi! I'm Francis Fortune.
// I’m passionate about motivating young teens to explore technology, learn new skills, and create innovative solutions.
// .
// `;

//   // ===== PRODUCT HUNT BUTTON (COMMENTED OUT FOR NOW) =====
//   /*
//   const phLink = "https://www.producthunt.com/posts/your-product";
//   const phBtn = document.createElement("button");
//   phBtn.id = "productHuntBtn";
//   phBtn.innerHTML = "🚀 Product Hunt";
//   phBtn.onclick = () => window.open(phLink, "_blank");
//   document.body.appendChild(phBtn);
//   updateBtnSize();
//   */
// })();