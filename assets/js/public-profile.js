// assets/js/public-profile.js
//
// Internal, authenticated dashboard controller for public.html.
//
// PERMISSION MODEL (same shape as bookings page)
//   Owner        -> full access, including the two things that are
//                   owner-only on this page:
//                     • turning the store OFFLINE via the Go Online toggle
//                     • deleting gallery media
//   Partner      -> full access to everything else: all settings, slug,
//                   contact info, bio, categories, logo, cover, gallery
//                   UPLOAD, location pin, and the Go Online toggle (but
//                   only to turn it ON — once it's on, only the owner can
//                   turn it back off).
//
// The UI below enforces this, but the authoritative check is in Firestore
// Security Rules — never trust the client alone. See firestore.rules.
import { auth, db } from "./firebase.js";
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
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

// --- Cloudinary (unsigned upload, same endpoint for images & video) -------
const CLOUDINARY_CLOUD_NAME = "jbavo7nr";
const CLOUDINARY_UPLOAD_PRESET = "tracknrent_gallery_unsigned";
const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`;

const functions = getFunctions();
const deleteGalleryMediaFn = httpsCallable(functions, "deleteGalleryMedia");

// Quick-add suggestions for the Services & Categories tag editor.
const CATEGORY_SUGGESTIONS = [
  "Equipment", "Vehicles", "Event Rentals", "Photography", "Furniture",
  "Sound & Lighting", "Decor", "Catering", "Bounce Castles", "Tents & Canopies",
  "Chairs & Tables", "Generators", "Power Tools", "Party Supplies"
];
const MAX_CATEGORIES = 12;

let currentBusinessId = null;
let currentGallery = [];
let currentCategories = [];
let currentUid = null;
let isOwner = false;
let isPartner = false;
let profileWasEnabled = false;

let unsubscribeBusiness = null;

// --- DOM refs ---------------------------------------------------------
const publicProfileToggle = document.getElementById("publicProfileToggle");
const showInventoryToggle = document.getElementById("showInventoryToggle");
const showAvailabilityToggle = document.getElementById("showAvailabilityToggle");
const profileSlug = document.getElementById("profileSlug");
const businessBio = document.getElementById("businessBio");
const publicPhone = document.getElementById("publicPhone");
const publicWhatsapp = document.getElementById("publicWhatsapp");
const publicInstagram = document.getElementById("publicInstagram");
const publicTiktok = document.getElementById("publicTiktok");
const publicFacebook = document.getElementById("publicFacebook");
const depositCautionFee = document.getElementById("depositCautionFee");
const depositIdRequirement = document.getElementById("depositIdRequirement");
const depositNotes = document.getElementById("depositNotes");
const publicAddress = document.getElementById("publicAddress");
const publicLatitude = document.getElementById("publicLatitude");
const publicLongitude = document.getElementById("publicLongitude");
const btnUseMyLocation = document.getElementById("btnUseMyLocation");
const pinStatus = document.getElementById("pinStatus");
const imagePreviewGrid = document.getElementById("imagePreviewGrid");
const galleryUploadInput = document.getElementById("galleryUploadInput");
const galleryDropzone = document.getElementById("galleryDropzone");
const galleryUploadStatus = document.getElementById("galleryUploadStatus");
const logoPreview = document.getElementById("logoPreview");
const logoUploadInput = document.getElementById("logoUploadInput");
const logoUploadStatus = document.getElementById("logoUploadStatus");
const coverImagePreview = document.getElementById("coverImagePreview");
const coverImagePreviewWrap = document.getElementById("coverImagePreviewWrap");
const coverUploadInput = document.getElementById("coverUploadInput");
const coverUploadStatus = document.getElementById("coverUploadStatus");
const removeCoverBtn = document.getElementById("removeCoverBtn");
const categoryTagsList = document.getElementById("categoryTagsList");
const categoryInput = document.getElementById("categoryInput");
const categoryAddBtn = document.getElementById("categoryAddBtn");
const categorySuggestions = document.getElementById("categorySuggestions");
const saveBtn = document.getElementById("savePublicSettings");
const saveBtnFloating = document.getElementById("savePublicSettingsFloating");
const liveProfileLink = document.getElementById("liveProfileLink");
const teamMemberNotice = document.getElementById("teamMemberNotice");
const toggleHelper = document.getElementById("toggleHelper");
const saveBarWrapper = document.getElementById("saveBarWrapper");

// --- Share storefront button (added) ----------------------------------
const shareStoreBtn = document.getElementById("shareStoreBtn");
const storeUrlHelp = document.getElementById("storeUrlHelp");

/* =========================
   UNSAVED CHANGES STATE
========================= */
let pageIsDirty = false;
let dirtyWired = false;

function markDirty() {
  if (pageIsDirty) return;
  pageIsDirty = true;
  document.body.classList.add("has-unsaved-changes");
}

function clearDirty() {
  pageIsDirty = false;
  document.body.classList.remove("has-unsaved-changes");
}

window._markPublicDirty = markDirty;
window._clearPublicDirty = clearDirty;

function wireDirtyTracking() {
  if (dirtyWired) return;
  dirtyWired = true;

  const watchedIds = [
    "publicProfileToggle",
    "showInventoryToggle",
    "showAvailabilityToggle",
    "profileSlug",
    "businessBio",
    "publicPhone",
    "publicWhatsapp",
    "publicInstagram",
    "publicTiktok",
    "publicFacebook",
    "depositCautionFee",
    "depositIdRequirement",
    "depositNotes",
    "publicAddress"
  ];

  watchedIds.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", markDirty);
    el.addEventListener("change", markDirty);
  });

  if (categoryInput) categoryInput.addEventListener("input", markDirty);
  if (categoryAddBtn) categoryAddBtn.addEventListener("click", markDirty);

  [coverUploadInput, logoUploadInput, galleryUploadInput].forEach((input) => {
    if (input) input.addEventListener("change", markDirty);
  });

  if (removeCoverBtn) removeCoverBtn.addEventListener("click", markDirty);
  if (btnUseMyLocation) btnUseMyLocation.addEventListener("click", markDirty);
}

window.addEventListener("beforeunload", (e) => {
  if (!pageIsDirty) return;
  e.preventDefault();
  e.returnValue = "";
});

/* =========================
   SLUG SANITIZER
========================= */
if (profileSlug) {
  profileSlug.addEventListener("input", (e) => {
    e.target.value = sanitizeSlug(e.target.value);
  });
}

function sanitizeSlug(rawSlug) {
  return String(rawSlug || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")
    .replace(/--+/g, "-");
}

/* =========================
   SHARE STOREFRONT LINK
   Only works when the store is live AND a slug is set.
   Re-evaluated any time the toggle flips or the slug changes.
========================= */
function syncShareStoreButton() {
  if (!shareStoreBtn) return;

  const slug = (profileSlug?.value || "").trim();
  const enabled = publicProfileToggle?.checked === true;
  const canShare = enabled && slug.length > 0;

  shareStoreBtn.disabled = !canShare;
  shareStoreBtn.title = canShare
    ? "Share your storefront link"
    : "Turn on Go Online to enable sharing";

  if (storeUrlHelp) {
    if (!slug) {
      storeUrlHelp.textContent = "Choose a unique name for your storefront link";
    } else if (!enabled) {
      storeUrlHelp.textContent = "Turn on Go Online to make this link shareable";
    } else {
      storeUrlHelp.textContent = `Your store is live at ${window.location.origin}/p/${slug}`;
    }
  }
}

if (profileSlug) profileSlug.addEventListener("input", syncShareStoreButton);
if (publicProfileToggle) publicProfileToggle.addEventListener("change", syncShareStoreButton);

if (shareStoreBtn) {
  shareStoreBtn.addEventListener("click", async () => {
    const slug = (profileSlug?.value || "").trim();
    const enabled = publicProfileToggle?.checked === true;

    if (!enabled) {
      alert("Turn on 'Go Online' first to publish and share your storefront.");
      return;
    }
    if (!slug) {
      alert("Please choose a store URL first.");
      return;
    }

    const url = `${window.location.origin}/p/${slug}`;
    const shareData = {
      title: document.title || "Our Store on Tracknrent",
      text: "Check out our rental catalogue on Tracknrent:",
      url,
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(url);
        alert("Store link copied to clipboard.");
      }
    } catch (err) {
      if (err?.name !== "AbortError") {
        console.warn("Share failed:", err);
        try {
          await navigator.clipboard.writeText(url);
          alert("Couldn't open the share menu — link copied instead.");
        } catch {
          alert("Couldn't share or copy the link. Please copy it manually.");
        }
      }
    }
  });
}

/* =========================
   AUTHENTICATION GUARD
========================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "signup.html";
    return;
  }

  currentUid = user.uid;

  try {
    const membership = await getBusinessMembership(user.uid);
    currentBusinessId = membership.businessId;
    isOwner = membership.role === "owner";
    isPartner = !isOwner;

    applyRoleToUI();
    await loadSettings();
    wireDirtyTracking();
    syncShareStoreButton();
  } catch (err) {
    console.error("Failed to load storefront settings:", err);
    alert("Error loading business info.");
  }
});

async function getBusinessMembership(uid) {
  const cacheKey = `businessMembership_${uid}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed && parsed.businessId) return parsed;
    } catch {
      /* fall through */
    }
  }

  const q = query(collection(db, "businessMembers"), where("uid", "==", uid));
  const snap = await getDocs(q);
  if (snap.empty) throw new Error("NO_BUSINESS");

  const memberDoc = snap.docs[0].data();
  const businessId = memberDoc.businessId;

  const businessSnap = await getDoc(doc(db, "businesses", businessId));
  const ownerId = businessSnap.exists() ? businessSnap.data().ownerId : null;
  const role = ownerId === uid ? "owner" : "member";

  const result = { businessId, role };
  localStorage.setItem(cacheKey, JSON.stringify(result));
  return result;
}

