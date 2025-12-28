import { collection, query, where, getDocs } from
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";

export async function getBusinessIdByEmail(email) {
  const q = query(
    collection(db, "businessMembers"),
    where("email", "==", email)
  );
  const snap = await getDocs(q);
  if (snap.empty) throw new Error("NO_BUSINESS");
  return snap.docs[0].data().businessId;
}
