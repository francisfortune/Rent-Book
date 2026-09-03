import { db } from "./firebase.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  onSnapshot,
  updateDoc,
  addDoc,
  collection,
  serverTimestamp,
  arrayUnion,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── CLOUDINARY ────────────────────────────────────────────────────
// Unsigned upload preset: fine to expose in client code (that's what
// it's for), but it does mean anyone who has this preset name can
// upload to your Cloudinary account. Two things worth doing in the
// Cloudinary dashboard: cap the preset's max file size, and restrict
// it to an "upload folder" scoped to this app. See SETUP-README.md
// for the tighter, signed-upload alternative via a Cloud Function.
const CLOUDINARY_CLOUD_NAME = "YOUR_CLOUD_NAME";
const CLOUDINARY_UPLOAD_PRESET = "tracknrent_gallery_unsigned";

const loader = document.getElementById("loader");
const errorView = document.getElementById("error-state") || document.getElementById("errorView");
const storefrontContent = document.getElementById("storefront") || document.getElementById("storefrontContent");

// Shared across renderProfile() and loadCatalog() so per-item "Inquire" links
// can reuse the same normalized WhatsApp number and business name.
let waNumberGlobal = "";
let businessNameGlobal = "";
let currentBusinessId = null;
let showAvailabilityGlobal = true;
let cachedInventoryDocs = [];
let unsubscribeInventory = null;
let isStaffMember = false;
let staffUser = null;

function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
}

/* =========================
   PARSE SLUG FROM PATH / QUERY
========================= */
function getSlug() {
  const urlParams = new URLSearchParams(window.location.search);

  if (urlParams.has("slug")) {
    const querySlug = urlParams.get("slug").trim().toLowerCase();
    if (querySlug && querySlug !== "p.html" && querySlug !== "public-profile.html") {
      return querySlug;
    }
  }

  const path = window.location.pathname;
  if (path.includes("/p/")) {
    const rawSlug = path.split("/p/")[1];
    if (rawSlug) {
      const cleanSlug = decodeURIComponent(rawSlug.split("/")[0]).trim().toLowerCase();
      if (cleanSlug) return cleanSlug;
    }
  }

  const segments = path.split("/").filter(Boolean);
  if (segments.length > 0) {
    const lastSegment = decodeURIComponent(segments[segments.length - 1]).trim().toLowerCase();
    const systemPages = ["public.html", "public-profile.html", "profile.html", "index.html", "pwa.html", "add.html"];
    if (!systemPages.includes(lastSegment)) {
      return lastSegment;
    }
  }

  return null;
}

/* =========================
   RESOLVE SLUG → businessId (one-time; this mapping rarely changes)
========================= */
async function resolveBusinessId(slug) {
  const slugRef = doc(db, "publicSlugs", slug);
  const slugSnap = await getDoc(slugRef);
  if (slugSnap.exists()) return slugSnap.data().businessId;

  const q = query(collection(db, "businesses"), where("publicProfile.slug", "==", slug));
  const querySnap = await getDocs(q);
  return querySnap.empty ? null : querySnap.docs[0].id;
}

