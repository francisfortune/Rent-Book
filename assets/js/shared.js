import { collection, query, where, getDocs, doc, getDoc, setDoc } from
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
    if (cached) {
      // Still trigger self-healing in the background if user is provided, to ensure consistency
      if (user && user.uid) {
        getDoc(doc(db, "users", user.uid)).then(userSnap => {
          if (!userSnap.exists() || userSnap.data().businessId !== cached) {
            console.log(`Self-healing (cache hit background): updating user ${user.uid} document with businessId ${cached}`);
            setDoc(doc(db, "users", user.uid), {
              uid: user.uid,
              email: user.email || userSnap.data()?.email || null,
              phone: user.phoneNumber || userSnap.data()?.phone || null,
              name: user.displayName || userSnap.data()?.name || "User",
              role: userSnap.data()?.role || "owner",
              businessId: cached,
              updatedAt: new Date()
            }, { merge: true }).catch(err => console.error("Background self-healing failed:", err));
          }
        }).catch(err => console.error("Background self-healing lookup failed:", err));
      }
      return cached;
    }
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
  if (!businessId && user && user.uid) {
    const q3 = query(
      collection(db, "businessMembers"),
      where("uid", "==", user.uid)
    );
    const snap3 = await getDocs(q3);
    if (!snap3.empty) {
      businessId = snap3.docs[0].data().businessId;
    }
  }

  if (!businessId) {
    throw new Error("NO_BUSINESS");
  }

  // Self-healing: Ensure users/{uid} has this businessId
  if (user && user.uid) {
    try {
      const userDocRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userDocRef);
      if (!userSnap.exists() || userSnap.data().businessId !== businessId) {
        console.log(`Self-healing: updating user ${user.uid} document with businessId ${businessId}`);
        await setDoc(userDocRef, {
          uid: user.uid,
          email: user.email || userSnap.data()?.email || null,
          phone: user.phoneNumber || userSnap.data()?.phone || null,
          name: user.displayName || userSnap.data()?.name || "User",
          role: userSnap.data()?.role || "owner",
          businessId: businessId,
          updatedAt: new Date()
        }, { merge: true });
      }
    } catch (e) {
      console.error("Self-healing failed:", e);
    }
  }

  if (cacheKey) {
    localStorage.setItem(cacheKey, businessId);
  }
  return businessId;
}
