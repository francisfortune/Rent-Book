import { db } from "./firebase.js";
import {
  doc,
  getDoc,
  onSnapshot,
  collection,
  getDocs,
  query,
  where,
  addDoc,
  runTransaction,
  serverTimestamp,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const loader = document.getElementById("loader");
const errorView = document.getElementById("error-state");
const storefrontContent = document.getElementById("storefront");

// Shared across render functions so per-item "Inquire" links reuse the
// same normalized WhatsApp number and business name.
let waNumberGlobal = "";
let businessNameGlobal = "";
let currentBusinessId = null;
let unsubBusiness = null;
let unsubInventory = null;
let unsubReviews = null;

// Owner-controlled visibility toggles (public.html "What Customers See").
// Defaults are permissive (true) so older records without these fields
// keep behaving the way the storefront always has.
let showInventoryGlobal = true;
let showAvailabilityGlobal = true;
let lastInventorySnapshot = null; // re-rendered if the toggles change

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
   INITIALIZE PUBLIC PROFILE (REAL-TIME)
========================= */
export async function initViewer() {
  const slug = getSlug();

  if (!slug) {
    showError("Storefront Not Found", "No business handle was specified in the URL.");
    return;
  }

  try {
    let businessId = null;

    const slugRef = doc(db, "publicSlugs", slug);
    const slugSnap = await getDoc(slugRef);

    if (slugSnap.exists()) {
      businessId = slugSnap.data().businessId;
    } else {
      const q = query(collection(db, "businesses"), where("publicProfile.slug", "==", slug));
      const querySnap = await getDocs(q);
      if (!querySnap.empty) businessId = querySnap.docs[0].id;
    }

    if (!businessId) {
      showError("Storefront Not Found", `The store handle "${slug}" is not registered.`);
      return;
    }

    currentBusinessId = businessId;

    // Live listener on the business doc — any change the owner saves
    // (bio, contact info, toggle, gallery) reflects here instantly.
    const businessRef = doc(db, "businesses", businessId);
    unsubBusiness = onSnapshot(
      businessRef,
      (snap) => {
        if (!snap.exists()) {
          showError("Storefront Unavailable", "The business data associated with this store could not be found.");
          return;
        }
        const businessData = snap.data();
        const profile = businessData.publicProfile || {};

        if (profile.enabled === false) {
          showError("Store Currently Offline", "This business has taken its storefront offline. Please check back later.");
          return;
        }

        renderProfile(businessData.name || "Equipment Rentals", profile, businessData);

        if (loader) loader.classList.add("hidden");
        if (storefrontContent) storefrontContent.classList.remove("hidden");
        if (errorView) errorView.classList.add("hidden");
        refreshIcons();
      },
      (err) => {
        console.error("Business listener error:", err);
        showError("Connection Error", "Failed to retrieve store details. Please check your network connection.");
      }
    );

    listenToCatalog(businessId);
    listenToReviews(businessId);
    wireReviewForm(businessId);
  } catch (err) {
    console.error("Storefront initialization error:", err);
    showError("Connection Error", "Failed to retrieve store details. Please check your network connection.");
  }
}

/* =========================
   RENDER PROFILE DATA
========================= */
function renderProfile(name, profile, businessData) {
  document.title = `${name} | Rental Catalog`;
  businessNameGlobal = name;

  const nameEl = document.getElementById("store-name");
  if (nameEl) nameEl.textContent = name;

  // Logo / profile picture (WhatsApp-Business style avatar)
  const logoEl = document.getElementById("store-logo");
  if (logoEl) {
    logoEl.innerHTML = businessData.logoUrl
      ? `<img src="${businessData.logoUrl}" style="width:100%;height:100%;object-fit:cover;" alt="${escapeHtml(name)} logo">`
      : name.slice(0, 2).toUpperCase();
  }

  // Verification / Growth Partner / dynamic achievement badges — the
  // Featured & Verified badges mirror the marketplace card; the rest are
  // computed automatically from the business's own stats, not set by hand.
  const badgesEl = document.getElementById("profile-badges");
  if (badgesEl) {
    const marketplace = businessData.marketplace || {};
    const verification = businessData.verification || {};
    const ratingCount = Number(businessData.ratingCount || 0);
    const ratingSum = Number(businessData.ratingSum || 0);
    const avgRating = ratingCount > 0 ? ratingSum / ratingCount : 0;
    const completedRentals = Number(businessData.completedRentals || 0);

    let badges = "";
    if (marketplace.featured) {
      badges += `<span class="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full" style="background:rgba(245,165,36,.18); color:#FBBF24; border:1px solid rgba(245,165,36,.35);">🏆 Growth Partner</span>`;
    } else if (marketplace.verified) {
      badges += `<span class="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full" style="background:rgba(16,185,129,.15); color:#34D399; border:1px solid rgba(16,185,129,.3);"><i data-lucide="badge-check" class="w-3 h-3"></i> Verified</span>`;
    }
    if (verification.idUploaded === true) {
      badges += `<span class="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full" style="background:rgba(124,58,237,.15); color:#C4B5FD; border:1px solid rgba(124,58,237,.3);"><i data-lucide="shield-check" class="w-3 h-3"></i> Identity Verified</span>`;
    }
    if (avgRating >= 4.5 && ratingCount >= 10) {
      badges += `<span class="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full" style="background:rgba(245,165,36,.15); color:#FCD34D; border:1px solid rgba(245,165,36,.3);"><i data-lucide="star" class="w-3 h-3"></i> Top Rated</span>`;
    }
    if (completedRentals >= 50) {
      badges += `<span class="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full" style="background:rgba(59,130,246,.15); color:#93C5FD; border:1px solid rgba(59,130,246,.3);"><i data-lucide="trending-up" class="w-3 h-3"></i> High Volume</span>`;
    }
    badgesEl.innerHTML = badges;
  }

  // Cover / banner image — behind the whole hero, faded in once loaded so
  // there's no flash of a broken image on slow connections.
  const coverEl = document.getElementById("store-cover");
  if (coverEl) {
    if (businessData.coverImageUrl) {
      coverEl.style.backgroundImage = `url('${businessData.coverImageUrl}')`;
      coverEl.style.opacity = "1";
    } else {
      coverEl.style.backgroundImage = "";
      coverEl.style.opacity = "0";
    }
  }

  const bioEl = document.getElementById("store-bio");
  if (bioEl) {
    bioEl.textContent = profile.bio || "Welcome to our rental catalog. Browse available items and reach out to place an order.";
  }

  // Services / categories tags — from the owner's tag editor. Hidden
  // entirely when nothing has been set, same pattern as social links.
  const categoriesEl = document.getElementById("store-categories");
  if (categoriesEl) {
    const cats = Array.isArray(profile.categories) && profile.categories.length
      ? profile.categories
      : (Array.isArray(businessData.categories) && businessData.categories.length
          ? businessData.categories
          : (businessData.category ? [businessData.category] : []));
    if (cats.length) {
      categoriesEl.innerHTML = cats.map((c) => `<span class="category-chip">${escapeHtml(c)}</span>`).join("");
      categoriesEl.classList.remove("hidden");
      categoriesEl.classList.add("flex");
    } else {
      categoriesEl.classList.add("hidden");
      categoriesEl.classList.remove("flex");
      categoriesEl.innerHTML = "";
    }
  }

  // Address, falling back to City, State (from the setup wizard) when the
  // owner hasn't filled in a full street address on the storefront.
  const addrEl = document.getElementById("store-address");
  const addrContainer = document.getElementById("address-container");
  const cityState = [businessData.city, businessData.state].filter(Boolean).join(", ");
  const addressText = profile.address || cityState;
  if (addressText) {
    if (addrEl) addrEl.textContent = addressText;
    if (addrContainer) addrContainer.classList.remove("hidden");
  } else if (addrContainer) {
    addrContainer.classList.add("hidden");
  }

  const rawPhone = profile.phone || profile.whatsapp || "";
  const cleanPhone = rawPhone.replace(/\D/g, "");

  const btnPhone = document.getElementById("btn-phone");
  if (btnPhone) {
    if (cleanPhone) {
      btnPhone.href = `tel:${cleanPhone}`;
      btnPhone.classList.remove("hidden");
    } else {
      btnPhone.classList.add("hidden");
    }
  }

  const btnWa = document.getElementById("btn-whatsapp");
  if (btnWa) {
    if (cleanPhone) {
      let waNumber = cleanPhone;
      if (waNumber.startsWith("0")) waNumber = "234" + waNumber.slice(1);
      waNumberGlobal = waNumber;
      const waMsg = encodeURIComponent(`Hello ${name}, I am viewing your online rental catalog and would like to inquire about renting equipment.`);
      btnWa.href = `https://wa.me/${waNumber}?text=${waMsg}`;
      btnWa.classList.remove("hidden");
    } else {
      waNumberGlobal = "";
      btnWa.classList.add("hidden");
    }
  }

  const prevShowInventory = showInventoryGlobal;
  const prevShowAvailability = showAvailabilityGlobal;
  showInventoryGlobal = profile.showInventory !== false; // default true
  showAvailabilityGlobal = profile.showAvailability !== false; // default true

  const catalogSection = document.getElementById("inventory-grid")?.closest("section");
  if (catalogSection) catalogSection.classList.toggle("hidden", !showInventoryGlobal);

  // If either toggle flipped since the last inventory snapshot, re-render
  // the grid immediately rather than waiting on the next inventory write.
  if (lastInventorySnapshot && (prevShowInventory !== showInventoryGlobal || prevShowAvailability !== showAvailabilityGlobal)) {
    renderInventoryGrid(lastInventorySnapshot);
  }

  renderDepositBanner(profile.depositPolicy || {});
  renderSocialLinks(profile);
  renderGallery(profile.gallery || []);
  renderRatingSummary(businessData);
}

/* =========================
   DEPOSIT & CAUTION POLICY BANNER
   Owner-configured, optional — hidden entirely when nothing is set.
========================= */
function renderDepositBanner(depositPolicy) {
  const section = document.getElementById("deposit-banner");
  const contentEl = document.getElementById("deposit-banner-content");
  if (!section || !contentEl) return;

  const cautionFee = (depositPolicy.cautionFee || "").trim();
  const idRequirement = (depositPolicy.idRequirement || "").trim();
  const notes = (depositPolicy.notes || "").trim();

  if (!cautionFee && !idRequirement && !notes) {
    section.classList.add("hidden");
    contentEl.innerHTML = "";
    return;
  }

  let rows = "";
  if (cautionFee) rows += `<p><span class="font-medium text-slate-800">Caution deposit:</span> ${escapeHtml(cautionFee)}</p>`;
  if (idRequirement) rows += `<p><span class="font-medium text-slate-800">ID requirement:</span> ${escapeHtml(idRequirement)}</p>`;
  if (notes) rows += `<p>${escapeHtml(notes)}</p>`;

  contentEl.innerHTML = rows;
  section.classList.remove("hidden");
  refreshIcons();
}

/* =========================
   SOCIAL HANDLES
   Only rendered when the owner has filled at least one in. Accepts either
   a bare handle ("@shopname") or a full URL.
========================= */
function toSocialUrl(platform, value) {
  const trimmed = (value || "").trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const handle = trimmed.replace(/^@/, "");
  if (platform === "instagram") return `https://instagram.com/${handle}`;
  if (platform === "tiktok") return `https://tiktok.com/@${handle}`;
  if (platform === "facebook") return `https://facebook.com/${handle}`;
  return null;
}

function renderSocialLinks(profile) {
  const container = document.getElementById("social-links");
  if (!container) return;

  const links = [
    { platform: "instagram", url: toSocialUrl("instagram", profile.instagram), icon: "instagram" },
    { platform: "tiktok", url: toSocialUrl("tiktok", profile.tiktok), icon: "music" },
    { platform: "facebook", url: toSocialUrl("facebook", profile.facebook), icon: "facebook" }
  ].filter((l) => l.url);

  if (links.length === 0) {
    container.classList.add("hidden");
    container.classList.remove("flex");
    container.innerHTML = "";
    return;
  }

  container.innerHTML = links
    .map(
      (l) => `
      <a href="${l.url}" target="_blank" rel="noopener noreferrer"
         class="w-8 h-8 rounded-full flex items-center justify-center transition"
         style="background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.2); color:#fff;"
         aria-label="${l.platform}">
        <i data-lucide="${l.icon}" class="w-4 h-4"></i>
      </a>`
    )
    .join("");
  container.classList.remove("hidden");
  container.classList.add("flex");
  refreshIcons();
}

/* =========================
   GALLERY — IMAGES + VIDEO (Cloudinary-aware)
========================= */
function renderGallery(gallery) {
  const gallerySection = document.getElementById("gallery-section");
  const galleryGrid = document.getElementById("gallery-grid");
  if (!gallerySection || !galleryGrid) return;

  if (!gallery || gallery.length === 0) {
    gallerySection.classList.add("hidden");
    return;
  }

  galleryGrid.innerHTML = gallery
    .map((entry, i) => {
      const item = normalizeGalleryEntry(entry);
      if (item.type === "video") {
        return `
          <button type="button" class="gallery-tile" data-index="${i}" data-type="video" data-url="${item.url}" aria-label="Play video">
            <video src="${item.url}#t=0.1" muted playsinline preload="metadata"></video>
            <span class="gallery-play"><i data-lucide="play" class="w-5 h-5"></i></span>
          </button>`;
      }
      return `
        <button type="button" class="gallery-tile" data-index="${i}" data-type="image" data-url="${item.url}" aria-label="View photo">
          <img src="${item.url}" alt="Store showcase" loading="lazy" />
        </button>`;
    })
    .join("");

  gallerySection.classList.remove("hidden");
  refreshIcons();

  galleryGrid.querySelectorAll(".gallery-tile").forEach((tile) => {
    tile.addEventListener("click", () => openLightbox(tile.dataset.url, tile.dataset.type));
  });
}

function normalizeGalleryEntry(entry) {
  // Backward compatible: old data may just be a plain URL string.
  if (typeof entry === "string") {
    const isVideo = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(entry) || entry.includes("/video/upload/");
    return { url: entry, type: isVideo ? "video" : "image" };
  }
  return { url: entry.url, type: entry.type === "video" ? "video" : "image" };
}

function openLightbox(url, type) {
  let overlay = document.getElementById("lightbox-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "lightbox-overlay";
    overlay.className = "lightbox-overlay";
    overlay.innerHTML = `<div class="lightbox-inner"></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeLightbox();
    });
  }
  const inner = overlay.querySelector(".lightbox-inner");
  inner.innerHTML =
    type === "video"
      ? `<video src="${url}" controls autoplay playsinline class="lightbox-media"></video>`
      : `<img src="${url}" alt="Store showcase" class="lightbox-media" />`;
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";

  document.addEventListener("keydown", escCloseOnce);
}

function escCloseOnce(e) {
  if (e.key === "Escape") closeLightbox();
}

function closeLightbox() {
  const overlay = document.getElementById("lightbox-overlay");
  if (!overlay) return;
  overlay.classList.remove("open");
  overlay.querySelector(".lightbox-inner").innerHTML = "";
  document.body.style.overflow = "";
  document.removeEventListener("keydown", escCloseOnce);
}
window.closeLightbox = closeLightbox;

/* =========================
   LOAD CATALOG INVENTORY (REAL-TIME)
========================= */
function listenToCatalog(businessId) {
  const grid = document.getElementById("inventory-grid");
  if (!grid) return;

  if (unsubInventory) unsubInventory();

  const invRef = collection(db, "businesses", businessId, "inventory");
  unsubInventory = onSnapshot(
    invRef,
    (snap) => {
      lastInventorySnapshot = snap;
      renderInventoryGrid(snap);
    },
    (err) => {
      console.error("Error loading catalog:", err);
      grid.innerHTML = `<p class="col-span-full text-center text-red-500 py-6">Failed to load equipment catalog.</p>`;
    }
  );
}

// Renders the equipment grid from the latest inventory snapshot, honoring
// the owner's "Show Inventory Catalog" / "Show Live Availability" toggles.
function renderInventoryGrid(snap) {
  const grid = document.getElementById("inventory-grid");
  const countEl = document.getElementById("inventory-count");
  if (!grid) return;

  if (!showInventoryGlobal) {
    // Section itself is hidden (see renderProfile), nothing to build.
    grid.innerHTML = "";
    return;
  }

  if (snap.empty) {
    grid.innerHTML = `<p class="col-span-full text-center text-slate-400 py-10">No equipment listed in the catalog yet.</p>`;
    if (countEl) countEl.textContent = "0 items";
    return;
  }

  let itemCount = 0;
  let itemsHtml = "";

  snap.forEach((docSnap) => {
    itemCount++;
    const item = docSnap.data();
    const availableQty = Number(item.availableQuantity ?? item.quantity ?? 0);
    const totalQty = Number(item.totalQuantity ?? item.quantity ?? availableQty);
    const isAvailable = availableQty > 0;

    // Without "Show Live Availability", visitors see only name & price —
    // no stock counts, no booked/available status pill.
    const statusHtml = showAvailabilityGlobal
      ? `<span class="status-pill ${isAvailable ? "status-available" : "status-booked"}">
           ${isAvailable ? `${availableQty} left` : "Booked out"}
         </span>`
      : "";
    const stockLine = showAvailabilityGlobal
      ? `<p class="text-slate-400 text-xs">Total stock: ${totalQty}</p>`
      : "";
    const cardStateClass = showAvailabilityGlobal ? (isAvailable ? "is-available" : "is-booked") : "";

    itemsHtml += `
      <div class="equipment-card ${cardStateClass}">
        <div class="equipment-card-body">
          <div class="flex justify-between items-start gap-3 mb-1.5">
            <h3 class="font-semibold text-slate-900 text-base leading-snug">${escapeHtml(item.name || "Unnamed Equipment")}</h3>
            ${statusHtml}
          </div>
          ${stockLine}
        </div>
        <div class="equipment-card-footer">
          <div>
            <span class="text-lg font-bold text-slate-900">₦${(Number(item.price) || 0).toLocaleString()}</span>
            <span class="text-xs text-slate-400"> / day</span>
          </div>
          ${
            waNumberGlobal
              ? `<a href="https://wa.me/${waNumberGlobal}?text=${encodeURIComponent(
                  `Hi ${businessNameGlobal}, I'm interested in renting the ${item.name || "item"}`
                )}" target="_blank" rel="noopener noreferrer" class="equipment-inquire-btn">Inquire</a>`
              : ""
          }
        </div>
      </div>`;
  });

  grid.innerHTML = itemsHtml;
  if (countEl) countEl.textContent = `${itemCount} item${itemCount === 1 ? "" : "s"}`;
}

/* =========================
   RATINGS & REVIEWS (built from scratch)
========================= */
function renderRatingSummary(businessData) {
  const ratingCount = Number(businessData.ratingCount || 0);
  const ratingSum = Number(businessData.ratingSum || 0);
  const avg = ratingCount > 0 ? ratingSum / ratingCount : 0;

  const avgEl = document.getElementById("rating-average");
  const countEl = document.getElementById("rating-count");
  const starsEl = document.getElementById("rating-average-stars");

  if (avgEl) avgEl.textContent = ratingCount > 0 ? avg.toFixed(1) : "—";
  if (countEl) countEl.textContent = ratingCount === 0 ? "No reviews yet" : `${ratingCount} review${ratingCount === 1 ? "" : "s"}`;
  if (starsEl) starsEl.innerHTML = starIconsHtml(avg);
}

function listenToReviews(businessId) {
  const listEl = document.getElementById("reviews-list");
  const distEl = document.getElementById("rating-distribution");
  if (!listEl) return;

  if (unsubReviews) unsubReviews();

  const reviewsRef = collection(db, "businesses", businessId, "reviews");
  const q = query(reviewsRef, orderBy("createdAt", "desc"), limit(25));

  unsubReviews = onSnapshot(
    q,
    (snap) => {
      if (snap.empty) {
        listEl.innerHTML = `<p class="text-sm text-slate-400 py-4">Be the first to leave a review for this store.</p>`;
        if (distEl) distEl.innerHTML = "";
        return;
      }

      const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
      let rows = "";
      snap.forEach((docSnap) => {
        const r = docSnap.data();
        const stars = Math.min(5, Math.max(1, Number(r.rating) || 0));
        if (counts[stars] !== undefined) counts[stars]++;
        const when = r.createdAt && r.createdAt.toDate ? r.createdAt.toDate() : null;
        rows += `
          <div class="review-row">
            <div class="flex items-center justify-between gap-2 mb-1">
              <span class="font-semibold text-sm text-slate-900">${escapeHtml(r.name || "Anonymous")}</span>
              <span class="text-xs text-slate-400">${when ? when.toLocaleDateString() : ""}</span>
            </div>
            <div class="mb-1.5">${starIconsHtml(stars)}</div>
            ${r.comment ? `<p class="text-sm text-slate-600 leading-relaxed">${escapeHtml(r.comment)}</p>` : ""}
          </div>`;
      });
      listEl.innerHTML = rows;

      if (distEl) {
        const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
        distEl.innerHTML = [5, 4, 3, 2, 1]
          .map((star) => {
            const pct = Math.round((counts[star] / total) * 100);
            return `
              <div class="dist-row">
                <span class="dist-label">${star}★</span>
                <div class="dist-track"><div class="dist-fill" style="width:${pct}%"></div></div>
                <span class="dist-count">${counts[star]}</span>
              </div>`;
          })
          .join("");
      }

      refreshIcons();
    },
    (err) => {
      console.error("Error loading reviews:", err);
      listEl.innerHTML = `<p class="text-sm text-red-500 py-4">Failed to load reviews.</p>`;
    }
  );
}

function starIconsHtml(value) {
  const rounded = Math.round(value);
  let html = "";
  for (let i = 1; i <= 5; i++) {
    html += `<i data-lucide="star" class="w-4 h-4 inline-block ${i <= rounded ? "star-filled" : "star-empty"}"></i>`;
  }
  return html;
}

function wireReviewForm(businessId) {
  const form = document.getElementById("review-form");
  if (!form) return;

  const nameInput = document.getElementById("review-name");
  const commentInput = document.getElementById("review-comment");
  const stars = Array.from(document.querySelectorAll(".rating-input-star"));
  const submitBtn = document.getElementById("review-submit");
  let selectedRating = 0;

  stars.forEach((star) => {
    star.addEventListener("click", () => {
      selectedRating = Number(star.dataset.value);
      stars.forEach((s) => s.classList.toggle("star-filled", Number(s.dataset.value) <= selectedRating));
      stars.forEach((s) => s.classList.toggle("star-empty", Number(s.dataset.value) > selectedRating));
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (selectedRating < 1) {
      alert("Please select a star rating before submitting.");
      return;
    }
    const name = (nameInput?.value || "").trim() || "Anonymous";
    const comment = (commentInput?.value || "").trim();

    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";

    try {
      await addDoc(collection(db, "businesses", businessId, "reviews"), {
        name,
        rating: selectedRating,
        comment,
        createdAt: serverTimestamp()
      });

      // Atomically keep the aggregate rating on the business doc in sync.
      // (A Cloud Function trigger on review create/delete is the more
      // robust long-term approach — same pattern you're using for the
      // sitemap on googleIndexed — but this transaction keeps things
      // correct in the meantime.)
      const businessRef = doc(db, "businesses", businessId);
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(businessRef);
        const data = snap.data() || {};
        const newSum = Number(data.ratingSum || 0) + selectedRating;
        const newCount = Number(data.ratingCount || 0) + 1;
        tx.update(businessRef, { ratingSum: newSum, ratingCount: newCount });
      });

      form.reset();
      selectedRating = 0;
      stars.forEach((s) => {
        s.classList.remove("star-filled");
        s.classList.add("star-empty");
      });
      submitBtn.textContent = "Review submitted ✓";
      setTimeout(() => {
        submitBtn.textContent = "Submit review";
        submitBtn.disabled = false;
      }, 1800);
    } catch (err) {
      console.error("Review submit error:", err);
      alert("Failed to submit review: " + err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit review";
    }
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* =========================
   ERROR DISPLAY CONTROLLER
========================= */
function showError(title, message) {
  if (loader) loader.classList.add("hidden");
  if (storefrontContent) storefrontContent.classList.add("hidden");

  if (unsubBusiness) unsubBusiness();
  if (unsubInventory) unsubInventory();
  if (unsubReviews) unsubReviews();

  if (errorView) {
    errorView.classList.remove("hidden");
    const titleEl = errorView.querySelector("h2");
    const msgEl = errorView.querySelector("p");
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
