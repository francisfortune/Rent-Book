// assets/js/services/reminderService.js
// Handles reminders, alerts, and automated notification generation.

import { db } from "../firebase.js";
import {
    collection,
    doc,
    setDoc,
    getDoc,
    addDoc,
    getDocs,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    onSnapshot,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { sendPush } from "../onesignal.js";

import { getLowStockItems } from "./inventoryService.js";
import { getUpcomingBookings } from "./bookingService.js";
import { getExternalRentals, getBorrowedItems } from "./rentalService.js";

/* =========================================================
   MULTI-CHANNEL NOTIFICATION HELPER
   ----------------------------------------
   Every notification in this file goes through notifyAll().
   It writes the in-app document, fires the OneSignal push, and
   (if a server endpoint exists) requests email/SMS delivery.

   Email and SMS are best-effort: if the endpoint isn't
   configured, they silently no-op. The in-app + push path
   always works even when email/SMS are off.
========================================================= */
async function notifyAll({
    businessId,
    message,
    type,
    bookingId = null,
    itemId = null,
    deepLink = "/dashboard.html",
    clientEmail = null,     // optional — recipient of the email
    clientPhone = null,     // optional — recipient of the SMS
    clientName = null,      // optional — used in email/SMS greeting
    channels = ["inapp", "push"]  // add "email" / "sms" to opt in
}) {
    const results = { inapp: false, push: false, email: false, sms: false };

    /* ---------- 1. In-app notification (Firestore) ---------- */
    if (channels.includes("inapp")) {
        try {
            const payload = {
                message,
                type,
                triggeredBy: "System",
                createdAt: serverTimestamp(),
                readBy: [],
                deletedFor: []
            };
            if (bookingId) payload.bookingId = bookingId;
            if (itemId) payload.itemId = itemId;

            await addDoc(
                collection(db, "businesses", businessId, "notifications"),
                payload
            );
            results.inapp = true;
        } catch (err) {
            console.error("[notifyAll] in-app write failed:", err);
        }
    }

    /* ---------- 2. Push notification (OneSignal) ---------- */
    if (channels.includes("push")) {
        try {
            await sendPush(message, deepLink);
            results.push = true;
        } catch (err) {
            console.warn("[notifyAll] push failed:", err.message);
        }
    }

    /* ---------- 3. Email + SMS (serverless relay) ----------
       Both are handled by one endpoint so the client stays simple.
       The endpoint decides which provider to call based on the
       `channel` field. If the endpoint isn't deployed, both
       silently fail without breaking the main flow. */
    const needsServerRelay = channels.includes("email") || channels.includes("sms");
    if (needsServerRelay) {
        try {
            const res = await fetch("/api/send-notification", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    businessId,
                    message,
                    type,
                    bookingId,
                    deepLink,
                    clientEmail,
                    clientPhone,
                    clientName,
                    channels: channels.filter(c => c === "email" || c === "sms")
                })
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                if (data.email) results.email = true;
                if (data.sms) results.sms = true;
            } else {
                console.warn("[notifyAll] email/SMS relay returned error:", data);
            }
        } catch (err) {
            // Endpoint may not exist yet — this is a soft failure by design.
            console.warn("[notifyAll] email/SMS relay unreachable:", err.message);
        }
    }

    return results;
}

/* =========================================================
   MANUAL REMINDERS (user-created)
========================================================= */
export async function createReminder(businessId, reminderData) {
    try {
        const reminderRef = doc(collection(db, "businesses", businessId, "reminders"));
        await setDoc(reminderRef, {
            type: reminderData.type || "custom",
            title: reminderData.title,
            message: reminderData.message,
            dueDate: reminderData.dueDate,
            priority: reminderData.priority || "medium",
            status: "pending",
            relatedId: reminderData.relatedId || null,
            createdAt: serverTimestamp()
        });
        return reminderRef.id;
    } catch (error) {
        console.error("Error creating reminder:", error);
        throw new Error("Failed to create reminder.");
    }
}