/* =========================
   ROLE-BASED UI
========================= */
function applyRoleToUI() {
  if (teamMemberNotice) {
    teamMemberNotice.style.display = isOwner ? "none" : "flex";
  }

  if (saveBtn) {
    saveBtn.style.display = "";
    saveBtn.disabled = false;
  }

  syncTogglePermission();
}

function syncTogglePermission() {
  if (!publicProfileToggle) return;

  const wantsToTurnOff = profileWasEnabled && !publicProfileToggle.checked;
  const ownerOnlyAction = isPartner && (profileWasEnabled || wantsToTurnOff);

  if (ownerOnlyAction) {
    publicProfileToggle.disabled = true;
    if (toggleHelper) {
      toggleHelper.textContent = "Only the business owner can take the store offline.";
    }
  } else {
    publicProfileToggle.disabled = false;
    if (toggleHelper) {
      toggleHelper.textContent = isPartner
        ? "As a partner you can publish the store, but only the owner can unpublish it."
        : "";
    }
  }

  // The share button mirrors the toggle state, so keep it in sync.
  syncShareStoreButton();
}

if (publicProfileToggle) {
  publicProfileToggle.addEventListener("change", syncTogglePermission);
}

/* =========================
   LOAD SETTINGS
========================= */
async function loadSettings() {
  if (!currentBusinessId) return;
  const businessRef = doc(db, "businesses", currentBusinessId);

  if (unsubscribeBusiness) unsubscribeBusiness();
  unsubscribeBusiness = onSnapshot(businessRef, (snap) => {
    if (!snap.exists()) return;
    applyProfileToForm(snap.data());
  });
}

