// assets/js/analytics.js
// ============================================================================
// Full analytics page for Tracknrent.
// Reads from analytics-service.js — no aggregation logic here, only rendering.
// ============================================================================

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getBusinessIdByEmail } from "./shared.js";
import { getFullAnalytics, buildRange } from "./services/analytics-service.js";

let currentBusinessId = null;
let currentPreset = "this_month"; // default
let currentMonthKey = null;       // "2026-08" when a specific month is picked
let revenueChart = null;
let lastData = null;

const MONTHS_BACK = 24;           // how far back the month picker goes

/* =========================
   FORMATTERS
========================= */
function money(n) {
  const v = Number(n || 0);
  return `₦${v.toLocaleString("en-NG")}`;
}

function number(n) {
  return Number(n || 0).toLocaleString("en-NG");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setHTML(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = value;
}

/**
 * Human-friendly "since" label. Handles null = unknown booking date.
 */
function sinceLabel(daysSince) {
  if (daysSince === null || daysSince === undefined) return "Unknown";
  if (daysSince <= 0) return "Today";
  if (daysSince === 1) return "1 day ago";
  return `${daysSince} days ago`;
}

/**
 * Build {from, to} Date objects for a specific calendar month.
 * @param {string} monthKey — "YYYY-MM"
 */
function buildMonthRange(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const from = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const to = new Date(y, m, 0, 23, 59, 59, 999); // last day of that month
  return { from, to };
}

/**
 * Human label for a month key, e.g. "2026-08" → "August 2026"
 */
function monthLabel(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-NG", {
    month: "long",
    year: "numeric"
  });
}

/* =========================
   RENDER: MONEY HEADER
========================= */
function renderMoneyHeader(data) {
  const { totalRevenue, previousRevenue, changePct, bookingCount } = data.revenue;

  setText("bigRevenue", money(totalRevenue));

  const header = document.getElementById("bigRevenueHeader");
  if (header) {
    if (changePct === null || previousRevenue === 0) {
      header.innerHTML = `<span style="opacity:.7;">${number(bookingCount)} bookings · no comparison available</span>`;
      header.style.color = "";
    } else if (changePct >= 0) {
      header.innerHTML = `
        <span style="color:#059669;font-weight:800;">↑ ${changePct.toFixed(1)}%</span>
        <span style="opacity:.75;"> vs previous period (${money(previousRevenue)})</span>`;
      header.style.color = "";
    } else {
      header.innerHTML = `
        <span style="color:#dc2626;font-weight:800;">↓ ${Math.abs(changePct).toFixed(1)}%</span>
        <span style="opacity:.75;"> vs previous period (${money(previousRevenue)})</span>`;
      header.style.color = "";
    }
  }
}

/* =========================
   RENDER: SNAPSHOT CARDS
========================= */
function renderSnapshot(data) {
  const s = data.snapshot;
  setText("snapBookings", number(s.bookingCount));
  setText("snapReturned", number(s.returned));
  setText("snapOwed", money(s.owedTotal));
  setText("snapOverdue", number(s.overdue));
  setText("snapDamages", money(s.damagesTotal));
}