/* =========================
   INITIALIZE PUBLIC PROFILE
   Everything from here on is LIVE: a business doc listener means any
   change the owner makes (toggles, bio, gallery deletions, map pin,
   SEO indexing) appears on an already-open storefront with no reload.
========================= */
export async function initViewer() {
  const slug = getSlug();

  if (!slug) {
    showError("Storefront Not Found", "No business handle was specified in the URL.");
    return;
  }

  let firstLoad = true;

  try {
    const businessId = await resolveBusinessId(slug);

    if (!businessId) {
      showError("Storefront Not Found", `The store handle "${slug}" is not registered.`);
      return;
    }

    currentBusinessId = businessId;
    const businessRef = doc(db, "businesses", businessId);
    wireStaffGallery(businessId);

    onSnapshot(
      businessRef,
      (businessSnap) => {
        if (!businessSnap.exists()) {
          showError("Storefront Unavailable", "The business data associated with this store could not be found.");
          return;
        }

        const businessData = businessSnap.data();
        const profile = businessData.publicProfile || {};

        applySeoMeta(businessData);

        if (profile.enabled === false) {
          if (unsubscribeInventory) { unsubscribeInventory(); unsubscribeInventory = null; }
          showError("Storefront Offline", "This storefront has been disabled by the business owner.");
          return;
        }

        renderProfile(businessData.name || "Equipment Rentals", profile, businessData.rating);
        renderMap(profile);

        const inventorySection = document.getElementById("inventory-section");
        if (profile.showInventory === false) {
          if (inventorySection) inventorySection.classList.add("hidden");
          if (unsubscribeInventory) { unsubscribeInventory(); unsubscribeInventory = null; }
        } else {
          if (inventorySection) inventorySection.classList.remove("hidden");
          showAvailabilityGlobal = profile.showAvailability !== false; // default true
          if (!unsubscribeInventory) {
            unsubscribeInventory = watchCatalog(businessId);
          } else {
            renderCatalogFromCache(); // toggle flipped — re-render instantly, no need to wait for new stock data
          }
        }

        if (firstLoad) {
          if (loader) loader.classList.add("hidden");
          if (storefrontContent) {
            storefrontContent.classList.remove("hidden");
            // one clean fade-in on first paint, not on every subsequent live update
            requestAnimationFrame(() => storefrontContent.classList.remove("opacity-0"));
          }
          firstLoad = false;
        }
        refreshIcons();
      },
      (err) => {
        console.error("Storefront listener error:", err);
        showError("Connection Error", "Failed to retrieve store details. Please check your network connection.");
      }
    );

  } catch (err) {
    console.error("Storefront initialization error:", err);
    showError("Connection Error", "Failed to retrieve store details. Please check your network connection.");
  }
}

/* =========================
   SEO META (client-side best-effort)
   Note: this only helps crawlers that execute JS. The reliable fix
   for indexing is the sitemap Cloud Function in SETUP-README.md —
   this tag is a cheap extra signal, not the whole solution.
========================= */
function applySeoMeta(businessData) {
  const indexed = businessData.seo?.googleIndexed === true;
  let metaTag = document.querySelector('meta[name="robots"]');
  if (!metaTag) {
    metaTag = document.createElement("meta");
    metaTag.setAttribute("name", "robots");
    document.head.appendChild(metaTag);
  }
  metaTag.setAttribute("content", indexed ? "index,follow" : "noindex,nofollow");
}

/* =========================
   RENDER PROFILE DATA
========================= */
function renderProfile(name, profile, rating) {
  document.title = `${name} | Rental Catalog`;

  const nameEl = document.getElementById("store-name") || document.getElementById("displayBusinessName");
  if (nameEl) nameEl.textContent = name;

  const ratingEl = document.getElementById("store-rating");
  if (ratingEl) {
    const numericRating = Number(rating || 0);
    if (numericRating > 0) {
      const stars = "★".repeat(Math.round(numericRating)) + "☆".repeat(5 - Math.round(numericRating));
      ratingEl.innerHTML = `<span class="text-amber-400">${stars}</span> <span class="text-purple-200/80">${numericRating.toFixed(1)}</span>`;
      ratingEl.classList.remove("hidden");
    } else {
      ratingEl.classList.add("hidden");
    }
  }

  const bioEl = document.getElementById("store-bio") || document.getElementById("displayBusinessBio");
  if (bioEl) {
    bioEl.textContent = profile.bio || "Welcome to our rental catalog. Browse available items and contact us directly to place a order.";
  }

  const addrEl = document.getElementById("store-address") || document.getElementById("addressText");
  const addrContainer = document.getElementById("address-container") || document.getElementById("contactAddress");
  if (profile.address) {
    if (addrEl) addrEl.textContent = profile.address;
    if (addrContainer) addrContainer.classList.remove("hidden");
  } else if (addrContainer) {
    addrContainer.classList.add("hidden");
  }

  const rawPhone = profile.phone || profile.whatsapp || "";
  const cleanPhone = rawPhone.replace(/\D/g, "");

  const btnPhone = document.getElementById("btn-phone") || document.getElementById("contactPhone");
  if (btnPhone) {
    if (cleanPhone) {
      btnPhone.href = `tel:${cleanPhone}`;
      btnPhone.classList.remove("hidden");
    } else {
      btnPhone.classList.add("hidden");
    }
  }

  const btnWa = document.getElementById("btn-whatsapp") || document.getElementById("contactWhatsapp");
  const btnWaSticky = document.getElementById("sticky-btn-whatsapp");
  if (cleanPhone) {
    let waNumber = cleanPhone;
    if (waNumber.startsWith("0")) waNumber = "234" + waNumber.slice(1);
    waNumberGlobal = waNumber;
    businessNameGlobal = name;
    const waMsg = encodeURIComponent(`Hello ${name}, I am viewing your online rental catalog and would like to inquire about renting equipment.`);
    const waHref = `https://wa.me/${waNumber}?text=${waMsg}`;
    if (btnWa) { btnWa.href = waHref; btnWa.classList.remove("hidden"); }
    if (btnWaSticky) { btnWaSticky.href = waHref; }
  } else {
    waNumberGlobal = "";
    if (btnWa) btnWa.classList.add("hidden");
  }

  const stickyBar = document.getElementById("sticky-mobile-bar");
  if (stickyBar) stickyBar.classList.toggle("hidden", !cleanPhone);

  renderGallery(profile.gallery, businessNameGlobal || name);
}