function applyProfileToForm(data) {
  const profile = data.publicProfile || {};

  profileWasEnabled = profile.enabled === true;

  if (publicProfileToggle) publicProfileToggle.checked = profileWasEnabled;
  if (showInventoryToggle) showInventoryToggle.checked = profile.showInventory !== false;
  if (showAvailabilityToggle) showAvailabilityToggle.checked = profile.showAvailability !== false;
  if (profileSlug) profileSlug.value = profile.slug || "";
  if (businessBio) businessBio.value = profile.bio || "";
  if (publicPhone) publicPhone.value = profile.phone || "";
  if (publicWhatsapp) publicWhatsapp.value = profile.whatsapp || "";
  if (publicInstagram) publicInstagram.value = profile.instagram || "";
  if (publicTiktok) publicTiktok.value = profile.tiktok || "";
  if (publicFacebook) publicFacebook.value = profile.facebook || "";

  const deposit = profile.depositPolicy || {};
  if (depositCautionFee) depositCautionFee.value = deposit.cautionFee || "";
  if (depositIdRequirement) depositIdRequirement.value = deposit.idRequirement || "";
  if (depositNotes) depositNotes.value = deposit.notes || "";

  if (publicAddress) publicAddress.value = profile.address || "";
  if (publicLatitude) publicLatitude.value = profile.latitude ?? "";
  if (publicLongitude) publicLongitude.value = profile.longitude ?? "";
  updatePinStatus(profile.latitude, profile.longitude);

  if (logoPreview) {
    const logoUrl = data.logoUrl || "";
    logoPreview.innerHTML = logoUrl
      ? `<img src="${logoUrl}" style="width:100%;height:100%;object-fit:cover;" alt="Store logo">`
      : (data.name || "?").slice(0, 2).toUpperCase();
  }

  applyCoverToPreview(data.coverImageUrl || "");

  currentCategories = normalizeCategories(
    profile.categories || data.categories || (data.category ? [data.category] : [])
  );
  renderCategoryTags();
  renderCategorySuggestions();

  currentGallery = normalizeGallery(profile.gallery);

  updateLiveLink(profile.slug, profile.enabled);
  renderGallery();

  syncTogglePermission();
  syncShareStoreButton();
}

