// assets/js/services/inventoryService.js
// Handles all inventory management and availability calculations

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
    onSnapshot,
    serverTimestamp,
    runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/**
 * Add a new inventory item
 * @param {string} businessId 
 * @param {Object} itemData - {name, totalQuantity, warningThreshold}
 * @returns {Promise<string>} itemId
 */
export async function addInventoryItem(businessId, itemData) {
    try {
        const itemRef = doc(collection(db, "businesses", businessId, "inventory"));
        const itemId = itemRef.id;

        await setDoc(itemRef, {
            name: itemData.name,
            totalQuantity: itemData.totalQuantity,
            availableQuantity: itemData.totalQuantity, // Initially all available
            warningThreshold: itemData.warningThreshold || 10,
            createdAt: serverTimestamp()
        });

        return itemId;
    } catch (error) {
        console.error("Error adding inventory item:", error);
        throw new Error("Failed to add inventory item.");
    }
}

/**
 * Get all inventory items for a business
 * @param {string} businessId 
 * @returns {Promise<Array>}
 */
export async function getInventory(businessId) {
    try {
        const inventoryRef = collection(db, "businesses", businessId, "inventory");
        const snapshot = await getDocs(inventoryRef);

        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    } catch (error) {
        console.error("Error getting inventory:", error);
        throw new Error("Failed to load inventory.");
    }
}

/**
 * Get a single inventory item
 * @param {string} businessId 
 * @param {string} itemId 
 * @returns {Promise<Object>}
 */
export async function getInventoryItem(businessId, itemId) {
    try {
        const itemDoc = await getDoc(doc(db, "businesses", businessId, "inventory", itemId));

        if (!itemDoc.exists()) {
            throw new Error("Item not found");
        }

        return {
            id: itemDoc.id,
            ...itemDoc.data()
        };
    } catch (error) {
        console.error("Error getting inventory item:", error);
        throw error;
    }
}

/**
 * Update inventory item
 * @param {string} businessId 
 * @param {string} itemId 
 * @param {Object} updates 
 */
