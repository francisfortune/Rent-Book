// assets/js/public-profile.js
import { auth, db, storage } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
  serverTimestamp,
  query,
  where,
  getDocs,
  arrayRemove,
  arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref,
  deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import {
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

// Same Cloudinary preset the public storefront uses — see
// SETUP-README.md for signed-upload hardening.
const CLOUDINARY_CLOUD_NAME = "YOUR_CLOUD_NAME";
const CLOUDINARY_UPLOAD_PRESET = "tracknrent_gallery_unsigned";

const functions = getFunctions();
const deleteGalleryMediaFn = httpsCallable(functions, "deleteGalleryMedia");

let currentBusinessId = null;
let currentGallery = []; // array of { id, url, addedBy, addedAt }
let unsubscribeBusiness = null;

const publicProfileToggle = document.getElementById("publicProfileToggle");
const showInventoryToggle = document.getElementById("showInventoryToggle");
const showAvailabilityToggle = document.getElementById("showAvailabilityToggle");
const profileSlug = document.getElementById("profileSlug");
const businessBio = document.getElementById("businessBio");
const publicPhone = document.getElementById("publicPhone");
const publicWhatsapp = document.getElementById("publicWhatsapp");
const publicAddress = document.getElementById("publicAddress");
const publicLatitude = document.getElementById("publicLatitude");
const publicLongitude = document.getElementById("publicLongitude");
const btnUseMyLocation = document.getElementById("btnUseMyLocation");
const imagePreviewGrid = document.getElementById("imagePreviewGrid");
const galleryUploadInput = document.getElementById("galleryUploadInput");
const galleryUploadStatus = document.getElementById("galleryUploadStatus");
const saveBtn = document.getElementById("savePublicSettings");
const liveProfileLink = document.getElementById("liveProfileLink");

/* =========================
   REAL-TIME SLUG SANITIZER
========================= */
if (profileSlug) {
  profileSlug.addEventListener("input", (e) => {
    e.target.value = sanitizeSlug(e.target.value);
  });
}

function sanitizeSlug(rawSlug) {
  return rawSlug
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")
    .replace(/--+/g, "-");
}

/* =========================
   AUTHENTICATION GUARD
========================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "signup.html";
    return;
  }

  try {
    currentBusinessId = await getBusinessIdByUid(user.uid);
    await loadSettings();
    watchGalleryLive();
    linkOneSignalIdentity(currentBusinessId);
  } catch (err) {
    console.error("Failed to load storefront settings:", err);
    alert("Error loading business info.");
  }
});

async function getBusinessIdByUid(uid) {
  const cacheKey = `businessId_${uid}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) return cached;

  const q = query(
    collection(db, "businessMembers"),
    where("uid", "==", uid)
  );
  const snap = await getDocs(q);
  if (snap.empty) throw new Error("NO_BUSINESS");
  const businessId = snap.docs[0].data().businessId;
  localStorage.setItem(cacheKey, businessId);
  return businessId;
}

/* =========================
   ONESIGNAL IDENTITY LINK
   So the Cloud Function can target this specific owner by
   businessId when a visitor uploads a gallery photo.
   Requires the OneSignal Web SDK to already be loaded on this page.
========================= */
function linkOneSignalIdentity(businessId) {
  if (!window.OneSignal) return;
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async (OneSignal) => {
    try {
      await OneSignal.login(businessId); // external_id used by the Cloud Function
    } catch (err) {
      console.warn("OneSignal login failed:", err);
    }
  });
}

/* =========================
   LOAD SETTINGS (initial paint)
========================= */
async function loadSettings() {
  if (!currentBusinessId) return;

  const businessRef = doc(db, "businesses", currentBusinessId);
  const snap = await getDoc(businessRef);
  if (!snap.exists()) return;

  applyProfileToForm(snap.data());
}

