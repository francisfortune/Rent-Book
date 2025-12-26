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
 * Deduct inventory when booking is created
 * @param {string} businessId 
 * @param {Array} items - [{itemId, quantity}]
 * @returns {Promise<void>}
 */
export async function deductInventory(businessId, items) {
    try {
        await runTransaction(db, async (transaction) => {
            // Read all items first
            const itemRefs = items.map(item =>
                doc(db, "businesses", businessId, "inventory", item.itemId)
            );

            const itemDocs = await Promise.all(
                itemRefs.map(ref => transaction.get(ref))
            );

            // Check availability
            for (let i = 0; i < itemDocs.length; i++) {
                const itemDoc = itemDocs[i];
                const requestedQty = items[i].quantity;

                if (!itemDoc.exists()) {
                    throw new Error(`Item ${items[i].itemId} not found`);
                }

                const currentAvailable = itemDoc.data().availableQuantity;

                if (currentAvailable < requestedQty) {
                    throw new Error(`Insufficient quantity for ${itemDoc.data().name}. Available: ${currentAvailable}, Requested: ${requestedQty}`);
                }
            }

            // Deduct quantities
            for (let i = 0; i < itemRefs.length; i++) {
                const currentAvailable = itemDocs[i].data().availableQuantity;
                const newAvailable = currentAvailable - items[i].quantity;

                transaction.update(itemRefs[i], {
                    availableQuantity: newAvailable,
                    updatedAt: serverTimestamp()
                });
            }
        });
    } catch (error) {
        console.error("Error deducting inventory:", error);
        throw error;
    }
}

/**
 * Restore inventory when booking is completed/cancelled
 * @param {string} businessId 
 * @param {Array} items - [{itemId, quantity}]
 * @returns {Promise<void>}
 */
export async function restoreInventory(businessId, items) {
    try {
        await runTransaction(db, async (transaction) => {
            const itemRefs = items.map(item =>
                doc(db, "businesses", businessId, "inventory", item.itemId)
            );

            const itemDocs = await Promise.all(
                itemRefs.map(ref => transaction.get(ref))
            );

            // Restore quantities
            for (let i = 0; i < itemRefs.length; i++) {
                if (!itemDocs[i].exists()) continue;

                const currentAvailable = itemDocs[i].data().availableQuantity;
                const totalQuantity = itemDocs[i].data().totalQuantity;
                const newAvailable = Math.min(currentAvailable + items[i].quantity, totalQuantity);

                transaction.update(itemRefs[i], {
                    availableQuantity: newAvailable,
                    updatedAt: serverTimestamp()
                });
            }
        });
    } catch (error) {
        console.error("Error restoring inventory:", error);
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
