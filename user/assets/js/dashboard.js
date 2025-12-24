import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  collection,
  query,
  where,
  onSnapshot,
  getDoc,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Listen to user authentication
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "sign.html";
    return;
  }

  const userId = user.uid;

  // -------------------------------
  // 1️⃣ Get business info
  const businessRef = doc(db, "businesses", userId);
  const businessSnap = await getDoc(businessRef);

  if (businessSnap.exists()) {
    const businessData = businessSnap.data();
    document.getElementById("welcomeText").textContent = `Welcome! ${businessData.name} `;
  } else {
    console.warn("No business found. Redirecting to setup.");
    window.location.href = "setup.html";
    return;
  }

  // -------------------------------
  // 2️⃣ Inventory low-stock alerts
  const alertsBox = document.getElementById("alertsBox");
  const inventoryQuery = query(collection(db, "inventory"), where("businessId", "==", userId));
  
  onSnapshot(inventoryQuery, (snapshot) => {
    alertsBox.innerHTML = ""; // Clear previous alerts
    let hasAlerts = false;
    snapshot.forEach(docSnap => {
      const item = docSnap.data();
      if (item.quantity <= item.alertLevel) {
        hasAlerts = true;
        const div = document.createElement("div");
        div.className = "alert critical";
        div.textContent = `⚠️ Low stock for ${item.name} (${item.quantity} remaining)`;
        alertsBox.appendChild(div);
      }
    });
    if (!hasAlerts) {
      alertsBox.innerHTML = "<p>No inventory alerts</p>";
    }
  });

  // -------------------------------
  // 3️⃣ Today's bookings/events
  const todayEventsDiv = document.getElementById("todayEvents");
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0]; // YYYY-MM-DD

  const eventsQuery = query(
    collection(db, "bookings"),
    where("businessId", "==", userId),
    where("date", "==", todayStr),
    orderBy("time", "asc")
  );

  onSnapshot(eventsQuery, (snapshot) => {
    todayEventsDiv.innerHTML = "";
    if (snapshot.empty) {
      todayEventsDiv.innerHTML = "<p>No events today 🎉</p>";
      return;
    }
    snapshot.forEach(docSnap => {
      const event = docSnap.data();
      const div = document.createElement("div");
      div.className = "event";
      div.innerHTML = `
        <h4>${event.name}</h4>
        <p>${event.items.map(i => `${i.name} × ${i.quantity}`).join(", ")}</p>
        <p class="muted">Location: ${event.location}</p>
        <span class="status ${event.status.toLowerCase()}">${event.status}</span>
      `;
      todayEventsDiv.appendChild(div);
    });
  });

  // -------------------------------
  // 4️⃣ Reminders
  const remindersList = document.getElementById("remindersList");
  const remindersQuery = query(collection(db, "reminders"), where("businessId", "==", userId));

  onSnapshot(remindersQuery, (snapshot) => {
    remindersList.innerHTML = "";
    if (snapshot.empty) {
      remindersList.innerHTML = "<li>No reminders</li>";
      return;
    }
    snapshot.forEach(docSnap => {
      const reminder = docSnap.data();
      const li = document.createElement("li");
      li.textContent = `⏰ ${reminder.message} ${reminder.date ? `(${reminder.date})` : ""}`;
      remindersList.appendChild(li);
    });
  });
});


const todayEventsWrapper = document.querySelector(".dashboard .card .event-wrapper"); // create this div in your HTML

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const businessId = user.uid;

  const bookingsRef = collection(db, "businesses", businessId, "bookings");
  const snapshot = await getDocs(bookingsRef);

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0]; // yyyy-mm-dd

  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.bookingDate === todayStr) {
      const eventDiv = document.createElement("div");
      eventDiv.className = "event";
      eventDiv.innerHTML = `
        <h4>${data.bookingName}</h4>
        <p>${data.items.map(i => `${i.name} × ${i.quantity}`).join(", ")}</p>
        <p class="muted">Client: ${data.client || "N/A"}</p>
      `;
      todayEventsWrapper.appendChild(eventDiv);
    }
  });
});
