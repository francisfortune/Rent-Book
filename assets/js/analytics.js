// assets/js/analytics.js
// ============================================================================
// Full analytics page for Tracknrent.
//
// Three tabs share this file:
//   1. All Revenue        → combines customers + rental partners for the range
//   2. Customers          → reads businesses/{id}/bookings
//   3. Rental Partners    → reads businesses/{id}/externalRentals (batch docs only)
//
// One shared range picker (above the tabs) controls all three.
// All aggregation lives in analytics-service.js. This file only renders.
// ============================================================================

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getBusinessIdByEmail } from "./shared.js";
import {
  getFullAnalytics,
  buildRange,
  getMonthlyRevenue,
  getRentalPartnerAnalytics,
  getMonthlyLentOutRevenue
} from "./services/analytics-service.js";

/* =========================
   MODULE STATE
========================= */
let currentBusinessId = null;

// Shared range state — applies to ALL three tabs
let currentPreset = "this_month";
let currentMonthKey = null; // "2026-08" when a specific month is picked

// Chart instances
let allRevenueChart = null;
let revenueChart = null;
let partnerChart = null;

// Partner tab lazily loads
let partnerLoaded = false;
let partnerLoading = false;

// const MONTHS_BACK = 24;

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

function sinceLabel(daysSince) {
  if (daysSince === null || daysSince === undefined) return "Unknown";
  if (daysSince <= 0) return "Today";
  if (daysSince === 1) return "1 day ago";
  return `${daysSince} days ago`;
}

function buildMonthRange(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const from = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const to = new Date(y, m, 0, 23, 59, 59, 999);
  return { from, to };
}

function monthLabel(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-NG", {
    month: "long",
    year: "numeric"
  });
}

/** Resolve the currently-selected range into {from, to}. */
function resolveRange() {
  if (currentMonthKey) return buildMonthRange(currentMonthKey);
  return buildRange(currentPreset);
}

/** Pretty label for the active range. */
function activeRangeLabel() {
  if (currentMonthKey) return monthLabel(currentMonthKey);
  const map = {
    this_month: "this month",
    this_week: "this week",
    this_year: "this year",
    all_time: "all time"
  };
  return map[currentPreset] || currentPreset;
}

/* ============================================================================
   ALL REVENUE TAB
============================================================================ */

function renderAllRevenueHeader(custData, partnerData) {
  const custRev = Number(custData.revenue.totalRevenue || 0);
  const partRev = Number(partnerData.revenue.totalRevenue || 0);
  const total = custRev + partRev;

  setText("allTotalRevenue", money(total));

  const sub = document.getElementById("allRevenueSub");
  if (sub) {
    const bCount = custData.revenue.bookingCount || 0;
    const batchCount = partnerData.revenue.batchCount || 0;
    sub.textContent = `${number(bCount)} booking${bCount === 1 ? "" : "s"} · ${number(batchCount)} lent-out batch${batchCount === 1 ? "" : "es"} · ${activeRangeLabel()}`;
  }

  const custPct = total > 0 ? (custRev / total) * 100 : 0;
  const partPct = total > 0 ? (partRev / total) * 100 : 0;

  const segCust = document.getElementById("splitSegCustomers");
  const segPart = document.getElementById("splitSegPartners");
  const segEmpty = document.getElementById("splitSegEmpty");

  if (total > 0) {
    segCust.style.width = `${custPct}%`;
    segPart.style.width = `${partPct}%`;
    segEmpty.style.width = `0%`;
  } else {
    segCust.style.width = `0%`;
    segPart.style.width = `0%`;
    segEmpty.style.width = `100%`;
  }

  setText("splitCustomersValue", money(custRev));
  setText("splitPartnersValue", money(partRev));
  setText("splitCustomersPct", `${custPct.toFixed(0)}%`);
  setText("splitPartnersPct", `${partPct.toFixed(0)}%`);
}

