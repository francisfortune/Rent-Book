import { db } from "./firebase.js";
import {
  collection,
  onSnapshot,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const CATEGORIES = ["Equipment", "Vehicles", "Event Rentals", "Photography", "Furniture", "Sound & Lighting"];

const searchInput = document.getElementById("search-input");
const searchClear = document.getElementById("search-clear");
const categoryChipsEl = document.getElementById("category-chips");
const cityChipsEl = document.getElementById("city-chips");
const activeFilterBanner = document.getElementById("active-filter-banner");
const activeFilterText = document.getElementById("active-filter-text");
const clearFilterBtn = document.getElementById("clear-filter-btn");

const resultsSection = document.getElementById("results-section");
const resultsGrid = document.getElementById("results-grid");
const homepageSections = document.getElementById("homepage-sections");
const featuredSection = document.getElementById("featured-section");
const featuredScroll = document.getElementById("featured-scroll");
const newestGrid = document.getElementById("newest-grid");
const emptyState = document.getElementById("empty-state");

let allBusinesses = [];
let activeCategory = null;
let activeCity = null;

function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
}

/* =========================
   LIVE MARKETPLACE LISTING
   onSnapshot instead of a one-time getDocs — the moment a business
   goes visible, gets marked featured/verified, or a rating changes,
   every open marketplace tab updates itself. No refresh needed.
========================= */
function loadBusinesses() {
  // The dashboard's single "Go Online" toggle writes publicProfile.enabled
  // AND marketplace.visible together in the same update (see
  // public-profile.js), so marketplace.visible is the correct — and only
  // — field this catalog needs to filter on.
  const q = query(collection(db, "businesses"), where("marketplace.visible", "==", true));

  onSnapshot(
    q,
    (snap) => {
      allBusinesses = snap.docs.map(d => normalizeBusiness(d.id, d.data()));
      rankBusinesses(allBusinesses);
      renderCityChips();
      // Keep whatever view (homepage vs filtered results) is currently active in sync
      const isFiltering = searchInput.value.trim().length > 0 || activeCategory || activeCity;
      isFiltering ? applyFilters() : renderHomepage();
    },
    (err) => {
      console.error("Failed to load marketplace businesses:", err);
      if (emptyState) {
        emptyState.classList.remove("hidden");
        emptyState.querySelector("h3").textContent = "Couldn't load the marketplace";
        emptyState.querySelector("p").textContent = "Please check your connection and try again.";
      }
    }
  );
}

// Pulls a short, chip-friendly location (e.g. "Port Harcourt") out of a
// freeform address like "No 12 Ogui Road, Port Harcourt, Rivers State".
// Falls back gracefully since owners type addresses however they like.
function deriveLocation(business) {
  if (business.city) return business.city;
  if (!business.address) return "";
  const parts = business.address.split(",").map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return "";
  // Prefer the second-to-last segment (usually the city) over the last
  // (often a state, or "Nigeria"), but fall back sensibly either way.
  const stateLike = /state|nigeria/i;
  const last = parts[parts.length - 1];
  const secondLast = parts[parts.length - 2];
  if (secondLast && !stateLike.test(secondLast)) return secondLast;
  if (last && !stateLike.test(last)) return last;
  return secondLast || last;
}

function normalizeBusiness(id, data) {
  const marketplace = data.marketplace || {};
  const profile = data.publicProfile || {};
  const business = {
    id,
    name: data.name || "Unnamed Business",
    category: data.category || "Equipment",
    city: data.city || "",
    address: profile.address || "",
    rating: Number(data.rating || 0),
    logoUrl: data.logoUrl || "",
    slug: profile.slug || "",
    visible: profile.enabled === true,
    featured: marketplace.featured === true,
    verified: marketplace.verified === true,
    referralCount: Number(data.referrals?.count || 0),
    createdAt: data.createdAt || null
  };
  business.location = deriveLocation(business);
  return business;
}

