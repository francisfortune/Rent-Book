import { collection, query, where, getDocs } from
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";

export async function getBusinessIdByEmail(email, user = null) {
  let lookupEmail = email;
  let lookupPhone = null;

  if (typeof email === "object" && email !== null) {
    user = email;
    lookupEmail = user.email;
    lookupPhone = user.phoneNumber;
  } else if (user) {
    lookupEmail = user.email || email;
    lookupPhone = user.phoneNumber;
  }

  const cacheKey = user ? `businessId_${user.uid}` : (lookupEmail ? `businessId_${lookupEmail}` : null);
  if (cacheKey) {
    const cached = localStorage.getItem(cacheKey);
    if (cached) return cached;
  }

  let businessId = null;

  if (lookupEmail) {
    const emailLower = lookupEmail.toLowerCase().trim();
    const q1 = query(
      collection(db, "businessMembers"),
      where("email", "==", emailLower)
    );
    let snap1 = await getDocs(q1);

    // Fallback case-sensitive lookup
    if (snap1.empty && lookupEmail.trim() !== emailLower) {
      const q1Raw = query(
        collection(db, "businessMembers"),
        where("email", "==", lookupEmail.trim())
      );
      snap1 = await getDocs(q1Raw);
    }

    if (!snap1.empty) {
      businessId = snap1.docs[0].data().businessId;
    }
  }

  if (!businessId && lookupPhone) {
    const q2 = query(
      collection(db, "businessMembers"),
      where("phone", "==", lookupPhone.trim())
    );
    const snap2 = await getDocs(q2);
    if (!snap2.empty) {
      businessId = snap2.docs[0].data().businessId;
    }
  }

  if (!businessId) {
    throw new Error("NO_BUSINESS");
  }

  if (cacheKey) {
    localStorage.setItem(cacheKey, businessId);
  }
  return businessId;
}
