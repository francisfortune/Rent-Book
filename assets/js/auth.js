import { auth, db } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  RecaptchaVerifier,
  signInWithPhoneNumber
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  setDoc,
  doc,
  updateDoc,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* =========================
   HELPERS
========================= */
function showMessage(msg) {
  alert(msg);
}

function getReferralCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("ref");
  if (fromUrl) localStorage.setItem("tracknrent_ref", fromUrl);
  return fromUrl || localStorage.getItem("tracknrent_ref") || null;
}

function setLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? "Please wait..." : "Submit";
}

/* =========================
   FIND BUSINESS MEMBER BY EMAIL
========================= */
async function getMembershipByEmail(email, rawEmail = null) {
  const emailLower = email.toLowerCase().trim();
  const q = query(
    collection(db, "businessMembers"),
    where("email", "==", emailLower)
  );
  let snap = await getDocs(q);
  if (snap.empty && rawEmail && rawEmail.trim() !== emailLower) {
    const qRaw = query(
      collection(db, "businessMembers"),
      where("email", "==", rawEmail.trim())
    );
    snap = await getDocs(qRaw);
  }
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

/* =========================
   CLAIM PENDING INVITE
   Called immediately after a successful auth event, BEFORE routing.
   Matches the user to any businessMembers doc by:
     1. lowercased email
     2. raw email (in case invite stored mixed case)
     3. phone number (digits only)
     4. existing uid (safety net)
   If found, flips status -> "accepted", links uid, and writes an
   in-app notification to the business so the owner's bell lights up.
   Returns the businessId on success, or null if no invite was found.
========================= */
async function claimPendingInvite(user) {
  const identifiers = [];

  if (user.email) {
    identifiers.push({ field: "email", value: user.email.toLowerCase().trim() });
    if (user.email.trim() !== user.email.toLowerCase().trim()) {
      identifiers.push({ field: "email", value: user.email.trim() });
    }
  }
  if (user.phoneNumber) {
    identifiers.push({
      field: "phone",
      value: user.phoneNumber.replace(/[\s\-\(\)]/g, "")
    });
  }
  identifiers.push({ field: "uid", value: user.uid });

  for (const { field, value } of identifiers) {
    try {
      const q = query(
        collection(db, "businessMembers"),
        where(field, "==", value)
      );
      const snap = await getDocs(q);
      if (snap.empty) continue;

      const memberDoc = snap.docs[0];
      const data = memberDoc.data();

      // Already accepted & linked? Just return the businessId.
      if (data.status === "accepted" && data.uid === user.uid) {
        return data.businessId;
      }

      // Claim it.
      await updateDoc(doc(db, "businessMembers", memberDoc.id), {
        status: "accepted",
        uid: user.uid,
        joinedAt: serverTimestamp(),
        notifiedAccepted: false
      });

      console.log(
        `[Auth] Claimed invite via ${field}=${value} → businessId=${data.businessId}`
      );

      // Write the in-app notification so the owner's bell lights up.
      try {
        await addDoc(
          collection(db, "businesses", data.businessId, "notifications"),
          {
            message: `Welcome! ${user.email || user.phoneNumber} has accepted the invite and joined the team.`,
            type: "invite_accepted",
            triggeredBy: user.email || user.phoneNumber || user.uid,
            createdAt: serverTimestamp(),
            readBy: []
          }
        );
      } catch (notifErr) {
        console.warn("[Auth] Notification write failed:", notifErr.message);
      }

      return data.businessId;
    } catch (err) {
      console.warn(`[Auth] Invite lookup failed for ${field}=${value}:`, err.message);
    }
  }

  return null;
}

/* =========================
   OTP AND PHONE HANDLERS
========================= */
let registerConfirmationResult = null;
let loginConfirmationResult = null;
let recaptchaVerifier = null;
let isRegistering = false;

function initRecaptcha() {
  if (recaptchaVerifier) return;
  recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", {
    size: "invisible"
  });
}

