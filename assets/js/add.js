import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, addDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

document.addEventListener("DOMContentLoaded", () => {

  const bookingForm = document.getElementById("bookingForm");
  const itemsWrapper = document.getElementById("itemsWrapper");
  const addItemBtn = document.getElementById("addItemBtn");
  const successMsg = document.getElementById("successMsg");

  // Add more items dynamically
  addItemBtn.addEventListener("click", () => {
    const row = document.createElement("div");
    row.className = "item-row";
    row.innerHTML = `
      <input type="text" class="item-name" placeholder="Item (e.g Chairs)" required>
      <input type="number" class="item-qty" placeholder="Quantity" required>
    `;
    itemsWrapper.appendChild(row);
  });

  // Handle form submission
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }

    const userId = user.uid;

    bookingForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const name = document.getElementById("bookingName").value;
      const date = document.getElementById("bookingDate").value;

      const items = [];
      itemsWrapper.querySelectorAll(".item-row").forEach(row => {
        const itemName = row.querySelector(".item-name").value.trim();
        const itemQty = Number(row.querySelector(".item-qty").value);
        if (itemName && itemQty) {
          items.push({ name: itemName, quantity: itemQty });
        }
      });

      const tasksText = document.getElementById("bookingTasks").value;
      const tasks = tasksText ? tasksText.split("\n").map(t => t.trim()).filter(t => t) : [];

      if (!name || !date || items.length === 0) {
        alert("Please fill in all required fields.");
        return;
      }

      try {
        await addDoc(collection(db, "bookings"), {
          businessId: userId,
          name,
          date,
          items,
          tasks,
          rentalTransfers: [], // optional, can be added later
          createdAt: new Date()
        });

        successMsg.style.display = "block";
        bookingForm.reset();
        itemsWrapper.innerHTML = `
          <div class="item-row">
            <input type="text" class="item-name" placeholder="Item (e.g Chairs)" required>
            <input type="number" class="item-qty" placeholder="Quantity" required>
          </div>
        `;
      } catch (error) {
        console.error("Error adding booking:", error);
        alert("Failed to add booking. Check console for details.");
      }
    });
  });
});