function renderAllRevenueSnapshot(custData, partnerData) {
  const custRev = Number(custData.revenue.totalRevenue || 0);
  const partRev = Number(partnerData.revenue.totalRevenue || 0);
  const total = custRev + partRev;

  setText("allSnapTotal", money(total));
  const bCount = custData.revenue.bookingCount || 0;
  const batchCount = partnerData.revenue.batchCount || 0;
  setText("allSnapTotalHint", `${number(bCount)} bookings · ${number(batchCount)} batches`);

  const custOwed = Number(custData.snapshot.owedTotal || 0);
  const partOwed = Number(partnerData.snapshot.owedTotal || 0);
  const totalOwed = custOwed + partOwed;
  setText("allSnapOwed", money(totalOwed));
  setText("allSnapOwedHint", `${money(custOwed)} from clients · ${money(partOwed)} from partners`);

  const custOverdue = Number(custData.snapshot.overdue || 0);
  const partOverdue = Number(partnerData.snapshot.overdue || 0);
  const totalOverdue = custOverdue + partOverdue;
  setText("allSnapOverdue", number(totalOverdue));
  setText("allSnapOverdueHint", `${number(custOverdue)} client · ${number(partOverdue)} partner`);

  const custDmg = Number(custData.damageReport.totalDamageAmount || 0);
  const partDmg = Number(partnerData.damageReport.totalDamageAmount || 0);
  const totalDmg = custDmg + partDmg;
  setText("allSnapDamages", money(totalDmg));
  setText("allSnapDamagesHint", `${money(custDmg)} clients · ${money(partDmg)} partners`);
}

/**
 * FIX #3 — Freeze "now" once and feed the SAME anchorDate to both monthly
 * fetchers, so a midnight rollover between the two awaits can't misalign
 * the stacked chart's labels.
 */
