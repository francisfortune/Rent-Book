// add hovered class to selected list item
let list = document.querySelectorAll(".navigation li");

function activeLink() {
  list.forEach((item) => {
    item.classList.remove("hovered");
  });
  this.classList.add("hovered");
}

list.forEach((item) => item.addEventListener("mouseover", activeLink));

// Menu Toggle
let toggle = document.querySelector(".toggle");
let navigation = document.querySelector(".navigation");
let main = document.querySelector(".main");

toggle.onclick = function () {
  navigation.classList.toggle("active");
  main.classList.toggle("active");
};


  const addBtn = document.getElementById("addBookingBtn");
  const modal = document.getElementById("addBookingModal");
  const closeBtn = document.getElementById("closeAddModal");
  const form = document.getElementById("bookingForm");
  const addItemBtn = document.getElementById("addItemBtn");
  const itemsWrapper = document.getElementById("itemsWrapper");

  // OPEN MODAL
  addBtn.onclick = (e) => {
    e.preventDefault();
    modal.classList.remove("hidden");
  };

  // CLOSE MODAL
  closeBtn.onclick = () => modal.classList.add("hidden");

  modal.onclick = (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  };

  // ADD NEW ITEM ROW
  addItemBtn.onclick = () => {
    const div = document.createElement("div");
    div.className = "item-row";

    div.innerHTML = `
      <input type="text" placeholder="Item (e.g Canopy)" class="item-name" required>
      <input type="number" placeholder="Qty" class="item-qty" required>
    `;

    itemsWrapper.appendChild(div);
  };

  // SAVE BOOKING
  form.onsubmit = (e) => {
    e.preventDefault();

    const items = [];

    document.querySelectorAll(".item-row").forEach(row => {
      const name = row.querySelector(".item-name").value;
      const qty = row.querySelector(".item-qty").value;

      items.push({ name, qty: Number(qty) });
    });

    const bookingData = {
      event: eventName.value,
      client: clientName.value,
      date: eventDate.value,
      items,
      createdAt: new Date()
    };

    console.log("Booking Saved:", bookingData);
    alert("Booking added successfully");

    form.reset();
    itemsWrapper.innerHTML = `
      <div class="item-row">
        <input type="text" placeholder="Item (e.g Chairs)" class="item-name" required>
        <input type="number" placeholder="Qty" class="item-qty" required>
      </div>
    `;

    modal.classList.add("hidden");

    // 🔥 FIREBASE READY
    // addDoc(collection(db, "bookings"), bookingData)
  };
  

  const receiptInput = document.getElementById("receipt");
const receiptPreview = document.getElementById("receiptPreview");

// PREVIEW RECEIPT IMAGE
receiptInput.onchange = () => {
  const file = receiptInput.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    receiptPreview.src = reader.result;
    receiptPreview.classList.remove("hidden");
  };
  reader.readAsDataURL(file);
};

// UPDATE SAVE LOGIC
form.onsubmit = (e) => {
  e.preventDefault();

  const items = [];

  document.querySelectorAll(".item-row").forEach(row => {
    const name = row.querySelector(".item-name").value;
    const qty = row.querySelector(".item-qty").value;
    items.push({ name, qty: Number(qty) });
  });

  const bookingData = {
    event: eventName.value,
    client: clientName.value,
    date: eventDate.value,
    items,
    extraInfo: extraInfo.value,
    createdAt: new Date()
  };

  console.log("Booking Saved:", bookingData);

  alert("Booking added successfully");

  modal.classList.add("hidden");
  form.reset();
  receiptPreview.classList.add("hidden");

  // 🔥 FIREBASE STORAGE (later)
  // uploadBytes(ref(storage, `receipts/${Date.now()}`), receipt)
};0

