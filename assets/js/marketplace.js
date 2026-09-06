import { db } from "./firebase.js";
import {
  collection,
  onSnapshot,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ============================================
// CONFIG
// ============================================

const CATEGORIES = [
  "All", "Equipment", "Vehicles", "Event Rentals", "Photography", "Furniture",
  "Sound & Lighting", "Decor", "Catering", "Bounce Castles", "Tents & Canopies",
  "Chairs & Tables", "Generators", "Power Tools", "Party Supplies"
];

// ============================================
// DOM REFS
// ============================================

const searchInput = document.getElementById("search-input");
const searchClear = document.getElementById("search-clear");
const searchBtn = document.getElementById("search-btn");
const categoryChipsEl = document.getElementById("category-chips");
const verifiedOnlyChip = document.getElementById("verified-only-chip");
const sortRatingBtn = document.getElementById("sort-rating-btn");
const sortNewestBtn = document.getElementById("sort-newest-btn");
const sortSelect = document.getElementById("sort-select");
const clearFiltersBtn = document.getElementById("clear-filters-btn");
const resetEmptyBtn = document.getElementById("reset-empty-btn");
const resultsGrid = document.getElementById("results-grid");
const resultsTitle = document.getElementById("results-title");
const resultsCount = document.getElementById("results-count");
const emptyState = document.getElementById("empty-state");
const activeFilters = document.getElementById("active-filters");
const activeFilterTags = document.getElementById("active-filter-tags");

// ============================================
// STATE
// ============================================

let allBusinesses = [];
let filteredBusinesses = [];
let activeCategory = "All";
let verifiedOnly = false;
let searchQuery = "";
let currentSort = "newest";
let currentPage = 1;
const PAGE_SIZE = 12;

// ============================================
// LOAD BUSINESSES (LIVE)
// ============================================

function loadBusinesses() {
  const q = query(collection(db, "businesses"), where("marketplace.visible", "==", true));

  onSnapshot(
    q,
    (snap) => {
      allBusinesses = snap.docs.map(d => normalizeBusiness(d.id, d.data()));
      applyFiltersAndSort();
    },
    (err) => {
      console.error("Failed to load marketplace:", err);
      showEmptyState("Couldn't load the marketplace", "Please check your connection and try again.");
    }
  );
}

// ============================================
// NORMALIZE BUSINESS DATA - FIXED
// ============================================

function normalizeBusiness(id, data) {
  const marketplace = data.marketplace || {};
  const profile = data.publicProfile || {};

  const categories = Array.isArray(profile.categories) && profile.categories.length
    ? profile.categories
    : (Array.isArray(data.categories) && data.categories.length
        ? data.categories
        : (data.category ? [data.category] : ["Equipment"]));

  // ✅ FIX: Calculate rating from ratingSum and ratingCount
  const ratingCount = Number(data.ratingCount || 0);
  const ratingSum = Number(data.ratingSum || 0);
  const rating = ratingCount > 0 ? ratingSum / ratingCount : 0;

  return {
    id,
    name: data.name || "Unnamed Business",
    category: categories[0] || "Equipment",
    categories,
    city: data.city || "",
    address: profile.address || "",
    rating: rating,
    ratingCount: ratingCount,
    ratingSum: ratingSum,
    logoUrl: data.logoUrl || "",
    coverImageUrl: data.coverImageUrl || "",
    slug: profile.slug || "",
    visible: profile.enabled === true,
    featured: marketplace.featured === true,
    verified: marketplace.verified === true,
    referralCount: Number(data.referrals?.count || 0),
    createdAt: data.createdAt ? data.createdAt.toDate?.() || new Date(data.createdAt) : null,
    whatsapp: profile.whatsapp || "",
    phone: profile.phone || "",
    instagram: profile.instagram || "",
    tiktok: profile.tiktok || "",
    facebook: profile.facebook || "",
    description: profile.bio || data.description || ""
  };
}

// ============================================
// RENDER BUSINESS CARD - FIXED
// ============================================

function renderBusinessCard(business) {
  const initials = business.name.slice(0, 2).toUpperCase();
  
  // ✅ FIX: Calculate stars from business.rating
  const starCount = Math.round(business.rating || 0);
  const stars = Array.from({ length: 5 }, (_, i) => 
    i < starCount ? '★' : '☆'
  ).join('');

  // Badges
  let badges = '';
  if (business.featured) {
    badges += `<span class="badge-featured">⭐ Featured</span>`;
  }
  if (business.verified) {
    badges += `<span class="badge-verified">✓ Verified</span>`;
  }

  // Social Handles
  const socials = [];
  if (business.instagram) {
    socials.push(`<a href="${business.instagram}" target="_blank" rel="noopener" class="social-link" title="Instagram">
      <i class="fab fa-instagram"></i>
    </a>`);
  }
  if (business.tiktok) {
    socials.push(`<a href="${business.tiktok}" target="_blank" rel="noopener" class="social-link" title="TikTok">
      <i class="fab fa-tiktok"></i>
    </a>`);
  }
  if (business.facebook) {
    socials.push(`<a href="${business.facebook}" target="_blank" rel="noopener" class="social-link" title="Facebook">
      <i class="fab fa-facebook"></i>
    </a>`);
  }
  if (business.whatsapp) {
    socials.push(`<a href="https://wa.me/${business.whatsapp}" target="_blank" rel="noopener" class="social-link whatsapp" title="WhatsApp">
      <i class="fab fa-whatsapp"></i>
    </a>`);
  }
  if (business.phone) {
    socials.push(`<a href="tel:${business.phone}" class="social-link phone" title="Call">
      <i class="fas fa-phone"></i>
    </a>`);
  }

  const socialHtml = socials.length > 0 
    ? `<div class="social-row">${socials.join('')}</div>`
    : '';

  // ✅ FIX: Rating display - shows stars and count
  const ratingDisplay = business.rating > 0 
    ? `<div class="rating-wrapper">
         <span class="star-rating">${stars}</span>
         <span class="rating-number">${business.rating.toFixed(1)}</span>
         <span class="rating-total">(${business.ratingCount || 0} reviews)</span>
       </div>`
    : `<span class="no-reviews-text">Be the first to review</span>`;

  // Cover image
  const coverImage = business.coverImage || business.coverImageUrl || '';
  const cardImageStyle = coverImage
    ? `style="background-image: url('${coverImage}'); background-size: cover; background-position: center;"`
    : `style="background: linear-gradient(135deg, #800080, #9b4d9b, #800080);"`;

  // Categories
  const allCategories = business.categories || business.serviceTags || [];
  const primaryCategory = business.category || allCategories[0] || 'Equipment';
  const extraTags = allCategories.slice(1, 5);
  
  const extraTagsHtml = extraTags.length
    ? `<div class="tags-container">
         ${extraTags.map(t => `<span class="tag-item">${t}</span>`).join('')}
       </div>`
    : '';

  // Location
  const locationText = business.city 
    ? `${business.city}${business.state ? `, ${business.state}` : ''}`
    : '';

  return `
    <a href="/p/${business.slug || '#'}" class="card-link">
      <div class="linkedin-card">
        <!-- Cover Image -->
        <div class="cover-section" ${cardImageStyle}>
          <div class="cover-overlay"></div>
          <div class="badge-section">${badges}</div>
        </div>
        
        <!-- Avatar -->
        <div class="avatar-section">
          <div class="avatar-circle">
            ${business.logoUrl 
              ? `<img src="${business.logoUrl}" alt="${business.name}" loading="lazy">` 
              : initials}
          </div>
        </div>
        
        <!-- Content -->
        <div class="content-section">
          <h3 class="business-title">${business.name}</h3>
          
          <div class="info-row">
            <span class="category-tag">
              <i class="fas fa-briefcase"></i> ${primaryCategory}
            </span>
            ${locationText ? `<span class="location-tag"><i class="fas fa-map-marker-alt"></i> ${locationText}</span>` : ''}
          </div>
          
          ${extraTagsHtml}
          
          ${business.address ? `<p class="address-line"><i class="fas fa-location-dot"></i> ${business.address}</p>` : ''}
          
          ${socialHtml}
          
          <div class="card-footer-actions">
            ${ratingDisplay}
            <button class="connect-btn" onclick="event.preventDefault(); window.location.href='/p/${business.slug || '#'}'">
              View Store <i class="fas fa-arrow-right"></i>
            </button>
          </div>
        </div>
      </div>
    </a>
  `;
}

// ============================================
// FILTERING ENGINE
// ============================================

function applyFiltersAndSort() {
  let result = [...allBusinesses];

  // 1. Category filter
  if (activeCategory !== "All") {
    const wanted = activeCategory.toLowerCase();
    result = result.filter(b =>
      (b.categories || [b.category]).some(c => (c || "").toLowerCase() === wanted)
    );
  }

  // 2. Search filter
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase().trim();
    const tokens = query.split(/\s+/).filter(Boolean);
    result = result.filter(b => {
      const haystack = `${b.name} ${(b.categories || [b.category]).join(" ")} ${b.city} ${b.address}`.toLowerCase();
      return tokens.every(t => haystack.includes(t));
    });
  }

  // 3. Verified filter
  if (verifiedOnly) {
    result = result.filter(b => b.verified || b.featured);
  }

  // 4. Sorting
  switch (currentSort) {
    case "newest":
      result.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
      break;
    case "rating":
      result.sort((a, b) => b.rating - a.rating);
      break;
    case "name":
      result.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "featured":
      result.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
      break;
    default:
      break;
  }

  filteredBusinesses = result;
  renderResults();
  updateActiveFilters();
}