const sendRegisterOtpBtn = document.getElementById("sendRegisterOtpBtn");
if (sendRegisterOtpBtn) {
  sendRegisterOtpBtn.addEventListener("click", async () => {
    const phoneInput = document.getElementById("registerPhone");
    const countryCode = document.getElementById("registerCountryCode").value;
    const phone = phoneInput.value.replace(/\D/g, "");
    if (!phone) return alert("Please enter your phone number.");
    const fullPhone = countryCode + phone.replace(/^0+/, "");

    try {
      initRecaptcha();
      sendRegisterOtpBtn.disabled = true;
      sendRegisterOtpBtn.textContent = "Sending...";
      registerConfirmationResult = await signInWithPhoneNumber(
        auth,
        fullPhone,
        recaptchaVerifier
      );
      alert("Verification code sent to " + fullPhone + " ✅");
      document.getElementById("registerOtpContainer").classList.remove("hidden");
      sendRegisterOtpBtn.textContent = "Resend SMS Code";
      sendRegisterOtpBtn.disabled = false;
    } catch (err) {
      console.error(err);
      alert("Error sending verification SMS: " + err.message);
      sendRegisterOtpBtn.disabled = false;
      sendRegisterOtpBtn.textContent = "Send Verification SMS";
    }
  });
}

const sendLoginOtpBtn = document.getElementById("sendLoginOtpBtn");
if (sendLoginOtpBtn) {
  sendLoginOtpBtn.addEventListener("click", async () => {
    const phoneInput = document.getElementById("loginPhone");
    const countryCode = document.getElementById("loginCountryCode").value;
    const phone = phoneInput.value.replace(/\D/g, "");
    if (!phone) return alert("Please enter your phone number.");
    const fullPhone = countryCode + phone.replace(/^0+/, "");

    try {
      initRecaptcha();
      sendLoginOtpBtn.disabled = true;
      sendLoginOtpBtn.textContent = "Sending...";
      loginConfirmationResult = await signInWithPhoneNumber(
        auth,
        fullPhone,
        recaptchaVerifier
      );
      alert("Verification code sent to " + fullPhone + " ✅");
      document.getElementById("loginOtpContainer").classList.remove("hidden");
      sendLoginOtpBtn.textContent = "Resend SMS Code";
      sendLoginOtpBtn.disabled = false;
    } catch (err) {
      console.error(err);
      alert("Error sending verification SMS: " + err.message);
      sendLoginOtpBtn.disabled = false;
      sendLoginOtpBtn.textContent = "Send Verification SMS";
    }
  });
}

/* =========================
   REGISTER
========================= */
const registerForm = document.getElementById("registerForm");

if (registerForm) {
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const authMethod = document.getElementById("registerAuthMethod").value;
    const btn = registerForm.querySelector("button[type='submit']");
    setLoading(btn, true);

    const name = document.getElementById("registerName").value.trim();

    if (authMethod === "email") {
      const email = registerForm.registerEmail.value.trim();
      const password = registerForm.registerPassword.value;

      try {
        isRegistering = true;
        const userCredential = await createUserWithEmailAndPassword(
          auth,
          email,
          password
        );
        const user = userCredential.user;

        await setDoc(doc(db, "users", user.uid), {
          uid: user.uid,
          email: email,
          name: name,
          role: "owner",
          businessId: null,
          referredByCode: getReferralCodeFromUrl(),
          createdAt: serverTimestamp()
        });

        // ✅ Try to claim any pending invite BEFORE routing
        const claimedBusinessId = await claimPendingInvite(user);

        if (claimedBusinessId) {
          console.log("[Auth] Invite claimed — routing to dashboard");
          window.location.href = "dashboard.html";
        } else {
          console.log("[Auth] No invite — routing to setup");
          window.location.href = "setup.html";
        }
      } catch (err) {
        isRegistering = false;
        showMessage(err.message);
        setLoading(btn, false);
      }
    } else {
      const otp = document.getElementById("registerOtp").value.trim();
      if (!otp) {
        alert("Please enter the verification OTP code.");
        setLoading(btn, false);
        return;
      }
      if (!registerConfirmationResult) {
        alert("Please request verification SMS first.");
        setLoading(btn, false);
        return;
      }

      try {
        isRegistering = true;
        const userCredential = await registerConfirmationResult.confirm(otp);
        const user = userCredential.user;

        await setDoc(doc(db, "users", user.uid), {
          uid: user.uid,
          phone: user.phoneNumber,
          name: name,
          role: "owner",
          businessId: null,
          referredByCode: getReferralCodeFromUrl(),
          createdAt: serverTimestamp()
        });

        // ✅ Try to claim any pending invite BEFORE routing
        const claimedBusinessId = await claimPendingInvite(user);

        if (claimedBusinessId) {
          window.location.href = "dashboard.html";
        } else {
          window.location.href = "setup.html";
        }
      } catch (err) {
        isRegistering = false;
        showMessage("Invalid verification code: " + err.message);
        setLoading(btn, false);
      }
    }
  });
}

