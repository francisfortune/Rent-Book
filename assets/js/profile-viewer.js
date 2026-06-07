// assets/js/profile-viewer.js
import { db } from "./firebase.js";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  query
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
  const path = window.location.pathname; // "/p/my-slug"
  if (path.includes("/p/")) {
    const slug = path.split("/p/")[1];
    if (slug) return decodeURIComponent(slug).trim().toLowerCase();
  }
  
  // Fallback to query parameter ?slug=my-slug
  const params = new URLSearchParams(window.location.search);
  return params.get("slug")?.trim()?.toLowerCase() || null;
}

/* =========================
   INITIALIZE PUBLIC PROFILE
========================= */
async function initViewer() {
  const slug = getSlug();
  
  if (!slug) {
    showError("Storefront Not Found", "No business URL handle was specified.");
    return;
  }

  try {
    // 1. Resolve slug to business ID
    const slugRef = doc(db, "publicSlugs", slug);
    const slugSnap = await getDoc(slugRef);

    if (!slugSnap.exists()) {
      showError("Storefront Not Found", "This business URL handle is not registered.");
      return;
    }

    const { businessId } = slugSnap.data();

    // 2. Load business details
    const businessRef = doc(db, "businesses", businessId);
    const businessSnap = await getDoc(businessRef);

    if (!businessSnap.exists()) {
      showError("Storefront Unavailable", "The business data associated with this URL could not be loaded.");
      return;
    }

    const businessData = businessSnap.data();
    const profile = businessData.publicProfile || {};

    // 3. Check if profile is active
    if (!profile.enabled) {
      showError("Storefront Offline", "This rental storefront has been set to private by the business owner.");
      return;
    }

    // 4. Render Profile Info
    renderProfile(businessData.name, profile);

    // 5. Load and Render Inventory Catalog
    await loadCatalog(businessId);

    // Hide loader and show content
    loader.style.display = "none";
    storefrontContent.style.display = "block";

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
  displayBusinessName.textContent = name;
  displayBusinessBio.textContent = profile.bio || "Welcome to our equipment rental catalog. Browse available items and book directly with us.";
  
  // SEO description update
  if (metaDescription) {
    metaDescription.setAttribute("content", profile.bio || `Browse catalog items and rental equipment from ${name}.`);
  }

  // Phone Contact
  if (profile.phone) {
    contactPhone.href = `tel:${profile.phone}`;
    phoneText.textContent = profile.phone;
    contactPhone.style.display = "inline-flex";
  } else {
    contactPhone.style.display = "none";
  }

  // Whatsapp Direct Booking Chat
  if (profile.whatsapp) {
    let cleanPhone = profile.whatsapp.replace(/\D/g, "");
    if (cleanPhone.startsWith("0")) {
      cleanPhone = "234" + cleanPhone.slice(1);
    }
    const whatsappMsg = encodeURIComponent(`Hello ${name}, I am viewing your online rental catalog and would like to make an inquiry about booking some equipment.`);
    contactWhatsapp.href = `https://wa.me/${cleanPhone}?text=${whatsappMsg}`;
    contactWhatsapp.style.display = "inline-flex";
  } else {
    contactWhatsapp.style.display = "none";
  }

  // Physical Warehouse Address
  if (profile.address) {
    contactAddress.href = `https://maps.google.com/?q=${encodeURIComponent(profile.address)}`;
    addressText.textContent = profile.address;
    contactAddress.style.display = "inline-flex";
  } else {
    contactAddress.style.display = "none";
  }

  // Gallery Showcase Photos
  if (profile.gallery && profile.gallery.length > 0) {
    showcaseGallery.innerHTML = "";
    profile.gallery.forEach(url => {
      const imgWrapper = document.createElement("div");
      imgWrapper.className = "gallery-item";
      imgWrapper.innerHTML = `<img src="${url}" alt="Equipment Showcase">`;
      showcaseGallery.appendChild(imgWrapper);
    });
    gallerySection.style.display = "block";
  } else {
    gallerySection.style.display = "none";
  }
}

/* =========================
   LOAD CATALOG INVENTORY
========================= */
async function loadCatalog(businessId) {
  try {
    const invRef = collection(db, "businesses", businessId, "inventory");
    const snap = await getDocs(invRef);

    catalogGrid.innerHTML = "";

    if (snap.empty) {
      catalogGrid.innerHTML = `<div class="col-span-full text-center py-10 text-gray-500 font-semibold">No equipment catalog items posted yet.</div>`;
      return;
    }

    snap.forEach(docSnap => {
      const item = docSnap.data();
      const qty = item.availableQuantity || 0;
      const isAvailable = qty > 0;
      
      const card = document.createElement("div");
      card.className = "item-card";

      card.innerHTML = `
        <div class="item-info">
          <h4 class="item-name">${item.name}</h4>
          <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 15px;">Available Quantity: ${item.totalQuantity || qty}</p>
          <div class="item-meta">
            <span class="item-price">₦${(item.price || 0).toLocaleString()}</span>
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
    catalogGrid.innerHTML = `<div class="col-span-full text-center py-10 text-red-500 font-semibold">Error loading catalog catalog.</div>`;
  }
}

/* =========================
   ERROR DISPLAY CONTROLLER
========================= */
function showError(title, message) {
  loader.style.display = "none";
  storefrontContent.style.display = "none";
  errorView.style.display = "block";
  document.getElementById("errorTitle").textContent = title;
  document.getElementById("errorMessage").textContent = message;
}

// Start execution
initViewer();
