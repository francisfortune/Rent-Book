// functions/onesignal-notify.js
//
// WHY THIS HAS TO BE A CLOUD FUNCTION:
// OneSignal pushes are sent by calling their REST API with your app's
// REST API Key. That key can create/target notifications for anyone,
// so it must never ship in browser JS (anyone could view-source it and
// spam your users). The browser's job is only to WRITE a small "please
// notify" doc to Firestore — this function watches for those docs and
// makes the actual OneSignal call using a key stored in a private
// environment variable.
//
// Requires: firebase-functions v2, firebase-admin, and Node's built-in fetch
// (Node 18+ on Cloud Functions / Cloud Run already has this).

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

if (!admin.apps.length) admin.initializeApp();

const ONESIGNAL_APP_ID = defineSecret("ONESIGNAL_APP_ID");
const ONESIGNAL_REST_API_KEY = defineSecret("ONESIGNAL_REST_API_KEY");

// Fires whenever the public storefront (profile-viewer.js) queues a
// notification at: businesses/{businessId}/notificationQueue/{queueId}
exports.notifyOwnerOnGalleryUpload = onDocumentCreated(
  {
    document: "businesses/{businessId}/notificationQueue/{queueId}",
    secrets: [ONESIGNAL_APP_ID, ONESIGNAL_REST_API_KEY]
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();

    if (data.processed) return; // already handled
    if (data.type !== "gallery_upload") return;

    const businessId = event.params.businessId;

    try {
      const businessDoc = await admin.firestore().doc(`businesses/${businessId}`).get();
      const businessName = businessDoc.exists ? (businessDoc.data().name || "Your store") : "Your store";

      const response = await fetch("https://onesignal.com/api/v1/notifications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Basic ${ONESIGNAL_REST_API_KEY.value()}`
        },
        body: JSON.stringify({
          app_id: ONESIGNAL_APP_ID.value(),
          // The owner's browser must have called OneSignal.login(businessId)
          // (done in public-profile.js) so this external_id resolves to them.
          include_external_user_ids: [businessId],
          headings: { en: businessName },
          contents: { en: "A visitor just added a new photo to your gallery." },
          url: `https://tracknrent.vercel.app/dashboard` // adjust to your real dashboard route
        })
      });

      const result = await response.json();
      if (!response.ok) {
        console.error("OneSignal API error:", result);
      }

      await snap.ref.update({
        processed: true,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        oneSignalResult: result
      });
    } catch (err) {
      console.error("notifyOwnerOnGalleryUpload failed:", err);
      await snap.ref.update({ processed: true, error: String(err) });
    }
  }
);