function normalizeCategories(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const tag = String(raw || "").trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_CATEGORIES) break;
  }
  return out;
}

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
  const banner = document.getElementById("liveStatusBanner");
  const titleEl = banner?.querySelector("p.font-bold");
  const subtitleEl = banner?.querySelector("p.text-purple-200");

  if (enabled && slug) {
    const url = `${window.location.origin}/p/${slug}`;
    liveProfileLink.href = url;
    liveProfileLink.target = "_blank";
    liveProfileLink.innerHTML = `View Store <i class="fas fa-link text-xs mr-1"></i>`;
    if (titleEl) titleEl.textContent = "Your store is live";
    if (subtitleEl) subtitleEl.textContent = "Share your link with customers";
    if (banner) banner.style.display = "flex";
    liveProfileLink.onclick = null;
  } else {
    liveProfileLink.href = "#";
    liveProfileLink.removeAttribute("target");
    liveProfileLink.innerHTML = `Go to toggle <i class="fas fa-arrow-down text-xs mr-1"></i>`;
    if (titleEl) titleEl.textContent = "Your store is offline";
    if (subtitleEl) subtitleEl.textContent = "Flip the Go Online switch below to publish";
    if (banner) banner.style.display = "flex";
    liveProfileLink.onclick = (e) => {
      e.preventDefault();
      document.getElementById("publicProfileToggle")?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
  }
}

/* =========================
   COVER / BANNER IMAGE
========================= */
function applyCoverToPreview(url) {
  if (!coverImagePreview) return;
  if (url) {
    coverImagePreview.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;" alt="Store cover image">`;
    if (removeCoverBtn) removeCoverBtn.classList.remove("hidden");
  } else {
    coverImagePreview.innerHTML = `<span class="w-full h-full flex items-center justify-center text-white/70 text-xs font-medium">No banner uploaded yet</span>`;
    if (removeCoverBtn) removeCoverBtn.classList.add("hidden");
  }
}

