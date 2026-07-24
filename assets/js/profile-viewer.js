// assets/js/profile-viewer.js
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
const errorView = document.getElementById("errorView");
const storefrontContent = document.getElementById("storefrontContent");

const displayBusinessName = document.getElementById("displayBusinessName");
const displayBusinessBio = document.getElementById("displayBusinessBio");
const contactPhone = document.getElementById("contactPhone");
const phoneText = document.getElementById("phoneText");
const contactWhatsapp = document.getElementById("contactWhatsapp");
const contactAddress = document.getElementById("contactAddress");
const addressText = document.getElementById("addressText");
const gallerySection = document.getElementById("gallerySection");
const showcaseGallery = document.getElementById("showcaseGallery");
const catalogGrid = document.getElementById("catalogGrid");
const metaDescription = document.getElementById("metaDescription");

/* =========================
   PARSE SLUG FROM PATH / QUERY
========================= */
function getSlug() {
  const path = window.location.pathname; // e.g., "/p/my-slug"
  
  if (path.includes("/p/")) {
    const rawSlug = path.split("/p/")[1];
    if (rawSlug) {
      // Strip trailing slashes or path segments
      const cleanSlug = rawSlug.split("/")[0];
      return decodeURIComponent(cleanSlug).trim().toLowerCase();
    }
  }

  // Fallback to query parameter ?slug=my-slug
  const params = new URLSearchParams(window.location.search);
  const querySlug = params.get("slug");
  return querySlug ? querySlug.trim().toLowerCase() : null;
}

/* =========================
   INITIALIZE PUBLIC PROFILE
========================= */
async function initViewer() {
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
      // Stage 2: Fallback query directly on businesses collection
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

    // Verify if profile is enabled by business owner
    if (!profile.enabled) {
      showError("Storefront Offline", "This storefront has been disabled by the business owner.");
      return;
    }

    // Render Profile Info
    renderProfile(businessData.name || "Equipment Rentals", profile);

    // Load Inventory Catalog
    await loadCatalog(businessId);

    // Show content
    if (loader) loader.style.display = "none";
    if (storefrontContent) storefrontContent.style.display = "block";

  } catch (err) {
    console.error("Storefront initialization error:", err);
    showError("Connection Error", "Failed to retrieve store details. Please check your internet connection.");
  }
}

/* =========================
   RENDER PROFILE INFO
========================= */
function renderProfile(name, profile) {
  document.title = `${name} | Rental Catalog`;
  if (displayBusinessName) displayBusinessName.textContent = name;
  
  if (displayBusinessBio) {
    displayBusinessBio.textContent = profile.bio || "Welcome to our equipment rental catalog. Browse available items and contact us directly to make a booking.";
  }

  // SEO description update
  if (metaDescription) {
    metaDescription.setAttribute("content", profile.bio || `Browse equipment and rental catalog items from ${name}.`);
  }

  // Phone Contact
  if (contactPhone) {
    if (profile.phone) {
      contactPhone.href = `tel:${profile.phone}`;
      if (phoneText) phoneText.textContent = profile.phone;
      contactPhone.style.display = "inline-flex";
    } else {
      contactPhone.style.display = "none";
    }
  }

  // WhatsApp Contact
  if (contactWhatsapp) {
    if (profile.whatsapp) {
      let cleanPhone = profile.whatsapp.replace(/\D/g, "");
      // Default to Nigerian country code if local leading zero is used
      if (cleanPhone.startsWith("0")) {
        cleanPhone = "234" + cleanPhone.slice(1);
      }
      const whatsappMsg = encodeURIComponent(`Hello ${name}, I am viewing your online rental catalog and would like to inquire about renting some equipment.`);
      contactWhatsapp.href = `https://wa.me/${cleanPhone}?text=${whatsappMsg}`;
      contactWhatsapp.style.display = "inline-flex";
    } else {
      contactWhatsapp.style.display = "none";
    }
  }

  // Address Location
  if (contactAddress) {
    if (profile.address) {
      contactAddress.href = `https://maps.google.com/?q=${encodeURIComponent(profile.address)}`;
      if (addressText) addressText.textContent = profile.address;
      contactAddress.style.display = "inline-flex";
    } else {
      contactAddress.style.display = "none";
    }
  }

  // Showcase Gallery
  if (gallerySection && showcaseGallery) {
    if (profile.gallery && profile.gallery.length > 0) {
      showcaseGallery.innerHTML = "";
      profile.gallery.forEach(url => {
        const imgWrapper = document.createElement("div");
        imgWrapper.className = "gallery-item";
        imgWrapper.innerHTML = `<img src="${url}" alt="Showcase Image" loading="lazy">`;
        showcaseGallery.appendChild(imgWrapper);
      });
      gallerySection.style.display = "block";
    } else {
      gallerySection.style.display = "none";
    }
  }
}

/* =========================
   LOAD CATALOG INVENTORY
========================= */
async function loadCatalog(businessId) {
  if (!catalogGrid) return;

  try {
    const invRef = collection(db, "businesses", businessId, "inventory");
    const snap = await getDocs(invRef);

    catalogGrid.innerHTML = "";

    if (snap.empty) {
      catalogGrid.innerHTML = `<div class="col-span-full text-center py-10 text-gray-500 font-semibold" style="grid-column: 1 / -1; padding: 40px 0; color: #6b7280;">No equipment catalog items listed yet.</div>`;
      return;
    }

    snap.forEach(docSnap => {
      const item = docSnap.data();
      const availableQty = Number(item.availableQuantity ?? item.quantity ?? 0);
      const totalQty = Number(item.totalQuantity ?? item.quantity ?? availableQty);
      const isAvailable = availableQty > 0;

      const card = document.createElement("div");
      card.className = "item-card";

      card.innerHTML = `
        <div class="item-info">
          <h4 class="item-name">${item.name || "Unnamed Item"}</h4>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 15px;">
            Available: <strong>${availableQty}</strong> / ${totalQty}
          </p>
          <div class="item-meta">
            <span class="item-price">₦${(Number(item.price) || 0).toLocaleString()}</span>
            <span class="item-status ${isAvailable ? 'status-available' : 'status-unavailable'}">
              ${isAvailable ? 'In Stock' : 'Out of Stock'}
            </span>
          </div>
        </div>
      `;
      catalogGrid.appendChild(card);
    });

  } catch (err) {
    console.error("Error loading storefront inventory:", err);
    catalogGrid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: #dc2626; padding: 30px 0;">Failed to load catalog inventory.</div>`;
  }
}

/* =========================
   ERROR DISPLAY CONTROLLER
========================= */
function showError(title, message) {
  if (loader) loader.style.display = "none";
  if (storefrontContent) storefrontContent.style.display = "none";
  if (errorView) {
    errorView.style.display = "block";
    const titleEl = document.getElementById("errorTitle");
    const msgEl = document.getElementById("errorMessage");
    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
  }
}

// Start execution
initViewer();