/* =========================
   LOGIN
========================= */
const loginForm = document.getElementById("loginForm");

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const authMethod = document.getElementById("loginAuthMethod").value;
    const btn = loginForm.querySelector("button[type='submit']");
    setLoading(btn, true);

    if (authMethod === "email") {
      const email = loginForm.loginEmail.value.trim();
      const password = loginForm.loginPassword.value;

      try {
        const userCredential = await signInWithEmailAndPassword(
          auth,
          email,
          password
        );

        // ✅ Claim any pending invite that might have been created after
        // the user first signed up. If none exists, we still let
        // onAuthStateChanged handle the redirect — but to be safe,
        // route explicitly here.
        const claimedBusinessId = await claimPendingInvite(userCredential.user);

        if (claimedBusinessId) {
          window.location.href = "dashboard.html";
        } else {
          // Fall through to onAuthStateChanged — it will route based on
          // whether the user has any membership at all.
          window.location.href = "dashboard.html";
        }
      } catch (err) {
        showMessage("Invalid login details");
        setLoading(btn, false);
      }
    } else {
      const otp = document.getElementById("loginOtp").value.trim();
      if (!otp) {
        alert("Please enter the verification OTP code.");
        setLoading(btn, false);
        return;
      }
      if (!loginConfirmationResult) {
        alert("Please request verification SMS first.");
        setLoading(btn, false);
        return;
      }

      try {
        const userCredential = await loginConfirmationResult.confirm(otp);

        // ✅ Same as email login: attempt to claim pending invite
        const claimedBusinessId = await claimPendingInvite(userCredential.user);

        if (claimedBusinessId) {
          window.location.href = "dashboard.html";
        } else {
          window.location.href = "dashboard.html";
        }
      } catch (err) {
        showMessage("Invalid verification code: " + err.message);
        setLoading(btn, false);
      }
    }
  });
}

/* =========================
   GOOGLE AUTH
========================= */
async function handleGoogleAuth() {
  try {
    const provider = new GoogleAuthProvider();
    const userCredential = await signInWithPopup(auth, provider);
    const user = userCredential.user;

    const userDocRef = doc(db, "users", user.uid);
    const userSnapshot = await getDoc(userDocRef);

    if (!userSnapshot.exists()) {
      isRegistering = true;
      await setDoc(userDocRef, {
        uid: user.uid,
        email: user.email,
        name: user.displayName || "Google User",
        role: "owner",
        businessId: null,
        referredByCode: getReferralCodeFromUrl(),
        createdAt: serverTimestamp()
      });

      // ✅ Try to claim any pending invite BEFORE routing
      const claimedBusinessId = await claimPendingInvite(user);

      if (claimedBusinessId) {
        window.location.href = "dashboard.html";
      } else {
        window.location.href = "setup.html";
      }
      return;
    }

    // Returning Google user — still try to claim an invite, then route
    const claimedBusinessId = await claimPendingInvite(user);
    window.location.href = claimedBusinessId
      ? "dashboard.html"
      : "dashboard.html";
  } catch (err) {
    console.error("Google Auth Error:", err);
    showMessage(err.message || "Google Login failed");
  }
}