/* =========================
   LIVE GALLERY / SETTINGS SYNC
   Keeps the dashboard in sync the moment a visitor adds a photo
   on the public storefront, no refresh needed.
========================= */
function watchGalleryLive() {
  if (!currentBusinessId) return;
  const businessRef = doc(db, "businesses", currentBusinessId);

  if (unsubscribeBusiness) unsubscribeBusiness();
  unsubscribeBusiness = onSnapshot(businessRef, (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    currentGallery = normalizeGallery(data.publicProfile?.gallery);
    renderGallery();
  });
}

function applyProfileToForm(data) {
  const profile = data.publicProfile || {};

  if (publicProfileToggle) publicProfileToggle.checked = profile.enabled || false;
  if (showInventoryToggle) showInventoryToggle.checked = profile.showInventory !== false; // default true
  if (showAvailabilityToggle) showAvailabilityToggle.checked = profile.showAvailability !== false; // default true
  if (profileSlug) profileSlug.value = profile.slug || "";
  if (businessBio) businessBio.value = profile.bio || "";
  if (publicPhone) publicPhone.value = profile.phone || "";
  if (publicWhatsapp) publicWhatsapp.value = profile.whatsapp || "";
  if (publicAddress) publicAddress.value = profile.address || "";
  if (publicLatitude) publicLatitude.value = profile.latitude ?? "";
  if (publicLongitude) publicLongitude.value = profile.longitude ?? "";

  currentGallery = normalizeGallery(profile.gallery);

  updateLiveLink(profile.slug, profile.enabled);
  renderGallery();
}

// Older records stored gallery as a plain array of URL strings.
// Normalize everything to { id, url, type, addedBy, addedAt } going forward.
function normalizeGallery(gallery) {
  if (!Array.isArray(gallery)) return [];
  return gallery.map((entry, i) => {
    if (typeof entry === "string") {
      return { id: `legacy_${i}`, url: entry, type: "image", addedBy: "owner", addedAt: null };
    }
    return { type: "image", ...entry };
  });
}

function updateLiveLink(slug, enabled) {
  if (!liveProfileLink) return;
  const parentCard = liveProfileLink.closest(".profile-card");
  if (enabled && slug) {
    const url = `${window.location.origin}/p/${slug}`;
    liveProfileLink.href = url;
    liveProfileLink.textContent = `View Live Store (${slug})`;
    if (parentCard) parentCard.classList.remove("hidden");
  } else if (parentCard) {
    parentCard.classList.add("hidden");
  }
}

/* =========================
   USE MY CURRENT LOCATION
   Free alternative to geocoding — drops a real pin without
   needing a paid Google Maps API key.
========================= */
if (btnUseMyLocation) {
  btnUseMyLocation.addEventListener("click", () => {
    if (!navigator.geolocation) {
      alert("Location isn't supported on this device/browser.");
      return;
    }
    btnUseMyLocation.disabled = true;
    btnUseMyLocation.textContent = "Locating...";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (publicLatitude) publicLatitude.value = pos.coords.latitude.toFixed(6);
        if (publicLongitude) publicLongitude.value = pos.coords.longitude.toFixed(6);
        btnUseMyLocation.disabled = false;
        btnUseMyLocation.textContent = "Use My Current Location";
      },
      (err) => {
        console.error("Geolocation error:", err);
        alert("Couldn't get your location. You can still type coordinates manually.");
        btnUseMyLocation.disabled = false;
        btnUseMyLocation.textContent = "Use My Current Location";
      }
    );
  });
}

/* =========================
   ACTIVITY LOG
   "Remember everything" — every gallery event is written here so
   the owner has a full history, independent of push notifications.
========================= */
async function logActivity(type, detail) {
  if (!currentBusinessId) return;
  try {
    await addDoc(collection(db, "businesses", currentBusinessId, "activity"), {
      type,
      detail,
      createdAt: serverTimestamp()
    });
  } catch (err) {
    console.warn("Activity log write failed:", err);
  }
}

