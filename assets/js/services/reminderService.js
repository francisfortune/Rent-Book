// assets/js/services/reminderService.js
// Handles reminders and alerts generation

import { db } from "../firebase.js";
import {
    collection,
    doc,
    setDoc,
    getDocs,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    onSnapshot,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { getLowStockItems } from "./inventoryService.js";
import { getUpcomingBookings } from "./bookingService.js";
import { getExternalRentals, getBorrowedItems } from "./rentalService.js";

/**
 * Create a manual reminder
 * @param {string} businessId 
 * @param {Object} reminderData 
 * @returns {Promise<string>} reminderId
 */
export async function createReminder(businessId, reminderData) {
    try {
        const reminderRef = doc(collection(db, "businesses", businessId, "reminders"));
        const reminderId = reminderRef.id;

        await setDoc(reminderRef, {
            type: reminderData.type || "custom", // custom, call_supplier, booking, rental_return
            title: reminderData.title,
            message: reminderData.message,
            dueDate: reminderData.dueDate,
            priority: reminderData.priority || "medium", // low, medium, high
            status: "pending", // pending, completed, dismissed
            relatedId: reminderData.relatedId || null, // booking ID, rental ID, etc.
            createdAt: serverTimestamp()
        });

        return reminderId;
    } catch (error) {
        console.error("Error creating reminder:", error);
        throw new Error("Failed to create reminder.");
    }
}

/**
 * Get all reminders
 * @param {string} businessId 
 * @param {string} status - Optional filter by status
 * @returns {Promise<Array>}
 */
export async function getReminders(businessId, status = "pending") {
    try {
        const remindersRef = collection(db, "businesses", businessId, "reminders");
        let q;

        if (status) {
            q = query(remindersRef, where("status", "==", status), orderBy("dueDate", "asc"));
        } else {
            q = query(remindersRef, orderBy("dueDate", "asc"));
        }

        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    } catch (error) {
        console.error("Error getting reminders:", error);
        throw new Error("Failed to load reminders.");
    }
}

/**
 * Mark reminder as completed
 * @param {string} businessId 
 * @param {string} reminderId 
 */
export async function completeReminder(businessId, reminderId) {
    try {
        await updateDoc(doc(db, "businesses", businessId, "reminders", reminderId), {
            status: "completed",
            completedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.error("Error completing reminder:", error);
        throw new Error("Failed to complete reminder.");
    }
}

/**
 * Dismiss a reminder
 * @param {string} businessId 
 * @param {string} reminderId 
 */
export async function dismissReminder(businessId, reminderId) {
    try {
        await updateDoc(doc(db, "businesses", businessId, "reminders", reminderId), {
            status: "dismissed",
            dismissedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.error("Error dismissing reminder:", error);
        throw new Error("Failed to dismiss reminder.");
    }
}

/**
 * Delete a reminder
 * @param {string} businessId 
 * @param {string} reminderId 
 */
export async function deleteReminder(businessId, reminderId) {
    try {
        await deleteDoc(doc(db, "businesses", businessId, "reminders", reminderId));
    } catch (error) {
        console.error("Error deleting reminder:", error);
        throw new Error("Failed to delete reminder.");
    }
}

/**
 * Generate alerts based on current business state
 * @param {string} businessId 
 * @returns {Promise<Array>} alerts
 */
export async function generateAlerts(businessId) {
    try {
        const alerts = [];
        const today = new Date().toISOString().split('T')[0];

        // 1. Low Stock Alerts
        const lowStockItems = await getLowStockItems(businessId);
        lowStockItems.forEach(item => {
            alerts.push({
                type: "low_stock",
                severity: "warning",
                title: "Low Stock Alert",
                message: `${item.name} is running low. Available: ${item.availableQuantity}, Threshold: ${item.warningThreshold}`,
                itemId: item.id,
                itemName: item.name
            });
        });

        // 2. Upcoming Bookings (next 2 days)
        const upcomingBookings = await getUpcomingBookings(businessId);
        const twoDaysFromNow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        upcomingBookings.forEach(booking => {
            if (booking.eventDate <= twoDaysFromNow) {
                alerts.push({
                    type: "upcoming_booking",
                    severity: "info",
                    title: "Upcoming Event",
                    message: `${booking.eventName} for ${booking.clientName} on ${booking.eventDate}`,
                    bookingId: booking.id
                });
            }
        });

        // 3. Overdue External Rentals
        const externalRentals = await getExternalRentals(businessId);
        externalRentals.forEach(rental => {
            if (rental.status === "overdue" || (rental.status === "active" && rental.returnDate < today)) {
                alerts.push({
                    type: "overdue_rental",
                    severity: "error",
                    title: "Overdue Rental",
                    message: `${rental.quantity} ${rental.itemName} from ${rental.rentedTo} was due on ${rental.returnDate}`,
                    rentalId: rental.id
                });
            }
        });

        // 4. Overdue Borrowed Items
        const borrowedItems = await getBorrowedItems(businessId);
        borrowedItems.forEach(item => {
            if (item.status === "overdue" || (item.status === "active" && item.returnDate < today)) {
                alerts.push({
                    type: "overdue_borrow",
                    severity: "error",
                    title: "Overdue Return",
                    message: `${item.quantity} ${item.itemName} borrowed from ${item.borrowedFrom} was due on ${item.returnDate}`,
                    borrowId: item.id
                });
            }
        });

        // 5. Pending Payments
        const bookingsRef = collection(db, "businesses", businessId, "bookings");
        const pendingPaymentsQuery = query(
            bookingsRef,
            where("paymentStatus", "in", ["pending", "partial"]),
            where("status", "==", "active")
        );
        const pendingSnapshot = await getDocs(pendingPaymentsQuery);

        pendingSnapshot.docs.forEach(doc => {
            const booking = doc.data();
            const remaining = (booking.totalAmount || 0) - (booking.amountPaid || 0);
            if (remaining > 0) {
                alerts.push({
                    type: "pending_payment",
                    severity: "warning",
                    title: "Pending Payment",
                    message: `${booking.clientName} has ₦${remaining.toLocaleString()} pending for ${booking.eventName}`,
                    bookingId: doc.id
                });
            }
        });

        return alerts;
    } catch (error) {
        console.error("Error generating alerts:", error);
        return [];
    }
}

/**
 * Get dashboard summary with alerts and reminders
 * @param {string} businessId 
 * @returns {Promise<Object>}
 */
export async function getDashboardSummary(businessId) {
    try {
        const [alerts, reminders] = await Promise.all([
            generateAlerts(businessId),
            getReminders(businessId, "pending")
        ]);

        // Filter reminders for today and upcoming
        const today = new Date().toISOString().split('T')[0];
        const todayReminders = reminders.filter(r => r.dueDate === today);
        const upcomingReminders = reminders.filter(r => r.dueDate > today);

        return {
            alerts: {
                total: alerts.length,
                critical: alerts.filter(a => a.severity === "error").length,
                warnings: alerts.filter(a => a.severity === "warning").length,
                info: alerts.filter(a => a.severity === "info").length,
                items: alerts
            },
            reminders: {
                total: reminders.length,
                today: todayReminders.length,
                upcoming: upcomingReminders.length,
                items: reminders
            }
        };
    } catch (error) {
        console.error("Error getting dashboard summary:", error);
        throw new Error("Failed to load dashboard summary.");
    }
}

/**
 * Auto-generate reminders for upcoming bookings
 * @param {string} businessId 
 * @returns {Promise<number>} count of reminders created
 */
export async function autoGenerateBookingReminders(businessId) {
    try {
        const upcomingBookings = await getUpcomingBookings(businessId);
        let count = 0;

        for (const booking of upcomingBookings) {
            // Check if reminder already exists
            const remindersRef = collection(db, "businesses", businessId, "reminders");
            const q = query(
                remindersRef,
                where("relatedId", "==", booking.id),
                where("type", "==", "booking")
            );
            const existing = await getDocs(q);

            if (existing.empty) {
                // Create reminder 1 day before event
                const eventDate = new Date(booking.eventDate);
                const reminderDate = new Date(eventDate.getTime() - 24 * 60 * 60 * 1000);
                const reminderDateStr = reminderDate.toISOString().split('T')[0];

                await createReminder(businessId, {
                    type: "booking",
                    title: "Upcoming Event Reminder",
                    message: `Prepare items for ${booking.eventName} - ${booking.clientName}`,
                    dueDate: reminderDateStr,
                    priority: "high",
                    relatedId: booking.id
                });
                count++;
            }
        }

        return count;
    } catch (error) {
        console.error("Error auto-generating reminders:", error);
        return 0;
    }
}

/**
 * Listen to reminders changes in real-time
 * @param {string} businessId 
 * @param {Function} callback 
 * @returns {Function} unsubscribe function
 */
export function onRemindersChange(businessId, callback) {
    const remindersRef = collection(db, "businesses", businessId, "reminders");
    const q = query(remindersRef, where("status", "==", "pending"), orderBy("dueDate", "asc"));

    return onSnapshot(q, (snapshot) => {
        const reminders = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        callback(reminders);
    }, (error) => {
        console.error("Error listening to reminders changes:", error);
    });
}