// Featured (Growth Partner) > Verified > Rating > Newest
function rankBusinesses(list) {
  list.sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    if (a.verified !== b.verified) return a.verified ? -1 : 1;
    if (b.rating !== a.rating) return b.rating - a.rating;
    return (b.createdAt || "") > (a.createdAt || "") ? 1 : -1;
  });
  return list;
}

/* =========================
   CARD RENDERER
   The single source of truth for how a business appears anywhere
   in the marketplace — homepage strips, search results, category
   pages all call this.
========================= */
function buildBusinessCard(business, { featuredStyle = false } = {}) {
  const storeUrl = business.slug ? `/p/${business.slug}` : "#";
  const initials = business.name.slice(0, 2).toUpperCase();

  const badge = business.featured
    ? `<span class="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">🏆 Growth Partner</span>`
    : business.verified
      ? `<span class="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200"><i data-lucide="badge-check" class="w-3 h-3"></i> Verified</span>`
      : "";

  const stars = "★".repeat(Math.round(business.rating)) + "☆".repeat(5 - Math.round(business.rating));

  const cardBorder = featuredStyle
    ? "border-2 border-amber-400 shadow-md"
    : "border border-slate-200 shadow-sm";

  return `
    <a href="${storeUrl}" class="group block bg-white ${cardBorder} rounded-2xl p-5 hover:shadow-lg transition flex flex-col gap-3 min-w-[240px]">
      <div class="flex items-start justify-between gap-2">
        <div class="w-12 h-12 rounded-xl bg-purple-950 text-white flex items-center justify-center font-display font-bold text-sm overflow-hidden">
          ${business.logoUrl ? `<img src="${business.logoUrl}" class="w-full h-full object-cover" alt="${business.name} logo">` : initials}
        </div>
        ${badge}
      </div>
      <div>
        <h3 class="font-display font-bold text-slate-900 group-hover:text-purple-800 transition">${business.name}</h3>
        <p class="text-xs text-slate-500 mt-0.5">${business.category}${business.location ? ` · ${business.location}` : ""}</p>
        ${business.address ? `<p class="text-xs text-slate-400 mt-1 flex items-start gap-1"><i data-lucide="map-pin" class="w-3 h-3 mt-0.5 flex-shrink-0"></i><span class="line-clamp-1">${business.address}</span></p>` : ""}
      </div>
      <div class="flex items-center justify-between pt-2 border-t border-slate-50">
        <span class="text-amber-500 text-sm tracking-tight">${business.rating > 0 ? stars : ""}</span>
        <span class="text-xs font-semibold text-purple-800 group-hover:underline">View Store &rarr;</span>
      </div>
    </a>
  `;
}

/* =========================
   HOMEPAGE (default view)
========================= */
function renderHomepage() {
  resultsSection.classList.add("hidden");
  homepageSections.classList.remove("hidden");
  emptyState.classList.add("hidden");

  const featured = allBusinesses.filter(b => b.featured);
  if (featured.length > 0) {
    featuredSection.classList.remove("hidden");
    featuredScroll.innerHTML = featured.map(b => buildBusinessCard(b, { featuredStyle: true })).join("");
  } else {
    featuredSection.classList.add("hidden");
  }

  const newest = [...allBusinesses].slice(0, 9);
  newestGrid.innerHTML = newest.length
    ? newest.map(b => buildBusinessCard(b)).join("")
    : `<p class="col-span-full text-center text-slate-400 py-8">No businesses listed yet — be the first!</p>`;

  refreshIcons();
}

/* =========================
   SEARCH + FILTERS
========================= */
function matchesQuery(business, tokens) {
  const haystack = `${business.name} ${business.category} ${business.location} ${business.address}`.toLowerCase();
  return tokens.every(t => haystack.includes(t));
}

