// assets/js/public-profile.js
//
// Internal, authenticated dashboard controller for public.html.
//
// PERMISSION MODEL
//   Owner        -> full CRUD: settings, slug, contact info, the Go Online
//                   toggle, logo, and can delete any gallery media.
//   Team member  -> read-only on all settings/toggle/slug, but CAN add new
//                   gallery photos/videos. Cannot delete anything.
// The UI below enforces this by disabling inputs for team members, but the
// authoritative check is the Firestore Security Rules (see
// firestore.rules) — never trust the client alone.
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

// Quick-add suggestions for the Services & Categories tag editor. Kept in
// sync (loosely) with the marketplace's top-level CATEGORIES list, plus a
// few finer-grained service tags vendors commonly want.
const CATEGORY_SUGGESTIONS = [
  "Equipment", "Vehicles", "Event Rentals", "Photography", "Furniture",
  "Sound & Lighting", "Decor", "Catering", "Bounce Castles", "Tents & Canopies",
  "Chairs & Tables", "Generators", "Power Tools", "Party Supplies"
];
const MAX_CATEGORIES = 12;

let currentBusinessId = null;
let currentGallery = []; // array of { id, url, type, publicId, resourceType, addedBy, addedAt }
let currentCategories = []; // array of strings, e.g. ["Equipment", "Tents & Canopies"]
let currentUid = null;
let isOwner = false;
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
const liveProfileLink = document.getElementById("liveProfileLink");
const teamMemberNotice = document.getElementById("teamMemberNotice");

// Inputs only the OWNER may change. Locked (disabled, not hidden — so team
// members can still see current settings) for team members.
const OWNER_ONLY_FIELDS = [
  publicProfileToggle,
  profileSlug,
  businessBio,
  publicPhone,
  publicWhatsapp,
  publicInstagram,
  publicTiktok,
  publicFacebook,
  depositCautionFee,
  depositIdRequirement,
  depositNotes,
  publicAddress,
  showInventoryToggle,
  showAvailabilityToggle,
  logoUploadInput,
  coverUploadInput,
  removeCoverBtn,
  categoryInput,
  categoryAddBtn,
  btnUseMyLocation
];

/* =========================
   SLUG SANITIZER
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

  currentUid = user.uid;

  try {
    const membership = await getBusinessMembership(user.uid);
    currentBusinessId = membership.businessId;
    isOwner = membership.role === "owner";

    applyRoleToUI();
    await loadSettings();
  } catch (err) {
    console.error("Failed to load storefront settings:", err);
    alert("Error loading business info.");
  }
});

// Resolves { businessId, role } for the signed-in user. A business's
// `ownerId` field is the source of truth for who the owner is; the
// businessMembers collection lists everyone (owner included) who has
// access, with a `role` of "owner" or "member".
async function getBusinessMembership(uid) {
  const cacheKey = `businessMembership_${uid}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      /* fall through to a fresh lookup */
    }
  }

  const q = query(collection(db, "businessMembers"), where("uid", "==", uid));
  const snap = await getDocs(q);
  if (snap.empty) throw new Error("NO_BUSINESS");

  const memberDoc = snap.docs[0].data();
  const businessId = memberDoc.businessId;

  // Cross-check against the business doc's ownerId, since that's the
  // field Security Rules trust — a stale/incorrect `role` on the member
  // doc should never grant owner-level UI.
  const businessSnap = await getDoc(doc(db, "businesses", businessId));
  const ownerId = businessSnap.exists() ? businessSnap.data().ownerId : null;
  const role = ownerId === uid ? "owner" : (memberDoc.role === "owner" ? "owner" : "member");

  const result = { businessId, role };
  localStorage.setItem(cacheKey, JSON.stringify(result));
  return result;
}

/* =========================
   LOCK DOWN THE UI FOR TEAM MEMBERS
========================= */
function applyRoleToUI() {
  if (isOwner) {
    if (teamMemberNotice) teamMemberNotice.style.display = "none";
    OWNER_ONLY_FIELDS.forEach((el) => { if (el) el.disabled = false; });
    if (saveBtn) { saveBtn.style.display = ""; saveBtn.disabled = false; }
    return;
  }

  // Team member: show the notice, disable every owner-only field.
  if (teamMemberNotice) teamMemberNotice.style.display = "flex";
  OWNER_ONLY_FIELDS.forEach((el) => { if (el) el.disabled = true; });
  // The save button only ever writes owner-only fields, so hide it —
  // team members' only write path is the gallery upload input below.
  if (saveBtn) saveBtn.style.display = "none";
}

