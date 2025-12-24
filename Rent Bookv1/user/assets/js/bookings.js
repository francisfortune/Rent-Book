import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, query, where, onSnapshot, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const userId = user.uid;

  // Get business info for reference
  const businessRef = doc(db, "businesses", userId);
  const businessSnap = await getDoc(businessRef);
  if (!businessSnap.exists()) {
    console.warn("No business found. Redirecting to setup.");
    window.location.href = "setup.html";
    return;
  }

  // -------------------------------
  // 1️⃣ Load bookings
  const bookingsList = document.querySelector(".booking-list");
  const bookingsQuery = query(collection(db, "bookings"), where("businessId", "==", userId));

  onSnapshot(bookingsQuery, (snapshot) => {
    bookingsList.innerHTML = "";
    if (snapshot.empty) {
      bookingsList.innerHTML = "<p>No bookings found.</p>";
      return;
    }

    snapshot.forEach(docSnap => {
      const booking = docSnap.data();
      const bookingDiv = document.createElement("div");
      bookingDiv.className = "booking-item";
      bookingDiv.dataset.bookingId = docSnap.id;
      bookingDiv.innerHTML = `
        <span class="date">${booking.date}</span>
        <div class="info">
          <h4>${booking.name}</h4>
          <p>${booking.items.map(i => `${i.name} × ${i.quantity}`).join(", ")}</p>
        </div>
      `;
      bookingsList.appendChild(bookingDiv);

      // Click event to open booking details modal
      bookingDiv.addEventListener("click", () => openBookingModal(booking));
    });
  });

  // -------------------------------
  // 2️⃣ Booking details modal
  const bookingModal = document.getElementById("bookingModal");
  const closeBookingModal = document.getElementById("closeModal");

  function openBookingModal(booking) {
    bookingModal.querySelector(".modal-section p strong").textContent = booking.name;
    
    // Items
    const itemsUl = bookingModal.querySelector(".modal-section:nth-of-type(2) ul");
    itemsUl.innerHTML = "";
    booking.items.forEach(i => {
      const li = document.createElement("li");
      li.textContent = `${i.name} – ${i.quantity}`;
      itemsUl.appendChild(li);
    });

    // Tasks (if exists)
    const tasksUl = bookingModal.querySelector(".modal-section:nth-of-type(3) ul");
    tasksUl.innerHTML = "";
    if (booking.tasks) {
      booking.tasks.forEach(task => {
        const li = document.createElement("li");
        li.textContent = task;
        tasksUl.appendChild(li);
      });
    } else {
      tasksUl.innerHTML = "<li>No tasks assigned</li>";
    }

    // Rental-to-rental info
    const rentalSection = bookingModal.querySelector(".modal-section:nth-of-type(4)");
    rentalSection.innerHTML = `<h4>Rental-to-Rental</h4>`;
    if (booking.rentalTransfers) {
      booking.rentalTransfers.forEach(r => {
        const p = document.createElement("p");
        p.innerHTML = `${r.item} – ${r.quantity} from <strong>${r.from}</strong><br>Return: ${r.returnDate}`;
        rentalSection.appendChild(p);
      });
    } else {
      rentalSection.innerHTML += "<p>No rental transfers</p>";
    }

    bookingModal.classList.remove("hidden");
  }

  closeBookingModal.addEventListener("click", () => bookingModal.classList.add("hidden"));
  bookingModal.addEventListener("click", (e) => {
    if (e.target === bookingModal) bookingModal.classList.add("hidden");
  });
});





document.addEventListener("DOMContentLoaded", () => {
  
    /* ===============================
       ADD BOOKING MODAL
    =============================== */
    const addBookingBtn = document.getElementById("addBookingBtn");
    const addBookingModal = document.getElementById("addBookingModal");
    const closeAddModal = document.getElementById("closeAddModal");
    const addItemBtn = document.getElementById("addItemBtn");
    const itemsWrapper = document.getElementById("itemsWrapper");
  
    if (addBookingBtn) {
      addBookingBtn.addEventListener("click", (e) => {
        e.preventDefault();
        addBookingModal.classList.remove("hidden");
      });
    }
  
    if (closeAddModal) {
      closeAddModal.addEventListener("click", () => {
        addBookingModal.classList.add("hidden");
      });
    }
  
    // Close add booking modal on outside click
    addBookingModal.addEventListener("click", (e) => {
      if (e.target === addBookingModal) {
        addBookingModal.classList.add("hidden");
      }
    });
  
    // Add more items dynamically
    addItemBtn.addEventListener("click", () => {
      const row = document.createElement("div");
      row.className = "item-row";
      row.innerHTML = `
        <input type="text" placeholder="Item (e.g Chairs)" class="item-name" required>
        <input type="number" placeholder="Qty" class="item-qty" required>
      `;
      itemsWrapper.appendChild(row);
    });
  
  
    /* ===============================
       BOOKING DETAILS MODAL
    =============================== */
    const bookingModal = document.getElementById("bookingModal");
    const closeBookingModal = document.getElementById("closeModal");
    const bookingItems = document.querySelectorAll(".booking-item");
  
    bookingItems.forEach(item => {
      item.addEventListener("click", () => {
        bookingModal.classList.remove("hidden");
      });
    });
  
    closeBookingModal.addEventListener("click", () => {
      bookingModal.classList.add("hidden");
    });
  
    bookingModal.addEventListener("click", (e) => {
      if (e.target === bookingModal) {
        bookingModal.classList.add("hidden");
      }
    });
  
  });