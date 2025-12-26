# RentBook Backend Documentation

## 📚 Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Database Schema](#database-schema)
3. [Service Layer](#service-layer)
4. [Security Rules](#security-rules)
5. [Integration Guide](#integration-guide)
6. [Deployment](#deployment)

---

## 🏗️ Architecture Overview

RentBook uses a **service-oriented architecture** with Firebase as the backend:

```
Frontend (HTML/JS)
    ↓
Service Layer (Business Logic)
    ↓
Firebase (Auth + Firestore + Storage)
```

### Key Components:
- **Authentication Service**: User signup, login, password reset
- **Business Service**: Business management, staff permissions
- **Inventory Service**: Stock management with atomic transactions
- **Booking Service**: Event bookings with automatic inventory deduction
- **Rental Service**: Rental-to-rental tracking
- **Reminder Service**: Alerts and reminders generation

---

## 🗄️ Database Schema

### Collections Structure

```
users/{uid}
  - uid: string
  - email: string
  - name: string
  - role: "owner" | "staff"
  - businessId: string
  - createdAt: timestamp

businesses/{businessId}
  - name: string
  - type: string (Event Rental, Equipment, etc.)
  - city: string
  - state: string
  - rentalModel: string
  - returnDuration: string
  - ownerId: string
  - createdAt: timestamp
  - updatedAt: timestamp
  
  /inventory/{itemId}
    - name: string
    - totalQuantity: number
    - availableQuantity: number
    - warningThreshold: number
    - createdAt: timestamp
  
  /bookings/{bookingId}
    - eventName: string
    - clientName: string
    - clientPhone: string
    - clientEmail: string
    - eventDate: string (YYYY-MM-DD)
    - eventTime: string
    - location: string
    - items: array [{itemId, itemName, quantity}]
    - additionalInfo: string
    - status: "active" | "completed" | "cancelled"
    - paymentStatus: "pending" | "partial" | "paid"
    - amountPaid: number
    - totalAmount: number
    - createdBy: string (userId)
    - createdAt: timestamp
    - updatedAt: timestamp
  
  /staff/{staffId}
    - name: string
    - email: string
    - role: string
    - permissions: {
        viewBookings: boolean
        addBookings: boolean
        editBookings: boolean
        editInventory: boolean
        manageRentals: boolean
      }
    - businessId: string
    - createdAt: timestamp
  
  /externalRentals/{rentalId}
    - itemId: string
    - itemName: string
    - quantity: number
    - rentedTo: string (business name)
    - contactPerson: string
    - contactPhone: string
    - rentalDate: string
    - returnDate: string
    - status: "active" | "returned" | "overdue"
    - notes: string
    - createdAt: timestamp
  
  /borrowedItems/{borrowId}
    - itemName: string
    - quantity: number
    - borrowedFrom: string (business name)
    - contactPerson: string
    - contactPhone: string
    - borrowDate: string
    - returnDate: string
    - eventName: string
    - status: "active" | "returned" | "overdue"
    - notes: string
    - createdAt: timestamp
  
  /reminders/{reminderId}
    - type: "custom" | "call_supplier" | "booking" | "rental_return"
    - title: string
    - message: string
    - dueDate: string (YYYY-MM-DD)
    - priority: "low" | "medium" | "high"
    - status: "pending" | "completed" | "dismissed"
    - relatedId: string (optional)
    - createdAt: timestamp
```

---

## 🔧 Service Layer

### 1. Authentication Service (`authService.js`)

```javascript
import { registerUser, loginUser, logoutUser, resetPassword, getCurrentUserData, onAuthChange } from './services/authService.js';

// Register new user
const { user, needsSetup } = await registerUser(email, password, name);

// Login
const { user, userData, needsSetup } = await loginUser(email, password);

// Logout
await logoutUser();

// Password reset
await resetPassword(email);

// Get current user data
const userData = await getCurrentUserData();

// Listen to auth changes
const unsubscribe = onAuthChange((user) => {
  if (user) {
    // User is signed in
  } else {
    // User is signed out
  }
});
```

### 2. Business Service (`businessService.js`)

```javascript
import { createBusiness, getBusiness, updateBusiness, addStaff, getStaff, updateStaffPermissions, checkPermission } from './services/businessService.js';

// Create business
const businessId = await createBusiness(userId, {
  name: "Benfra Rentals",
  type: "Event Rental",
  city: "Enugu",
  state: "Enugu",
  rentalModel: "daily",
  returnDuration: "24hours"
});

// Get business
const business = await getBusiness(businessId);

// Add staff
const staffId = await addStaff(businessId, {
  name: "John Doe",
  email: "john@example.com",
  role: "booking-only",
  permissions: {
    viewBookings: true,
    addBookings: true,
    editBookings: false,
    editInventory: false,
    manageRentals: false
  }
});

// Check permission
const canEdit = await checkPermission(userId, businessId, "editInventory");
```

### 3. Inventory Service (`inventoryService.js`)

```javascript
import { addInventoryItem, getInventory, updateInventoryItem, checkAvailability, getLowStockItems, onInventoryChange } from './services/inventoryService.js';

// Add inventory item
const itemId = await addInventoryItem(businessId, {
  name: "Chairs",
  totalQuantity: 500,
  warningThreshold: 50
});

// Get all inventory
const inventory = await getInventory(businessId);

// Check availability
const { available, shortages } = await checkAvailability(businessId, [
  { itemId: "item123", quantity: 100 }
]);

// Get low stock items
const lowStock = await getLowStockItems(businessId);

// Real-time updates
const unsubscribe = onInventoryChange(businessId, (inventory) => {
  console.log("Inventory updated:", inventory);
});
```

### 4. Booking Service (`bookingService.js`)

```javascript
import { createBooking, getBookings, completeBooking, cancelBooking, getTodaysBookings, onBookingsChange } from './services/bookingService.js';

// Create booking (automatically deducts inventory)
const bookingId = await createBooking(businessId, userId, {
  eventName: "Wedding Ceremony",
  clientName: "John Doe",
  clientPhone: "08012345678",
  eventDate: "2025-08-10",
  location: "New Haven Hall",
  items: [
    { itemId: "item123", itemName: "Chairs", quantity: 500 },
    { itemId: "item456", itemName: "Canopy", quantity: 2 }
  ],
  totalAmount: 150000,
  paymentStatus: "pending"
});

// Get today's bookings
const todayBookings = await getTodaysBookings(businessId);

// Complete booking (restores inventory)
await completeBooking(businessId, bookingId);

// Cancel booking (restores inventory)
await cancelBooking(businessId, bookingId, "Client cancelled");

// Real-time updates
const unsubscribe = onBookingsChange(businessId, (bookings) => {
  console.log("Bookings updated:", bookings);
});
```

### 5. Rental Service (`rentalService.js`)

```javascript
import { addExternalRental, addBorrowedItem, getExternalRentals, getBorrowedItems, markExternalRentalReturned } from './services/rentalService.js';

// Add external rental
const rentalId = await addExternalRental(businessId, {
  itemId: "item123",
  itemName: "Chairs",
  quantity: 100,
  rentedTo: "Example Rentals",
  contactPerson: "Jane Doe",
  contactPhone: "08098765432",
  rentalDate: "2025-08-01",
  returnDate: "2025-08-05"
});

// Add borrowed item
const borrowId = await addBorrowedItem(businessId, {
  itemName: "Canopy",
  quantity: 2,
  borrowedFrom: "City Events",
  rentalDate: "2025-08-01",
  returnDate: "2025-08-06",
  eventName: "Burial"
});

// Mark as returned
await markExternalRentalReturned(businessId, rentalId);
```

### 6. Reminder Service (`reminderService.js`)

```javascript
import { createReminder, getReminders, generateAlerts, getDashboardSummary, completeReminder } from './services/reminderService.js';

// Create manual reminder
const reminderId = await createReminder(businessId, {
  type: "call_supplier",
  title: "Call Supplier",
  message: "Call Example Rentals to reserve chairs",
  dueDate: "2025-08-01",
  priority: "high"
});

// Get all alerts
const alerts = await generateAlerts(businessId);

// Get dashboard summary
const summary = await getDashboardSummary(businessId);
// Returns: { alerts: {...}, reminders: {...} }

// Complete reminder
await completeReminder(businessId, reminderId);
```

---

## 🔒 Security Rules

The Firestore security rules ensure:
- **Multi-tenant isolation**: Users can only access their own business data
- **Role-based permissions**: Owners have full access, staff have limited access
- **Data validation**: Proper field validation and constraints

To deploy security rules:
```bash
firebase deploy --only firestore:rules
```

---

## 🔗 Integration Guide

### Step 1: Import Services

In your HTML files, import the services you need:

```html
<script type="module">
  import { loginUser, registerUser } from './assets/js/services/authService.js';
  import { createBooking, getTodaysBookings } from './assets/js/services/bookingService.js';
  import { getInventory } from './assets/js/services/inventoryService.js';
  import { getDashboardSummary } from './assets/js/services/reminderService.js';
  
  // Your code here
</script>
```

### Step 2: Handle Authentication

```javascript
// On login page
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  
  try {
    const { user, userData, needsSetup } = await loginUser(email, password);
    
    if (needsSetup) {
      window.location.href = 'setup.html';
    } else {
      window.location.href = 'dashboard.html';
    }
  } catch (error) {
    alert(error.message);
  }
});
```

### Step 3: Load Dashboard Data

```javascript
// On dashboard page
import { getCurrentUserData } from './assets/js/services/authService.js';
import { getDashboardSummary } from './assets/js/services/reminderService.js';
import { getTodaysBookings } from './assets/js/services/bookingService.js';
import { getInventorySummary } from './assets/js/services/inventoryService.js';

async function loadDashboard() {
  const userData = await getCurrentUserData();
  const businessId = userData.businessId;
  
  // Load summary
  const summary = await getDashboardSummary(businessId);
  displayAlerts(summary.alerts.items);
  displayReminders(summary.reminders.items);
  
  // Load today's bookings
  const todayBookings = await getTodaysBookings(businessId);
  displayTodayBookings(todayBookings);
  
  // Load inventory summary
  const inventorySummary = await getInventorySummary(businessId);
  displayInventorySummary(inventorySummary);
}

loadDashboard();
```

### Step 4: Create Bookings

```javascript
// On add booking page
import { createBooking } from './assets/js/services/bookingService.js';
import { getCurrentUserData } from './assets/js/services/authService.js';

document.getElementById('bookingForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const userData = await getCurrentUserData();
  const businessId = userData.businessId;
  
  const bookingData = {
    eventName: document.getElementById('eventName').value,
    clientName: document.getElementById('clientName').value,
    clientPhone: document.getElementById('clientPhone').value,
    eventDate: document.getElementById('eventDate').value,
    items: getSelectedItems(), // Your function to collect items
    totalAmount: parseFloat(document.getElementById('totalAmount').value),
    paymentStatus: 'pending'
  };
  
  try {
    const bookingId = await createBooking(businessId, userData.uid, bookingData);
    alert('Booking created successfully!');
    window.location.href = 'bookings.html';
  } catch (error) {
    alert(error.message);
  }
});
```

---

## 🚀 Deployment

### Prerequisites
1. Firebase CLI installed: `npm install -g firebase-tools`
2. Firebase project created

### Steps

1. **Initialize Firebase** (if not already done):
```bash
firebase login
firebase init
```

2. **Deploy Security Rules**:
```bash
firebase deploy --only firestore:rules
```

3. **Deploy Hosting** (if using Firebase Hosting):
```bash
firebase deploy --only hosting
```

4. **Test the Application**:
   - Create a test account
   - Complete business setup
   - Add inventory items
   - Create a booking
   - Verify inventory deduction
   - Check dashboard alerts

### Environment Variables

Make sure your `firebase.js` has the correct configuration:

```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

---

## 📝 Notes

- **Booking History**: All bookings are kept permanently (never deleted). Status changes to "completed" or "cancelled".
- **Real-time Sync**: All staff see updates instantly via Firestore real-time listeners.
- **Inventory Accuracy**: Atomic transactions ensure inventory is never over-booked.
- **Alerts**: Auto-generated based on current state (no manual cleanup needed).
- **Permissions**: Owners can do everything; staff permissions are granular.

---

## 🆘 Support

For issues or questions, check:
1. Browser console for errors
2. Firebase console for Firestore data
3. Security rules for permission issues

---

**Built with ❤️ for RentBook**