export async function updateInventoryItem(businessId, itemId, updates) {
    try {
        await updateDoc(doc(db, "businesses", businessId, "inventory", itemId), {
            ...updates,
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.error("Error updating inventory item:", error);
        throw new Error("Failed to update inventory item.");
    }
}

/**
 * Delete inventory item
 * @param {string} businessId 
 * @param {string} itemId 
 */
export async function deleteInventoryItem(businessId, itemId) {
    try {
        await deleteDoc(doc(db, "businesses", businessId, "inventory", itemId));
    } catch (error) {
        console.error("Error deleting inventory item:", error);
        throw new Error("Failed to delete inventory item.");
    }
}

/**
 * Deduct inventory when booking is created (transactional & safe)
 * @param {string} businessId 
 * @param {Array} items - Array of items to deduct, supporting both ID-based and name-based schemas
 * @returns {Promise<void>}
 */
export async function deductInventory(businessId, items) {
    try {
        await runTransaction(db, async (transaction) => {
            const names = [];
            const ids = [];

            for (const item of items) {
                const name = item.name || item.itemName;
                const id = item.itemId || item.id;
                const qty = item.qty || item.quantity || 0;

                if (id) {
                    ids.push({ id, qty });
                } else if (name) {
                    names.push({ name: name.trim(), qty });
                }
            }

            const inventoryColl = collection(db, "businesses", businessId, "inventory");
            const inventoryMap = new Map();

            // Fetch by ID
            for (const itemInfo of ids) {
                const ref = doc(inventoryColl, itemInfo.id);
                const snap = await transaction.get(ref);
                if (snap.exists()) {
                    inventoryMap.set(itemInfo.id, { ref, data: snap.data(), qty: itemInfo.qty });
                } else {
                    throw new Error(`Inventory item ID ${itemInfo.id} not found.`);
                }
            }

            // Fetch by Name
            if (names.length > 0) {
                const nameList = names.map(n => n.name);
                const chunkSize = 30;
                const snaps = [];
                for (let i = 0; i < nameList.length; i += chunkSize) {
                    const chunk = nameList.slice(i, i + chunkSize);
                    const q = query(inventoryColl, where("name", "in", chunk));
                    const querySnap = await getDocs(q);
                    snaps.push(querySnap);
                }

                for (const querySnap of snaps) {
                    for (const docSnap of querySnap.docs) {
                        const freshSnap = await transaction.get(docSnap.ref);
                        if (freshSnap.exists()) {
                            const nameLower = freshSnap.data().name.toLowerCase();
                            const matchingNameInfos = names.filter(n => n.name.toLowerCase() === nameLower);
                            for (const matchingNameInfo of matchingNameInfos) {
                                inventoryMap.set(freshSnap.id, {
                                    ref: docSnap.ref,
                                    data: freshSnap.data(),
                                    qty: matchingNameInfo.qty
                                });
                            }
                        }
                    }
                }
            }

            // Deduct quantities
            for (const [id, entry] of inventoryMap.entries()) {
                const currentAvailable = entry.data.availableQuantity || 0;
                const requestedQty = entry.qty;

                // Safe shortage logic
                const shortage = Math.max(0, requestedQty - currentAvailable);
                const usableQty = requestedQty - shortage;
                const newAvailable = Math.max(0, currentAvailable - usableQty);

                transaction.update(entry.ref, {
                    availableQuantity: newAvailable,
                    updatedAt: serverTimestamp()
                });

                // Set shortage back in items array
                const matchedItems = items.filter(item => 
                    (item.itemId === id) || 
                    (item.id === id) ||
                    ((item.name || item.itemName)?.trim().toLowerCase() === entry.data.name.toLowerCase())
                );
                for (const matchedItem of matchedItems) {
                    matchedItem.shortage = shortage;
                }
            }
        });
    } catch (error) {
        console.error("Error deducting inventory transactionally:", error);
        throw error;
    }
}

/**
 * Restore inventory when booking is completed/cancelled (transactional & safe)
 * @param {string} businessId 
 * @param {Array} items - Array of items to restore
 * @returns {Promise<void>}
 */
export async function restoreInventory(businessId, items) {
    try {
        await runTransaction(db, async (transaction) => {
            const names = [];
            const ids = [];

            for (const item of items) {
                const name = item.name || item.itemName;
                const id = item.itemId || item.id;
                const qty = item.qty || item.quantity || 0;
                const shortage = item.shortage || 0;
                const restorable = Math.max(0, qty - shortage);

                if (restorable <= 0) continue;

                if (id) {
                    ids.push({ id, restorable });
                } else if (name) {
                    names.push({ name: name.trim(), restorable });
                }
            }

            if (ids.length === 0 && names.length === 0) return;

            const inventoryColl = collection(db, "businesses", businessId, "inventory");
            const inventoryMap = new Map();

            // Fetch by ID
            for (const itemInfo of ids) {
                const ref = doc(inventoryColl, itemInfo.id);
                const snap = await transaction.get(ref);
                if (snap.exists()) {
                    inventoryMap.set(itemInfo.id, { ref, data: snap.data(), restorable: itemInfo.restorable });
                }
            }

            // Fetch by Name
            if (names.length > 0) {
                const nameList = names.map(n => n.name);
                const chunkSize = 30;
                const snaps = [];
                for (let i = 0; i < nameList.length; i += chunkSize) {
                    const chunk = nameList.slice(i, i + chunkSize);
                    const q = query(inventoryColl, where("name", "in", chunk));
                    const querySnap = await getDocs(q);
                    snaps.push(querySnap);
                }

                for (const querySnap of snaps) {
                    for (const docSnap of querySnap.docs) {
                        const freshSnap = await transaction.get(docSnap.ref);
                        if (freshSnap.exists()) {
                            const nameLower = freshSnap.data().name.toLowerCase();
                            const matchingNameInfos = names.filter(n => n.name.toLowerCase() === nameLower);
                            for (const matchingNameInfo of matchingNameInfos) {
                                inventoryMap.set(freshSnap.id, {
                                    ref: docSnap.ref,
                                    data: freshSnap.data(),
                                    restorable: matchingNameInfo.restorable
                                });
                            }
                        }
                    }
                }
            }

            // Restore quantities
            for (const [id, entry] of inventoryMap.entries()) {
                const currentAvailable = entry.data.availableQuantity || 0;
                const totalQuantity = entry.data.totalQuantity || 0;
                const newAvailable = Math.min(currentAvailable + entry.restorable, totalQuantity);

                transaction.update(entry.ref, {
                    availableQuantity: newAvailable,
                    updatedAt: serverTimestamp()
                });
            }
        });
    } catch (error) {
        console.error("Error restoring inventory transactionally:", error);
        throw error;
    }
}

/**
 * Check if items are available for booking
 * @param {string} businessId 
 * @param {Array} items - [{itemId, quantity}]
 * @returns {Promise<{available: boolean, shortages: Array}>}
 */
export async function checkAvailability(businessId, items) {
    try {
        const shortages = [];

        for (const item of items) {
            const itemDoc = await getDoc(doc(db, "businesses", businessId, "inventory", item.itemId));

            if (!itemDoc.exists()) {
                shortages.push({
                    itemId: item.itemId,
                    message: "Item not found"
                });
                continue;
            }

            const itemData = itemDoc.data();
            const available = itemData.availableQuantity;
            const requested = item.quantity;

            if (available < requested) {
                shortages.push({
                    itemId: item.itemId,
                    itemName: itemData.name,
                    available: available,
                    requested: requested,
                    shortage: requested - available
                });
            }
        }

        return {
            available: shortages.length === 0,
            shortages: shortages
        };
    } catch (error) {
        console.error("Error checking availability:", error);
        throw new Error("Failed to check availability.");
    }
}

/**
 * Get items with low stock (below warning threshold)
 * @param {string} businessId 
 * @returns {Promise<Array>}
 */
export async function getLowStockItems(businessId) {
    try {
        const inventoryRef = collection(db, "businesses", businessId, "inventory");
        const snapshot = await getDocs(inventoryRef);

        const lowStockItems = [];

        snapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.availableQuantity <= data.warningThreshold) {
                lowStockItems.push({
                    id: doc.id,
                    ...data
                });
            }
        });

        return lowStockItems;
    } catch (error) {
        console.error("Error getting low stock items:", error);
        throw new Error("Failed to check low stock items.");
    }
}

