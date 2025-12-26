// assets/js/services/businessService.js
// Handles all business-related operations

import { db } from "../firebase.js";
import {
    collection,
    doc,
    setDoc,
    getDoc,
    updateDoc,
    query,
    where,
    getDocs,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/**
 * Create a new business and link it to the user
 * @param {string} userId - Owner's user ID
 * @param {Object} businessData - Business information
 * @returns {Promise<string>} businessId
 */
export async function createBusiness(userId, businessData) {
    try {
        // Generate a unique business ID
        const businessRef = doc(collection(db, "businesses"));
        const businessId = businessRef.id;

        // Create business document
        await setDoc(businessRef, {
            ...businessData,
            ownerId: userId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        // Update user document with businessId
        await updateDoc(doc(db, "users", userId), {
            businessId: businessId,
            updatedAt: serverTimestamp()
        });

        return businessId;
    } catch (error) {
        console.error("Error creating business:", error);
        throw new Error("Failed to create business. Please try again.");
    }
}

/**
 * Get business data by ID
 * @param {string} businessId 
 * @returns {Promise<Object>}
 */
export async function getBusiness(businessId) {
    try {
        const businessDoc = await getDoc(doc(db, "businesses", businessId));

        if (!businessDoc.exists()) {
            throw new Error("Business not found");
        }

        return {
            id: businessDoc.id,
            ...businessDoc.data()
        };
    } catch (error) {
        console.error("Error getting business:", error);
        throw error;
    }
}

/**
 * Update business information
 * @param {string} businessId 
 * @param {Object} updates 
 */
export async function updateBusiness(businessId, updates) {
    try {
        await updateDoc(doc(db, "businesses", businessId), {
            ...updates,
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.error("Error updating business:", error);
        throw new Error("Failed to update business settings.");
    }
}

/**
 * Get all staff members for a business
 * @param {string} businessId 
 * @returns {Promise<Array>}
 */
export async function getStaff(businessId) {
    try {
        const staffRef = collection(db, "businesses", businessId, "staff");
        const snapshot = await getDocs(staffRef);

        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    } catch (error) {
        console.error("Error getting staff:", error);
        throw new Error("Failed to load staff members.");
    }
}

/**
 * Add a staff member to the business
 * @param {string} businessId 
 * @param {Object} staffData 
 * @returns {Promise<string>} staffId
 */
export async function addStaff(businessId, staffData) {
    try {
        const staffRef = doc(collection(db, "businesses", businessId, "staff"));
        const staffId = staffRef.id;

        await setDoc(staffRef, {
            ...staffData,
            businessId: businessId,
            createdAt: serverTimestamp()
        });

        return staffId;
    } catch (error) {
        console.error("Error adding staff:", error);
        throw new Error("Failed to add staff member.");
    }
}

/**
 * Update staff member permissions
 * @param {string} businessId 
 * @param {string} staffId 
 * @param {Object} permissions 
 */
export async function updateStaffPermissions(businessId, staffId, permissions) {
    try {
        await updateDoc(doc(db, "businesses", businessId, "staff", staffId), {
            permissions: permissions,
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.error("Error updating staff permissions:", error);
        throw new Error("Failed to update permissions.");
    }
}

/**
 * Remove a staff member
 * @param {string} businessId 
 * @param {string} staffId 
 */
export async function removeStaff(businessId, staffId) {
    try {
        await deleteDoc(doc(db, "businesses", businessId, "staff", staffId));
    } catch (error) {
        console.error("Error removing staff:", error);
        throw new Error("Failed to remove staff member.");
    }
}

/**
 * Check if user has permission to perform an action
 * @param {string} userId 
 * @param {string} businessId 
 * @param {string} permission 
 * @returns {Promise<boolean>}
 */
export async function checkPermission(userId, businessId, permission) {
    try {
        // Get user data
        const userDoc = await getDoc(doc(db, "users", userId));
        const userData = userDoc.data();

        // Owners have all permissions
        if (userData.role === "owner") {
            return true;
        }

        // Get staff data
        const staffRef = collection(db, "businesses", businessId, "staff");
        const q = query(staffRef, where("email", "==", userData.email));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return false;
        }

        const staffData = snapshot.docs[0].data();
        return staffData.permissions?.[permission] === true;
    } catch (error) {
        console.error("Error checking permission:", error);
        return false;
    }
}