export async function getReminders(businessId, status = "pending") {
    try {
        const remindersRef = collection(db, "businesses", businessId, "reminders");
        const q = status
            ? query(remindersRef, where("status", "==", status), orderBy("dueDate", "asc"))
            : query(remindersRef, orderBy("dueDate", "asc"));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (error) {
        console.error("Error getting reminders:", error);
        throw new Error("Failed to load reminders.");
    }
}

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

export async function deleteReminder(businessId, reminderId) {
    try {
        await deleteDoc(doc(db, "businesses", businessId, "reminders", reminderId));
    } catch (error) {
        console.error("Error deleting reminder:", error);
        throw new Error("Failed to delete reminder.");
    }
}

/* =========================================================
   ALERTS (read-only, for dashboard summary)
========================================================= */
export async function generateAlerts(businessId) {
    try {
        const alerts = [];
        const today = new Date().toISOString().split("T")[0];

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

        const upcomingBookings = await getUpcomingBookings(businessId);
        const twoDaysFromNow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
            .toISOString().split("T")[0];

        upcomingBookings.forEach(booking => {
            if (booking.eventDate <= twoDaysFromNow) {
                alerts.push({
                    type: "upcoming_booking",
                    severity: "info",
                    title: "Upcoming Event",
                    message: `${booking.clientName} Has an Event on ${booking.eventDate}`,
                    bookingId: booking.id
                });
            }
        });

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

        const bookingsRef = collection(db, "businesses", businessId, "bookings");
        const pendingPaymentsQuery = query(
            bookingsRef,
            where("paymentStatus", "in", ["pending", "partial"]),
            where("status", "==", "active")
        );
        const pendingSnapshot = await getDocs(pendingPaymentsQuery);

        pendingSnapshot.docs.forEach(d => {
            const booking = d.data();
            const remaining = (booking.totalAmount || 0) - (booking.amountPaid || 0);
            if (remaining > 0) {
                alerts.push({
                    type: "pending_payment",
                    severity: "warning",
                    title: "Pending Payment",
                    message: `${booking.clientName} has ₦${remaining.toLocaleString()} pending for ${booking.eventName}`,
                    bookingId: d.id
                });
            }
        });

        return alerts;
    } catch (error) {
        console.error("Error generating alerts:", error);
        return [];
    }
}

export async function getDashboardSummary(businessId) {
    try {
        const [alerts, reminders] = await Promise.all([
            generateAlerts(businessId),
            getReminders(businessId, "pending")
        ]);

        const today = new Date().toISOString().split("T")[0];
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

/* =========================================================
   AUTO-GENERATE REMINDERS (from bookings)
========================================================= */
export async function autoGenerateBookingReminders(businessId) {
    try {
        const upcomingBookings = await getUpcomingBookings(businessId);
        let count = 0;

        for (const booking of upcomingBookings) {
            const remindersRef = collection(db, "businesses", businessId, "reminders");
            const q = query(
                remindersRef,
                where("relatedId", "==", booking.id),
                where("type", "==", "booking")
            );
            const existing = await getDocs(q);

            if (existing.empty) {
                const eventDate = new Date(booking.eventDate);
                const reminderDate = new Date(eventDate.getTime() - 24 * 60 * 60 * 1000);
                const reminderDateStr = reminderDate.toISOString().split("T")[0];

                await createReminder(businessId, {
                    type: "booking",
                    title: "Upcoming Event Reminder",
                    message: `Prepare items for ${booking.clientName}`,
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

export function onRemindersChange(businessId, callback) {
    const remindersRef = collection(db, "businesses", businessId, "reminders");
    const q = query(
        remindersRef,
        where("status", "==", "pending"),
        orderBy("dueDate", "asc")
    );
    return onSnapshot(q, (snapshot) => {
        const reminders = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(reminders);
    }, (error) => {
        console.error("Error listening to reminders changes:", error);
    });
}

/* =========================================================
   AUTOMATED BACKGROUND ENGINE
   Runs from dashboard.js and bookings.js on page load
   (throttled to once every 5 minutes per business).

   Notifications generated:
     1. Return overdue          — client didn't return items
     2. Return due in 1 hour    — same-day pickup reminder
     3. Return due in 12 hours  — same-day reminder
     4. Return due in 24 hours  — next-day reminder
     5. Delivery in 2 hours     — same-day event prep
     6. Delivery in 24 hours    — day-before prep
     7. Low stock               — item below threshold

   Reminder windows are independent — each fires exactly once
   when the booking crosses into its window, regardless of
   whether the wider window already fired. This means a booking
   created 20h before return will fire its 24h reminder, then
   its 12h reminder, then its 1h reminder, in order.
========================================================= */
export async function runAutomatedChecks(businessId) {
    try {
        const businessRef = doc(db, "businesses", businessId);
        const businessSnap = await getDoc(businessRef);
        if (!businessSnap.exists()) return;

        const businessData = businessSnap.data();
        const lastCheck = businessData.lastEngineCheck;
        const now = new Date();

        // Throttle: 5 minutes (was 15 — too long, missed reminder windows)
        if (lastCheck) {
            const lastCheckTime = lastCheck.toDate ? lastCheck.toDate() : new Date(lastCheck);
            const timeDiff = now.getTime() - lastCheckTime.getTime();
            const fiveMinutes = 5 * 60 * 1000;
            if (timeDiff < fiveMinutes) {
                console.log(
                    `Automated checks throttled. Last run: ${Math.round(timeDiff / 1000)}s ago.`
                );
                return;
            }
        }

        console.log("Running automated alerts and notifications engine...");
        await updateDoc(businessRef, {
            lastEngineCheck: serverTimestamp()
        });

        /* =================================================
           SCAN ALL BOOKINGS
           No status filter — we check the status client-side
           so we never miss bookings with stale / missing status.
        ================================================= */
        const bookingsRef = collection(db, "businesses", businessId, "bookings");
        const bookingsSnap = await getDocs(bookingsRef);

        for (const bookingDoc of bookingsSnap.docs) {
            const booking = bookingDoc.data();
            const bookingId = bookingDoc.id;

            // Skip bookings that are already done — nothing to remind about.
            if (booking.status === "returned" || booking.status === "cancelled") {
                continue;
            }

            const returnDateStr = booking.event?.returnDate;
            const deliveryDateStr =
                booking.event?.deliveryDate || booking.event?.date;
            const clientName = booking.client?.name || "Client";
            const clientEmail = booking.client?.email || null;
            const clientPhone = booking.client?.phone || null;

            /* ---------- RETURN DEADLINE HANDLING ---------- */
            if (returnDateStr) {
                const returnDate = new Date(returnDateStr);
                const diffToReturn = returnDate.getTime() - now.getTime();

                if (diffToReturn < 0) {
                    /* ---- Overdue ---- */
                    if (booking.status !== "overdue" || !booking.overdueNotified) {
                        await updateDoc(bookingDoc.ref, {
                            status: "overdue",
                            overdueNotified: true,
                            updatedAt: serverTimestamp()
                        });

                        await notifyAll({
                            businessId,
                            message: `Overdue return — ${clientName} (was due ${returnDateStr})`,
                            type: "overdue_rental",
                            bookingId,
                            deepLink: `/bookings.html?highlight=${bookingId}`,
                            clientEmail,
                            clientPhone,
                            clientName,
                            channels: ["inapp", "push", "email", "sms"]
                        });
                    }
                } else {
                    const hoursRemaining = diffToReturn / (1000 * 60 * 60);

                    /* ---- 24-hour window (fires once when crossing into 24h) ---- */
                    if (
                        hoursRemaining <= 24 &&
                        hoursRemaining > 12 &&
                        !booking.returnReminder24Sent
                    ) {
                        await updateDoc(bookingDoc.ref, {
                            returnReminder24Sent: true,
                            updatedAt: serverTimestamp()
                        });
                        await notifyAll({
                            businessId,
                            message: `Return due tomorrow — ${clientName}`,
                            type: "rental_return_reminder",
                            bookingId,
                            deepLink: `/bookings.html?highlight=${bookingId}`,
                            clientEmail,
                            clientPhone,
                            clientName,
                            channels: ["inapp", "push", "email", "sms"]
                        });
                    }

                    /* ---- 12-hour window (fires once when crossing into 12h) ---- */
                    if (
                        hoursRemaining <= 12 &&
                        hoursRemaining > 1 &&
                        !booking.returnReminder12Sent
                    ) {
                        await updateDoc(bookingDoc.ref, {
                            returnReminder12Sent: true,
                            updatedAt: serverTimestamp()
                        });
                        await notifyAll({
                            businessId,
                            message: `Return due in 12 hours — ${clientName}`,
                            type: "rental_return_reminder",
                            bookingId,
                            deepLink: `/bookings.html?highlight=${bookingId}`,
                            clientEmail,
                            clientPhone,
                            clientName,
                            channels: ["inapp", "push", "email", "sms"]
                        });
                    }

                    /* ---- 1-hour window (fires once when crossing into 1h) ---- */
                    if (
                        hoursRemaining <= 1 &&
                        hoursRemaining > 0 &&
                        !booking.returnReminder1Sent
                    ) {
                        await updateDoc(bookingDoc.ref, {
                            returnReminder1Sent: true,
                            updatedAt: serverTimestamp()
                        });
                        await notifyAll({
                            businessId,
                            message: `Return due in 1 hour — ${clientName}`,
                            type: "rental_return_reminder",
                            bookingId,
                            deepLink: `/bookings.html?highlight=${bookingId}`,
                            clientEmail,
                            clientPhone,
                            clientName,
                            channels: ["inapp", "push", "sms"]
                        });
                    }
                }
            }

            /* ---------- DELIVERY / EVENT HANDLING ----------
               Only fires while the booking is still active or upcoming.
               Returned/cancelled already skipped above. */
            if (deliveryDateStr) {
                const deliveryDate = new Date(deliveryDateStr);
                const diffToDelivery = deliveryDate.getTime() - now.getTime();
                const hoursUntilDelivery = diffToDelivery / (1000 * 60 * 60);

                /* ---- 24-hour delivery reminder (only if > 2h out) ---- */
                if (
                    hoursUntilDelivery > 2 &&
                    hoursUntilDelivery <= 24 &&
                    !booking.deliveryReminder24Sent
                ) {
                    await updateDoc(bookingDoc.ref, {
                        deliveryReminder24Sent: true,
                        updatedAt: serverTimestamp()
                    });
                    await notifyAll({
                        businessId,
                        message: `Delivery tomorrow for ${clientName} on ${deliveryDateStr}. Do you remember?`,
                        type: "delivery_reminder",
                        bookingId,
                        deepLink: `/bookings.html?highlight=${bookingId}`,
                        clientEmail,
                        clientPhone,
                        clientName,
                        channels: ["inapp", "push", "email", "sms"]
                    });
                }

                /* ---- 2-hour delivery reminder ---- */
                if (
                    hoursUntilDelivery > 0 &&
                    hoursUntilDelivery <= 2 &&
                    !booking.deliveryReminder2Sent
                ) {
                    await updateDoc(bookingDoc.ref, {
                        deliveryReminder2Sent: true,
                        updatedAt: serverTimestamp()
                    });
                    await notifyAll({
                        businessId,
                        message: `Delivery in 2 hours for ${clientName}. Are you ready?`,
                        type: "delivery_reminder",
                        bookingId,
                        deepLink: `/bookings.html?highlight=${bookingId}`,
                        clientEmail,
                        clientPhone,
                        clientName,
                        channels: ["inapp", "push", "sms"]
                    });
                }
            }
        }

        /* =================================================
           LOW STOCK CHECK
        ================================================= */
        const lowStockItems = await getLowStockItems(businessId);
        for (const item of lowStockItems) {
            if (!item.lowStockNotified) {
                await updateDoc(
                    doc(db, "businesses", businessId, "inventory", item.id),
                    { lowStockNotified: true, updatedAt: serverTimestamp() }
                );

                await notifyAll({
                    businessId,
                    message: `Low stock — ${item.name} (${item.availableQuantity} left, threshold ${item.warningThreshold})`,
                    type: "low_stock",
                    itemId: item.id,
                    deepLink: "/inventory.html",
                    channels: ["inapp", "push", "email"]
                });
            }
        }

    } catch (error) {
        console.error("Error running automated background checks:", error);
    }
}
