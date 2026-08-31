import { db } from "./firebase.js";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const loader = document.getElementById("loader");
const errorView = document.getElementById("error-state") || document.getElementById("errorView");
const storefrontContent = document.getElementById("storefront") || document.getElementById("storefrontContent");

/* =========================
   PARSE SLUG FROM PATH / QUERY
========================= */
function getSlug() {
  const urlParams = new URLSearchParams(window.location.search);
  
  // 1. Check query parameter ?slug=my-store
  if (urlParams.has("slug")) {
    const querySlug = urlParams.get("slug").trim().toLowerCase();
    if (querySlug && querySlug !== "p.html" && querySlug !== "public-profile.html") {
      return querySlug;
    }
  }

  // 2. Check path pattern e.g., /p/my-store
  const path = window.location.pathname;
  if (path.includes("/p/")) {
    const rawSlug = path.split("/p/")[1];
    if (rawSlug) {
      const cleanSlug = decodeURIComponent(rawSlug.split("/")[0]).trim().toLowerCase();
      if (cleanSlug) return cleanSlug;
    }
  }

  // 3. Fallback for path segments (excluding system pages)
  const segments = path.split("/").filter(Boolean);
  if (segments.length > 0) {
    const lastSegment = decodeURIComponent(segments[segments.length - 1]).trim().toLowerCase();
    const systemPages = ["public.html", "public-profile.html", "index.html", "pwa.html", "add.html"];
    if (!systemPages.includes(lastSegment)) {
      return lastSegment;
    }
  }

  return null;
}

/* =========================
   INITIALIZE PUBLIC PROFILE
========================= */
export async function initViewer() {
  const slug = getSlug();

  if (!slug) {
    showError("Storefront Not Found", "No business handle was specified in the URL.");
    return;
  }

  try {
    let businessId = null;

    // Stage 1: Try resolving via publicSlugs collection
    const slugRef = doc(db, "publicSlugs", slug);
    const slugSnap = await getDoc(slugRef);

    if (slugSnap.exists()) {
      businessId = slugSnap.data().businessId;
    } else {
      // Stage 2: Direct query on businesses collection
      const q = query(
        collection(db, "businesses"),
        where("publicProfile.slug", "==", slug)
      );
      const querySnap = await getDocs(q);

      if (!querySnap.empty) {
        businessId = querySnap.docs[0].id;
      }
    }

    if (!businessId) {
      showError("Storefront Not Found", `The store handle "${slug}" is not registered.`);
      return;
    }

    // Load business details
    const businessRef = doc(db, "businesses", businessId);
    const businessSnap = await getDoc(businessRef);

    if (!businessSnap.exists()) {
      showError("Storefront Unavailable", "The business data associated with this store could not be found.");
      return;
    }

    const businessData = businessSnap.data();
    const profile = businessData.publicProfile || {};

    // Check if explicitly disabled (allow undefined/null to default to true)
    if (profile.enabled === false) {
      showError("Storefront Offline", "This storefront has been disabled by the business owner.");
      return;
    }

    // Render Profile Info & Inventory
    renderProfile(businessData.name || "Equipment Rentals", profile);
    await loadCatalog(businessId);

    // Show storefront content
    if (loader) loader.classList.add("hidden");
    if (storefrontContent) storefrontContent.classList.remove("hidden");

  } catch (err) {
    console.error("Storefront initialization error:", err);
    showError("Connection Error", "Failed to retrieve store details. Please check your network connection.");
  }
}

