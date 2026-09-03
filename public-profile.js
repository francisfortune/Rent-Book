// assets/js/public-profile.js
import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  collection,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ===== Cloudinary (unsigned upload) =====
const CLOUDINARY_CLOUD_NAME = "jbavo7nr";
const CLOUDINARY_UPLOAD_PRESET = "yihgs7q3";
const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`;

let currentBusinessId = null;
let currentGallery = [];
let currentRole = "owner"; // safe default for legacy accounts with no businessMembers record
let currentUserEmail = "";

const publicProfileToggle = document.getElementById("publicProfileToggle");
const profileSlug = document.getElementById("profileSlug");
const businessBio = document.getElementById("businessBio");
const publicPhone = document.getElementById("publicPhone");
const publicWhatsapp = document.getElementById("publicWhatsapp");
const publicAddress = document.getElementById("publicAddress");
const galleryUploadInput = document.getElementById("galleryUploadInput");
const imagePreviewGrid = document.getElementById("imagePreviewGrid");
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

  currentUserEmail = (user.email || "").toLowerCase().trim();

  try {
    const membership = await getMembership(user);
    currentBusinessId = membership.businessId;
    currentRole = membership.role;

    applyRolePermissions();
    await loadSettings();
  } catch (err) {
    console.error("Failed to load storefront settings:", err);
    alert("Error loading business info.");
  }
});

/**
 * Resolves { businessId, role } for the signed-in user.
 * Tries the uid-keyed businessMembers record first (legacy owner accounts),
 * then falls back to the email/phone-keyed record used by settings.js.
 */
async function getMembership(user) {
  const cacheKey = `businessId_${user.uid}`;
  const membersRef = collection(db, "businessMembers");

  const uidQuery = query(membersRef, where("uid", "==", user.uid));
  const uidSnap = await getDocs(uidQuery);
  if (!uidSnap.empty) {
    const data = uidSnap.docs[0].data();
    localStorage.setItem(cacheKey, data.businessId);
    return { businessId: data.businessId, role: data.role || "owner" };
  }

  if (user.email) {
    const emailQuery = query(membersRef, where("email", "==", user.email.toLowerCase().trim()));
    const emailSnap = await getDocs(emailQuery);
    if (!emailSnap.empty) {
      const data = emailSnap.docs[0].data();
      localStorage.setItem(cacheKey, data.businessId);
      return { businessId: data.businessId, role: data.role || "viewer" };
    }
  }

  if (user.phoneNumber) {
    const phoneQuery = query(membersRef, where("phone", "==", user.phoneNumber.trim()));
    const phoneSnap = await getDocs(phoneQuery);
    if (!phoneSnap.empty) {
      const data = phoneSnap.docs[0].data();
      localStorage.setItem(cacheKey, data.businessId);
      return { businessId: data.businessId, role: data.role || "viewer" };
    }
  }

  const cached = localStorage.getItem(cacheKey);
  if (cached) return { businessId: cached, role: "owner" };

  throw new Error("NO_BUSINESS");
}

/* =========================
   ROLE-BASED UI LOCKS
   Only the owner may toggle the store, change the slug, or edit
   contact/bio details. Any team member (owner or accepted partner)
   may still upload to the gallery.
========================= */
function applyRolePermissions() {
  const isOwner = currentRole === "owner";
  const ownerOnlyFields = [publicProfileToggle, profileSlug, businessBio, publicPhone, publicWhatsapp, publicAddress];

  ownerOnlyFields.forEach((el) => {
    if (!el) return;
    el.disabled = !isOwner;
  });

  if (saveBtn) {
    saveBtn.disabled = !isOwner;
    if (!isOwner) {
      saveBtn.textContent = "Only the owner can change these settings";
      saveBtn.classList.add("opacity-60", "cursor-not-allowed");
    }
  }

  const roleNotice = document.getElementById("roleNotice");
  if (roleNotice) {
    roleNotice.innerHTML = isOwner
      ? ""
      : `<p class="text-xs text-purple-700 bg-purple-50 border border-purple-100 rounded-lg px-3 py-2 mb-4">
           You can add photos and videos to the gallery below, but only the business owner can change the store link, bio, contact info, or turn the store on/off.
         </p>`;
  }
}

/* =========================
   LOAD SETTINGS
========================= */
async function loadSettings() {
  if (!currentBusinessId) return;

  const businessRef = doc(db, "businesses", currentBusinessId);
  const snap = await getDoc(businessRef);

  if (!snap.exists()) return;

  const data = snap.data();
  const profile = data.publicProfile || {};

  if (publicProfileToggle) publicProfileToggle.checked = profile.enabled || false;
  if (profileSlug) profileSlug.value = profile.slug || "";
  if (businessBio) businessBio.value = profile.bio || "";
  if (publicPhone) publicPhone.value = profile.phone || "";
  if (publicWhatsapp) publicWhatsapp.value = profile.whatsapp || "";
  if (publicAddress) publicAddress.value = profile.address || "";
  currentGallery = profile.gallery || [];

  updateLiveLink(profile.slug, profile.enabled);
  renderGallery();
}

function updateLiveLink(slug, enabled) {
  if (!liveProfileLink) return;

  const parentCard = liveProfileLink.closest(".profile-card");
  if (enabled && slug) {
    const url = `${window.location.origin}/p/${slug}`;
    liveProfileLink.href = url;
    liveProfileLink.textContent = `View Live Store (${slug})`;
    if (parentCard) parentCard.classList.remove("hidden");
  } else {
    if (parentCard) parentCard.classList.add("hidden");
  }
}

/* =========================
   RENDER GALLERY PREVIEW (images + video, Cloudinary URLs)
========================= */
function renderGallery() {
  if (!imagePreviewGrid) return;
  imagePreviewGrid.innerHTML = "";

  currentGallery.forEach((entry, index) => {
    const item = normalizeGalleryEntry(entry);
    const isOwner = currentRole === "owner";

    const wrapper = document.createElement("div");
    wrapper.className = "relative group aspect-square rounded-xl overflow-hidden border bg-gray-100 shadow-sm";

    const mediaHtml =
      item.type === "video"
        ? `<video src="${item.url}#t=0.1" muted class="w-full h-full object-cover"></video>`
        : `<img src="${item.url}" class="w-full h-full object-cover">`;

    wrapper.innerHTML = `
      ${mediaHtml}
      ${
        isOwner
          ? `<button class="absolute top-2 right-2 bg-red-600 hover:bg-red-700 text-white p-1.5 rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity" onclick="deleteGalleryImage(${index})">
              <span class="material-symbols-outlined text-xs" style="font-size: 16px;">delete</span>
            </button>`
          : ""
      }
    `;
    imagePreviewGrid.appendChild(wrapper);
  });
}

function normalizeGalleryEntry(entry) {
  if (typeof entry === "string") {
    const isVideo = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(entry) || entry.includes("/video/upload/");
    return { url: entry, type: isVideo ? "video" : "image" };
  }
  return entry;
}

// Deleting a gallery item is owner-only: it only removes the Firestore
// reference. The underlying Cloudinary asset stays until you wire up a
// signed delete endpoint (Cloudinary destroy requires the API secret,
// which can't live in this client-side file).
window.deleteGalleryImage = async function (index) {
  if (currentRole !== "owner") {
    alert("Only the business owner can remove gallery items.");
    return;
  }
  if (!confirm("Are you sure you want to delete this showcase item?")) return;

  try {
    currentGallery.splice(index, 1);

    const businessRef = doc(db, "businesses", currentBusinessId);
    await updateDoc(businessRef, {
      "publicProfile.gallery": currentGallery
    });

    renderGallery();
    alert("Item deleted successfully! 🗑️");
  } catch (err) {
    console.error("Delete image error:", err);
    alert("Failed to delete item: " + err.message);
  }
};

/* =========================
   IMAGE / VIDEO UPLOAD HANDLER (Cloudinary)
   Any accepted team member can upload — not owner-gated.
========================= */
if (galleryUploadInput) {
  galleryUploadInput.setAttribute("accept", "image/*,video/*");

  galleryUploadInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    if (!currentBusinessId) {
      alert("Please wait for account authorization.");
      return;
    }

    try {
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = "Uploading media...";
      }

      const uploadPromises = files.map((file) => uploadToCloudinary(file, currentUserEmail || "team member"));
      const newEntries = await Promise.all(uploadPromises);

      currentGallery = [...currentGallery, ...newEntries];

      const businessRef = doc(db, "businesses", currentBusinessId);
      await updateDoc(businessRef, {
        "publicProfile.gallery": currentGallery
      });

      renderGallery();
      alert("Media uploaded successfully! 📸");
    } catch (err) {
      console.error("Upload error:", err);
      alert("Error uploading media: " + err.message);
    } finally {
      if (saveBtn) {
        saveBtn.disabled = currentRole !== "owner";
        saveBtn.textContent = currentRole === "owner" ? "Update Storefront Data" : "Only the owner can change these settings";
      }
      galleryUploadInput.value = "";
    }
  });
}

async function uploadToCloudinary(file, uploadedBy) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

  const res = await fetch(CLOUDINARY_UPLOAD_URL, { method: "POST", body: formData });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error?.message || `Upload failed for ${file.name}`);
  }
  const data = await res.json();

  return {
    url: data.secure_url,
    type: data.resource_type === "video" ? "video" : "image",
    publicId: data.public_id,
    uploadedBy,
    createdAt: new Date().toISOString()
  };
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

  const q = query(collection(db, "businesses"), where("publicProfile.slug", "==", slug));
  const querySnap = await getDocs(q);

  if (!querySnap.empty) {
    const matchedDoc = querySnap.docs[0];
    if (matchedDoc.id !== myBusinessId) return false;
  }

  return true;
}

/* =========================
   SAVE PUBLIC SETTINGS (owner only)
========================= */
if (saveBtn) {
  saveBtn.addEventListener("click", async () => {
    if (currentRole !== "owner") {
      alert("Only the business owner can change these settings.");
      return;
    }

    const cleanSlug = sanitizeSlug(profileSlug.value);
    const enabled = publicProfileToggle.checked;

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

      // googleIndexed stays false until a Cloud Function (see docs) verifies
      // the page is live and flips it — that trigger is what regenerates
      // the sitemap, same pattern already used elsewhere in the app.
      await updateDoc(businessRef, {
        publicProfile: {
          enabled: enabled,
          slug: cleanSlug,
          bio: businessBio.value.trim(),
          phone: publicPhone.value.trim(),
          whatsapp: publicWhatsapp.value.trim(),
          address: publicAddress.value.trim(),
          gallery: currentGallery,
          googleIndexed: enabled ? (oldSnap.data()?.publicProfile?.googleIndexed || false) : false,
          updatedAt: new Date().toISOString()
        }
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
