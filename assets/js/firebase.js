// assets/js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAzAy3EEVP-bACD-hMTXs3YLy7bW4H5yBo",
  authDomain: "rent-bookv1.firebaseapp.com",
  projectId: "rent-bookv1",
  storageBucket: "rent-bookv1.appspot.com",
  messagingSenderId: "863320991464",
  appId: "1:863320991464:web:9331aca06d3bac908d0b5d"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