async function renderAllRevenueChart() {
  const canvas = document.getElementById("allRevenueChart");
  if (!canvas) return;
  if (!window.Chart) {
    console.warn("[Analytics] Chart.js not loaded — skipping all-revenue chart");
    return;
  }

  const anchor = new Date();

  const [custMonthly, partMonthly] = await Promise.all([
    getMonthlyRevenue(currentBusinessId, { months: 12, anchorDate: anchor }),
    getMonthlyLentOutRevenue(currentBusinessId, { months: 12, anchorDate: anchor })
  ]);

  const labels = custMonthly.map(m => m.label);
  const custValues = custMonthly.map(m => m.revenue);
  const partValues = partMonthly.map(m => m.revenue);

  if (allRevenueChart) {
    allRevenueChart.data.labels = labels;
    allRevenueChart.data.datasets[0].data = custValues;
    allRevenueChart.data.datasets[1].data = partValues;
    allRevenueChart.update();
    return;
  }

  allRevenueChart = new window.Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Customers",
          data: custValues,
          backgroundColor: "#800080",
          borderRadius: 4,
          maxBarThickness: 40,
          stack: "rev"
        },
        {
          label: "Rental partners",
          data: partValues,
          backgroundColor: "#16a34a",
          borderRadius: 4,
          maxBarThickness: 40,
          stack: "rev"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: "top",
          labels: {
            boxWidth: 12,
            boxHeight: 12,
            font: { weight: "700", size: 12 }
          }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ₦${Number(ctx.parsed.y).toLocaleString("en-NG")}`,
            footer: (items) => {
              const sum = items.reduce((s, i) => s + Number(i.parsed.y || 0), 0);
              return `Total: ₦${sum.toLocaleString("en-NG")}`;
            }
          }
        }
      },
      scales: {
        x: { stacked: true },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: { callback: (v) => `₦${Number(v).toLocaleString("en-NG")}` }
        }
      }
    }
  });
}

async function loadAllRevenueData() {
  if (!currentBusinessId) return;

  setText("allTotalRevenue", "…");

  const range = resolveRange();

  try {
    const [custData, partnerData] = await Promise.all([
      getFullAnalytics(currentBusinessId, range),
      getRentalPartnerAnalytics(currentBusinessId, range)
    ]);

    renderAllRevenueHeader(custData, partnerData);
    renderAllRevenueSnapshot(custData, partnerData);
    await renderAllRevenueChart();

    console.log(`[Analytics] ✅ All Revenue rendered for ${activeRangeLabel()}`);
  } catch (err) {
    console.error("[Analytics] All Revenue failed to load:", err);
    setText("allTotalRevenue", "—");
  }
}

window.loadAllRevenueAnalytics = function () {
  if (!currentBusinessId) return;
  loadAllRevenueData();
};

/* ============================================================================
   CUSTOMERS TAB
============================================================================ */

function renderMoneyHeader(data) {
  const { totalRevenue, previousRevenue, changePct, bookingCount } = data.revenue;

  setText("bigRevenue", money(totalRevenue));

  const header = document.getElementById("bigRevenueHeader");
  if (!header) return;

  if (changePct === null || previousRevenue === 0) {
    header.innerHTML = `<span style="opacity:.7;">${number(bookingCount)} bookings · no comparison available</span>`;
  } else if (changePct >= 0) {
    header.innerHTML = `
      <span style="color:#059669;font-weight:800;">↑ ${changePct.toFixed(1)}%</span>
      <span style="opacity:.75;"> vs previous period (${money(previousRevenue)})</span>`;
  } else {
    header.innerHTML = `
      <span style="color:#dc2626;font-weight:800;">↓ ${Math.abs(changePct).toFixed(1)}%</span>
      <span style="opacity:.75;"> vs previous period (${money(previousRevenue)})</span>`;
  }
}

function renderSnapshot(data) {
  const s = data.snapshot;
  setText("snapBookings", number(s.bookingCount));
  setText("snapReturned", number(s.returned));
  setText("snapOwed", money(s.owedTotal));
  setText("snapOverdue", number(s.overdue));
  setText("snapDamages", money(s.damagesTotal));
}

function renderOutstanding(list) {
  const tbody = document.getElementById("outstandingTableBody");
  const totalEl = document.getElementById("outstandingTotal");
  const countEl = document.getElementById("outstandingCount");

  if (countEl) countEl.textContent = `${list.length}`;
  const total = list.reduce((s, c) => s + c.totalOwed, 0);
  if (totalEl) totalEl.textContent = `Total outstanding: ${money(total)}`;

  if (!tbody) return;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:24px;color:#9ca3af;">🎉 No outstanding balances</td></tr>`;
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
      <tr>
        <td style="font-weight:600;">${escapeHtml(c.name)}</td>
        <td style="font-weight:800;color:#dc2626;">${money(c.totalOwed)}</td>
        <td style="color:#6b7280;font-size:13px;">${sinceLabel(c.daysSince)}</td>
        <td style="text-align:right;">
          ${waLink
            ? `<a href="${waLink}" target="_blank" rel="noopener"
                 style="display:inline-block;padding:6px 12px;font-size:12px;font-weight:700;border-radius:8px;background:#dcfce7;color:#15803d;text-decoration:none;">
                 Remind
               </a>`
            : `<span style="font-size:12px;color:#9ca3af;">No phone</span>`}
        </td>
      </tr>`;
  }).join("");
}

function renderBestCustomers(list) {
  const tbody = document.getElementById("bestCustomersTableBody");
  if (!tbody) return;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:24px;color:#9ca3af;">No customers yet in this period</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map((c, i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "";
    return `
      <tr>
        <td style="font-weight:600;">
          ${escapeHtml(c.name)}${medal ? ` <span style="margin-left:6px;">${medal}</span>` : ""}
        </td>
        <td style="font-size:13px;color:#6b7280;">${escapeHtml(c.phone || "—")}</td>
        <td style="font-size:13px;color:#6b7280;">${number(c.bookingCount)} booking${c.bookingCount === 1 ? "" : "s"}</td>
        <td style="font-weight:800;text-align:right;">${money(c.totalSpent)}</td>
      </tr>`;
  }).join("");
}

function renderTopItems(list) {
  const tbody = document.getElementById("topItemsTableBody");
  if (!tbody) return;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:24px;color:#9ca3af;">No items rented in this period</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map((it, i) => {
    const badge = i === 0
      ? `<span style="margin-left:8px;font-size:10px;font-weight:900;text-transform:uppercase;color:#7c3aed;">⭐ Best earner</span>`
      : "";
    return `
      <tr>
        <td style="font-weight:600;">${escapeHtml(it.name)}${badge}</td>
        <td style="font-size:13px;color:#6b7280;">${number(it.unitsRented)} units</td>
        <td style="font-size:13px;color:#6b7280;">${number(it.timesBooked)} booking${it.timesBooked === 1 ? "" : "s"}</td>
        <td style="font-weight:800;text-align:right;">${money(it.revenue)}</td>
      </tr>`;
  }).join("");
}

function renderDamages(data) {
  const d = data.damageReport;

  setText("damageTotal", money(d.totalDamageAmount));
  setText("damageRate", `${d.damageRatePct.toFixed(2)}%`);
  setText("damageCautionKept", money(d.totalCautionKept));

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
      itemBody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:16px;color:#9ca3af;">No damages recorded</td></tr>`;
    } else {
      itemBody.innerHTML = d.byItem.slice(0, 10).map(it => `
        <tr>
          <td style="font-weight:600;">${escapeHtml(it.name)}</td>
          <td style="font-size:13px;color:#6b7280;">${number(it.timesDamaged)}</td>
          <td style="font-size:13px;color:#6b7280;">${number(it.unitsLost)}</td>
          <td style="font-weight:800;color:#dc2626;text-align:right;">${money(it.amount)}</td>
        </tr>`).join("");
    }
  }

  const clientBody = document.getElementById("damageByClientTableBody");
  if (clientBody) {
    if (!d.byClient.length) {
      clientBody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:16px;color:#9ca3af;">No damages recorded</td></tr>`;
    } else {
      clientBody.innerHTML = d.byClient.slice(0, 10).map(c => `
        <tr>
          <td style="font-weight:600;">${escapeHtml(c.name)}</td>
          <td style="font-size:13px;color:#6b7280;">${number(c.timesDamaged)}</td>
          <td style="font-weight:800;color:#dc2626;text-align:right;">${money(c.amount)}</td>
        </tr>`).join("");
    }
  }
}

