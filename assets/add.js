import { auth, db, storage } from "./firebase.js";
import { deductInventory } from "./services/inventoryService.js";

import {
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

let currentBusinessName = "Our Business"; 
let inventoryItems = [];

async function sendNotification(businessId, message, userEmail, type = "general", bookingId = null) {
  try {
    await addDoc(collection(db, "businesses", businessId, "notifications"), {
      message,
      triggeredBy: userEmail,
      type,
      bookingId,          // link to booking if exists
      read: false,
      createdAt: serverTimestamp()
    });
  } catch (e) {
    console.error("Notification error:", e);
  }
}

/* =========================
   BUSINESS LOOKUP
========================= */
async function getBusinessIdByEmail(email) {
  const user = auth.currentUser;
  if (!user) throw new Error("No user");
  const cacheKey = `businessId_${user.uid}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) return cached;

  let businessId = null;
  if (user.email) {
    const emailLower = user.email.toLowerCase().trim();
    const q = query(collection(db, "businessMembers"), where("email", "==", emailLower));
    let snap = await getDocs(q);
    if (snap.empty && user.email.trim() !== emailLower) {
      const qRaw = query(collection(db, "businessMembers"), where("email", "==", user.email.trim()));
      snap = await getDocs(qRaw);
    }
    if (!snap.empty) businessId = snap.docs[0].data().businessId;
  }
  if (!businessId && user.phoneNumber) {
    const q = query(collection(db, "businessMembers"), where("phone", "==", user.phoneNumber.trim()));
    const snap = await getDocs(q);
    if (!snap.empty) businessId = snap.docs[0].data().businessId;
  }

  if (!businessId) {
    if (!navigator.onLine) {
      if (cached) return cached;
      throw new Error("OFFLINE_NO_CACHE");
    }
    throw new Error("No business");
  }

  localStorage.setItem(cacheKey, businessId);
  return businessId;
}

/* =========================
   TOTAL CALCULATION
========================= */

function recalcTotal() {
  let total = 0;
  let itemsSummary = "";

  document.querySelectorAll(".item-row").forEach(row => {
    const select = row.querySelector(".item-name");
    const name = select.value || "Item Name";
    const qty = Number(row.querySelector(".item-qty")?.value || 0);
    const price = Number(row.querySelector(".item-price")?.value || 0);
    
    // Updated selector to find the vendor name inside the new container
    const vendor = row.querySelector(".vendor-name")?.value;
    
    const rowTotal = qty * price;
    total += rowTotal;

    if (qty > 0) {
      // Improved logic: only show the tag if a vendor name is actually typed
      const vendorTag = vendor ? ` [Ext: ${vendor}]` : "";
      itemsSummary += `• ${name} (x${qty})${vendorTag} - ₦${rowTotal.toLocaleString()}\n`;
    }
  });

  // Update hidden total input
  if (document.getElementById("totalAmount")) {
    document.getElementById("totalAmount").value = total;
  }

   // Read Amount Paid
// ✅ FIXED: Get Paid Amount correctly
  const paidInput = document.getElementById("amountPaid");
  const paidValue = paidInput ? parseFloat(paidInput.value) || 0 : 0;

  const balance = total - paidValue;

  // Build Preview with Dynamic Business Name
 const previewText = 
  `*BOOKING CONFIRMATION - ${currentBusinessName.toUpperCase()}*\n\n` +
  `Hi ${document.getElementById("clientName")?.value || "Customer"}, your booking is confirmed! ✅\n\n` +
  `Date: ${document.getElementById("eventDate")?.value || "Date"}\n` +
  `Location: ${document.getElementById("eventLocation")?.value || "Not specified"}\n\n` +
  `Items Ordered: \n${itemsSummary}\n` +
  `Total: ₦${total.toLocaleString()}\n` +
  `Paid: ₦${paidValue.toLocaleString()}\n` +
  `Balance: ₦${balance.toLocaleString()}\n\n` +
`Thank you for choosing ${currentBusinessName}!\n\n` +
  `--- \n` + 
  `_Powered by Tracknrent_ \n` + 
  `👉 https://tracknrent.vercel.app`;
  ;
  const previewBox = document.getElementById("liveReceiptText");
  if (previewBox) {
    previewBox.innerText = previewText;
  }
}

/* =========================
   ADD ITEM ROW
========================= */
/* =========================
   ADD ITEM ROW (FIXED WITH VENDOR FIELD)
========================= */

window.addItemRow = function () {
  const container = document.getElementById("itemsContainer");
  const row = document.createElement("div");
  row.className = "item-row flex flex-wrap gap-2 items-center mb-2 bg-gray-50 p-2 rounded-xl relative";

  row.innerHTML = `
    <select class="item-name flex-[2] p-2 border rounded-lg outline-none" required>
      <option value="">Select an Item</option>
      ${inventoryItems.map(item => `
        <option value="${item.name}" data-price="${item.price}" data-avail="${item.availableQuantity}">
          ${item.name} (${item.availableQuantity} avail)
        </option>
      `).join("")}
    </select>
    <div class="flex gap-2 w-full sm:w-auto">
        <input class="item-qty w-20 p-2 border rounded-lg outline-none" type="number" min="1" value="1" required>
        <input class="item-price w-24 p-2 border rounded-lg outline-none" type="number" placeholder="Price">
    </div>
    
    <div class="vendor-container hidden w-full mt-2 p-3 border border-purple-200 bg-purple-50 rounded-lg">
        <label class="block text-[10px] font-bold text-purple-700 uppercase mb-1">Vendor Name (To borrow from):</label>
        <input class="vendor-name w-full p-2 border border-purple-300 rounded-md text-sm outline-none" 
               placeholder="e.g. John Rentals" title='Vendor to borrow shortage from'>
    </div>
    
    
    <button type="button" class="absolute top-2 right-2 sm:static w-10 h-10 flex items-center justify-center bg-red-50 text-red-600 rounded-lg">✕</button>
  `;

  const select = row.querySelector(".item-name");
  const qtyInput = row.querySelector(".item-qty");
  const priceInput = row.querySelector(".item-price");
  const vendorInput = row.querySelector(".vendor-name");
  const vendorContainer = row.querySelector(".vendor-container"); // Target the wrapper
  const removeBtn = row.querySelector("button");

  const checkShortage = () => {
    const opt = select.selectedOptions[0];
    const avail = Number(opt?.dataset.avail || 0);
    const requested = Number(qtyInput.value);

    if (requested > avail) {
      vendorContainer.classList.remove("hidden");
    } else {
      vendorContainer.classList.add("hidden");
    }
    recalcTotal();
  };

  select.addEventListener("change", (e) => {
    const opt = e.target.selectedOptions[0];
    priceInput.value = opt?.dataset.price || "";
    checkShortage();
  });

  qtyInput.addEventListener("input", checkShortage);
  priceInput.addEventListener("input", recalcTotal);
  vendorInput.addEventListener("input", recalcTotal);

  removeBtn.addEventListener("click", () => {
    row.remove();
    recalcTotal();
  });

  container.appendChild(row);
  updateSelectOptions();
};

/* =========================
   RECEIPT IMAGE UPLOAD
========================= */
async function uploadReceiptImage(businessId, file) {
  if (!file) return null;

  const timestamp = Date.now();
  const fileName = `receipts/${businessId}/${timestamp}_${file.name}`;
  const storageRef = ref(storage, fileName);

  await uploadBytes(storageRef, file);
  const downloadURL = await getDownloadURL(storageRef);
  return downloadURL;
}

let businessId = "";
let currentUser = null;

/* =========================
   AUTH + SUBMIT
========================= */

function showOfflineBanner() {
  if (document.getElementById("offlineBanner")) return;
  const banner = document.createElement("div");
  banner.id = "offlineBanner";
  banner.style.cssText = "position: fixed; top: 0; left: 0; right: 0; background: rgba(128, 0, 128, 0.95); backdrop-filter: blur(10px); color: white; text-align: center; padding: 12px; z-index: 99999; font-weight: 500; font-size: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center; gap: 8px;";
  banner.innerHTML = `<span class="material-symbols-outlined" style="font-size: 20px; vertical-align: middle;">wifi_off</span> Offline Mode — Using cached local data`;
  document.body.appendChild(banner);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "signup.html";
    return;
  }

  try {
    currentUser = user; // ✅ SAVE USER
    businessId = await getBusinessIdByEmail(user.email); // ✅ NO const
    if (!navigator.onLine) {
      showOfflineBanner();
    }

    const bizSnap = await getDoc(doc(db, "businesses", businessId));
    if (bizSnap.exists()) {
      currentBusinessName = bizSnap.data().name;
    }

    const invSnap = await getDocs(
      collection(db, "businesses", businessId, "inventory")
    );

    inventoryItems = invSnap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

// ✅ ADD LISTENERS FOR LIVE UPDATES
    const liveFields = ["clientName", "eventDate", "eventLocation", "amountPaid"];
    liveFields.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        // Use 'input' event so it updates as you type
        el.addEventListener("input", recalcTotal);
      }
    });

    addItemRow();
    recalcTotal();

  } catch (error) {
    console.error("Auth Init Error:", error);
    if (!navigator.onLine || error.message === "OFFLINE_NO_CACHE") {
      showOfflineBanner();
    } else {
      if (user && user.uid) {
        localStorage.removeItem(`businessId_${user.uid}`);
      }
      window.location.href = "setup.html";
    }
  }
});
  // 3. Receipt image preview handler
  const receiptInput = document.getElementById("receiptImage");
  const receiptPreview = document.getElementById("receiptPreview");
  const receiptThumbnail = document.getElementById("receiptThumbnail");
  const receiptText = document.getElementById("receiptText");

  if (receiptInput) {
    receiptInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          receiptThumbnail.src = e.target.result;
          receiptPreview.style.display = "block";
          receiptText.textContent = "Tap to change receipt";
        };
        reader.readAsDataURL(file);
      }
    });
  }

  document
    .getElementById("addBookingForm")
    .addEventListener("submit", async (e) => {
      e.preventDefault();

      const submitBtn = e.target.querySelector('button[type="submit"]');
const originalText = submitBtn.textContent;

submitBtn.disabled = true;
submitBtn.textContent = "Saving...";

try {
  /* ===== VALIDATION ===== */

  const delivery = deliveryDate.value || eventDate.value;

  if (new Date(returnDate.value) < new Date(delivery)) {
    alert("Return date cannot be before delivery date");

    // ✅ FIX: restore button
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;

    return;
  }

  // ✅ REMOVE this completely (no longer needed)
  // if (new Date(returnDate.value) < new Date(eventDate.value)) { ... }

        const items = [];
        document.querySelectorAll(".item-row").forEach(row => {
          const name = row.querySelector(".item-name").value.trim();
          const qty = Number(row.querySelector(".item-qty").value);
          const price = Number(row.querySelector(".item-price").value);

          if (!name || qty <= 0) return;
// find inventory item
const inventoryItem = inventoryItems.find(
  i => i.name.toLowerCase() === name.toLowerCase()
);

const availableAtBooking = inventoryItem?.availableQuantity || 0;
const shortage = Math.max(0, qty - availableAtBooking);

const supplierInput = row.querySelector(".vendor-name");

items.push({
  name,
  qty,
  price,
  total: qty * price,
  availableAtBooking,
  shortage,
  borrowed: shortage > 0 ? shortage : 0,
  supplier: shortage > 0 ? (supplierInput?.value || "") : ""
});

        });

        const overbookedItems = items.filter(i => i.shortage > 0);
if (overbookedItems.length) {
  const msg = overbookedItems
    .map(i => `${i.name}: borrow ${i.shortage}`)
    .join("\n");

  if (!confirm(`⚠ Overbooking detected:\n${msg}\n\nContinue anyway?`)) {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
    return;
  }
}


        if (!items.length) {
          alert("Add at least one item");
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
          return;
        }

        /* ===== UPLOAD RECEIPT IMAGE ===== */
        let receiptImageUrl = null;
        const receiptFile = receiptInput?.files[0];
        if (receiptFile) {
          submitBtn.textContent = "Uploading receipt...";
          receiptImageUrl = await uploadReceiptImage(businessId, receiptFile);
        }

        const bookingData = {
          client: {
            name: clientName.value.trim(),
            phone: clientPhone.value.trim(),
            email: clientEmail.value.trim() || ""
          },
          event: {
            type: eventType.value,
            date: eventDate.value,
  deliveryDate: deliveryDate.value || "", // ✅ NEW
            returnDate: returnDate.value,
            location: eventLocation.value || ""
          },
          items,
          payment: {
            total: Number(totalAmount.value),
            paid: Number(amountPaid.value || 0),
            method: paymentMethod.value
          },
          receiptImage: receiptImageUrl,
          notes: document.getElementById("notes")?.value || "",
          status: "active",
         createdBy: {
  uid: currentUser.uid,
  email: currentUser.email
},
          createdAt: serverTimestamp()
        };

       
  /* ===== SAVE BOOKING ===== */
const bookingRef = await addDoc(
  collection(db, "businesses", businessId, "bookings"),
  bookingData
);

// Add listeners for live updates
["clientName", "eventDate", "eventLocation", "amountPaid"].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("input", recalcTotal);
});

// Also recalc on page load
recalcTotal();

// 🔔 Send notification about new booking with bookingId
await sendNotification(
  businessId,
  `New booking added ${bookingData.client.name} on ${bookingData.event.date}`,
  currentUser.email, // ✅ FIXED
  "booking_added",      // type
  bookingRef.id         // bookingId
);

// 🎇 2. WELCOME NOTIFICATION (Add this part)
// This checks if this is the very first booking in the system
const allBookings = await getDocs(collection(db, "businesses", businessId, "bookings"));
if (allBookings.size === 1) {
  await sendNotification(
    businessId,
    `🎉 Welcome ${currentBusinessName}! ! You've just created your first booking for ${bookingData.client.name}. This platform is designed to help you track rentals and payments effortlessly. Explore your dashboard to see your new stats!`,
    "Tracknrent",
    "welcome_message",
    bookingRef.id
  );
}

        /* ===== DEDUCT INVENTORY ===== */
        await deductInventory(businessId, items);

        window.location.href = "bookings.html";
      } catch (error) {
        console.error("Error saving booking:", error);
        alert("Failed to save booking. Please try again.");
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    });


function updateSelectOptions() {
  const selectedItems = Array.from(document.querySelectorAll(".item-name"))
    .map(s => s.value)
    .filter(v => v); // remove empty

  document.querySelectorAll(".item-name").forEach(select => {
    Array.from(select.options).forEach(option => {
      if (!option.value) return; // keep placeholder
      // disable option if selected elsewhere
      option.disabled = selectedItems.includes(option.value) && select.value !== option.value;
    });
  });
}

window.shareToWhatsApp = function() {
  const phone = document.getElementById("clientPhone")?.value;
  const message = document.getElementById("liveReceiptText")?.innerText;

  if (!phone || phone.length < 5) {
    alert("Please enter a valid Client Phone number first!");
    return;
  }

  // Format phone for WhatsApp (removes spaces/dashes)
  const cleanPhone = phone.replace(/\D/g, '');
  const encodedMsg = encodeURIComponent(message);

  window.open(`https://wa.me/${cleanPhone}?text=${encodedMsg}`, '_blank');
};

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
// })();