function applyFilters() {
  const rawQuery = searchInput.value.trim().toLowerCase();
  const tokens = rawQuery.split(/\s+/).filter(Boolean);

  const isFiltering = tokens.length > 0 || activeCategory || activeCity;

  searchClear.classList.toggle("hidden", tokens.length === 0);

  if (!isFiltering) {
    activeFilterBanner.classList.add("hidden");
    renderHomepage();
    return;
  }

  let filtered = allBusinesses.filter(b => {
    if (activeCategory && b.category !== activeCategory) return false;
    if (activeCity && b.location.toLowerCase() !== activeCity.toLowerCase()) return false;
    if (tokens.length > 0 && !matchesQuery(b, tokens)) return false;
    return true;
  });

  rankBusinesses(filtered);

  // Filter banner
  const labelParts = [];
  if (activeCategory) labelParts.push(activeCategory);
  if (activeCity) labelParts.push(activeCity);
  if (tokens.length > 0) labelParts.push(`"${rawQuery}"`);
  activeFilterText.textContent = `Showing results for ${labelParts.join(" · ")}`;
  activeFilterBanner.classList.remove("hidden");

  homepageSections.classList.add("hidden");
  resultsSection.classList.toggle("hidden", filtered.length === 0);
  emptyState.classList.toggle("hidden", filtered.length > 0);

  resultsGrid.innerHTML = filtered.map(b => buildBusinessCard(b, { featuredStyle: b.featured })).join("");
  refreshIcons();
}

function clearFilters() {
  searchInput.value = "";
  activeCategory = null;
  activeCity = null;
  document.querySelectorAll("[data-category-chip]").forEach(el => el.classList.remove("bg-purple-800", "text-white"));
  document.querySelectorAll("[data-city-chip]").forEach(el => el.classList.remove("bg-purple-800", "text-white"));
  applyFilters();
}

searchInput.addEventListener("input", applyFilters);
searchClear.addEventListener("click", clearFilters);
clearFilterBtn.addEventListener("click", clearFilters);

/* =========================
   CHIPS (categories + cities)
========================= */
function renderChips() {
  categoryChipsEl.innerHTML = CATEGORIES.map(cat => `
    <button data-category-chip data-value="${cat}"
      class="text-xs md:text-sm font-medium px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white border border-white/20 transition">
      ${cat}
    </button>
  `).join("");

  document.querySelectorAll("[data-category-chip]").forEach(btn => {
    btn.addEventListener("click", () => {
      const value = btn.dataset.value;
      activeCategory = activeCategory === value ? null : value;
      document.querySelectorAll("[data-category-chip]").forEach(el => el.classList.remove("bg-white", "text-purple-900"));
      if (activeCategory) btn.classList.add("bg-white", "text-purple-900");
      applyFilters();
    });
  });
}

/* =========================
   LOCATION CHIPS (dynamic)
   This is a nationwide marketplace, so instead of a fixed handful of
   cities, we surface whatever real locations businesses have actually
   listed — sorted by how many businesses are there, most first.
========================= */
function renderCityChips() {
  if (!cityChipsEl) return;

  const counts = new Map();
  allBusinesses.forEach(b => {
    if (!b.location) return;
    counts.set(b.location, (counts.get(b.location) || 0) + 1);
  });

  const locations = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([location]) => location);

  if (locations.length === 0) {
    cityChipsEl.innerHTML = `<p class="text-sm text-slate-400">Locations will show up here as businesses join.</p>`;
    return;
  }

  cityChipsEl.innerHTML = locations.map(loc => `
    <button data-city-chip data-value="${loc}"
      class="text-sm font-medium px-4 py-2 rounded-full bg-white border border-slate-200 hover:border-purple-300 hover:text-purple-800 transition ${activeCity === loc ? "bg-purple-800 text-white border-purple-800" : ""}">
      ${loc}
    </button>
  `).join("");

  document.querySelectorAll("[data-city-chip]").forEach(btn => {
    btn.addEventListener("click", () => {
      const value = btn.dataset.value;
      activeCity = activeCity === value ? null : value;
      renderCityChips();
      applyFilters();
    });
  });
}

renderChips();
loadBusinesses();
