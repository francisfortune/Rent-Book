// assets/js/services/authService.js
// Handles all authentication and user management

import { auth, db } from "../firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/**
 * Register a new user and create their user document
 * @param {string} email 
 * @param {string} password 
 * @param {string} name 
 * @returns {Promise<{user, needsSetup}>}
 */
export async function registerUser(email, password, name) {
  try {
    // 1. Create Firebase Auth user
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // 2. Create user document in Firestore
    await setDoc(doc(db, "users", user.uid), {
      uid: user.uid,
      email: email,
      name: name,
      role: "owner", // Default role for new signups
      businessId: null, // Will be set during business setup
      createdAt: serverTimestamp()
    });

    return {
      user,
      needsSetup: true // New users need to complete business setup
    };
  } catch (error) {
    console.error("Registration error:", error);
    throw new Error(getAuthErrorMessage(error.code));
  }
}

/**
 * Login existing user
 * @param {string} email 
 * @param {string} password 
 * @returns {Promise<{user, userData, needsSetup}>}
 */
export async function loginUser(email, password) {
  try {
    // 1. Sign in with Firebase Auth
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // 2. Get user document
    const userDoc = await getDoc(doc(db, "users", user.uid));
    
    if (!userDoc.exists()) {
      throw new Error("User data not found. Please contact support.");
    }

    const userData = userDoc.data();

    // 3. Check if user has completed business setup
    const needsSetup = !userData.businessId;

    return {
      user,
      userData,
      needsSetup
    };
  } catch (error) {
    console.error("Login error:", error);
    throw new Error(getAuthErrorMessage(error.code));
  }
}

/**
 * Logout current user
 */
export async function logoutUser() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Logout error:", error);
    throw new Error("Failed to logout. Please try again.");
  }
}

/**
 * Send password reset email
 * @param {string} email 
 */
export async function resetPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (error) {
    console.error("Password reset error:", error);
    throw new Error(getAuthErrorMessage(error.code));
  }
}

/**
 * Get current user data from Firestore
 * @returns {Promise<Object|null>}
 */
export async function getCurrentUserData() {
  const user = auth.currentUser;
  if (!user) return null;

  const userDoc = await getDoc(doc(db, "users", user.uid));
  return userDoc.exists() ? userDoc.data() : null;
}

/**
 * Listen to auth state changes
 * @param {Function} callback 
 * @returns {Function} unsubscribe function
 */
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

/**
 * Convert Firebase auth error codes to user-friendly messages
 * @param {string} errorCode 
 * @returns {string}
 */
function getAuthErrorMessage(errorCode) {
  const errorMessages = {
    'auth/email-already-in-use': 'This email is already registered. Please login instead.',
    'auth/invalid-email': 'Invalid email address.',
    'auth/operation-not-allowed': 'Operation not allowed. Please contact support.',
    'auth/weak-password': 'Password should be at least 6 characters.',
    'auth/user-disabled': 'This account has been disabled.',
    'auth/user-not-found': 'No account found with this email.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/too-many-requests': 'Too many failed attempts. Please try again later.',
    'auth/network-request-failed': 'Network error. Please check your connection.'
  };

  return errorMessages[errorCode] || 'An error occurred. Please try again.';
}