if (coverUploadInput) {
  coverUploadInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file || !currentBusinessId) return;

    markDirty();
    if (coverUploadStatus) {
      coverUploadStatus.classList.remove("hidden");
      coverUploadStatus.textContent = "Uploading cover image...";
    }
    if (coverImagePreviewWrap) coverImagePreviewWrap.style.opacity = "0.6";

    try {
      const result = await uploadToCloudinary(file);
      const businessRef = doc(db, "businesses", currentBusinessId);
      await updateDoc(businessRef, { coverImageUrl: result.secure_url });

      applyCoverToPreview(result.secure_url);
      await logActivity("cover_update", { url: result.secure_url });
      if (coverUploadStatus) coverUploadStatus.textContent = "Cover image updated ✓";
    } catch (err) {
      console.error("Cover upload failed:", err);
      if (coverUploadStatus) coverUploadStatus.textContent = "Upload failed. Try again.";
    } finally {
      coverUploadInput.value = "";
      if (coverImagePreviewWrap) coverImagePreviewWrap.style.opacity = "1";
      setTimeout(() => { if (coverUploadStatus) coverUploadStatus.classList.add("hidden"); }, 3000);
    }
  });
}

if (removeCoverBtn) {
  removeCoverBtn.addEventListener("click", async () => {
    if (!currentBusinessId) return;
    if (!confirm("Remove your storefront's cover image?")) return;
    markDirty();
    try {
      const businessRef = doc(db, "businesses", currentBusinessId);
      await updateDoc(businessRef, { coverImageUrl: "" });
      applyCoverToPreview("");
      await logActivity("cover_remove", {});
    } catch (err) {
      console.error("Cover remove failed:", err);
      alert("Failed to remove cover image: " + err.message);
    }
  });
}

/* =========================
   SERVICES & CATEGORIES TAG EDITOR
========================= */
function renderCategoryTags() {
  if (!categoryTagsList) return;

  if (currentCategories.length === 0) {
    categoryTagsList.innerHTML = `<p class="text-xs text-gray-400">No services added yet — add one below.</p>`;
    return;
  }

  categoryTagsList.innerHTML = currentCategories
    .map((tag) => `
      <span class="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full"
            style="background:#F1E9FB; color:purple; border:1px solid #E4D6F7;">
        ${escapeHtmlLocal(tag)}
        <button type="button" data-tag="${escapeHtmlLocal(tag)}" class="remove-category-tag hover:text-red-600 transition-colors" aria-label="Remove ${escapeHtmlLocal(tag)}">
          <i class="fas fa-times text-[10px]"></i>
        </button>
      </span>`)
    .join("");

  categoryTagsList.querySelectorAll(".remove-category-tag").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentCategories = currentCategories.filter((t) => t !== btn.dataset.tag);
      renderCategoryTags();
      renderCategorySuggestions();
      markDirty();
    });
  });
}

function renderCategorySuggestions() {
  if (!categorySuggestions) return;
  const activeLower = new Set(currentCategories.map((t) => t.toLowerCase()));
  const remaining = CATEGORY_SUGGESTIONS.filter((s) => !activeLower.has(s.toLowerCase()));

  if (remaining.length === 0) {
    categorySuggestions.innerHTML = `<p class="text-xs text-gray-400">All suggestions added — type your own above.</p>`;
    return;
  }

  categorySuggestions.innerHTML = remaining
    .map((s) => `
      <button type="button" data-suggestion="${escapeHtmlLocal(s)}"
              class="category-suggestion-chip text-xs font-semibold px-3 py-1.5 rounded-full border border-gray-200 bg-gray-50 text-gray-600 hover:border-purple-300 hover:text-purple-700 hover:bg-purple-50 transition-colors">
        + ${escapeHtmlLocal(s)}
      </button>`)
    .join("");

  categorySuggestions.querySelectorAll(".category-suggestion-chip").forEach((btn) => {
    btn.addEventListener("click", () => addCategoryTag(btn.dataset.suggestion));
  });
}

