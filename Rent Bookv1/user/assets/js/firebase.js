// assets/js/firebase.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 🔴 REPLACE WITH YOUR REAL CONFIG
const firebaseConfig = {
  apiKey: "AIzaSyDeByD1fV0liincxG-bbSel9YphdtPbPjU",
  authDomain: "rentbook-15faf.firebaseapp.com",
  projectId: "rentbook-15faf",
  storageBucket: "rentbook-15faf.firebasestorage.app",
  messagingSenderId: "249946907508",
  appId: "1:249946907508:web:55b24a8a39e6e609dcc221"
};

// Init Firebase
const app = initializeApp(firebaseConfig);

// Export auth & db
export const auth = getAuth(app);
export const db = getFirestore(app);
