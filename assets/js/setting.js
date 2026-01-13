// assets/js/settings.js
import { auth, db } from "./firebase.js";
import {
  doc,
  getDoc,
  updateDoc,
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

// ===== UTILS =====
async function getBusinessId(email) {
  const snap = await getDocs(query(collection(db, "businessMembers"), where("email", "==", email)));
  if (snap.empty) throw new Error("No business found for this user");
  return snap.docs[0].data().businessId;
}

// ===== AUTH GUARD =====
onAuthStateChanged(auth, async (user) => {
  if (!user) return window.location.href = "signup.html";

  try {
    const businessId = await getBusinessId(user.email);
    const businessRef = doc(db, "businesses", businessId);
    const membersRef = collection(db, "businessMembers");

    // ===== LIVE BUSINESS NAME UPDATE =====
    onSnapshot(businessRef, (docSnap) => {
      if (!docSnap.exists()) return;

      const data = docSnap.data();
      const newName = data.name || "";

      // Update all references of the business name on the page
      businessNameInput.value = newName;
      brandNameMobileEl.textContent = newName;
      feedbackBusinessName.value = newName;
      if (topNavBrand) topNavBrand.textContent = newName;
    });

    // ===== OWNER CHECK =====
    const memberSnap = await getDocs(query(membersRef, where("email", "==", user.email)));
    const role = memberSnap.docs[0].data().role;
    if (role !== "owner") {
      businessNameInput.disabled = true;
      saveBusinessBtn.disabled = true;
      saveBusinessBtn.textContent = "Only owner can edit";
    }

    // ===== SAVE BUSINESS NAME =====
    saveBusinessBtn.addEventListener("click", async () => {
      const newName = businessNameInput.value.trim();
      if (!newName) return alert("Business name cannot be empty");

      saveBusinessBtn.disabled = true;
      saveBusinessBtn.textContent = "Saving...";

      await updateDoc(businessRef, { name: newName, updatedAt: serverTimestamp() });

      saveBusinessBtn.textContent = "Saved!";
      setTimeout(() => {
        saveBusinessBtn.textContent = "Save Changes";
        saveBusinessBtn.disabled = false;
      }, 1200);
    });

    // ===== INVITE PARTNER =====
    if (inviteForm) {
      inviteForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = partnerEmailInput.value.trim().toLowerCase();
        const role = partnerRoleInput.value;

        if (!email) return alert("Enter an email");

        // Prevent multi-business invite
        const globalSnap = await getDocs(query(membersRef, where("email", "==", email)));
        if (!globalSnap.empty) {
          const existing = globalSnap.docs[0].data();
          if (existing.businessId !== businessId) {
            return alert("This email is already linked to another business.");
          }
        }

        // Prevent duplicates in the same business
        const existsSnap = await getDocs(query(membersRef, where("email", "==", email), where("businessId", "==", businessId)));
        if (!existsSnap.empty) return alert("Partner already added.");

        // Add partner
        await addDoc(membersRef, {
          email,
          role,
          status: "pending",
          invitedBy: user.email,
          businessId,
          createdAt: serverTimestamp()
        });

        inviteForm.reset();
      });
    }

    // ===== LOAD PARTNERS (LIVE) =====
    async function loadPartners() {
      const snap = await getDocs(query(membersRef, where("businessId", "==", businessId)));
      partnersList.innerHTML = "";

      snap.forEach(docSnap => {
        const p = docSnap.data();
        const status = p.status || "accepted"; // fix undefined

        const div = document.createElement("div");
        div.className = "p-3 bg-gray-50 border border-gray-200 rounded mb-2 flex justify-between items-center shadow-sm hover:shadow-md transition-shadow";

        div.innerHTML = `
          <div>
            <strong>${p.email}</strong> — <span class="text-blue-600">${p.role}</span>
          </div>
          <div>
            <span class="${status === 'pending' ? 'text-yellow-600' : 'text-green-600'} font-semibold">${status}</span>
          </div>
        `;
        partnersList.appendChild(div);
      });
    }

    loadPartners();
    onSnapshot(membersRef, snap => loadPartners()); // live updates

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
    alert("Error loading settings. Redirecting...");
    window.location.href = "setup.html";
  }
});
// ===== DYNAMIC BUY ME A COFFEE BUTTON WITH FLOATING ANIMATION =====
(function() {
  const bmcLink = "https://www.buymeacoffee.com/francisfortune"; // your profile link

  // Create Buy Me a Coffee button
  const coffeeBtn = document.createElement("button");
  coffeeBtn.id = "buyCoffeeBtn";
  coffeeBtn.innerHTML = "☕ Support Me";
  coffeeBtn.style.position = "fixed";
  coffeeBtn.style.bottom = "80px"; // leave space for bottom nav
  coffeeBtn.style.right = "20px";
  coffeeBtn.style.background = "Purple";
  coffeeBtn.style.color = "#ffffff";
  coffeeBtn.style.padding = "0.7rem 1.5rem";
  coffeeBtn.style.fontWeight = "700";
  coffeeBtn.style.borderRadius = "50px";
  coffeeBtn.style.border = "none";
  coffeeBtn.style.cursor = "pointer";
  coffeeBtn.style.boxShadow = "0 8px 16px rgba(0,0,0,0.3)";
  coffeeBtn.style.zIndex = "9999";
  coffeeBtn.style.display = "flex";
  coffeeBtn.style.alignItems = "center";
  coffeeBtn.style.justifyContent = "center";
  coffeeBtn.style.transition = "transform 0.3s, box-shadow 0.3s";
  coffeeBtn.style.fontSize = "1.3rem";

  // Hover effect
  coffeeBtn.onmouseover = () => {
    coffeeBtn.style.transform = "translateY(-6px)";
    coffeeBtn.style.boxShadow = "0 12px 24px rgba(0,0,0,0.35)";
  };
  coffeeBtn.onmouseout = () => {
    coffeeBtn.style.transform = "translateY(0)";
    coffeeBtn.style.boxShadow = "0 8px 16px rgba(0,0,0,0.3)";
  };

  // Floating animation CSS
  const style = document.createElement("style");
  style.innerHTML = `
    @keyframes floatButton {
      0% { transform: translateY(0px); }
      50% { transform: translateY(-8px); }
      100% { transform: translateY(0px); }
    }
    #buyCoffeeBtn {
      animation: floatButton 3s ease-in-out infinite;
    }
    /* Optional: Product Hunt button styles if used */
    #productHuntBtn {
      animation: floatButton 3s ease-in-out infinite;
      background: linear-gradient(135deg, #DA552F, #FF6F4C);
      color: #fff;
      font-weight: 700;
      border-radius: 50px;
      border: none;
      cursor: pointer;
      box-shadow: 0 8px 16px rgba(0,0,0,0.3);
      padding: 0.7rem 1.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.3s, box-shadow 0.3s;
      z-index: 9999;
      position: fixed;
      bottom: 20px; /* will adjust dynamically */
      right: 20px;
    }
    #productHuntBtn:hover {
      transform: translateY(-6px);
      box-shadow: 0 12px 24px rgba(0,0,0,0.35);
    }
  `;
  document.head.appendChild(style);

  // Responsive function
  function updateBtnSize() {
    const bottomMargin = 20; // default bottom spacing
    if (window.innerWidth < 768) {
      coffeeBtn.style.padding = "0.5rem 1.3rem";
      coffeeBtn.style.fontSize = "1.4rem";
      coffeeBtn.style.bottom = "130px"; // extra space for bottom nav
      coffeeBtn.style.right = "15px";
      // If Product Hunt button is used
      const phBtn = document.getElementById("productHuntBtn");
      if (phBtn) phBtn.style.bottom = "40px"; // below coffee button
    } else {
      coffeeBtn.style.padding = "0.7rem 1.5rem";
      coffeeBtn.style.fontSize = "1rem";
      coffeeBtn.style.bottom = "80px";
      coffeeBtn.style.right = "20px";
      const phBtn = document.getElementById("productHuntBtn");
      if (phBtn) phBtn.style.bottom = "20px";
    }
  }
  window.addEventListener("resize", updateBtnSize);
  updateBtnSize();

  // Append Buy Me a Coffee button
  document.body.appendChild(coffeeBtn);

  // Popup portal
  coffeeBtn.addEventListener("click", () => {
    const popupWidth = 500;
    const popupHeight = 700;
    const left = (window.innerWidth / 2) - (popupWidth / 2);
    const top = (window.innerHeight / 2) - (popupHeight / 2);

    window.open(
      bmcLink,
      "BuyMeACoffee",
      `width=${popupWidth},height=${popupHeight},top=${top},left=${left},resizable=yes,scrollbars=yes`
    );
  });

  // Tooltip/Bio
  coffeeBtn.title = `
Hi! I'm Francis Fortune.
I’m passionate about motivating young teens to explore technology, learn new skills, and create innovative solutions.
.
`;

  // ===== PRODUCT HUNT BUTTON (COMMENTED OUT FOR NOW) =====
  /*
  const phLink = "https://www.producthunt.com/posts/your-product";
  const phBtn = document.createElement("button");
  phBtn.id = "productHuntBtn";
  phBtn.innerHTML = "🚀 Product Hunt";
  phBtn.onclick = () => window.open(phLink, "_blank");
  document.body.appendChild(phBtn);
  updateBtnSize();
  */
})();