function addCategoryTag(rawValue) {
  const tag = String(rawValue || "").trim();
  if (!tag) return;
  if (currentCategories.some((t) => t.toLowerCase() === tag.toLowerCase())) {
    if (categoryInput) categoryInput.value = "";
    return;
  }
  if (currentCategories.length >= MAX_CATEGORIES) {
    alert(`You can add up to ${MAX_CATEGORIES} services/categories.`);
    return;
  }
  currentCategories.push(tag);
  renderCategoryTags();
  renderCategorySuggestions();
  if (categoryInput) categoryInput.value = "";
  markDirty();
}

if (categoryAddBtn) {
  categoryAddBtn.addEventListener("click", () => addCategoryTag(categoryInput?.value));
}
if (categoryInput) {
  categoryInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addCategoryTag(categoryInput.value);
    }
  });
}

function escapeHtmlLocal(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* =========================
   USE MY CURRENT LOCATION
========================= */
function updatePinStatus(lat, lng) {
  if (!pinStatus) return;
  pinStatus.textContent = (lat != null && lng != null && lat !== "" && lng !== "")
    ? `Pinned: ${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`
    : "No coordinates saved yet — this is captured from your device, not typed in, so it can't be entered wrong.";
}

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
        updatePinStatus(pos.coords.latitude, pos.coords.longitude);
        btnUseMyLocation.disabled = false;
        btnUseMyLocation.textContent = "Use my location";
        markDirty();
      },
      (err) => {
        console.error("Geolocation error:", err);
        alert("Couldn't get your location. Make sure location access is allowed for this site.");
        btnUseMyLocation.disabled = false;
        btnUseMyLocation.textContent = "Use my location";
      }
    );
  });
}

/* =========================
   ACTIVITY LOG
========================= */
async function logActivity(type, detail) {
  if (!currentBusinessId) return;
  try {
    await addDoc(collection(db, "businesses", currentBusinessId, "activity"), {
      type,
      detail,
      actorUid: currentUid,
      createdAt: serverTimestamp()
    });
  } catch (err) {
    console.warn("Activity log write failed:", err);
  }
}

/* =========================
   RENDER GALLERY PREVIEW
========================= */
function renderGallery() {
  if (!imagePreviewGrid) return;
  imagePreviewGrid.innerHTML = "";

  if (currentGallery.length === 0) {
    imagePreviewGrid.innerHTML = `<p class="col-span-full text-sm text-slate-400 py-4">No photos or videos yet. Use the upload box above to add some.</p>`;
    return;
  }

  currentGallery.forEach((item) => {
    const wrapper = document.createElement("div");
    wrapper.className = "relative group aspect-square rounded-xl overflow-hidden border bg-gray-100 shadow-sm";

    const sourceTag = item.addedBy && item.addedBy !== "owner"
      ? `<span class="absolute top-2 left-2 bg-purple-900/80 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full">Partner upload</span>`
      : "";

    const mediaTag = item.type === "video"
      ? `<video src="${item.url}" class="w-full h-full object-cover" muted loop playsinline></video>`
      : `<img src="${item.url}" class="w-full h-full object-cover">`;

    const deleteBtn = isOwner
      ? `<button data-id="${item.id}" class="delete-gallery-btn absolute top-2 right-2 bg-red-600 hover:bg-red-700 text-white p-1.5 rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity">
           <span class="material-symbols-outlined text-xs" style="font-size: 16px;">delete</span>
         </button>`
      : "";

    wrapper.innerHTML = `${mediaTag}${sourceTag}${deleteBtn}`;
    imagePreviewGrid.appendChild(wrapper);
  });

  if (isOwner) {
    imagePreviewGrid.querySelectorAll(".delete-gallery-btn").forEach((btn) => {
      btn.addEventListener("click", () => deleteGalleryImage(btn.dataset.id));
    });
  }
}