async function renderRevenueChart(businessId) {
  const canvas = document.getElementById("revenueChart");
  if (!canvas) return;

  const monthly = await getMonthlyRevenue(businessId, { months: 12 });
  const labels = monthly.map(m => m.label);
  const values = monthly.map(m => m.revenue);

  if (revenueChart) {
    revenueChart.data.labels = labels;
    revenueChart.data.datasets[0].data = values;
    revenueChart.update();
    return;
  }

  if (!window.Chart) return;

  revenueChart = new window.Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Customer revenue (₦)",
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
          ticks: { callback: (v) => `₦${Number(v).toLocaleString("en-NG")}` }
        }
      }
    }
  });
}

async function loadCustomersData() {
  if (!currentBusinessId) return;

  setText("bigRevenue", "…");

  const range = resolveRange();

  try {
    const data = await getFullAnalytics(currentBusinessId, range);

    renderMoneyHeader(data);
    renderSnapshot(data);
    renderOutstanding(data.outstandingByClient);
    renderBestCustomers(data.bestCustomers);
    renderTopItems(data.topItems);
    renderDamages(data);

    await renderRevenueChart(currentBusinessId);

    console.log(`[Analytics] ✅ Customers rendered for ${activeRangeLabel()}`);
  } catch (err) {
    console.error("[Analytics] Customers failed to load:", err);
    setText("bigRevenue", "—");
  }
}

/* ============================================================================
   RENTAL PARTNERS TAB
============================================================================ */