/* =========================
   LIVE GOOGLE MAP
   Uses the no-API-key embed endpoint. Prefers exact coordinates;
   falls back to a text search on the address string.
========================= */
function renderMap(profile) {
  const mapSection = document.getElementById("map-section");
  const mapFrame = document.getElementById("store-map");
  if (!mapSection || !mapFrame) return;

  let src = null;
  if (typeof profile.latitude === "number" && typeof profile.longitude === "number") {
    src = `https://maps.google.com/maps?q=${profile.latitude},${profile.longitude}&z=15&output=embed`;
  } else if (profile.address) {
    src = `https://maps.google.com/maps?q=${encodeURIComponent(profile.address)}&z=14&output=embed`;
  }

  if (src) {
    mapFrame.src = src;
    mapSection.classList.remove("hidden");
  } else {
    mapSection.classList.add("hidden");
  }
}

/* =========================
   GALLERY (images + videos)
========================= */
function normalizeGallery(gallery) {
  if (!Array.isArray(gallery)) return [];
  return gallery.map((entry, i) => {
    if (typeof entry === "string") return { id: `legacy_${i}`, url: entry, type: "image", addedBy: "owner" };
    return { type: "image", ...entry }; // default legacy objects without a type to image
  });
}

function galleryTileMarkup(item, businessName) {
  if (item.type === "video") {
    return `
      <div class="h-36 bg-black rounded-xl overflow-hidden shadow-inner relative">
        <video src="${item.url}" class="w-full h-full object-cover" muted loop playsinline
          onmouseover="this.play()" onmouseout="this.pause()"></video>
        <span class="absolute bottom-1.5 right-1.5 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
          <i data-lucide="play" class="w-3 h-3 inline"></i>
        </span>
      </div>`;
  }
  return `
    <div class="h-36 bg-gray-100 rounded-xl overflow-hidden shadow-inner">
      <img src="${item.url}" alt="${businessName} showcase" class="w-full h-full object-cover" loading="lazy" />
    </div>`;
}

function renderGallery(rawGallery, businessName) {
  const gallerySection = document.getElementById("gallery-section") || document.getElementById("gallerySection");
  const galleryGrid = document.getElementById("gallery-grid") || document.getElementById("showcaseGallery");
  if (!gallerySection || !galleryGrid) return;

  const gallery = normalizeGallery(rawGallery);

  galleryGrid.innerHTML = gallery.length > 0
    ? gallery.map(item => galleryTileMarkup(item, businessName)).join("")
    : `<p class="col-span-full text-center text-sm text-slate-400 py-6">No photos or videos yet.</p>`;

  // Gallery section stays visible (even when empty) so the staff
  // upload widget below it is always reachable.
  gallerySection.classList.remove("hidden");
  refreshIcons();
}