async function deleteGalleryImage(itemId) {
  if (!isOwner) {
    alert("Only the business owner can delete gallery media.");
    return;
  }
  if (!confirm("Are you sure you want to delete this item?")) return;

  const item = currentGallery.find((g) => g.id === itemId);
  if (!item) return;

  markDirty();
  try {
    if (item.publicId) {
      try {
        await deleteGalleryMediaFn({
          businessId: currentBusinessId,
          publicId: item.publicId,
          resourceType: item.resourceType || "image"
        });
      } catch (fnErr) {
        console.warn("Cloudinary delete function failed (removing from gallery anyway):", fnErr);
      }
    }

    const businessRef = doc(db, "businesses", currentBusinessId);
    await updateDoc(businessRef, {
      "publicProfile.gallery": arrayRemove(item)
    });

    await logActivity("gallery_delete", { url: item.url });

    currentGallery = currentGallery.filter((g) => g.id !== itemId);
    renderGallery();
  } catch (err) {
    console.error("Delete item error:", err);
    alert("Failed to delete: " + err.message);
  }
}

/* =========================
   GALLERY UPLOAD
========================= */
async function uploadToCloudinary(file) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

  const res = await fetch(CLOUDINARY_UPLOAD_URL, { method: "POST", body: formData });
  if (!res.ok) throw new Error("Cloudinary upload failed");
  return res.json();
}

if (galleryUploadInput) {
  galleryUploadInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file || !currentBusinessId) return;

    markDirty();
    if (galleryUploadStatus) {
      galleryUploadStatus.style.display = "block";
      galleryUploadStatus.textContent = "Uploading...";
    }
    if (galleryDropzone) galleryDropzone.style.opacity = "0.6";

    try {
      const result = await uploadToCloudinary(file);

      const newEntry = {
        id: result.public_id.replace(/\//g, "_"),
        url: result.secure_url,
        publicId: result.public_id,
        resourceType: result.resource_type,
        type: result.resource_type === "video" ? "video" : "image",
        addedBy: isOwner ? "owner" : "member",
        addedByUid: currentUid,
        addedAt: new Date().toISOString()
      };

      const businessRef = doc(db, "businesses", currentBusinessId);
      await updateDoc(businessRef, {
        "publicProfile.gallery": arrayUnion(newEntry)
      });

      await logActivity("gallery_add", { url: newEntry.url });
      if (galleryUploadStatus) galleryUploadStatus.textContent = "Added! ✓";
    } catch (err) {
      console.error("Gallery upload failed:", err);
      if (galleryUploadStatus) galleryUploadStatus.textContent = "Upload failed. Try again.";
    } finally {
      galleryUploadInput.value = "";
      if (galleryDropzone) galleryDropzone.style.opacity = "1";
      setTimeout(() => { if (galleryUploadStatus) galleryUploadStatus.style.display = "none"; }, 3000);
    }
  });
}

/* =========================
   LOGO UPLOAD
========================= */
if (logoUploadInput) {
  logoUploadInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file || !currentBusinessId) return;

    markDirty();
    if (logoUploadStatus) {
      logoUploadStatus.style.display = "block";
      logoUploadStatus.textContent = "Uploading logo...";
    }

    try {
      const result = await uploadToCloudinary(file);
      const businessRef = doc(db, "businesses", currentBusinessId);
      await updateDoc(businessRef, { logoUrl: result.secure_url });

      if (logoPreview) {
        logoPreview.innerHTML = `<img src="${result.secure_url}" style="width:100%;height:100%;object-fit:cover;" alt="Store logo">`;
      }
      await logActivity("logo_update", { url: result.secure_url });
      if (logoUploadStatus) logoUploadStatus.textContent = "Logo updated ✓";
    } catch (err) {
      console.error("Logo upload failed:", err);
      if (logoUploadStatus) logoUploadStatus.textContent = "Upload failed. Try again.";
    } finally {
      logoUploadInput.value = "";
      setTimeout(() => { if (logoUploadStatus) logoUploadStatus.style.display = "none"; }, 3000);
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

  const q = query(collection(db, "businesses"), where("publicProfile.slug", "==", slug));
  const querySnap = await getDocs(q);

  if (!querySnap.empty) {
    const matchedDoc = querySnap.docs[0];
    if (matchedDoc.id !== myBusinessId) return false;
  }

  return true;
}