function renderPartnerMoneyHeader(data) {
  const { totalRevenue, previousRevenue, changePct, batchCount } = data.revenue;

  setText("partnerBigRevenue", money(totalRevenue));

  const header = document.getElementById("partnerBigRevenueHeader");
  if (!header) return;

  if (changePct === null || previousRevenue === 0) {
    header.innerHTML = `<span style="opacity:.85;">${number(batchCount)} batch${batchCount === 1 ? "" : "es"} · no comparison available</span>`;
  } else if (changePct >= 0) {
    header.innerHTML = `
      <span style="color:#bbf7d0;font-weight:800;">↑ ${changePct.toFixed(1)}%</span>
      <span style="opacity:.85;"> vs previous period (${money(previousRevenue)})</span>`;
  } else {
    header.innerHTML = `
      <span style="color:#fecaca;font-weight:800;">↓ ${Math.abs(changePct).toFixed(1)}%</span>
      <span style="opacity:.85;"> vs previous period (${money(previousRevenue)})</span>`;
  }
}

function renderPartnerSnapshot(data) {
  const s = data.snapshot;
  setText("partnerSnapBatches", number(s.batchCount));
  setText("partnerSnapReturned", number(s.returned));
  setText("partnerSnapOwed", money(s.owedTotal));
  setText("partnerSnapOverdue", number(s.overdue));
  setText("partnerSnapDamages", money(s.damagesTotal));
}

function renderPartnerOutstanding(list) {
  const tbody = document.getElementById("partnerOutstandingTableBody");
  const totalEl = document.getElementById("partnerOutstandingTotal");
  const countEl = document.getElementById("partnerOutstandingCount");

  if (countEl) countEl.textContent = `${list.length}`;
  const total = list.reduce((s, c) => s + c.totalOwed, 0);
  if (totalEl) totalEl.textContent = `Total outstanding: ${money(total)}`;

  if (!tbody) return;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:24px;color:#9ca3af;">🎉 No outstanding balances</td></tr>`;
    return;
  }

  tbody.innerHTML = list.slice(0, 15).map(c => {
    const phoneClean = String(c.phone || "").replace(/\D/g, "");
    const waLink = phoneClean
      ? `https://wa.me/${phoneClean}?text=${encodeURIComponent(
          `Hi ${c.name}, hope you're well! Just a friendly reminder — ${money(c.totalOwed)} outstanding on your lent-out batch(es). Let me know when convenient. Thanks!`
        )}`
      : "";
    return `
      <tr>
        <td style="font-weight:600;">${escapeHtml(c.name)}</td>
        <td style="font-weight:800;color:#dc2626;">${money(c.totalOwed)}</td>
        <td style="color:#6b7280;font-size:13px;">${sinceLabel(c.daysSince)}</td>
        <td style="text-align:right;">
          ${waLink
            ? `<a href="${waLink}" target="_blank" rel="noopener"
                 style="display:inline-block;padding:6px 12px;font-size:12px;font-weight:700;border-radius:8px;background:#dcfce7;color:#15803d;text-decoration:none;">
                 Remind
               </a>`
            : `<span style="font-size:12px;color:#9ca3af;">No phone</span>`}
        </td>
      </tr>`;
  }).join("");
}

function renderPartnerBest(list) {
  const tbody = document.getElementById("partnerBestTableBody");
  if (!tbody) return;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:24px;color:#9ca3af;">No partners yet in this period</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map((c, i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "";
    return `
      <tr>
        <td style="font-weight:600;">
          ${escapeHtml(c.name)}${medal ? ` <span style="margin-left:6px;">${medal}</span>` : ""}
        </td>
        <td style="font-size:13px;color:#6b7280;">${escapeHtml(c.phone || "—")}</td>
        <td style="font-size:13px;color:#6b7280;">${number(c.batchCount)} batch${c.batchCount === 1 ? "" : "es"}</td>
        <td style="font-weight:800;text-align:right;">${money(c.totalSpent)}</td>
      </tr>`;
  }).join("");
}

function renderPartnerTopItems(list) {
  const tbody = document.getElementById("partnerTopItemsTableBody");
  if (!tbody) return;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:24px;color:#9ca3af;">No items lent out in this period</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map((it, i) => {
    const badge = i === 0
      ? `<span style="margin-left:8px;font-size:10px;font-weight:900;text-transform:uppercase;color:#7c3aed;">⭐ Top earner</span>`
      : "";
    return `
      <tr>
        <td style="font-weight:600;">${escapeHtml(it.name)}${badge}</td>
        <td style="font-size:13px;color:#6b7280;">${number(it.unitsLent)} units</td>
        <td style="font-size:13px;color:#6b7280;">${number(it.timesLent)} batch${it.timesLent === 1 ? "" : "es"}</td>
        <td style="font-weight:800;text-align:right;">${money(it.revenue)}</td>
      </tr>`;
  }).join("");
}

function renderPartnerDamages(data) {
  const d = data.damageReport;
  setText("partnerDamageTotal", money(d.totalDamageAmount));
  setText("partnerDamageRate", `${d.damageRatePct.toFixed(2)}%`);

  const itemBody = document.getElementById("partnerDamageByItemTableBody");
  if (itemBody) {
    if (!d.byItem.length) {
      itemBody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:16px;color:#9ca3af;">No damages recorded</td></tr>`;
    } else {
      itemBody.innerHTML = d.byItem.slice(0, 10).map(it => `
        <tr>
          <td style="font-weight:600;">${escapeHtml(it.name)}</td>
          <td style="font-size:13px;color:#6b7280;">${number(it.timesDamaged)}</td>
          <td style="font-size:13px;color:#6b7280;">${number(it.unitsLost)}</td>
          <td style="font-weight:800;color:#dc2626;text-align:right;">${money(it.amount)}</td>
        </tr>`).join("");
    }
  }

  const partnerBody = document.getElementById("partnerDamageByPartnerTableBody");
  if (partnerBody) {
    if (!d.byPartner.length) {
      partnerBody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:16px;color:#9ca3af;">No damages recorded</td></tr>`;
    } else {
      partnerBody.innerHTML = d.byPartner.slice(0, 10).map(c => `
        <tr>
          <td style="font-weight:600;">${escapeHtml(c.name)}</td>
          <td style="font-size:13px;color:#6b7280;">${number(c.timesDamaged)}</td>
          <td style="font-weight:800;color:#dc2626;text-align:right;">${money(c.amount)}</td>
        </tr>`).join("");
    }
  }
}