/* =========================
   RENDER GALLERY PREVIEW
   Owner can delete ANY photo/video, including ones team members added.
========================= */
function renderGallery() {
  if (!imagePreviewGrid) return;
  imagePreviewGrid.innerHTML = "";

  if (currentGallery.length === 0) {
    imagePreviewGrid.innerHTML = `<p class="col-span-full text-sm text-slate-400 py-4">No photos or videos yet. Team members can also add these from your live store page.</p>`;
    return;
  }

  currentGallery.forEach((item) => {
    const wrapper = document.createElement("div");
    wrapper.className = "relative group aspect-square rounded-xl overflow-hidden border bg-gray-100 shadow-sm";

    const sourceTag = item.addedBy && item.addedBy !== "owner"
      ? `<span class="absolute top-2 left-2 bg-purple-900/80 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full">${item.addedByEmail || "Team upload"}</span>`
      : "";

    const mediaTag = item.type === "video"
      ? `<video src="${item.url}" class="w-full h-full object-cover" muted loop playsinline></video>`
      : `<img src="${item.url}" class="w-full h-full object-cover">`;

    wrapper.innerHTML = `
      ${mediaTag}
      ${sourceTag}
      <button data-id="${item.id}" class="delete-gallery-btn absolute top-2 right-2 bg-red-600 hover:bg-red-700 text-white p-1.5 rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity">
        <span class="material-symbols-outlined text-xs" style="font-size: 16px;">delete</span>
      </button>
    `;
    imagePreviewGrid.appendChild(wrapper);
  });

  imagePreviewGrid.querySelectorAll(".delete-gallery-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteGalleryImage(btn.dataset.id));
  });
}

async function deleteGalleryImage(itemId) {
  if (!confirm("Are you sure you want to delete this item?")) return;

  const item = currentGallery.find((g) => g.id === itemId);
  if (!item) return;

  try {
    if (item.publicId) {
      // Cloudinary asset — must be destroyed server-side (needs the API
      // secret). This Cloud Function verifies you're the owner before
      // deleting. See SETUP-README.md / functions-cloudinary-delete.js.
      try {
        await deleteGalleryMediaFn({
          businessId: currentBusinessId,
          publicId: item.publicId,
          resourceType: item.resourceType || "image"
        });
      } catch (fnErr) {
        console.warn("Cloudinary delete function failed (removing from gallery anyway):", fnErr);
      }
    } else if (item.url.includes("firebasestorage.googleapis.com")) {
      try {
        const storageRef = ref(storage, item.url);
        await deleteObject(storageRef);
      } catch (storageErr) {
        console.warn("Storage file already gone or inaccessible:", storageErr);
      }
    }

    const businessRef = doc(db, "businesses", currentBusinessId);
    await updateDoc(businessRef, {
      "publicProfile.gallery": arrayRemove(item)
    });

    await logActivity("gallery_delete", { url: item.url, addedBy: item.addedBy });

    // onSnapshot will re-render automatically, but update immediately too
    currentGallery = currentGallery.filter((g) => g.id !== itemId);
    renderGallery();
  } catch (err) {
    console.error("Delete item error:", err);
    alert("Failed to delete: " + err.message);
  }
}
// Kept for any legacy inline handlers still pointing at this name.
window.deleteGalleryImage = deleteGalleryImage;