/* =========================
   LOAD SETTINGS (initial paint + live sync)
   onSnapshot keeps this dashboard in sync if the owner edits settings
   from another device/tab, or a teammate adds a gallery item.
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

  if (publicProfileToggle) publicProfileToggle.checked = profile.enabled || false;
  if (showInventoryToggle) showInventoryToggle.checked = profile.showInventory !== false; // default true
  if (showAvailabilityToggle) showAvailabilityToggle.checked = profile.showAvailability !== false; // default true
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

  // Categories can live on either publicProfile.categories (new) or the
  // top-level `categories`/`category` fields (older/simpler records) —
  // read whichever is present so nothing regresses for existing vendors.
  currentCategories = normalizeCategories(
    profile.categories || data.categories || (data.category ? [data.category] : [])
  );
  renderCategoryTags();
  renderCategorySuggestions();

  currentGallery = normalizeGallery(profile.gallery);

  updateLiveLink(profile.slug, profile.enabled);
  renderGallery();
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

// Older records stored gallery as a plain array of URL strings.
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
  const parentCard = liveProfileLink.closest(".profile-card") || document.getElementById("liveStatusBanner");
  if (enabled && slug) {
    const url = `${window.location.origin}/p/${slug}`;
    liveProfileLink.href = url;
    liveProfileLink.textContent = `View Store `;
    if (parentCard) parentCard.style.display = "";
  } else if (parentCard) {
    parentCard.style.display = "none";
  }
}

/* =========================
   COVER / BANNER IMAGE (Owner only)
========================= */
function applyCoverToPreview(url) {
  if (!coverImagePreview) return;
  if (url) {
    coverImagePreview.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;" alt="Store cover image">`;
    if (removeCoverBtn && isOwner) removeCoverBtn.classList.remove("hidden");
  } else {
    coverImagePreview.innerHTML = `<span class="w-full h-full flex items-center justify-center text-white/70 text-xs font-medium">No banner uploaded yet</span>`;
    if (removeCoverBtn) removeCoverBtn.classList.add("hidden");
  }
}