/* =========================
   RENDER PROFILE DATA
========================= */
function renderProfile(name, profile) {
  document.title = `${name} | Rental Catalog`;

  const nameEl = document.getElementById("store-name") || document.getElementById("displayBusinessName");
  if (nameEl) nameEl.textContent = name;

  const bioEl = document.getElementById("store-bio") || document.getElementById("displayBusinessBio");
  if (bioEl) {
    bioEl.textContent = profile.bio || "Welcome to our rental catalog. Browse available items and contact us directly to place a order.";
  }

  // Address
  const addrEl = document.getElementById("store-address") || document.getElementById("addressText");
  const addrContainer = document.getElementById("address-container") || document.getElementById("contactAddress");
  if (profile.address) {
    if (addrEl) addrEl.textContent = profile.address;
    if (addrContainer) addrContainer.classList.remove("hidden");
  } else if (addrContainer) {
    addrContainer.classList.add("hidden");
  }

  // Phone & WhatsApp Contact
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
  if (btnWa) {
    if (cleanPhone) {
      let waNumber = cleanPhone;
      if (waNumber.startsWith("0")) waNumber = "234" + waNumber.slice(1);
      const waMsg = encodeURIComponent(`Hello ${name}, I am viewing your online rental catalog and would like to inquire about renting equipment.`);
      btnWa.href = `https://wa.me/${waNumber}?text=${waMsg}`;
      btnWa.classList.remove("hidden");
    } else {
      btnWa.classList.add("hidden");
    }
  }

  // Gallery
  const gallerySection = document.getElementById("gallery-section") || document.getElementById("gallerySection");
  const galleryGrid = document.getElementById("gallery-grid") || document.getElementById("showcaseGallery");
  if (gallerySection && galleryGrid) {
    if (profile.gallery && profile.gallery.length > 0) {
      galleryGrid.innerHTML = profile.gallery.map(url => `
        <div class="h-36 bg-gray-100 rounded-xl overflow-hidden shadow-inner">
          <img src="${url}" alt="Store Showcase" class="w-full h-full object-cover" loading="lazy" />
        </div>
      `).join("");
      gallerySection.classList.remove("hidden");
    } else {
      gallerySection.classList.add("hidden");
    }
  }
}

/* =========================
   LOAD CATALOG INVENTORY
========================= */
async function loadCatalog(businessId) {
  const grid = document.getElementById("inventory-grid") || document.getElementById("catalogGrid");
  const countEl = document.getElementById("inventory-count");
  if (!grid) return;

  try {
    const invRef = collection(db, "businesses", businessId, "inventory");
    const snap = await getDocs(invRef);

    grid.innerHTML = "";

    if (snap.empty) {
      grid.innerHTML = `<p class="col-span-full text-center text-gray-500 py-8">No equipment listed in catalog yet.</p>`;
      if (countEl) countEl.textContent = "0 items";
      return;
    }

    let itemCount = 0;
    let itemsHtml = "";

    snap.forEach(docSnap => {
      itemCount++;
      const item = docSnap.data();
      const availableQty = Number(item.availableQuantity ?? item.quantity ?? 0);
      const totalQty = Number(item.totalQuantity ?? item.quantity ?? availableQty);
      const isAvailable = availableQty > 0;

      itemsHtml += `
        <div class="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between">
          <div>
            <div class="flex justify-between items-start mb-2">
              <h3 class="font-semibold text-gray-900 text-lg">${item.name || "Unnamed Equipment"}</h3>
              <span class="text-xs px-2.5 py-1 rounded-full font-medium ${isAvailable ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}">
                ${isAvailable ? `${availableQty} available` : 'Booked Out'}
              </span>
            </div>
            <p class="text-gray-500 text-xs mb-4">Total Stock: ${totalQty}</p>
          </div>

          <div class="flex items-center justify-between pt-4 border-t border-gray-50">
            <div>
              <span class="text-lg font-bold text-gray-900">₦${(Number(item.price) || 0).toLocaleString()}</span>
              <span class="text-xs text-gray-400"> / day</span>
            </div>
          </div>
        </div>
      `;
    });

    grid.innerHTML = itemsHtml;
    if (countEl) countEl.textContent = `${itemCount} item${itemCount === 1 ? '' : 's'}`;

  } catch (err) {
    console.error("Error loading catalog:", err);
    grid.innerHTML = `<p class="col-span-full text-center text-red-500 py-6">Failed to load equipment catalog.</p>`;
  }
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
}

// Auto-run on script execution
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initViewer);
} else {
  initViewer();
}