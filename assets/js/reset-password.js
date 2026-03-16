import { auth } from "./firebase.js";
import { confirmPasswordReset, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

document.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(window.location.search);
  const oobCode = urlParams.get("oobCode");
  const continueUrl = urlParams.get("continueUrl"); // Optional redirect
  const email = urlParams.get("email"); // Optional if you passed email in the link
  const newPasswordInput = document.getElementById("newPassword");
  const resetBtn = document.getElementById("resetBtn");
  const msg = document.getElementById("msg");

  if (!oobCode) {
    msg.textContent = "Invalid or missing reset link.";
    resetBtn.disabled = true;
    return;
  }

  resetBtn.addEventListener("click", async () => {
    const newPassword = newPasswordInput.value.trim();
    if (!newPassword) {
      msg.textContent = "Please enter a new password.";
      return;
    }

    try {
      // Confirm the reset code and set the new password
      await confirmPasswordReset(auth, oobCode, newPassword);

      msg.style.color = "green";
      msg.textContent = "Password reset successfully! Logging you in...";

      if (!email) {
        msg.textContent = "Password reset! Please login manually.";
        return;
      }

      // Auto-login
      await signInWithEmailAndPassword(auth, email, newPassword);

      // Redirect to dashboard
      window.location.href = continueUrl || "dashboard.html";

    } catch (error) {
      console.error("Reset error:", error);
      msg.style.color = "red";
      if (error.code === "auth/expired-action-code") {
        msg.textContent = "Reset link expired. Request a new one.";
      } else {
        msg.textContent = error.message;
      }
    }
  });
});