if (coverUploadInput) {
  coverUploadInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file || !currentBusinessId || !isOwner) return;

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
    if (!isOwner || !currentBusinessId) return;
    if (!confirm("Remove your storefront's cover image?")) return;
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
   SERVICES & CATEGORIES TAG EDITOR (Owner only)
   A real add/remove tag editor — not decorative. Tags live in-memory in
   `currentCategories` as the user edits, and are persisted to Firestore
   (publicProfile.categories) when "Save" is pressed, same as every other
   field on this page.
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
        ${isOwner ? `<button type="button" data-tag="${escapeHtmlLocal(tag)}" class="remove-category-tag hover:text-red-600 transition-colors" aria-label="Remove ${escapeHtmlLocal(tag)}">
          <i class="fas fa-times text-[10px]"></i>
        </button>` : ""}
      </span>`)
    .join("");

  if (isOwner) {
    categoryTagsList.querySelectorAll(".remove-category-tag").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentCategories = currentCategories.filter((t) => t !== btn.dataset.tag);
        renderCategoryTags();
        renderCategorySuggestions();
      });
    });
  }
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
    btn.addEventListener("click", () => {
      if (!isOwner) return;
      addCategoryTag(btn.dataset.suggestion);
    });
  });
}

function addCategoryTag(rawValue) {
  if (!isOwner) return;
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
   USE MY CURRENT LOCATION (Owner only)
   Captured straight from the device via navigator.geolocation — there is
   no visible/editable coordinate field, so no one can type in a fake or
   miscalculated latitude/longitude. The values only ever get here through
   this button.
========================= */
function updatePinStatus(lat, lng) {
  if (!pinStatus) return;
  pinStatus.textContent = (lat != null && lng != null && lat !== "" && lng !== "")
    ? `Pinned: ${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`
    : "No coordinates saved yet — this is captured from your device, not typed in, so it can't be entered wrong.";
}

if (btnUseMyLocation) {
  btnUseMyLocation.addEventListener("click", () => {
    if (!isOwner) return;
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
        btnUseMyLocation.textContent = "Use My Current Location";
      },
      (err) => {
        console.error("Geolocation error:", err);
        alert("Couldn't get your location. Make sure location access is allowed for this site.");
        btnUseMyLocation.disabled = false;
        btnUseMyLocation.textContent = "Use My Current Location";
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
   Delete buttons are only rendered (and only work) for the owner.
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
      ? `<span class="absolute top-2 left-2 bg-purple-900/80 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full">Team upload</span>`
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
  if (!isOwner) return; // UI-level guard; Security Rules are the real gate
  if (!confirm("Are you sure you want to delete this item?")) return;

  const item = currentGallery.find((g) => g.id === itemId);
  if (!item) return;

  try {
    if (item.publicId) {
      // Cloudinary asset — destroyed server-side (needs the API secret).
      // This Cloud Function verifies you're the owner before deleting.
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
   GALLERY UPLOAD (Owner AND Team Members)
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
   LOGO / PROFILE PICTURE UPLOAD (Owner only)
========================= */
if (logoUploadInput) {
  logoUploadInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file || !currentBusinessId || !isOwner) return;

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
   SAVE SETTINGS (Owner only)
   The save button is hidden entirely for team members (see
   applyRoleToUI), and Firestore Security Rules re-enforce this
   server-side, so this handler only ever runs for the owner.
========================= */
[publicPhone, publicWhatsapp].forEach((el) => {
  el?.addEventListener("input", () => {
    if (el.value.trim()) el.classList.remove("ring-2", "ring-red-400", "border-red-400");
  });
});

if (saveBtn) {
  saveBtn.addEventListener("click", async () => {
    if (!isOwner) return;

    const cleanSlug = sanitizeSlug(profileSlug.value);
    const enabled = publicProfileToggle.checked;
    const showInventory = showInventoryToggle ? showInventoryToggle.checked : true;
    const showAvailability = showAvailabilityToggle ? showAvailabilityToggle.checked : true;

    // Phone and WhatsApp are marked `required` in the HTML, but that
    // attribute only does anything on a native <form> submit — this is a
    // plain button click, so it was never actually being enforced.
    // Validate both explicitly here instead.
    const phoneValue = (publicPhone?.value || "").trim();
    const whatsappValue = (publicWhatsapp?.value || "").trim();
    const missingContact = [];
    if (!phoneValue) missingContact.push(publicPhone);
    if (!whatsappValue) missingContact.push(publicWhatsapp);

    [publicPhone, publicWhatsapp].forEach((el) => el?.closest("div")?.classList.remove("ring-2", "ring-red-400", "border-red-400"));

    if (missingContact.length) {
      missingContact.forEach((el) => el?.closest("div")?.classList.add("ring-2", "ring-red-400", "border-red-400"));
      missingContact[0]?.focus();
      alert("Phone and WhatsApp numbers are both required so customers can reach you.");
      return;
    }

    if (enabled && !cleanSlug) {
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
        if (enabled) {
          await setDoc(newSlugRef, { businessId: currentBusinessId, updatedAt: new Date().toISOString() });
        } else {
          await deleteDoc(newSlugRef);
        }
      } else if (oldSlug) {
        await deleteDoc(doc(db, "publicSlugs", oldSlug));
      }

      // Optional — leave blank if not applicable. Only stored when at
      // least one field has content, so the banner on the storefront
      // stays hidden for vendors who don't use a deposit policy.
      const depositPolicy = {
        cautionFee: (depositCautionFee?.value || "").trim(),
        idRequirement: (depositIdRequirement?.value || "").trim(),
        notes: (depositNotes?.value || "").trim()
      };

      await updateDoc(businessRef, {
        publicProfile: {
          enabled,
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
        // Keep the legacy top-level `category` field (singular) in sync
        // with the first tag, so marketplace cards/filters that only know
        // about a single category continue to work for existing vendors.
        categories: currentCategories,
        category: currentCategories[0] || "Equipment",
        // The "Go Online" toggle controls both the storefront AND the
        // marketplace listing at once — one switch, not two.
        "marketplace.visible": enabled
      });

      profileSlug.value = cleanSlug;
      updateLiveLink(cleanSlug, enabled);
      await logActivity("settings_update", { enabled, slug: cleanSlug });
      alert("Storefront settings updated successfully!");
    } catch (err) {
      console.error("Save storefront error:", err);
      alert("Failed to save: " + err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Store Link & Settings";
    }
  });
}