const googleLogin = document.getElementById("googleLogin");
const googleSignUp = document.getElementById("googleSignUp");

if (googleLogin) googleLogin.addEventListener("click", handleGoogleAuth);
if (googleSignUp) googleSignUp.addEventListener("click", handleGoogleAuth);

/* =========================
   AUTH STATE — ROUTING ONLY
   Invite-claim now lives in the submit handlers above.
   This listener only handles the case where a user lands on the
   page already authenticated (e.g. reloaded the tab).
========================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  // If a submit handler is mid-flight, let it handle routing.
  if (isRegistering) {
    console.log("[Auth] Registration in progress — auth listener yielding.");
    return;
  }

  let membership = null;

  try {
    if (user.email) {
      membership = await getMembershipByEmail(
        user.email.toLowerCase().trim(),
        user.email
      );
    }
    if (!membership && user.phoneNumber) {
      const q = query(
        collection(db, "businessMembers"),
        where("phone", "==", user.phoneNumber.trim())
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        membership = { id: snap.docs[0].id, ...snap.docs[0].data() };
      }
    }
    if (!membership) {
      const q = query(
        collection(db, "businessMembers"),
        where("uid", "==", user.uid)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        membership = { id: snap.docs[0].id, ...snap.docs[0].data() };
      }
    }
  } catch (err) {
    console.error("[Auth] Membership lookup failed on state change:", err);
  }

  if (!membership) {
    // No invite, no business — send them to setup.
    window.location.href = "setup.html";
    return;
  }

  // Belt-and-suspenders: if for some reason the doc is still pending,
  // claim it now (covers the rare case where the submit handler's
  // claimPendingInvite didn't run, e.g. user was already logged in
  // when the invite was created).
  if (membership.status === "pending") {
    try {
      await updateDoc(doc(db, "businessMembers", membership.id), {
        status: "accepted",
        uid: user.uid,
        joinedAt: serverTimestamp(),
        notifiedAccepted: false
      });
      console.log("[Auth] Self-healed pending invite → accepted");
    } catch (err) {
      console.error("[Auth] Error accepting pending invite:", err);
    }
  }

  window.location.href = "dashboard.html";
});

/* =========================
   PASSWORD RESET MODAL
========================= */
document.addEventListener("DOMContentLoaded", () => {
  const resetModal = document.getElementById("resetModal");
  const forgotPassword = document.getElementById("forgotPassword");
  const closeReset = document.getElementById("closeReset");
  const sendResetBtn = document.getElementById("sendReset");

  if (!resetModal || !forgotPassword || !closeReset || !sendResetBtn) {
    console.error("Reset modal elements not found");
    return;
  }

  forgotPassword.addEventListener("click", (e) => {
    e.preventDefault();
    resetModal.classList.remove("hidden");
    resetModal.classList.add("flex");
  });

  closeReset.addEventListener("click", () => {
    resetModal.classList.add("hidden");
  });

  sendResetBtn.addEventListener("click", async () => {
    const email = document.getElementById("resetEmail").value.trim();

    if (!email) {
      alert("Please enter your email.");
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email);
      alert(
        "A password reset link has been sent to your email address. Kindly check your inbox and spam folder."
      );
      resetModal.classList.add("hidden");
    } catch (error) {
      console.error("Reset error:", error);
      if (error.code === "auth/user-not-found") {
        alert("No password set for this account. Try logging in with Google.");
      } else {
        alert(error.message);
      }
    }
  });
});