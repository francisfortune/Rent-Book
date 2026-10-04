// assets/js/services/rentalService.js
// ============================================================================
// Handles rental-to-rental tracking.
//
// TWO SCHEMAS LIVE IN THIS FILE:
//   1. Legacy one-doc-per-item:  addExternalRental / getExternalRentals /
//      markExternalRentalReturned / onExternalRentalsChange, plus the
//      borrowedItems equivalents. Used by reminderService.js.
//   2. New batch schema (one doc = many items[]):  addLentOutBatch /
//      updateLentOutBatch / markLentOutBatchReturned / deleteLentOutBatch.
//      Used by rental-to-rental.js.
//
// Both write to the SAME collection (`externalRentals`). The batch shape has
// an `items[]` array; the legacy shape has a single `itemName` + `quantity`.
// Readers that care about batches filter on the presence of `items`.
// ============================================================================

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

/* ============================================================================
   INVENTORY HELPER — used by the batch functions below.
   Always re-reads fresh so we never write against a stale availableQuantity.
============================================================================ */
export async function getFreshInventory(businessId) {
    const snap = await getDocs(collection(db, "businesses", businessId, "inventory"));
    return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }));
}

/** Safely decrements an inventory item's availableQuantity, clamped at 0. */
async function decrementAvailable(businessId, itemId, amount) {
    if (!itemId || amount <= 0) return;
    const itemRef = doc(db, "businesses", businessId, "inventory", itemId);
    const snap = await getDoc(itemRef);
    if (!snap.exists()) return;
    const current = Number(snap.data().availableQuantity || 0);
    const next = Math.max(0, current - amount);
    await updateDoc(itemRef, { availableQuantity: next, updatedAt: serverTimestamp() });
}

/** Safely increments an inventory item's availableQuantity. */
async function incrementAvailable(businessId, itemId, amount) {
    if (!itemId || amount <= 0) return;
    const itemRef = doc(db, "businesses", businessId, "inventory", itemId);
    const snap = await getDoc(itemRef);
    if (!snap.exists()) return;
    const current = Number(snap.data().availableQuantity || 0);
    await updateDoc(itemRef, { availableQuantity: current + amount, updatedAt: serverTimestamp() });
}

/* ============================================================================
   LEGACY — one-doc-per-item shape. Kept for reminderService.js.
============================================================================ */

export async function addExternalRental(businessId, rentalData) {
    try {
        const rentalRef = doc(collection(db, "businesses", businessId, "externalRentals"));
        await setDoc(rentalRef, {
            itemId: rentalData.itemId,
            itemName: rentalData.itemName,
            quantity: rentalData.quantity,
            rentedTo: rentalData.rentedTo,
            contactPerson: rentalData.contactPerson || "",
            contactPhone: rentalData.contactPhone || "",
            rentalDate: rentalData.rentalDate,
            returnDate: rentalData.returnDate,
            status: "active",
            notes: rentalData.notes || "",
            createdAt: serverTimestamp()
        });
        return rentalRef.id;
    } catch (error) {
        console.error("Error adding external rental:", error);
        throw new Error("Failed to add external rental.");
    }
}

export async function addBorrowedItem(businessId, borrowData) {
    try {
        const borrowRef = doc(collection(db, "businesses", businessId, "borrowedItems"));
        await setDoc(borrowRef, {
            itemName: borrowData.itemName,
            quantity: borrowData.quantity,
            borrowedFrom: borrowData.borrowedFrom,
            contactPerson: borrowData.contactPerson || "",
            contactPhone: borrowData.contactPhone || "",
            borrowDate: borrowData.borrowDate,
            returnDate: borrowData.returnDate,
            eventName: borrowData.eventName || "",
            status: "active",
            notes: borrowData.notes || "",
            createdAt: serverTimestamp()
        });
        return borrowRef.id;
    } catch (error) {
        console.error("Error adding borrowed item:", error);
        throw new Error("Failed to add borrowed item.");
    }
}