/* =========================
   RENDER: OUTSTANDING BY CLIENT
========================= */
function renderOutstanding(list) {
  const tbody = document.getElementById("outstandingTableBody");
  const totalEl = document.getElementById("outstandingTotal");
  const countEl = document.getElementById("outstandingCount");

  if (countEl) countEl.textContent = `${list.length}`;
  const total = list.reduce((s, c) => s + c.totalOwed, 0);
  if (totalEl) totalEl.textContent = `Total outstanding: ${money(total)}`;

  if (!tbody) return;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center py-6 text-gray-400">🎉 No outstanding balances</td></tr>`;
    return;
  }

  tbody.innerHTML = list.slice(0, 15).map(c => {
    const phoneClean = String(c.phone || "").replace(/\D/g, "");
    const waLink = phoneClean
      ? `https://wa.me/${phoneClean}?text=${encodeURIComponent(
          `Hi ${c.name}, hope you're well! Just a friendly reminder — ${money(c.totalOwed)} outstanding on your booking(s). Let me know when convenient. Thanks!`
        )}`
      : "";
    return `
      <tr class="border-b border-gray-100 hover:bg-gray-50">
        <td class="p-3 font-medium text-gray-800">${escapeHtml(c.name)}</td>
        <td class="p-3 font-bold text-red-600">${money(c.totalOwed)}</td>
        <td class="p-3 text-gray-500 text-sm">${sinceLabel(c.daysSince)}</td>
        <td class="p-3 text-right">
          ${waLink
            ? `<a href="${waLink}" target="_blank" rel="noopener"
                 class="inline-block px-3 py-1.5 text-xs font-bold rounded-lg bg-green-100 text-green-700 hover:bg-green-200 transition">
                 Remind
               </a>`
            : `<span class="text-xs text-gray-400">No phone</span>`}
        </td>
      </tr>`;
  }).join("");
}

/* =========================
   RENDER: BEST CUSTOMERS
========================= */
function renderBestCustomers(list) {
  const tbody = document.getElementById("bestCustomersTableBody");
  if (!tbody) return;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center py-6 text-gray-400">No customers yet in this period</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map((c, i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "";
    return `
      <tr class="border-b border-gray-100 hover:bg-gray-50">
        <td class="p-3">
          <span class="font-medium text-gray-800">${escapeHtml(c.name)}</span>
          ${medal ? `<span class="ml-2">${medal}</span>` : ""}
        </td>
        <td class="p-3 text-sm text-gray-600">${escapeHtml(c.phone || "—")}</td>
        <td class="p-3 text-sm text-gray-600">${number(c.bookingCount)} booking${c.bookingCount === 1 ? "" : "s"}</td>
        <td class="p-3 font-bold text-gray-800 text-right">${money(c.totalSpent)}</td>
      </tr>`;
  }).join("");
}

/* =========================
   RENDER: TOP ITEMS
========================= */
function renderTopItems(list) {
  const tbody = document.getElementById("topItemsTableBody");
  if (!tbody) return;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center py-6 text-gray-400">No items rented in this period</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map((it, i) => {
    const badge = i === 0 ? `<span class="ml-2 text-[10px] font-black uppercase text-purple-600">⭐ Best earner</span>` : "";
    return `
      <tr class="border-b border-gray-100 hover:bg-gray-50">
        <td class="p-3 font-medium text-gray-800">
          ${escapeHtml(it.name)}${badge}
        </td>
        <td class="p-3 text-sm text-gray-600">${number(it.unitsRented)} units</td>
        <td class="p-3 text-sm text-gray-600">${number(it.timesBooked)} booking${it.timesBooked === 1 ? "" : "s"}</td>
        <td class="p-3 font-bold text-gray-800 text-right">${money(it.revenue)}</td>
      </tr>`;
  }).join("");
}

/* =========================
   RENDER: DAMAGE REPORT
========================= */
function renderDamages(data) {
  const d = data.damageReport;

  setText("damageTotal", money(d.totalDamageAmount));
  setText("damageRate", `${d.damageRatePct.toFixed(2)}%`);
  setText("damageCautionKept", money(d.totalCautionKept));
  setText("damageCautionReturned", money(d.totalCautionReturned));

  const net = d.netDamageCost;
  const netEl = document.getElementById("damageNetCost");
  if (netEl) {
    netEl.textContent = money(net);
    netEl.style.color = net > 0 ? "#dc2626" : "#059669";
  }

  const netLabel = document.getElementById("damageNetLabel");
  if (netLabel) {
    netLabel.textContent = net > 0
      ? "Out-of-pocket loss (caution fee didn't cover it)"
      : "Fully covered by caution fees";
  }

  const itemBody = document.getElementById("damageByItemTableBody");
  if (itemBody) {
    if (!d.byItem.length) {
      itemBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-gray-400">No damages recorded</td></tr>`;
    } else {
      itemBody.innerHTML = d.byItem.slice(0, 10).map(it => `
        <tr class="border-b border-gray-100">
          <td class="p-3 font-medium text-gray-800">${escapeHtml(it.name)}</td>
          <td class="p-3 text-sm text-gray-600">${number(it.timesDamaged)}</td>
          <td class="p-3 text-sm text-gray-600">${number(it.unitsLost)}</td>
          <td class="p-3 font-bold text-red-600 text-right">${money(it.amount)}</td>
        </tr>`).join("");
    }
  }

  const clientBody = document.getElementById("damageByClientTableBody");
  if (clientBody) {
    if (!d.byClient.length) {
      clientBody.innerHTML = `<tr><td colspan="3" class="text-center py-4 text-gray-400">No damages recorded</td></tr>`;
    } else {
      clientBody.innerHTML = d.byClient.slice(0, 10).map(c => `
        <tr class="border-b border-gray-100">
          <td class="p-3 font-medium text-gray-800">${escapeHtml(c.name)}</td>
          <td class="p-3 text-sm text-gray-600">${number(c.timesDamaged)}</td>
          <td class="p-3 font-bold text-red-600 text-right">${money(c.amount)}</td>
        </tr>`).join("");
    }
  }
}

/* =========================
   RENDER: REVENUE CHART
========================= */
async function renderRevenueChart(businessId) {
  const canvas = document.getElementById("revenueChart");
  if (!canvas) return;

  const { getMonthlyRevenue } = await import("./services/analytics-service.js");
  const monthly = await getMonthlyRevenue(businessId, { months: 12 });
  const labels = monthly.map(m => m.label);
  const values = monthly.map(m => m.revenue);

  if (revenueChart) {
    revenueChart.data.labels = labels;
    revenueChart.data.datasets[0].data = values;
    revenueChart.update();
    return;
  }

  if (!window.Chart) {
    console.warn("[Analytics] Chart.js not loaded — skipping chart");
    return;
  }

  revenueChart = new window.Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Revenue (₦)",
        data: values,
        backgroundColor: "#800080",
        borderRadius: 6,
        maxBarThickness: 40
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `₦${Number(ctx.parsed.y).toLocaleString("en-NG")}`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (v) => `₦${Number(v).toLocaleString("en-NG")}`
          }
        }
      }
    }
  });
}

