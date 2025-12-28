import { auth, db } from "./firebase.js";
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
  row.className = "item-row";

  row.innerHTML = `
    <input class="item-name" placeholder="Item name" required>
    <input class="item-qty" type="number" min="1" value="1">
    <input class="item-price" type="number" min="0">
    <button type="button">✕</button>
  `;

  row.querySelector("button").onclick = () => {
    row.remove();
    recalcTotal();
  };

  row.querySelectorAll("input").forEach(input =>
    input.addEventListener("input", recalcTotal)
  );

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
   AUTH + SUBMIT
========================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const businessId = await getBusinessIdByEmail(user.email);

  // brand avatar
  document.getElementById("user-avatar").textContent =
    user.email.charAt(0).toUpperCase();

  document
    .getElementById("addBookingForm")
    .addEventListener("submit", async (e) => {
      e.preventDefault();

      /* ===== VALIDATION ===== */
      if (new Date(returnDate.value) < new Date(eventDate.value)) {
        alert("Return date cannot be before event date");
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
        return;
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
    });
});