/* =========================
   SAVE SETTINGS
========================= */
[publicPhone, publicWhatsapp].forEach((el) => {
  el?.addEventListener("input", () => {
    if (el.value.trim()) el.classList.remove("ring-2", "ring-red-400", "border-red-400");
  });
});

if (saveBtn) {
  saveBtn.addEventListener("click", async () => {
    const cleanSlug = sanitizeSlug(profileSlug.value);
    const requestedEnabled = publicProfileToggle.checked;
    const showInventory = showInventoryToggle ? showInventoryToggle.checked : true;
    const showAvailability = showAvailabilityToggle ? showAvailabilityToggle.checked : true;

    // Owner-only guard: a partner cannot turn OFF an already-live store.
    if (isPartner && profileWasEnabled && !requestedEnabled) {
      alert("Only the business owner can take the store offline.");
      if (publicProfileToggle) publicProfileToggle.checked = true;
      return;
    }

    // Phone + WhatsApp validation.
    const phoneValue = (publicPhone?.value || "").trim();
    const whatsappValue = (publicWhatsapp?.value || "").trim();
    const missingContact = [];
    if (!phoneValue) missingContact.push(publicPhone);
    if (!whatsappValue) missingContact.push(publicWhatsapp);

    [publicPhone, publicWhatsapp].forEach((el) =>
      el?.closest("div")?.classList.remove("ring-2", "ring-red-400", "border-red-400")
    );

    if (missingContact.length) {
      missingContact.forEach((el) =>
        el?.closest("div")?.classList.add("ring-2", "ring-red-400", "border-red-400")
      );
      missingContact[0]?.focus();
      alert("Phone and WhatsApp numbers are both required so customers can reach you.");
      return;
    }

    if (requestedEnabled && !cleanSlug) {
      alert("Please enter a custom URL handle to enable your public store.");
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

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
        if (requestedEnabled) {
          await setDoc(newSlugRef, { businessId: currentBusinessId, updatedAt: new Date().toISOString() });
        } else {
          await deleteDoc(newSlugRef);
        }
      } else if (oldSlug) {
        await deleteDoc(doc(db, "publicSlugs", oldSlug));
      }

      const depositPolicy = {
        cautionFee: (depositCautionFee?.value || "").trim(),
        idRequirement: (depositIdRequirement?.value || "").trim(),
        notes: (depositNotes?.value || "").trim()
      };

      await updateDoc(businessRef, {
        publicProfile: {
          enabled: requestedEnabled,
          showInventory,
          showAvailability,
          slug: cleanSlug,
          bio: businessBio.value.trim(),
          phone: publicPhone.value.trim(),
          whatsapp: publicWhatsapp.value.trim(),
          instagram: (publicInstagram?.value || "").trim(),
          tiktok: (publicTiktok?.value || "").trim(),
          facebook: (publicFacebook?.value || "").trim(),
          depositPolicy,
          categories: currentCategories,
          address: publicAddress.value.trim(),
          latitude: publicLatitude && publicLatitude.value !== "" ? Number(publicLatitude.value) : null,
          longitude: publicLongitude && publicLongitude.value !== "" ? Number(publicLongitude.value) : null,
          gallery: currentGallery,
          updatedAt: new Date().toISOString()
        },
        categories: currentCategories,
        category: currentCategories[0] || "Equipment",
        "marketplace.visible": requestedEnabled
      });

      profileSlug.value = cleanSlug;
      profileWasEnabled = requestedEnabled;
      updateLiveLink(cleanSlug, requestedEnabled);
      await logActivity("settings_update", {
        enabled: requestedEnabled,
        slug: cleanSlug,
        actorRole: isOwner ? "owner" : "partner"
      });

      alert("Storefront settings updated successfully!");
      clearDirty();
      syncShareStoreButton();
    } catch (err) {
      console.error("Save storefront error:", err);
      alert("Failed to save: " + err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save changes";
      syncTogglePermission();
    }
  });
}

/* =========================
   FLOATING SAVE BUTTON
========================= */
if (saveBtnFloating && saveBtn) {
  saveBtnFloating.addEventListener("click", () => saveBtn.click());
}