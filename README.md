# 🎉 RentBook - Event Rental Management System

**RentBook** is a comprehensive web application designed for event rental businesses to manage bookings, inventory, staff, and customer relationships efficiently.

---

## ✨ Features

### 🔐 **Authentication & Business Setup**
- User registration and login
- Multi-step business onboarding
- Business profile management

### 📦 **Inventory Management**
- Real-time stock tracking
- Automatic availability calculation
- Low stock alerts
- Atomic transaction support (prevents overbooking)

### 📅 **Booking System**
- Create and manage event bookings
- Automatic inventory deduction
- Booking status tracking (active, completed, cancelled)
- Payment tracking
- Real-time sync across all staff

### 👥 **Staff Management**
- Add and manage staff members
- Role-based permissions
- Multi-user real-time collaboration

### 🔄 **Rental-to-Rental Tracking**
- Track items rented to other businesses
- Track items borrowed from other businesses
- Overdue alerts

### 🔔 **Smart Alerts & Reminders**
- Low stock warnings
- Upcoming event reminders
- Overdue rental notifications
- Pending payment alerts

### 📊 **Dashboard Analytics**
- Today's events overview
- Inventory summary
- Recent bookings
- Alert center

---

## 🏗️ Tech Stack

### **Frontend**
- HTML5 / CSS3 / JavaScript (Vanilla)
- Tailwind CSS for styling
- Responsive design

### **Backend**
- Firebase Authentication
- Cloud Firestore (NoSQL Database)
- Real-time data synchronization
- Serverless architecture

### **Architecture**
- Service-oriented design
- Atomic transactions for data integrity
- Multi-tenant isolation
- Role-based access control

---

## 🚀 Quick Start

### Prerequisites
- Firebase account
- Firebase CLI installed: `npm install -g firebase-tools`

### 1. Clone the Repository
```bash
git clone https://github.com/francisfortune/rentbook.git
cd rentbook
```

### 2. Configure Firebase
Update `assets/js/firebase.js` with your Firebase config:
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

### 3. Deploy Security Rules
```bash
firebase login
firebase deploy --only firestore:rules
```

### 4. Open the App
Open `index.html` in your browser or deploy to Firebase Hosting:
```bash
firebase deploy --only hosting
```

---

## 📚 Documentation

### **For Developers**
- **[QUICK_START.md](QUICK_START.md)** - Get started in 5 minutes
- **[BACKEND_DOCUMENTATION.md](BACKEND_DOCUMENTATION.md)** - Complete API reference
- **[INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md)** - Step-by-step integration guide

### **Key Concepts**
- **Multi-Tenant Architecture**: Each business's data is completely isolated
- **Real-Time Sync**: All staff see updates instantly without page refresh
- **Atomic Transactions**: Inventory is never over-booked, even with concurrent bookings
- **Booking History**: All bookings are preserved permanently for auditing

---

## 🗂️ Project Structure

```
Rent-Book/
├── assets/
│   ├── js/
│   │   ├── services/              # Backend service layer
│   │   │   ├── authService.js     # Authentication
│   │   │   ├── businessService.js # Business management
│   │   │   ├── inventoryService.js# Inventory tracking
│   │   │   ├── bookingService.js  # Booking operations
│   │   │   ├── rentalService.js   # Rental-to-rental
│   │   │   └── reminderService.js # Alerts & reminders
│   │   ├── firebase.js            # Firebase config
│   │   ├── setup.js               # Business setup wizard
│   │   ├── dashboard.js           # Dashboard logic
│   │   ├── bookings.js            # Bookings page
│   │   ├── inventory.js           # Inventory page
│   │   └── ...
│   └── css/                       # Stylesheets
├── firestore.rules                # Security rules
├── firebase.json                  # Firebase config
├── index.html                     # Landing page
├── signup.html                    # Registration
├── log-in.html                    # Login
├── setup.html                     # Business setup
├── dashboard.html                 # Main dashboard
├── booking.html                   # Bookings page
├── inventory.html                 # Inventory page
└── settings.html                  # Settings
```

---

## 🔒 Security

### **Firestore Security Rules**
- Multi-tenant data isolation
- Role-based access control
- Owner and staff permission levels
- Data validation at database level

### **Authentication**
- Email/password authentication
- Secure password reset
- Session management

---

## 🧪 Testing

### **Manual Testing Checklist**
1. ✅ Sign up new user
2. ✅ Complete business setup
3. ✅ Add inventory items
4. ✅ Create a booking (verify inventory deduction)
5. ✅ Complete booking (verify inventory restoration)
6. ✅ Test real-time sync (open in two browsers)
7. ✅ Check dashboard alerts
8. ✅ Add staff member
9. ✅ Test staff permissions

### **Test Scenarios**
See [QUICK_START.md](QUICK_START.md) for detailed testing scenarios.

---

## 📊 Database Schema

### **Collections**
- `users` - User accounts
- `businesses` - Business profiles
  - `inventory` - Inventory items (subcollection)
  - `bookings` - Event bookings (subcollection)
  - `staff` - Staff members (subcollection)
  - `externalRentals` - Items rented out (subcollection)
  - `borrowedItems` - Items borrowed (subcollection)
  - `reminders` - Alerts and reminders (subcollection)

See [BACKEND_DOCUMENTATION.md](BACKEND_DOCUMENTATION.md) for complete schema details.

---

## 🎯 Key Features Explained

### **1. Automatic Inventory Management**
When a booking is created:
1. System checks inventory availability
2. If available, booking is created
3. Inventory is automatically deducted
4. When booking is completed/cancelled, inventory is restored

### **2. Real-Time Synchronization**
- All changes sync instantly across all devices
- Multiple staff can work simultaneously
- No page refresh needed
- Uses Firestore real-time listeners

### **3. Smart Alerts**
Dashboard automatically shows:
- Low stock items (below threshold)
- Upcoming events (next 2 days)
- Overdue rentals
- Pending payments

### **4. Rental-to-Rental Tracking**
- Track items you've rented to other businesses
- Track items you've borrowed from others
- Automatic overdue detection
- Return management

---

## 🚀 Deployment

### **Firebase Hosting**
```bash
# Build and deploy
firebase deploy

# Deploy only hosting
firebase deploy --only hosting

# Deploy only security rules
firebase deploy --only firestore:rules
```

### **Custom Domain**
Configure in Firebase Console → Hosting → Add custom domain

---

## 🔧 Configuration

### **Environment Variables**
Update `assets/js/firebase.js` with your Firebase credentials.

### **Business Settings**
Configurable in the app:
- Business name and type
- Location
- Rental model (daily, weekly, etc.)
- Default return duration
- Inventory warning thresholds 