/* =========================
   OWNER GALLERY UPLOAD
   The owner is also "inside the business," so they can add photos
   or videos straight from the dashboard, same Cloudinary pipeline
   the storefront's team-member uploader uses. The dropzone <input>
   itself is the clickable area (see public.html) — no separate button.
========================= */
if (galleryUploadInput) {
  galleryUploadInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file || !currentBusinessId) return;

    if (galleryUploadStatus) galleryUploadStatus.textContent = "Uploading...";

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`, {
        method: "POST",
        body: formData
      });
      if (!res.ok) throw new Error("Cloudinary upload failed");
      const result = await res.json();

      const newEntry = {
        id: result.public_id.replace(/\//g, "_"),
        url: result.secure_url,
        publicId: result.public_id,
        resourceType: result.resource_type,
        type: result.resource_type === "video" ? "video" : "image",
        addedBy: "owner",
        addedAt: new Date().toISOString()
      };

      const businessRef = doc(db, "businesses", currentBusinessId);
      await updateDoc(businessRef, {
        "publicProfile.gallery": arrayUnion(newEntry)
      });

      await logActivity("gallery_add", { url: newEntry.url, addedBy: "owner" });
      if (galleryUploadStatus) galleryUploadStatus.textContent = "Added!";
    } catch (err) {
      console.error("Owner gallery upload failed:", err);
      if (galleryUploadStatus) galleryUploadStatus.textContent = "Upload failed.";
    } finally {
      galleryUploadInput.value = "";
      setTimeout(() => { if (galleryUploadStatus) galleryUploadStatus.textContent = ""; }, 4000);
    }
  });
}

/* =========================
   SLUG AVAILABILITY CHECK
========================= */
async function checkSlugAvailable(slug, myBusinessId) {
  const slugRef = doc(db, "publicSlugs", slug);
  const slugSnap = await getDoc(slugRef);

  if (slugSnap.exists()) {
    const ownerId = slugSnap.data().businessId;
    if (ownerId !== myBusinessId) return false;
  }

  const q = query(
    collection(db, "businesses"),
    where("publicProfile.slug", "==", slug)
  );
  const querySnap = await getDocs(q);

  if (!querySnap.empty) {
    const matchedDoc = querySnap.docs[0];
    if (matchedDoc.id !== myBusinessId) return false;
  }

  return true;
}

/* =========================
   SAVE PUBLIC SETTINGS
   Only the authenticated owner reaches this code path — the public
   storefront never calls it. Enforce the same rule server-side in
   Firestore Security Rules (see SETUP-README.md).
========================= */
if (saveBtn) {
  saveBtn.addEventListener("click", async () => {
    const cleanSlug = sanitizeSlug(profileSlug.value);
    const enabled = publicProfileToggle.checked;
    const showInventory = showInventoryToggle ? showInventoryToggle.checked : true;
    const showAvailability = showAvailabilityToggle ? showAvailabilityToggle.checked : true;

    const lat = publicLatitude && publicLatitude.value !== "" ? Number(publicLatitude.value) : null;
    const lng = publicLongitude && publicLongitude.value !== "" ? Number(publicLongitude.value) : null;

    if (enabled && !cleanSlug) {
      alert("Please enter a custom URL handle to enable your public store.");
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving changes...";

    try {
      const businessRef = doc(db, "businesses", currentBusinessId);
      const oldSnap = await getDoc(businessRef);
      const oldSlug = oldSnap.data()?.publicProfile?.slug;

      if (cleanSlug) {
        const isAvailable = await checkSlugAvailable(cleanSlug, currentBusinessId);
        if (!isAvailable) {
          throw new Error(`The handle "${cleanSlug}" is already taken by another business. Please choose another.`);
        }

        if (oldSlug && oldSlug !== cleanSlug) {
          await deleteDoc(doc(db, "publicSlugs", oldSlug));
        }

        const newSlugRef = doc(db, "publicSlugs", cleanSlug);
        if (enabled) {
          await setDoc(newSlugRef, { businessId: currentBusinessId, updatedAt: new Date().toISOString() });
        } else {
          await deleteDoc(newSlugRef);
        }
      } else if (oldSlug) {
        await deleteDoc(doc(db, "publicSlugs", oldSlug));
      }

      await updateDoc(businessRef, {
        publicProfile: {
          enabled,
          showInventory,
          showAvailability,
          slug: cleanSlug,
          bio: businessBio.value.trim(),
          phone: publicPhone.value.trim(),
          whatsapp: publicWhatsapp.value.trim(),
          address: publicAddress.value.trim(),
          latitude: lat,
          longitude: lng,
          gallery: currentGallery,
          updatedAt: new Date().toISOString()
        },
        // Turning the public storefront on/off also controls marketplace
        // visibility — the owner shouldn't have to flip two switches.
        // Dot-path update so we never clobber marketplace.featured/verified.
        "marketplace.visible": enabled
      });

      profileSlug.value = cleanSlug;
      updateLiveLink(cleanSlug, enabled);
      alert("Storefront settings updated successfully! 🌐");
    } catch (err) {
      console.error("Save storefront error:", err);
      alert("Failed to save: " + err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Update Storefront Data";
    }
  });
}