/* =========================
   MONTH PICKER
========================= */
function buildMonthPickerOptions() {
  const now = new Date();
  const options = [];
  for (let i = 0; i < MONTHS_BACK; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    options.push({ key, label: monthLabel(key) });
  }
  return options;
}

function injectMonthPicker() {
  // Find the range-buttons container
  const rangeWrap = document.querySelector(".range-buttons");
  if (!rangeWrap) return;

  // Skip if already injected (defensive against double-boot)
  if (document.getElementById("monthPicker")) return;

  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex; align-items:center; gap:8px; margin-left:auto;";

 const label = document.createElement("span");
label.textContent = "Or pick a month:";
label.style.cssText = "font-size:12px; font-weight:700; color:white; white-space:nowrap; background:#800080; padding:8px 4px; border-radius:8px;";




const select = document.createElement("select");
  select.id = "monthPicker";
  select.style.cssText = `
    padding: 8px 14px;
    border-radius: 10px;
    border: 1px solid #e2e8f0;
    background: #fff;
    font-size: 13px;
    font-weight: 700;
    color: #6b7280;
    cursor: pointer;
    font-family: inherit;
    outline: none;
    min-width: 160px;
  `;

  // Placeholder
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "— Pick a month —";
  select.appendChild(placeholder);

  buildMonthPickerOptions().forEach(({ key, label: text }) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = text;
    select.appendChild(opt);
  });

  select.addEventListener("change", () => {
    const val = select.value;
    if (!val) {
      // User cleared the picker — go back to the default preset
      currentMonthKey = null;
      currentPreset = "this_month";
      document.querySelectorAll("[data-preset]").forEach(b => {
        b.classList.toggle("range-btn-active", b.dataset.preset === "this_month");
      });
      loadAndRender();
      return;
    }
    currentMonthKey = val;

    // Deactivate preset buttons
    document.querySelectorAll("[data-preset]").forEach(b => {
      b.classList.remove("range-btn-active");
    });

    loadAndRender();
  });

  wrap.appendChild(label);
  wrap.appendChild(select);
  rangeWrap.appendChild(wrap);

  // On narrow screens, let it wrap below the preset buttons
  rangeWrap.style.flexWrap = "wrap";
}

/* =========================
   LOAD + RENDER EVERYTHING
========================= */
async function loadAndRender() {
  if (!currentBusinessId) return;

  setText("bigRevenue", "…");

  let range;
  if (currentMonthKey) {
    range = buildMonthRange(currentMonthKey);
  } else {
    range = buildRange(currentPreset);
  }

  try {
    const data = await getFullAnalytics(currentBusinessId, range);
    lastData = data;

    renderMoneyHeader(data);
    renderSnapshot(data);
    renderOutstanding(data.outstandingByClient);
    renderBestCustomers(data.bestCustomers);
    renderTopItems(data.topItems);
    renderDamages(data);

    const periodLabel = currentMonthKey ? monthLabel(currentMonthKey) : currentPreset;
    console.log(`[Analytics] ✅ Rendered ${data.bookingCountInRange} bookings for ${periodLabel}`);
  } catch (err) {
    console.error("[Analytics] Failed to load:", err);
    setText("bigRevenue", "—");
  }
}

/* =========================
   RANGE PRESET BUTTONS
========================= */
function wireRangeButtons() {
  const buttons = document.querySelectorAll("[data-preset]");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      const preset = btn.dataset.preset;

      // Any preset click clears the month picker
      currentMonthKey = null;
      const picker = document.getElementById("monthPicker");
      if (picker) picker.value = "";

      if (preset === currentPreset) {
        // Still ensure styling is right, then reload if user had a month active
        buttons.forEach(b => b.classList.toggle("range-btn-active", b.dataset.preset === preset));
        loadAndRender();
        return;
      }

      currentPreset = preset;
      buttons.forEach(b => {
        b.classList.toggle("range-btn-active", b.dataset.preset === preset);
      });

      loadAndRender();
    });
  });
}

/* =========================
   BOOT
========================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "signup.html";
    return;
  }

  try {
    currentBusinessId = await getBusinessIdByEmail(user.email, user);
  } catch (err) {
    console.error("[Analytics] Auth error:", err);
    setText("bigRevenue", "—");
    return;
  }

  // Render chart once (it fetches its own 12-month data)
  await renderRevenueChart(currentBusinessId);

  // Inject the month picker into the range-buttons row
  injectMonthPicker();

  // Load everything for the default preset
  wireRangeButtons();
  await loadAndRender();
});