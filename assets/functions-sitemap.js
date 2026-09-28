// functions/sitemap.js
//
// Two functions working together:
//  1. updateSitemapEntry — Firestore trigger. Whenever a business doc
//     changes, check seo.googleIndexed. If true, upsert a small entry
//     doc; if false/removed, delete it. This keeps a lightweight
//     "system/sitemapEntries" collection in sync automatically —
//     nothing to run by hand.
//  2. serveSitemap — HTTPS function that reads that collection and
//     returns real sitemap.xml. Wire it up in firebase.json:
//
//     "hosting": {
//       "rewrites": [
//         { "source": "/sitemap.xml", "function": "serveSitemap" }
//       ]
//     }
//
// This means /sitemap.xml is always current, with no server to run
// and no manual regeneration step.

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

if (!admin.apps.length) admin.initializeApp();

const SITE_ORIGIN = "https://tracknrent.vercel.app"; // adjust to your real production domain

exports.updateSitemapEntry = onDocumentWritten("businesses/{businessId}", async (event) => {
  const businessId = event.params.businessId;
  const after = event.data?.after?.data();
  const entryRef = admin.firestore().collection("system_sitemapEntries").doc(businessId);

  const isIndexed = after?.seo?.googleIndexed === true;
  const slug = after?.publicProfile?.slug;

  if (!after || !isIndexed || !slug) {
    await entryRef.delete().catch(() => {}); // fine if it never existed
    return;
  }

  await entryRef.set({
    slug,
    lastmod: new Date().toISOString()
  });
});

exports.serveSitemap = onRequest(async (req, res) => {
  try {
    const snap = await admin.firestore().collection("system_sitemapEntries").get();

    const urlEntries = snap.docs.map(d => {
      const data = d.data();
      return `  <url>
    <loc>${SITE_ORIGIN}/p/${data.slug}</loc>
    <lastmod>${data.lastmod}</lastmod>
  </url>`;
    }).join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`;

    res.set("Content-Type", "application/xml");
    res.status(200).send(xml);
  } catch (err) {
    console.error("serveSitemap failed:", err);
    res.status(500).send("Failed to generate sitemap");
  }
});