/**
 * Listen to inventory changes in real-time
 * @param {string} businessId 
 * @param {Function} callback 
 * @returns {Function} unsubscribe function
 */
export function onInventoryChange(businessId, callback) {
    const inventoryRef = collection(db, "businesses", businessId, "inventory");

    return onSnapshot(inventoryRef, (snapshot) => {
        const inventory = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        callback(inventory);
    }, (error) => {
        console.error("Error listening to inventory changes:", error);
    });
}

/**
 * Get inventory summary statistics
 * @param {string} businessId 
 * @returns {Promise<Object>}
 */
export async function getInventorySummary(businessId) {
    try {
        const inventory = await getInventory(businessId);

        let totalItems = 0;
        let totalAvailable = 0;
        let totalOut = 0;
        let lowStockCount = 0;

        inventory.forEach(item => {
            totalItems += item.totalQuantity;
            totalAvailable += item.availableQuantity;
            totalOut += (item.totalQuantity - item.availableQuantity);

            if (item.availableQuantity <= item.warningThreshold) {
                lowStockCount++;
            }
        });

        return {
            totalItems,
            totalAvailable,
            totalOut,
            lowStockCount,
            itemCount: inventory.length
        };
    } catch (error) {
        console.error("Error getting inventory summary:", error);
        throw new Error("Failed to get inventory summary.");
    }
}

/**
 * Transactional helper to calculate and update inventory quantities based on booking edits.
 * Must be called INSIDE an active Firestore transaction!
 * @param {Transaction} transaction
 * @param {string} businessId
 * @param {Array} originalItems - [{name, qty, shortage}]
 * @param {Array} updatedItems - [{name, qty, price, supplier}]
 * @returns {Promise<Array>} updatedItems with shortage calculated
 */
export async function updateInventoryDiff(transaction, businessId, originalItems, updatedItems) {
    const nameMap = new Map();
    originalItems.forEach(item => nameMap.set((item.name || item.itemName).trim().toLowerCase(), (item.name || item.itemName).trim()));
    updatedItems.forEach(item => nameMap.set((item.name || item.itemName).trim().toLowerCase(), (item.name || item.itemName).trim()));

    const names = Array.from(nameMap.values());
    if (names.length === 0) return updatedItems;

    // 1. Fetch item document references outside transaction read locks first
    const inventoryColl = collection(db, "businesses", businessId, "inventory");
    
    // Chunk names array if it exceeds Firestore "in" limit of 30 items
    const querySnaps = [];
    const chunkSize = 30;
    for (let i = 0; i < names.length; i += chunkSize) {
        const chunk = names.slice(i, i + chunkSize);
        const q = query(inventoryColl, where("name", "in", chunk));
        const snap = await getDocs(q);
        querySnaps.push(snap);
    }

    // 2. Perform transactional gets to lock documents and read latest state
    const inventoryMap = {};
    for (const snap of querySnaps) {
        for (const docSnap of snap.docs) {
            const freshSnap = await transaction.get(docSnap.ref);
            if (freshSnap.exists()) {
                inventoryMap[freshSnap.data().name.toLowerCase()] = {
                    ref: freshSnap.ref,
                    data: freshSnap.data()
                };
            }
        }
    }

    // 3. Stage reversion of previously reserved pool (return old items back to pool)
    for (const oldItem of originalItems) {
        const key = (oldItem.name || oldItem.itemName).toLowerCase();
        if (inventoryMap[key]) {
            const oldQty = oldItem.qty || oldItem.quantity || 0;
            const actualRestored = Math.max(0, oldQty - (oldItem.shortage || 0));
            inventoryMap[key].data.availableQuantity += actualRestored;
        }
    }

    // 4. Evaluate new demands against the pool
    for (const newItem of updatedItems) {
        const key = (newItem.name || newItem.itemName).toLowerCase();
        if (inventoryMap[key]) {
            const newItemQty = newItem.qty || newItem.quantity || 0;
            const currentPool = inventoryMap[key].data.availableQuantity;
            const short = Math.max(0, newItemQty - currentPool);
            const usable = newItemQty - short;

            inventoryMap[key].data.availableQuantity = Math.max(0, currentPool - usable);
            newItem.shortage = short;
        } else {
            newItem.shortage = newItem.qty || newItem.quantity || 0;
        }
    }

    // 5. Commit inventory quantity updates inside the transaction
    for (const key in inventoryMap) {
        transaction.update(inventoryMap[key].ref, {
            availableQuantity: inventoryMap[key].data.availableQuantity,
            updatedAt: serverTimestamp()
        });
    }

    return updatedItems;
}
