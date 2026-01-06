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
    <input class="item-price w-24 p-2 border rounded-lg bg-gray-50 outline-none" type="number" readonly placeholder="Price">
    <button type="button" class="w-10 h-10 flex items-center justify-center bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-all">✕</button>
  `;

  const select = row.querySelector(".item-name");
  const qtyInput = row.querySelector(".item-qty");
  const priceInput = row.querySelector(".item-price");
  const removeBtn = row.querySelector("button");

  select.onchange = (e) => {
    const opt = e.target.selectedOptions[0];
    if (opt) {
      priceInput.value = opt.dataset.price;
      recalcTotal();
    }
  };

  qtyInput.oninput = recalcTotal;

  removeBtn.onclick = () => {
    row.remove();
    recalcTotal();
  };

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
      availableQuantity: Math.max(0, current - item.qty)
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

          items.push({
            name,
            qty,
            price,
            total: qty * price
          });
        });

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