export async function getExternalRentals(businessId, status = null) {
    try {
        const rentalsRef = collection(db, "businesses", businessId, "externalRentals");
        let snap;
        try {
            const q = status
                ? query(rentalsRef, where("status", "==", status), orderBy("returnDate", "asc"))
                : query(rentalsRef, orderBy("returnDate", "asc"));
            snap = await getDocs(q);
        } catch (orderedErr) {
            console.warn("[rentalService] ordered rentals fetch failed, falling back:", orderedErr?.message);
            const fallback = status
                ? query(rentalsRef, where("status", "==", status))
                : rentalsRef;
            snap = await getDocs(fallback);
        }
        return snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => String(a.returnDate || "").localeCompare(String(b.returnDate || "")));
    } catch (error) {
        console.error("Error getting external rentals:", error);
        return [];
    }
}

export async function getBorrowedItems(businessId, status = null) {
    try {
        const borrowRef = collection(db, "businesses", businessId, "borrowedItems");
        let snap;
        try {
            const q = status
                ? query(borrowRef, where("status", "==", status), orderBy("returnDate", "asc"))
                : query(borrowRef, orderBy("returnDate", "asc"));
            snap = await getDocs(q);
        } catch (orderedErr) {
            console.warn("[rentalService] ordered borrowed fetch failed, falling back:", orderedErr?.message);
            const fallback = status
                ? query(borrowRef, where("status", "==", status))
                : borrowRef;
            snap = await getDocs(fallback);
        }
        return snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => String(a.returnDate || "").localeCompare(String(b.returnDate || "")));
    } catch (error) {
        console.error("Error getting borrowed items:", error);
        return [];
    }
}

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

export async function deleteExternalRental(businessId, rentalId) {
    try {
        await deleteDoc(doc(db, "businesses", businessId, "externalRentals", rentalId));
    } catch (error) {
        console.error("Error deleting external rental:", error);
        throw new Error("Failed to delete external rental.");
    }
}

export async function deleteBorrowedItem(businessId, borrowId) {
    try {
        await deleteDoc(doc(db, "businesses", businessId, "borrowedItems", borrowId));
    } catch (error) {
        console.error("Error deleting borrowed item:", error);
        throw new Error("Failed to delete borrowed item.");
    }
}