/* =========================
   STAFF-GATED GALLERY UPLOAD
   Anyone on the business's own team (a row in businessMembers) can
   sign in right here and add photos/videos. The general public
   cannot — only a quick login unlocks the uploader. Only the OWNER
   can still change store settings or take the storefront offline
   (that happens in storefront-settings.html, not here).
========================= */
function wireStaffGallery(businessId) {
  const loginToggle = document.getElementById("staff-login-toggle");
  const loginPanel = document.getElementById("staff-login-panel");
  const emailInput = document.getElementById("staff-email");
  const passwordInput = document.getElementById("staff-password");
  const loginSubmitBtn = document.getElementById("staff-login-submit");
  const loginStatus = document.getElementById("staff-login-status");
  const uploadPanel = document.getElementById("staff-upload-panel");
  const fileInput = document.getElementById("gallery-upload-input");
  const uploadBtn = document.getElementById("btn-add-photo");
  const uploadStatus = document.getElementById("gallery-upload-status");
  const logoutBtn = document.getElementById("staff-logout-btn");
  const staffNameLabel = document.getElementById("staff-name-label");

  if (!loginToggle || loginToggle.dataset.wired) return;
  loginToggle.dataset.wired = "true";

  loginToggle.addEventListener("click", () => {
    loginPanel.classList.toggle("hidden");
  });

  const auth = getAuth();

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      isStaffMember = false;
      staffUser = null;
      if (uploadPanel) uploadPanel.classList.add("hidden");
      if (loginToggle) loginToggle.classList.remove("hidden");
      return;
    }

    try {
      const q = query(collection(db, "businessMembers"), where("uid", "==", user.uid));
      const snap = await getDocs(q);
      const isMember = snap.docs.some(d => d.data().businessId === businessId);

      if (!isMember) {
        if (loginStatus) loginStatus.textContent = "This account isn't part of this business's team.";
        await signOut(auth);
        return;
      }

      isStaffMember = true;
      staffUser = user;
      if (loginPanel) loginPanel.classList.add("hidden");
      if (loginToggle) loginToggle.classList.add("hidden");
      if (uploadPanel) uploadPanel.classList.remove("hidden");
      if (staffNameLabel) staffNameLabel.textContent = user.email;
    } catch (err) {
      console.error("Membership check failed:", err);
      if (loginStatus) loginStatus.textContent = "Couldn't verify your account. Please try again.";
    }
  });

  if (loginSubmitBtn) {
    loginSubmitBtn.addEventListener("click", async () => {
      if (!emailInput.value || !passwordInput.value) {
        if (loginStatus) loginStatus.textContent = "Enter your email and password.";
        return;
      }
      loginSubmitBtn.disabled = true;
      loginSubmitBtn.textContent = "Signing in...";
      if (loginStatus) loginStatus.textContent = "";
      try {
        await signInWithEmailAndPassword(auth, emailInput.value.trim(), passwordInput.value);
        // onAuthStateChanged above handles the rest
      } catch (err) {
        console.error("Staff sign-in failed:", err);
        if (loginStatus) loginStatus.textContent = "Sign-in failed. Check your email and password.";
      } finally {
        loginSubmitBtn.disabled = false;
        loginSubmitBtn.textContent = "Sign In";
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => signOut(auth));
  }

  if (uploadBtn && fileInput && !uploadBtn.dataset.wired) {
    uploadBtn.dataset.wired = "true";
    uploadBtn.addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file || !isStaffMember || !staffUser) return;

      uploadBtn.disabled = true;
      if (uploadStatus) uploadStatus.textContent = "Uploading...";

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
          resourceType: result.resource_type, // "image" | "video"
          type: result.resource_type === "video" ? "video" : "image",
          addedBy: staffUser.uid,
          addedByEmail: staffUser.email,
          addedAt: new Date().toISOString()
        };

        const businessRef = doc(db, "businesses", currentBusinessId);
        await updateDoc(businessRef, {
          "publicProfile.gallery": arrayUnion(newEntry)
        });

        // Queue a push notification for the owner. See SETUP-README.md
        // for why this has to be picked up by a Cloud Function rather
        // than calling OneSignal directly from here.
        await addDoc(collection(db, "businesses", currentBusinessId, "notificationQueue"), {
          type: "gallery_upload",
          mediaType: newEntry.type,
          imageUrl: newEntry.url,
          addedByEmail: staffUser.email,
          createdAt: serverTimestamp(),
          processed: false
        });

        if (uploadStatus) uploadStatus.textContent = "Added — thank you!";
      } catch (err) {
        console.error("Gallery upload failed:", err);
        if (uploadStatus) uploadStatus.textContent = "Upload failed. Please try again.";
      } finally {
        uploadBtn.disabled = false;
        fileInput.value = "";
        setTimeout(() => { if (uploadStatus) uploadStatus.textContent = ""; }, 4000);
      }
    });
  }
}

