// assets/js/services/rentalService.js
// Handles rental-to-rental tracking (items with other rentals & borrowed items)

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
    onSnapshot,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/**
 * Add external rental (items you rented to another rental business)
 * @param {string} businessId 
 * @param {Object} rentalData 
 * @returns {Promise<string>} rentalId
 */
export async function addExternalRental(businessId, rentalData) {
    try {
        const rentalRef = doc(collection(db, "businesses", businessId, "externalRentals"));
        const rentalId = rentalRef.id;

        await setDoc(rentalRef, {
            itemId: rentalData.itemId,
            itemName: rentalData.itemName,
            quantity: rentalData.quantity,
            rentedTo: rentalData.rentedTo, // Name of the rental business
            contactPerson: rentalData.contactPerson || "",
            contactPhone: rentalData.contactPhone || "",
            rentalDate: rentalData.rentalDate,
            returnDate: rentalData.returnDate,
            status: "active", // active, returned, overdue
            notes: rentalData.notes || "",
            createdAt: serverTimestamp()
        });

        return rentalId;
    } catch (error) {
        console.error("Error adding external rental:", error);
        throw new Error("Failed to add external rental.");
    }
}

/**
 * Add borrowed item (items you borrowed from another rental business)
 * @param {string} businessId 
 * @param {Object} borrowData 
 * @returns {Promise<string>} borrowId
 */
export async function addBorrowedItem(businessId, borrowData) {
    try {
        const borrowRef = doc(collection(db, "businesses", businessId, "borrowedItems"));
        const borrowId = borrowRef.id;

        await setDoc(borrowRef, {
            itemName: borrowData.itemName,
            quantity: borrowData.quantity,
            borrowedFrom: borrowData.borrowedFrom, // Name of the rental business
            contactPerson: borrowData.contactPerson || "",
            contactPhone: borrowData.contactPhone || "",
            borrowDate: borrowData.borrowDate,
            returnDate: borrowData.returnDate,
            eventName: borrowData.eventName || "",
            status: "active", // active, returned, overdue
            notes: borrowData.notes || "",
            createdAt: serverTimestamp()
        });

        return borrowId;
    } catch (error) {
        console.error("Error adding borrowed item:", error);
        throw new Error("Failed to add borrowed item.");
    }
}

/**
 * Get all external rentals
 * @param {string} businessId 
 * @param {string} status - Optional filter by status
 * @returns {Promise<Array>}
 */
export async function getExternalRentals(businessId, status = null) {
    try {
        let rentalsRef = collection(db, "businesses", businessId, "externalRentals");
        let q;

        if (status) {
            q = query(rentalsRef, where("status", "==", status), orderBy("returnDate", "asc"));
        } else {
            q = query(rentalsRef, orderBy("returnDate", "asc"));
        }

        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    } catch (error) {
        console.error("Error getting external rentals:", error);
        throw new Error("Failed to load external rentals.");
    }
}

/**
 * Get all borrowed items
 * @param {string} businessId 
 * @param {string} status - Optional filter by status
 * @returns {Promise<Array>}
 */
export async function getBorrowedItems(businessId, status = null) {
    try {
        let borrowRef = collection(db, "businesses", businessId, "borrowedItems");
        let q;

        if (status) {
            q = query(borrowRef, where("status", "==", status), orderBy("returnDate", "asc"));
        } else {
            q = query(borrowRef, orderBy("returnDate", "asc"));
        }

        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    } catch (error) {
        console.error("Error getting borrowed items:", error);
        throw new Error("Failed to load borrowed items.");
    }
}

/**
 * Mark external rental as returned
 * @param {string} businessId 
 * @param {string} rentalId 
 */
