// assets/js/services/bookingService.js
// Handles all booking operations with automatic inventory management

import { db } from "../firebase.js";
import {
    collection,
    doc,
    setDoc,
    getDoc,
    getDocs,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    limit,
    onSnapshot,
    serverTimestamp,
    Timestamp,
    runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { getInventory } from "./inventoryService.js";
import { checkDateAvailability, getBookingWindow } from "./availabilityService.js";

/**
 * Create a new booking
 * @param {string} businessId 
 * @param {string} userId - Staff/owner who created the booking
 * @param {Object} bookingData 
 * @returns {Promise<string>} bookingId
 */
export async function createBooking(businessId, userId, bookingData) {
    try {
        // 1. Validate required fields
        if (!bookingData.eventName || !bookingData.clientName || !bookingData.eventDate || !bookingData.items || bookingData.items.length === 0) {
            throw new Error("Missing required booking information");
        }

        // 2. Check inventory availability for this booking's specific date window
        //    (nothing is reserved outside that window, so other bookings on
        //    other dates never block this one).
        const inventoryItems = await getInventory(businessId);
        const { start, end } = getBookingWindow({
            event: {
                deliveryDate: bookingData.eventDate,
                returnDate: bookingData.returnDate || bookingData.eventDate
            }
        });
        const availability = await checkDateAvailability(
            businessId,
            inventoryItems,
            bookingData.items.map(i => ({ name: i.itemName || i.name, qty: i.quantity || i.qty, isCustom: i.isCustom })),
            start,
            end
        );
        if (!availability.available) {
            const shortageMessages = availability.shortages.map(s =>
                `${s.name}: Need ${s.requested}, only ${s.available} available for these dates (short by ${s.shortage})`
            ).join("\n");
            throw new Error(`Insufficient inventory for the selected dates:\n${shortageMessages}`);
        }

        // 3. Create booking document
        const bookingRef = doc(collection(db, "businesses", businessId, "bookings"));
        const bookingId = bookingRef.id;

        await setDoc(bookingRef, {
            eventName: bookingData.eventName,
            clientName: bookingData.clientName,
            clientPhone: bookingData.clientPhone || "",
            clientEmail: bookingData.clientEmail || "",
            eventDate: bookingData.eventDate,
            eventTime: bookingData.eventTime || "",
            location: bookingData.location || "",
            items: bookingData.items, // [{itemId, itemName, quantity}]
            additionalInfo: bookingData.additionalInfo || "",
            status: "active", // active, completed, cancelled
            paymentStatus: bookingData.paymentStatus || "pending", // pending, partial, paid
            amountPaid: bookingData.amountPaid || 0,
            totalAmount: bookingData.totalAmount || 0,
            createdBy: userId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        // Note: inventory is no longer permanently deducted here. Availability
        // for any date window is computed live from active bookings instead
        // (see availabilityService.js), so nothing needs to be reserved
        // up front beyond the check we already did above.

        return bookingId;
    } catch (error) {
        console.error("Error creating booking:", error);
        throw error;
    }
}

/**
 * Get all bookings for a business
 * @param {string} businessId 
 * @param {Object} filters - {status, startDate, endDate}
 * @returns {Promise<Array>}
 */
export async function getBookings(businessId, filters = {}) {
    try {
        let bookingsRef = collection(db, "businesses", businessId, "bookings");
        let q = query(bookingsRef, orderBy("eventDate", "desc"));

        // Apply status filter if provided
        if (filters.status) {
            q = query(bookingsRef, where("status", "==", filters.status), orderBy("eventDate", "desc"));
        }

        const snapshot = await getDocs(q);
        let bookings = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        // Apply date filters if provided
        if (filters.startDate) {
            bookings = bookings.filter(b => b.eventDate >= filters.startDate);
        }
        if (filters.endDate) {
            bookings = bookings.filter(b => b.eventDate <= filters.endDate);
        }

        return bookings;
    } catch (error) {
        console.error("Error getting bookings:", error);
        throw new Error("Failed to load bookings.");
    }
}

/**
 * Get a single booking
 * @param {string} businessId 
 * @param {string} bookingId 
 * @returns {Promise<Object>}
 */
export async function getBooking(businessId, bookingId) {
    try {
        const bookingDoc = await getDoc(doc(db, "businesses", businessId, "bookings", bookingId));

        if (!bookingDoc.exists()) {
            throw new Error("Booking not found");
        }

        return {
            id: bookingDoc.id,
            ...bookingDoc.data()
        };
    } catch (error) {
        console.error("Error getting booking:", error);
        throw error;
    }
}

/**
 * Update booking
 * @param {string} businessId 
 * @param {string} bookingId 
 * @param {Object} updates 
 */
export async function updateBooking(businessId, bookingId, updates) {
    try {
        await updateDoc(doc(db, "businesses", businessId, "bookings", bookingId), {
            ...updates,
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.error("Error updating booking:", error);
        throw new Error("Failed to update booking.");
    }
}

/**
 * Complete a booking (returns inventory)
 * @param {string} businessId 
 * @param {string} bookingId 
 */
export async function completeBooking(businessId, bookingId) {
    try {
        // Get booking data (kept for symmetry / future hooks — inventory no
        // longer needs restoring since it was never permanently deducted).
        await getBooking(businessId, bookingId);

        // Update booking status
        await updateDoc(doc(db, "businesses", businessId, "bookings", bookingId), {
            status: "completed",
            completedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.error("Error completing booking:", error);
        throw new Error("Failed to complete booking.");
    }
}

/**
 * Cancel a booking (returns inventory)
 * @param {string} businessId 
 * @param {string} bookingId 
 * @param {string} reason 
 */
export async function cancelBooking(businessId, bookingId, reason = "") {
    try {
        // Inventory is computed live from active bookings, so cancelling
        // simply needs to flip the status — the item's stock frees up
        // automatically because cancelled bookings are excluded from the
        // date-overlap calculation (see availabilityService.fetchActiveBookings).
        await updateDoc(doc(db, "businesses", businessId, "bookings", bookingId), {
            status: "cancelled",
            cancellationReason: reason,
            cancelledAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.error("Error cancelling booking:", error);
        throw new Error("Failed to cancel booking.");
    }
}

/**
 * Get today's bookings
 * @param {string} businessId 
 * @returns {Promise<Array>}
 */
export async function getTodaysBookings(businessId) {
    try {
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD

        const bookingsRef = collection(db, "businesses", businessId, "bookings");
        const q = query(
            bookingsRef,
            where("eventDate", "==", todayStr),
            where("status", "==", "active")
        );

        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    } catch (error) {
        console.error("Error getting today's bookings:", error);
        throw new Error("Failed to load today's bookings.");
    }
}

/**
 * Get upcoming bookings (next 7 days)
 * @param {string} businessId 
 * @returns {Promise<Array>}
 */
export async function getUpcomingBookings(businessId) {
    try {
        const today = new Date();
        const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

        const todayStr = today.toISOString().split('T')[0];
        const nextWeekStr = nextWeek.toISOString().split('T')[0];

        const bookingsRef = collection(db, "businesses", businessId, "bookings");
        const q = query(
            bookingsRef,
            where("status", "==", "active"),
            orderBy("eventDate", "asc")
        );

        const snapshot = await getDocs(q);
        const bookings = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        // Filter for upcoming week
        return bookings.filter(b => b.eventDate >= todayStr && b.eventDate <= nextWeekStr);
    } catch (error) {
        console.error("Error getting upcoming bookings:", error);
        throw new Error("Failed to load upcoming bookings.");
    }
}

/**
 * Get recent bookings
 * @param {string} businessId 
 * @param {number} limitCount 
 * @returns {Promise<Array>}
 */
export async function getRecentBookings(businessId, limitCount = 10) {
    try {
        const bookingsRef = collection(db, "businesses", businessId, "bookings");
        const snapshot = await getDocs(bookingsRef);
        const bookings = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        bookings.sort((a, b) => {
            const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 
                          (a.createdAt ? new Date(a.createdAt).getTime() : 
                          (a.event?.date ? new Date(a.event.date).getTime() : 
                          (a.date ? new Date(a.date).getTime() : 0)));
            const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 
                          (b.createdAt ? new Date(b.createdAt).getTime() : 
                          (b.event?.date ? new Date(b.event.date).getTime() : 
                          (b.date ? new Date(b.date).getTime() : 0)));
            return timeB - timeA;
        });
        return bookings.slice(0, limitCount);
    } catch (error) {
        console.error("Error getting recent bookings:", error);
        throw new Error("Failed to load recent bookings.");
    }
}

/**
 * Listen to bookings changes in real-time
 * @param {string} businessId 
 * @param {Function} callback 
 * @returns {Function} unsubscribe function
 */
export function onBookingsChange(businessId, callback) {
    const bookingsRef = collection(db, "businesses", businessId, "bookings");
    const q = query(bookingsRef, orderBy("eventDate", "desc"));

    return onSnapshot(q, (snapshot) => {
        const bookings = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        callback(bookings);
    }, (error) => {
        console.error("Error listening to bookings changes:", error);
    });
}

/**
 * Get booking statistics
 * @param {string} businessId 
 * @returns {Promise<Object>}
 */
export async function getBookingStats(businessId) {
    try {
        const bookings = await getBookings(businessId);

        const stats = {
            total: bookings.length,
            active: bookings.filter(b => b.status === "active").length,
            completed: bookings.filter(b => b.status === "completed").length,
            cancelled: bookings.filter(b => b.status === "cancelled").length,
            totalRevenue: bookings.reduce((sum, b) => sum + (b.amountPaid || 0), 0),
            pendingPayments: bookings.filter(b => b.paymentStatus === "pending" || b.paymentStatus === "partial").length
        };

        return stats;
    } catch (error) {
        console.error("Error getting booking stats:", error);
        throw new Error("Failed to get booking statistics.");
    }
}

/**
 * Search bookings by client name or event name
 * @param {string} businessId 
 * @param {string} searchTerm 
 * @returns {Promise<Array>}
 */
export async function searchBookings(businessId, searchTerm) {
    try {
        const bookings = await getBookings(businessId);
        const term = searchTerm.toLowerCase();

        return bookings.filter(b =>
            b.clientName.toLowerCase().includes(term) ||
            b.eventName.toLowerCase().includes(term)
        );
    } catch (error) {
        console.error("Error searching bookings:", error);
        throw new Error("Failed to search bookings.");
    }
}

/**
 * Updates a booking document, re-checking date-based inventory availability
 * for the (possibly changed) event window and recalculating each item's
 * shortage/borrowed amount accordingly.
 *
 * IMPORTANT: This no longer touches inventory.availableQuantity at all.
 * Availability is computed live from other bookings' date windows
 * (see availabilityService.js), so editing a booking never needs to
 * "give back" or "take" shared stock — it just needs to re-verify that,
 * for whatever dates/quantities the booking now has, enough stock is free.
 *
 * @param {string} businessId
 * @param {string} bookingId
 * @param {Object} updatedBookingData - Full/partial dot-path updates to the booking doc
 *   (may include "event.deliveryDate" / "event.date" / "event.returnDate" if dates changed)
 * @param {Array} originalItems - The items array from the booking prior to edit (unused for
 *   inventory math now, kept in the signature for backward compatibility)
 * @param {Array} updatedItems - The new items array: [{name, qty, price, total, supplier, isCustom}]
 * @returns {Promise<Array>} The updatedItems with recalculated shortage/borrowed properties
 */
export async function editBookingTransaction(businessId, bookingId, updatedBookingData, originalItems, updatedItems) {
    try {
        const bookingRef = doc(db, "businesses", businessId, "bookings", bookingId);
        const bookingSnap = await getDoc(bookingRef);
        if (!bookingSnap.exists()) {
            throw new Error("Booking not found");
        }
        const existingBooking = bookingSnap.data();

        // Work out the date window this edit will leave the booking with,
        // falling back to whatever dates it already had if this edit didn't
        // touch them.
        const deliveryDate =
            updatedBookingData["event.deliveryDate"] ??
            updatedBookingData["event.date"] ??
            existingBooking.event?.deliveryDate ??
            existingBooking.event?.date;
        const returnDate =
            updatedBookingData["event.returnDate"] ??
            existingBooking.event?.returnDate ??
            deliveryDate;

        const inventoryItems = await getInventory(businessId);

        const { available, shortages } = await checkDateAvailability(
            businessId,
            inventoryItems,
            updatedItems.map(i => ({ name: i.name, qty: i.qty, isCustom: i.isCustom })),
            deliveryDate,
            returnDate,
            bookingId // exclude this booking's own current reservation from the check
        );

        const shortageMap = new Map(shortages.map(s => [s.name.trim().toLowerCase(), s]));

        const finalItems = updatedItems.map(item => {
            if (item.isCustom) {
                // Custom / not-in-catalog items are always fully sourced
                // from the named vendor — there's no "your stock" to check.
                return {
                    ...item,
                    shortage: item.qty,
                    borrowed: item.qty
                };
            }
            const key = (item.name || "").trim().toLowerCase();
            const s = shortageMap.get(key);
            const shortage = s ? s.shortage : 0;
            return {
                ...item,
                shortage,
                borrowed: shortage
            };
        });

        await updateDoc(bookingRef, {
            ...updatedBookingData,
            items: finalItems,
            updatedAt: serverTimestamp()
        });

        return { finalItems, available, shortages };
    } catch (error) {
        console.error("Error executing editBookingTransaction:", error);
        throw error;
    }
}
