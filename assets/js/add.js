import { auth, db, storage } from "./firebase.js";
import {
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
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

/* =========================
   BUSINESS LOOKUP
========================= */
async function getBusinessIdByEmail(email) {
  const q = query(
    collection(db, "businessMembers"),
    where("email", "==", email)
  );
  const snap = await getDocs(q);
  if (snap.empty) throw new Error("No business");
  return snap.docs[0].data().businessId;
}

/* =========================
   TOTAL CALCULATION
========================= */
let inventoryItems = [];

function recalcTotal() {
  let total = 0;

  document.querySelectorAll(".item-row").forEach(row => {
    const qty = Number(row.querySelector(".item-qty")?.value || 0);
    const price = Number(row.querySelector(".item-price")?.value || 0);
    total += qty * price;
  });

  document.getElementById("totalAmount").value = total;
}

/* =========================
   ADD ITEM ROW
========================= */
window.addItemRow = function () {
  const container = document.getElementById("itemsContainer");

  const row = document.createElement("div");
  row.className = "item-row flex gap-2 items-center mb-2";

  row.innerHTML = `
<select class="item-name flex-[2] p-2 border rounded-lg outline-none" required>
      <option value="">Select an Item</option>
      ${inventoryItems.map(item => `
        <option value="${item.name}" data-price="${item.price}" data-avail="${item.availableQuantity}">
          ${item.name} (${item.availableQuantity} avail)
        </option>
      `).join("")}
    </select>
    <input class="item-qty w-20 p-2 border rounded-lg outline-none" type="number" min="1" value="1" required>
    <input class="item-price w-24 p-2 border rounded-lg outline-none" type="number" placeholder="Price">
    <button type="button" class="w-10 h-10 flex items-center justify-center bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-all">✕</button>
  `;

  const select = row.querySelector(".item-name");
  const qtyInput = row.querySelector(".item-qty");
  const priceInput = row.querySelector(".item-price");
  const removeBtn = row.querySelector("button");

  
  // When user selects an item, populate default price but allow editing
  select.addEventListener("change", (e) => {
    const opt = e.target.selectedOptions[0];
    if (opt) {
      priceInput.value = opt.dataset.price || ""; // system price
    } else {
      priceInput.value = "";
    }
    recalcTotal();
  });

  qtyInput.addEventListener("input", recalcTotal);
  priceInput.addEventListener("input", recalcTotal); // total recalculation if user edits price

  removeBtn.addEventListener("click", () => {
    row.remove();
    recalcTotal();
  });

  container.appendChild(row);
};

/* =========================
   INVENTORY DEDUCTION
========================= */
async function deductInventory(businessId, items) {
  const invSnap = await getDocs(
    collection(db, "businesses", businessId, "inventory")
  );

  for (const item of items) {
    const match = invSnap.docs.find(d =>
      d.data().name.toLowerCase() === item.name.toLowerCase()
    );

    if (!match) continue;

    const current = match.data().availableQuantity;

    await updateDoc(match.ref, {
availableQuantity: Math.max(0, current - Math.min(item.qty, current))

    });
  }
}

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

/* =========================
   AUTH + SUBMIT
========================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const businessId = await getBusinessIdByEmail(user.email);

  // 1. Fetch Inventory for dropdowns
  const invSnap = await getDocs(collection(db, "businesses", businessId, "inventory"));
  inventoryItems = invSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // 2. Add first row automatically
  window.addItemRow();

  // brand avatar
  document.getElementById("user-avatar").textContent =
    user.email.charAt(0).toUpperCase();

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
        if (new Date(returnDate.value) < new Date(eventDate.value)) {
          alert("Return date cannot be before event date");
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
          return;
        }

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

items.push({
  name,
  qty,
  price,
  total: qty * price,
  availableAtBooking,
  shortage // 🔥 THIS IS THE KEY
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
            uid: user.uid,
            email: user.email
          },
          createdAt: serverTimestamp()
        };

        /* ===== SAVE BOOKING ===== */
        await addDoc(
          collection(db, "businesses", businessId, "bookings"),
          bookingData
        );

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
