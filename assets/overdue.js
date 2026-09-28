import { db } from "./firebase.js";

import {
collection,
onSnapshot,
updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export function watchOverdueBookings(businessId){

const ref=collection(db,"businesses",businessId,"bookings");

onSnapshot(ref,async snap=>{

const now=new Date();

for(const docSnap of snap.docs){

const b=docSnap.data();

if(
b.status==="active" &&
b.event?.returnDate &&
new Date(b.event.returnDate)<now
){

await updateDoc(docSnap.ref,{
status:"overdue"
});

}

}

});

}