// ============================================
// RENDER RESULTS
// ============================================

function renderResults() {
  const hasResults = filteredBusinesses.length > 0;
  const displayItems = filteredBusinesses.slice(0, currentPage * PAGE_SIZE);
  const hasMore = filteredBusinesses.length > displayItems.length;

  const count = filteredBusinesses.length;
  resultsTitle.textContent = activeCategory !== "All" ? `${activeCategory}` : "All Businesses";
  resultsCount.textContent = `${count} business${count !== 1 ? 'es' : ''} found`;

  resultsGrid.innerHTML = displayItems.map(b => renderBusinessCard(b)).join("");

  if (!hasResults) {
    showEmptyState("No businesses found", "Try adjusting your filters or search terms.");
  } else {
    emptyState.classList.add("hidden");
  }

  const loadMoreContainer = document.getElementById("load-more-container");
  if (loadMoreContainer) {
    if (hasMore) {
      loadMoreContainer.classList.remove("hidden");
    } else {
      loadMoreContainer.classList.add("hidden");
    }
  }

  // Refresh Lucide icons
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// ============================================
// UPDATE ACTIVE FILTERS DISPLAY
// ============================================

function updateActiveFilters() {
  const tags = [];
  
  if (activeCategory !== "All") {
    tags.push({ label: `Category: ${activeCategory}`, type: 'category' });
  }
  if (verifiedOnly) {
    tags.push({ label: '✓ Verified only', type: 'verified' });
  }
  if (searchQuery.trim()) {
    tags.push({ label: `"${searchQuery.trim()}"`, type: 'search' });
  }

  if (tags.length === 0) {
    activeFilters.classList.add("hidden");
    return;
  }

  activeFilters.classList.remove("hidden");
  activeFilterTags.innerHTML = tags.map(t => `
    <span class="inline-flex items-center gap-1 text-xs bg-purple-50 text-purple-700 px-2.5 py-1 rounded-full border border-purple-100">
      ${t.label}
      <button class="remove-filter" data-type="${t.type}" data-value="${t.label}" aria-label="Remove filter">
        <i data-lucide="x" class="w-3 h-3 hover:text-purple-900"></i>
      </button>
    </span>
  `).join("");

  document.querySelectorAll(".remove-filter").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const type = btn.dataset.type;
      switch (type) {
        case 'category':
          activeCategory = "All";
          updateCategoryChips();
          break;
        case 'verified':
          verifiedOnly = false;
          verifiedOnlyChip.classList.remove("active");
          break;
        case 'search':
          searchInput.value = "";
          searchQuery = "";
          break;
      }
      applyFiltersAndSort();
    });
  });

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// ============================================
// EMPTY STATE
// ============================================

