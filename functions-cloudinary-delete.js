// functions/cloudinary-delete.js
//
// WHY THIS HAS TO BE A CLOUD FUNCTION:
// Deleting a Cloudinary asset requires your API Secret (Cloudinary's
// "Admin API" credential). If that secret were in browser JS, anyone
// could destroy every file in your account. So the browser only ever
// calls this callable function with the businessId + publicId; this
// function checks the caller is actually that business's owner, then
// makes the signed Cloudinary call server-side.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");

if (!admin.apps.length) admin.initializeApp();

const CLOUDINARY_API_KEY = defineSecret("CLOUDINARY_API_KEY");
const CLOUDINARY_API_SECRET = defineSecret("CLOUDINARY_API_SECRET");
const CLOUDINARY_CLOUD_NAME = defineSecret("CLOUDINARY_CLOUD_NAME");

exports.deleteGalleryMedia = onCall(
  { secrets: [CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_CLOUD_NAME] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

    const { businessId, publicId, resourceType } = request.data || {};
    if (!businessId || !publicId) {
      throw new HttpsError("invalid-argument", "businessId and publicId are required.");
    }

    // Only the business OWNER may delete — not just any team member.
    // Adjust this check to however you actually mark ownership
    // (e.g. a `role: "owner"` field on the businessMembers doc).
    const memberSnap = await admin.firestore()
      .collection("businessMembers")
      .where("uid", "==", uid)
      .where("businessId", "==", businessId)
      .where("role", "==", "owner")
      .limit(1)
      .get();

    if (memberSnap.empty) {
      throw new HttpsError("permission-denied", "Only the business owner can delete gallery items.");
    }

    const cloudName = CLOUDINARY_CLOUD_NAME.value();
    const apiKey = CLOUDINARY_API_KEY.value();
    const apiSecret = CLOUDINARY_API_SECRET.value();
    const timestamp = Math.floor(Date.now() / 1000);
    const type = resourceType === "video" ? "video" : "image";

    // Cloudinary signed-request signature: sha1 of sorted params + secret
    const toSign = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
    const signature = crypto.createHash("sha1").update(toSign).digest("hex");

    const form = new URLSearchParams({
      public_id: publicId,
      timestamp: String(timestamp),
      api_key: apiKey,
      signature
    });

    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/${type}/destroy`,
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() }
    );

    const result = await res.json();
    if (result.result !== "ok" && result.result !== "not found") {
      throw new HttpsError("internal", `Cloudinary delete failed: ${JSON.stringify(result)}`);
    }

    return { success: true, result };
  }
);