export async function markExternalRentalReturned(businessId, rentalId) {
    try {
        await updateDoc(doc(db, "businesses", businessId, "externalRentals", rentalId), {
            status: "returned",
            returnedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.error("Error marking external rental as returned:", error);
        throw new Error("Failed to update rental status.");
    }
}

/**
 * Mark borrowed item as returned
 * @param {string} businessId 
 * @param {string} borrowId 
 */
export async function markBorrowedItemReturned(businessId, borrowId) {
    try {
        await updateDoc(doc(db, "businesses", businessId, "borrowedItems", borrowId), {
            status: "returned",
            returnedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.error("Error marking borrowed item as returned:", error);
        throw new Error("Failed to update borrow status.");
    }
}

/**
 * Update external rental
 * @param {string} businessId 
 * @param {string} rentalId 
 * @param {Object} updates 
 */
export async function updateExternalRental(businessId, rentalId, updates) {
    try {
        await updateDoc(doc(db, "businesses", businessId, "externalRentals", rentalId), {
            ...updates,
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.error("Error updating external rental:", error);
        throw new Error("Failed to update external rental.");
    }
}

/**
 * Update borrowed item
 * @param {string} businessId 
 * @param {string} borrowId 
 * @param {Object} updates 
 */
export async function updateBorrowedItem(businessId, borrowId, updates) {
    try {
        await updateDoc(doc(db, "businesses", businessId, "borrowedItems", borrowId), {
            ...updates,
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.error("Error updating borrowed item:", error);
        throw new Error("Failed to update borrowed item.");
    }
}

/**
 * Delete external rental
 * @param {string} businessId 
 * @param {string} rentalId 
 */
export async function deleteExternalRental(businessId, rentalId) {
    try {
        await deleteDoc(doc(db, "businesses", businessId, "externalRentals", rentalId));
    } catch (error) {
        console.error("Error deleting external rental:", error);
        throw new Error("Failed to delete external rental.");
    }
}

/**
 * Delete borrowed item
 * @param {string} businessId 
 * @param {string} borrowId 
 */
export async function deleteBorrowedItem(businessId, borrowId) {
    try {
        await deleteDoc(doc(db, "businesses", businessId, "borrowedItems", borrowId));
    } catch (error) {
        console.error("Error deleting borrowed item:", error);
        throw new Error("Failed to delete borrowed item.");
    }
}

/**
 * Check for overdue external rentals and update status
 * @param {string} businessId 
 * @returns {Promise<Array>} overdue rentals
 */
export async function checkOverdueExternalRentals(businessId) {
    try {
        const rentals = await getExternalRentals(businessId, "active");
        const today = new Date().toISOString().split('T')[0];
        const overdueRentals = [];

        for (const rental of rentals) {
            if (rental.returnDate < today) {
                await updateDoc(doc(db, "businesses", businessId, "externalRentals", rental.id), {
                    status: "overdue",
                    updatedAt: serverTimestamp()
                });
                overdueRentals.push(rental);
            }
        }

        return overdueRentals;
    } catch (error) {
        console.error("Error checking overdue rentals:", error);
        throw new Error("Failed to check overdue rentals.");
    }
}

/**
 * Check for overdue borrowed items and update status
 * @param {string} businessId 
 * @returns {Promise<Array>} overdue items
 */
export async function checkOverdueBorrowedItems(businessId) {
    try {
        const borrowed = await getBorrowedItems(businessId, "active");
        const today = new Date().toISOString().split('T')[0];
        const overdueItems = [];

        for (const item of borrowed) {
            if (item.returnDate < today) {
                await updateDoc(doc(db, "businesses", businessId, "borrowedItems", item.id), {
                    status: "overdue",
                    updatedAt: serverTimestamp()
                });
                overdueItems.push(item);
            }
        }

        return overdueItems;
    } catch (error) {
        console.error("Error checking overdue borrowed items:", error);
        throw new Error("Failed to check overdue borrowed items.");
    }
}

/**
 * Get rental-to-rental summary
 * @param {string} businessId 
 * @returns {Promise<Object>}
 */
export async function getRentalSummary(businessId) {
    try {
        const externalRentals = await getExternalRentals(businessId);
        const borrowedItems = await getBorrowedItems(businessId);

        return {
            externalRentals: {
                total: externalRentals.length,
                active: externalRentals.filter(r => r.status === "active").length,
                overdue: externalRentals.filter(r => r.status === "overdue").length,
                returned: externalRentals.filter(r => r.status === "returned").length
            },
            borrowedItems: {
                total: borrowedItems.length,
                active: borrowedItems.filter(b => b.status === "active").length,
                overdue: borrowedItems.filter(b => b.status === "overdue").length,
                returned: borrowedItems.filter(b => b.status === "returned").length
            }
        };
    } catch (error) {
        console.error("Error getting rental summary:", error);
        throw new Error("Failed to get rental summary.");
    }
}

/**
 * Listen to external rentals changes in real-time
 * @param {string} businessId 
 * @param {Function} callback 
 * @returns {Function} unsubscribe function
 */
export function onExternalRentalsChange(businessId, callback) {
    const rentalsRef = collection(db, "businesses", businessId, "externalRentals");
    const q = query(rentalsRef, orderBy("returnDate", "asc"));

    return onSnapshot(q, (snapshot) => {
        const rentals = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        callback(rentals);
    }, (error) => {
        console.error("Error listening to external rentals changes:", error);
    });
}

/**
 * Listen to borrowed items changes in real-time
 * @param {string} businessId 
 * @param {Function} callback 
 * @returns {Function} unsubscribe function
 */
export function onBorrowedItemsChange(businessId, callback) {
    const borrowRef = collection(db, "businesses", businessId, "borrowedItems");
    const q = query(borrowRef, orderBy("returnDate", "asc"));

    return onSnapshot(q, (snapshot) => {
        const items = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        callback(items);
    }, (error) => {
        console.error("Error listening to borrowed items changes:", error);
    });
}