/* =========================
   LIVE CATALOG INVENTORY
   watchCatalog() opens the listener and caches raw docs.
   renderCatalogFromCache() does the actual drawing, and is also
   called directly when the availability toggle flips, so the UI
   updates instantly instead of waiting for stock to change.
========================= */
function watchCatalog(businessId) {
  const invRef = collection(db, "businesses", businessId, "inventory");
  return onSnapshot(
    invRef,
    (snap) => {
      cachedInventoryDocs = snap.docs.map(d => d.data());
      renderCatalogFromCache();
    },
    (err) => {
      console.error("Error loading catalog:", err);
      const grid = document.getElementById("inventory-grid") || document.getElementById("catalogGrid");
      if (grid) grid.innerHTML = `<p class="col-span-full text-center text-red-500 py-6">Failed to load equipment catalog.</p>`;
    }
  );
}

function renderCatalogFromCache() {
  const grid = document.getElementById("inventory-grid") || document.getElementById("catalogGrid");
  const countEl = document.getElementById("inventory-count");
  if (!grid) return;

  if (cachedInventoryDocs.length === 0) {
    grid.innerHTML = `<p class="col-span-full text-center text-gray-500 py-8">No equipment listed in catalog yet.</p>`;
    if (countEl) countEl.textContent = "0 items";
    return;
  }

  let itemsHtml = "";

  cachedInventoryDocs.forEach(item => {
    const availableQty = Number(item.availableQuantity ?? item.quantity ?? 0);
    const totalQty = Number(item.totalQuantity ?? item.quantity ?? availableQty);
    const isAvailable = availableQty > 0;

    const availabilityBadge = showAvailabilityGlobal
      ? `<span class="text-xs px-2.5 py-1 rounded-full font-medium ${isAvailable ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}">
           ${isAvailable ? `${availableQty} available` : 'Booked Out'}
         </span>`
      : "";
    const stockLine = showAvailabilityGlobal
      ? `<p class="text-gray-500 text-xs mb-4">Total Stock: ${totalQty}</p>`
      : "";

    itemsHtml += `
      <div class="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between hover:shadow-md hover:-translate-y-0.5 transition">
        <div>
          <div class="flex justify-between items-start mb-2">
            <h3 class="font-semibold text-gray-900 text-lg">${item.name || "Unnamed Equipment"}</h3>
            ${availabilityBadge}
          </div>
          ${stockLine}
        </div>

        <div class="flex items-center justify-between pt-4 border-t border-gray-50">
          <div>
            <span class="text-lg font-bold text-gray-900">₦${(Number(item.price) || 0).toLocaleString()}</span>
            <span class="text-xs text-gray-400"> / day</span>
          </div>
          ${waNumberGlobal ? `
            <a href="https://wa.me/${waNumberGlobal}?text=${encodeURIComponent(`Hi ${businessNameGlobal}, I'm interested in renting the ${item.name || "item"}`)}"
               target="_blank" rel="noopener noreferrer"
               class="text-xs font-semibold bg-gray-900 text-white px-3.5 py-2 rounded-lg hover:bg-gray-800 transition">
              Inquire
            </a>
          ` : ''}
        </div>
      </div>
    `;
  });

  grid.innerHTML = itemsHtml;
  if (countEl) countEl.textContent = `${cachedInventoryDocs.length} item${cachedInventoryDocs.length === 1 ? '' : 's'}`;
}

/* =========================
   ERROR DISPLAY CONTROLLER
========================= */
function showError(title, message) {
  if (loader) loader.classList.add("hidden");
  if (storefrontContent) storefrontContent.classList.add("hidden");

  if (errorView) {
    errorView.classList.remove("hidden");
    const titleEl = document.getElementById("errorTitle") || errorView.querySelector("h2");
    const msgEl = document.getElementById("errorMessage") || errorView.querySelector("p");
    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
  }
  refreshIcons();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initViewer);
} else {
  initViewer();
}
