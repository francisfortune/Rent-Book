// assets/js/public-profile.js
import { auth, db, storage } from "./firebase.js";
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
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

let currentBusinessId = null;
let currentGallery = [];

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
  } catch (err) {
    console.error("Failed to load storefront settings:", err);
    alert("Error loading business info.");
  }
});

async function getBusinessIdByUid(uid) {
  const cacheKey = `businessId_${uid}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) return cached;

  // Query database
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
   LOAD SETTINGS
========================= */
async function loadSettings() {
  if (!currentBusinessId) return;

  const businessRef = doc(db, "businesses", currentBusinessId);
  const snap = await getDoc(businessRef);

  if (!snap.exists()) return;

  const data = snap.data();
  const profile = data.publicProfile || {};

  publicProfileToggle.checked = profile.enabled || false;
  profileSlug.value = profile.slug || "";
  businessBio.value = profile.bio || "";
  publicPhone.value = profile.phone || "";
  publicWhatsapp.value = profile.whatsapp || "";
  publicAddress.value = profile.address || "";
  currentGallery = profile.gallery || [];

  updateLiveLink(profile.slug, profile.enabled);
  renderGallery();
}

function updateLiveLink(slug, enabled) {
  if (enabled && slug) {
    const url = `${window.location.origin}/p/${slug}`;
    liveProfileLink.href = url;
    liveProfileLink.textContent = `View Live Store (${slug})`;
    liveProfileLink.closest(".profile-card").classList.remove("hidden");
  } else {
    liveProfileLink.closest(".profile-card").classList.add("hidden");
  }
}

/* =========================
   RENDER GALLERY PREVIEW
========================= */
function renderGallery() {
  imagePreviewGrid.innerHTML = "";
  currentGallery.forEach((url, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "relative group aspect-square rounded-xl overflow-hidden border bg-gray-100 shadow-sm";

    wrapper.innerHTML = `
      <img src="${url}" class="w-full h-full object-cover">
      <button class="absolute top-2 right-2 bg-red-600 hover:bg-red-700 text-white p-1.5 rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity" onclick="deleteGalleryImage(${index})">
        <span class="material-symbols-outlined text-xs" style="font-size: 16px;">delete</span>
      </button>
    `;
    imagePreviewGrid.appendChild(wrapper);
  });
}

// Expose delete to window so inline onclick works
window.deleteGalleryImage = async function (index) {
  if (!confirm("Are you sure you want to delete this showcase image?")) return;

  const url = currentGallery[index];
  try {
    // 1. Delete from storage if it belongs to storage
    if (url.includes("firebasestorage.googleapis.com")) {
      const storageRef = ref(storage, url);
      await deleteObject(storageRef);
    }

    // 2. Update array
    currentGallery.splice(index, 1);

    // 3. Save to database
    const businessRef = doc(db, "businesses", currentBusinessId);
    await updateDoc(businessRef, {
      "publicProfile.gallery": currentGallery
    });

    renderGallery();
    alert("Image deleted successfully! 🗑️");
  } catch (err) {
    console.error("Delete image error:", err);
    alert("Failed to delete image: " + err.message);
  }
};

/* =========================
   IMAGE UPLOAD HANDLER
========================= */
if (galleryUploadInput) {
  galleryUploadInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    if (!currentBusinessId) {
      alert("Please wait for account authorization.");
      return;
    }

    const uploadPromises = files.map(async (file) => {
      // Create unique name
      const fileExt = file.name.split('.').pop();
      const fileName = `gallery_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${fileExt}`;
      const fileRef = ref(storage, `businesses/${currentBusinessId}/gallery/${fileName}`);

      // Upload
      const snap = await uploadBytes(fileRef, file);
      // Get URL
      return await getDownloadURL(snap.ref);
    });

    try {
      saveBtn.disabled = true;
      saveBtn.textContent = "Uploading images...";

      const newUrls = await Promise.all(uploadPromises);
      currentGallery = [...currentGallery, ...newUrls];

      // Save to database
      const businessRef = doc(db, "businesses", currentBusinessId);
      await updateDoc(businessRef, {
        "publicProfile.gallery": currentGallery
      });

      renderGallery();
      alert("Photos uploaded successfully! 📸");
    } catch (err) {
      console.error("Upload error:", err);
      alert("Error uploading images: " + err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Update Storefront Data";
      galleryUploadInput.value = ""; // Clear file selector
    }
  });
}

/* =========================
   SAVE PUBLIC SETTINGS
========================= */
if (saveBtn) {
  saveBtn.addEventListener("click", async () => {
    const slug = profileSlug.value.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "");
    const enabled = publicProfileToggle.checked;

    if (enabled && !slug) {
      alert("Please enter a custom URL handle to enable your public store.");
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving changes...";

    try {
      // 1. Resolve slug collisions
      if (slug) {
        const slugRef = doc(db, "publicSlugs", slug);
        const slugSnap = await getDoc(slugRef);

        if (slugSnap.exists() && slugSnap.data().businessId !== currentBusinessId) {
          throw new Error("This custom URL handle is already taken by another business.");
        }

        // Clean up old slug if it changed
        const businessRef = doc(db, "businesses", currentBusinessId);
        const oldSnap = await getDoc(businessRef);
        const oldSlug = oldSnap.data()?.publicProfile?.slug;

        if (oldSlug && oldSlug !== slug) {
          await deleteDoc(doc(db, "publicSlugs", oldSlug));
        }

        // Write slug registry
        if (enabled) {
          await setDoc(slugRef, { businessId: currentBusinessId });
        } else {
          await deleteDoc(slugRef);
        }
      }

      // 2. Update business details
      const businessRef = doc(db, "businesses", currentBusinessId);
      await updateDoc(businessRef, {
        publicProfile: {
          enabled: enabled,
          slug: slug,
          bio: businessBio.value.trim(),
          phone: publicPhone.value.trim(),
          whatsapp: publicWhatsapp.value.trim(),
          address: publicAddress.value.trim(),
          gallery: currentGallery
        }
      });

      updateLiveLink(slug, enabled);
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