function showEmptyState(title, message) {
  emptyState.classList.remove("hidden");
  resultsGrid.innerHTML = "";
  emptyState.querySelector("h3").textContent = title;
  emptyState.querySelector("p").textContent = message;
}

// ============================================
// CATEGORY CHIPS
// ============================================

function renderCategoryChips() {
  categoryChipsEl.innerHTML = CATEGORIES.map(cat => `
    <button class="filter-chip ${activeCategory === cat ? 'active' : ''}" data-category="${cat}">
      ${cat}
    </button>
  `).join("");

  document.querySelectorAll("[data-category]").forEach(btn => {
    btn.addEventListener("click", () => {
      activeCategory = btn.dataset.category;
      updateCategoryChips();
      applyFiltersAndSort();
    });
  });
}

function updateCategoryChips() {
  document.querySelectorAll("[data-category]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.category === activeCategory);
  });
}

// ============================================
// EVENT LISTENERS
// ============================================

searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value;
  searchClear.classList.toggle("hidden", !searchQuery);
  applyFiltersAndSort();
});

searchClear.addEventListener("click", () => {
  searchInput.value = "";
  searchQuery = "";
  searchClear.classList.add("hidden");
  applyFiltersAndSort();
});

searchBtn.addEventListener("click", () => {
  searchQuery = searchInput.value;
  applyFiltersAndSort();
});

searchInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    searchQuery = searchInput.value;
    applyFiltersAndSort();
  }
});

verifiedOnlyChip.addEventListener("click", () => {
  verifiedOnly = !verifiedOnly;
  verifiedOnlyChip.classList.toggle("active");
  applyFiltersAndSort();
});

sortRatingBtn.addEventListener("click", () => {
  currentSort = "rating";
  sortSelect.value = "rating";
  applyFiltersAndSort();
});

sortNewestBtn.addEventListener("click", () => {
  currentSort = "newest";
  sortSelect.value = "newest";
  applyFiltersAndSort();
});

sortSelect.addEventListener("change", () => {
  currentSort = sortSelect.value;
  applyFiltersAndSort();
});

clearFiltersBtn.addEventListener("click", resetAllFilters);
resetEmptyBtn?.addEventListener("click", resetAllFilters);

function resetAllFilters() {
  activeCategory = "All";
  verifiedOnly = false;
  searchQuery = "";
  searchInput.value = "";
  searchClear.classList.add("hidden");
  verifiedOnlyChip.classList.remove("active");
  sortSelect.value = "newest";
  currentSort = "newest";
  updateCategoryChips();
  applyFiltersAndSort();
}

document.getElementById("load-more-btn")?.addEventListener("click", () => {
  currentPage++;
  renderResults();
});

// ============================================
// INIT
// ============================================

renderCategoryChips();
loadBusinesses();

console.log("✅ Marketplace loaded successfully!");