async function renderPartnerChart() {
  const canvas = document.getElementById("partnerRevenueChart");
  if (!canvas) return;
  if (!window.Chart) return;

  const monthly = await getMonthlyLentOutRevenue(currentBusinessId, { months: 12 });
  const labels = monthly.map(m => m.label);
  const values = monthly.map(m => m.revenue);

  if (partnerChart) {
    partnerChart.data.labels = labels;
    partnerChart.data.datasets[0].data = values;
    partnerChart.update();
    return;
  }

  partnerChart = new window.Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Lent-out revenue (₦)",
        data: values,
        backgroundColor: "#16a34a",
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
          ticks: { callback: (v) => `₦${Number(v).toLocaleString("en-NG")}` }
        }
      }
    }
  });
}

async function loadPartnerData() {
  if (!currentBusinessId) return;
  if (partnerLoading) return;
  partnerLoading = true;

  setText("partnerBigRevenue", "…");

  const range = resolveRange();

  try {
    const data = await getRentalPartnerAnalytics(currentBusinessId, range);

    renderPartnerMoneyHeader(data);
    renderPartnerSnapshot(data);
    renderPartnerOutstanding(data.outstandingByPartner);
    renderPartnerBest(data.bestPartners);
    renderPartnerTopItems(data.topItems);
    renderPartnerDamages(data);
    await renderPartnerChart();

    partnerLoaded = true;
    console.log(`[Analytics] ✅ Partners rendered for ${activeRangeLabel()}`);
  } catch (err) {
    console.error("[Analytics] Partners failed to load:", err);
    setText("partnerBigRevenue", "—");
  } finally {
    partnerLoading = false;
  }
}