export async function checkOverdueExternalRentals(businessId) {
    try {
        const rentals = await getExternalRentals(businessId, "active");
        const today = new Date().toISOString().split("T")[0];
        const overdueRentals = [];
        for (const rental of rentals) {
            if (rental.returnDate && rental.returnDate < today) {
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
        return [];
    }
}

export async function checkOverdueBorrowedItems(businessId) {
    try {
        const borrowed = await getBorrowedItems(businessId, "active");
        const today = new Date().toISOString().split("T")[0];
        const overdueItems = [];
        for (const item of borrowed) {
            if (item.returnDate && item.returnDate < today) {
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
        return [];
    }
}

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

export function onExternalRentalsChange(businessId, callback) {
    const rentalsRef = collection(db, "businesses", businessId, "externalRentals");
    const q = query(rentalsRef, orderBy("returnDate", "asc"));
    return onSnapshot(q, (snapshot) => {
        const rentals = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(rentals);
    }, (error) => {
        console.error("Error listening to external rentals changes:", error);
    });
}

export function onBorrowedItemsChange(businessId, callback) {
    const borrowRef = collection(db, "businesses", businessId, "borrowedItems");
    const q = query(borrowRef, orderBy("returnDate", "asc"));
    return onSnapshot(q, (snapshot) => {
        const items = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(items);
    }, (error) => {
        console.error("Error listening to borrowed items changes:", error);
    });
}

/* ============================================================================
   BORROWED-IN VIEW (read-only, derived from bookings)
============================================================================ */
export async function getBorrowedInFromBookings(businessId) {
    try {
        const bookingsRef = collection(db, "businesses", businessId, "bookings");
        const snap = await getDocs(bookingsRef);
        const rows = [];

        snap.docs.forEach((docSnap) => {
            const b = docSnap.data();
            const bookingId = docSnap.id;
            const bookingStatus = b.status || "active";

            (b.items || []).forEach((it, idx) => {
                const shortage = Number(it.shortage || 0);
                const supplier = (it.supplier || "").trim();
                const isCustom = !!it.isCustom;

                const isBorrowed = shortage > 0 || supplier !== "" || isCustom;
                if (!isBorrowed) return;

                const qty = Number(it.qty || 0);
                const borrowedQty = shortage > 0 ? shortage : qty;

                rows.push({
                    id: `${bookingId}::${idx}`,
                    bookingId,
                    itemName: it.name || "Unknown",
                    quantity: borrowedQty,
                    vendor: supplier || "Unknown vendor",
                    isCustom,
                    bookingStatus,
                    clientName: b.client?.name || "Client",
                    eventDate: b.event?.date || "",
                    returnDate: b.event?.returnDate || "",
                    createdAt: b.createdAt
                });
            });
        });

        rows.sort((a, b) => {
            const ta = a.createdAt?.toDate?.()?.getTime?.() || 0;
            const tb = b.createdAt?.toDate?.()?.getTime?.() || 0;
            return tb - ta;
        });

        return rows;
    } catch (error) {
        console.error("Error deriving borrowed-in from bookings:", error);
        return [];
    }
}

/* ============================================================================
   BATCH SHAPE (one doc = many items[]) — used by rental-to-rental.js
============================================================================ */

/**
 * Create a new lent-out batch and deduct each item's qty from
 * availableQuantity. Never touches totalQuantity — the item still exists,
 * it's just not on the shelf.
 */
export async function addLentOutBatch(businessId, batchData) {
    try {
        const batchRef = doc(collection(db, "businesses", businessId, "externalRentals"));
        const batchId = batchRef.id;

        const items = (batchData.items || []).map(i => ({
            itemId: i.itemId || "",
            name: i.name,
            qty: Number(i.qty || 0),
            price: Number(i.price || 0),
            total: Number(i.qty || 0) * Number(i.price || 0),
            returned: false,
            returnedAt: null,
            damaged: false,
            damageAmount: 0,
            // ✅ Preserve shortage/availableAtRental if the caller supplied them
            shortage: Math.max(0, Number(i.shortage || 0)),
            availableAtRental: Number(i.availableAtRental || 0)
        }));

        const receiptImages = Array.isArray(batchData.receiptImages) ? batchData.receiptImages : [];

        await setDoc(batchRef, {
            rentedTo: batchData.rentedTo,
            contactPerson: batchData.contactPerson || "",
            contactPhone: batchData.contactPhone || "",
            rentalDate: batchData.rentalDate,
            returnDate: batchData.returnDate,
            notes: batchData.notes || "",
            status: "active",
            payment: {
                total: Number(batchData.payment?.total || 0),
                paid: Number(batchData.payment?.paid || 0)
            },
            items,
            receiptImages,
            receiptImage: receiptImages[0] || null,
            damageStatus: "clean",
            createdAt: serverTimestamp(),
            returnedAt: null
        });

        // Deduct each item's qty from availableQuantity, fresh-read.
        for (const item of items) {
            await decrementAvailable(businessId, item.itemId, item.qty);
        }

        return batchId;
    } catch (error) {
        console.error("Error adding lent-out batch:", error);
        throw new Error("Failed to record the lent-out batch.");
    }
}

/**
 * Update a lent-out batch's fields and items.
 * Applies ONLY the per-item delta to availableQuantity.
 * Preserves returned/damaged state from the original items.
 * ✅ Preserves shortage + availableAtRental from the caller so the
 *    Overbooked badge survives an edit.
 * Writes receiptImages + receiptImage if provided.
 */
export async function updateLentOutBatch(businessId, batchId, updates, originalItems, newItems) {
    try {
        const batchRef = doc(db, "businesses", businessId, "externalRentals", batchId);
        const originalByItemId = new Map((originalItems || []).map(i => [i.itemId, i]));

        const finalItems = [];
        for (const item of newItems) {
            const qty = Number(item.qty || 0);
            const price = Number(item.price || 0);
            const original = originalByItemId.get(item.itemId);

            // Preserve return/damage state if this item existed before.
            const returned = original?.returned ?? (item.returned || false);
            const returnedAt = original?.returnedAt ?? (item.returnedAt || null);
            const damaged = original?.damaged ?? (item.damaged || false);
            const damageAmount = Number(original?.damageAmount ?? item.damageAmount ?? 0);

            // ✅ Preserve shortage/availableAtRental — the caller (saveLentOutEdit)
            // computes them against fresh inventory. Without these two lines the
            // Overbooked badge disappears after any edit.
            const shortage = Math.max(0, Number(item.shortage ?? original?.shortage ?? 0));
            const availableAtRental = Number(item.availableAtRental ?? original?.availableAtRental ?? 0);

            finalItems.push({
                itemId: item.itemId || "",
                name: item.name,
                qty,
                price,
                total: qty * price,
                returned,
                returnedAt,
                damaged,
                damageAmount,
                shortage,
                availableAtRental
            });

            // Apply the delta to availableQuantity
            if (!item.itemId) continue;
            const oldQty = Number(original?.qty || 0);
            const delta = qty - oldQty;
            if (delta === 0) continue;

            if (delta > 0) {
                await decrementAvailable(businessId, item.itemId, delta);
            } else {
                await incrementAvailable(businessId, item.itemId, Math.abs(delta));
            }
        }

        const patch = {
            ...updates,
            items: finalItems,
            updatedAt: serverTimestamp()
        };

        // Receipt images — only write if the caller actually sent them.
        if (Array.isArray(updates.receiptImages)) {
            patch.receiptImages = updates.receiptImages;
            patch.receiptImage = updates.receiptImages[0] || null;
        }

        await updateDoc(batchRef, patch);
    } catch (error) {
        console.error("Error updating lent-out batch:", error);
        throw new Error("Failed to update the lent-out batch.");
    }
}

/**
 * Settles a lent-out batch's return.
 *   • Good qty  → credited back to availableQuantity
 *   • Damaged qty → deducted from BOTH availableQuantity AND totalQuantity
 * Always re-reads the inventory doc fresh first.
 */
export async function markLentOutBatchReturned(businessId, batchId, settledItems) {
    try {
        const batchRef = doc(db, "businesses", businessId, "externalRentals", batchId);
        let anyDamaged = false;
        const finalItems = [];

        for (const item of settledItems) {
            const qty = Number(item.qty || 0);
            const price = Number(item.price || 0);
            const damaged = !!item.damaged && Number(item.damageQty || 0) > 0;
            const damageQty = damaged ? Math.min(Number(item.damageQty || 0), qty) : 0;
            const damageAmount = damaged ? Number(item.damageAmount || 0) : 0;
            if (damaged) anyDamaged = true;

            finalItems.push({
                itemId: item.itemId || "",
                name: item.name,
                qty,
                price,
                total: qty * price,
                returned: true,
                // Plain Date — Firestore disallows serverTimestamp() inside arrays.
                returnedAt: new Date(),
                damaged,
                damageAmount
            });

            if (!item.itemId) continue;

            const itemRef = doc(db, "businesses", businessId, "inventory", item.itemId);
            const snap = await getDoc(itemRef);
            if (!snap.exists()) continue;
            const data = snap.data();

            const goodQty = Math.max(0, qty - damageQty);
            let newAvailable = Number(data.availableQuantity || 0) + goodQty;
            let newTotal = Number(data.totalQuantity || 0);

            if (damageQty > 0) {
                newAvailable = Math.max(0, newAvailable - damageQty);
                newTotal = Math.max(0, newTotal - damageQty);
            }

            await updateDoc(itemRef, {
                availableQuantity: Math.max(0, newAvailable),
                totalQuantity: Math.max(0, newTotal),
                updatedAt: serverTimestamp()
            });
        }

        await updateDoc(batchRef, {
            items: finalItems,
            status: "returned",
            returnedAt: serverTimestamp(),
            damageStatus: anyDamaged ? "damaged" : "clean",
            updatedAt: serverTimestamp()
        });

        return { damaged: anyDamaged, items: finalItems };
    } catch (error) {
        console.error("Error settling lent-out batch return:", error);
        throw new Error("Failed to settle the return.");
    }
}

/**
 * Deletes a lent-out batch. If it hadn't been returned yet, credits every
 * item's qty back to availableQuantity first.
 */
export async function deleteLentOutBatch(businessId, batchId, batch) {
    try {
        if (batch.status !== "returned") {
            for (const item of (batch.items || [])) {
                await incrementAvailable(businessId, item.itemId, Number(item.qty || 0));
            }
        }
        await deleteDoc(doc(db, "businesses", businessId, "externalRentals", batchId));
    } catch (error) {
        console.error("Error deleting lent-out batch:", error);
        throw new Error("Failed to delete the lent-out batch.");
    }
}