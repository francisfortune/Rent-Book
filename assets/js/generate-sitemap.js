/**
 * generate-sitemap.js
 * ---------------------------------------------------------------------
 * Generates /public/sitemap.xml for Tracknrent from live Firestore data.
 *
 * Includes:
 *   - A handful of static marketing/marketplace pages
 *   - One <url> per business whose storefront is public
 *       (publicProfile.enabled === true AND a slug is set)
 *
 * WHY A SCRIPT (not a client-side page):
 *   Search engines expect a static sitemap.xml at the site root. Building
 *   it client-side (like profile-viewer.js does for a single storefront)
 *   would mean crawlers only see it if they execute JS, which many don't
 *   for sitemap discovery. This script runs with the Firebase Admin SDK
 *   (server-side, full read access, no Security Rules involved) and
 *   writes a plain XML file you commit/deploy alongside your static site.
 *
 * USAGE
 *   1. npm install firebase-admin
 *   2. Put your Firebase service account JSON somewhere safe, e.g.
 *      ./serviceAccountKey.json (DO NOT commit this file).
 *   3. Run:
 *        node scripts/generate-sitemap.js
 *      Optionally override the site URL:
 *        SITE_URL=https://your-domain.com node scripts/generate-sitemap.js
 *
 * AUTOMATING IT
 *   - Simplest: run it locally/in CI right before your Vercel deploy step
 *     (e.g. a `prebuild` npm script), so sitemap.xml is always fresh in
 *     the output that gets deployed.
 *   - Alternative: turn this into a scheduled Cloud Function
 *     (functions.pubsub.schedule('every 24 hours')) that writes the file
 *     to Cloud Storage or calls the Vercel deploy hook — ask if you'd
 *     like that version instead of the CLI script.
 * ---------------------------------------------------------------------
 */

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const SITE_URL = (process.env.SITE_URL || "https://tracknrent.vercel.app").replace(/\/+$/, "");
const OUTPUT_PATH = path.join(__dirname, "..", "public", "sitemap.xml");
const SERVICE_ACCOUNT_PATH =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  path.join(__dirname, "..", "serviceAccountKey.json");

// Static pages every crawler should see regardless of business data.
const STATIC_PAGES = [
  { loc: "/", changefreq: "weekly", priority: "1.0" },
  { loc: "/marketplace.html", changefreq: "daily", priority: "0.9" },
  { loc: "/signup.html", changefreq: "monthly", priority: "0.5" },
];

function xmlEscape(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function urlEntry({ loc, lastmod, changefreq, priority }) {
  return [
    "  <url>",
    `    <loc>${xmlEscape(loc)}</loc>`,
    lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
    changefreq ? `    <changefreq>${changefreq}</changefreq>` : null,
    priority ? `    <priority>${priority}</priority>` : null,
    "  </url>",
  ]
    .filter(Boolean)
    .join("\n");
}

async function main() {
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error(
      `\n[generate-sitemap] Could not find a service account key at:\n  ${SERVICE_ACCOUNT_PATH}\n\n` +
        `Download one from Firebase Console → Project Settings → Service accounts → Generate new private key,\n` +
        `save it as serviceAccountKey.json in your project root, and re-run this script.\n`
    );
    process.exit(1);
  }

  admin.initializeApp({
    credential: admin.credential.cert(require(SERVICE_ACCOUNT_PATH)),
  });

  const db = admin.firestore();

  console.log("[generate-sitemap] Fetching public businesses...");
  const snap = await db
    .collection("businesses")
    .where("publicProfile.enabled", "==", true)
    .get();

  const businessEntries = [];
  snap.forEach((doc) => {
    const data = doc.data();
    const profile = data.publicProfile || {};
    const slug = profile.slug;
    if (!slug) return; // no slug, no crawlable URL

    const updatedAt = profile.updatedAt
      ? new Date(profile.updatedAt).toISOString().split("T")[0]
      : undefined;

    businessEntries.push(
      urlEntry({
        loc: `${SITE_URL}/p/${slug}`,
        lastmod: updatedAt,
        changefreq: "weekly",
        priority: data.marketplace?.featured ? "0.8" : "0.6",
      })
    );
  });

  console.log(`[generate-sitemap] Found ${businessEntries.length} public storefronts.`);

  const staticEntries = STATIC_PAGES.map((p) =>
    urlEntry({ loc: `${SITE_URL}${p.loc}`, changefreq: p.changefreq, priority: p.priority })
  );

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...staticEntries,
    ...businessEntries,
    "</urlset>",
    "",
  ].join("\n");

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, xml, "utf8");

  console.log(`[generate-sitemap] Wrote ${businessEntries.length + staticEntries.length} URLs to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("[generate-sitemap] Failed:", err);
  process.exit(1);
});