window.loadPartnerAnalytics = function () {
  if (!currentBusinessId) return;
  loadPartnerData();
};

/* ============================================================================
   SHARED RANGE CONTROLS
============================================================================ */

function reloadActiveTab() {
  const all = document.getElementById("allPanel");
  const customers = document.getElementById("customersPanel");
  const partners = document.getElementById("partnersPanel");

  if (all && all.style.display !== "none") loadAllRevenueData();
  else if (customers && customers.style.display !== "none") loadCustomersData();
  else if (partners && partners.style.display !== "none") loadPartnerData();
}

function wireRangeButtons() {
  const buttons = document.querySelectorAll(".range-buttons [data-preset]");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      currentMonthKey = null;
      const picker = document.getElementById("monthPicker");
      if (picker) picker.value = "";

      currentPreset = btn.dataset.preset;
      buttons.forEach(b => {
        b.classList.toggle("range-btn-active", b.dataset.preset === currentPreset);
      });

      reloadActiveTab();
    });
  });
}






// Your app's launch month — the dropdown will NEVER go earlier than this.
const EARLIEST_MONTH_KEY = "2025-09";

function wireMonthPicker() {
  const select = document.getElementById("monthPicker");
  if (!select) return;

  // Preserve the placeholder option that's already in the HTML
  const placeholder = select.querySelector('option[value=""]');
  select.innerHTML = "";
  if (placeholder) {
    select.appendChild(placeholder);
  } else {
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = "— Pick a month —";
    select.appendChild(ph);
  }

  const [minY, minM] = EARLIEST_MONTH_KEY.split("-").map(Number);

  // ─────────────────────────────────────────────────────────────
  // Walk backward from the current month, collecting {year, key,
  // label} until we hit December 2025. Then group by year and emit
  // <optgroup> per year, newest year first, newest month first.
  // ─────────────────────────────────────────────────────────────
  const today = new Date();
  const monthsByYear = {}; // { "2026": [ {key, label}, ... ], ... }

  for (let i = 0; ; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);

    // Boundary checks — stop before going earlier than Dec 2025.
    if (d.getFullYear() < minY) break;
    if (d.getFullYear() === minY && d.getMonth() < minM - 1) break;

    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const year = String(d.getFullYear());

    if (!monthsByYear[year]) monthsByYear[year] = [];
    monthsByYear[year].push({ key, label: monthLabel(key) });
  }

  // Emit one <optgroup> per year, newest year first. Within each group,
  // months are already in newest-first order because we built the array
  // by walking backward.
  Object.keys(monthsByYear)
    .sort((a, b) => Number(b) - Number(a)) // 2026 before 2025
    .forEach(year => {
      const group = document.createElement("optgroup");
      group.label = year;
      monthsByYear[year].forEach(({ key, label }) => {
        const opt = document.createElement("option");
        opt.value = key;
        opt.textContent = label;
        group.appendChild(opt);
      });
      select.appendChild(group);
    });

  // Change handler — unchanged
  select.addEventListener("change", () => {
    const val = select.value;
    if (!val) {
      currentMonthKey = null;
      currentPreset = "this_month";
      document.querySelectorAll(".range-buttons [data-preset]").forEach(b => {
        b.classList.toggle("range-btn-active", b.dataset.preset === "this_month");
      });
      reloadActiveTab();
      return;
    }
    currentMonthKey = val;
    document.querySelectorAll(".range-buttons [data-preset]").forEach(b => {
      b.classList.remove("range-btn-active");
    });
    reloadActiveTab();
  });
}

/* ============================================================================
   BOOT
============================================================================ */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "signup.html";
    return;
  }

  try {
    currentBusinessId = await getBusinessIdByEmail(user.email, user);
  } catch (err) {
    console.error("[Analytics] Auth error:", err);
    setText("allTotalRevenue", "—");
    return;
  }

  wireRangeButtons();
  wireMonthPicker();

  await loadAllRevenueData();

  // Pre-warm the other two tabs so switching feels instant.
  loadCustomersData();
  loadPartnerData();
});