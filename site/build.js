// Static site generator — GTA Cash Exchange Directory.
// Plain Node, no deps. Reads data/shops.json -> writes dist/.
// Every claim on the site traces to the `status` + `evidence` fields produced
// by pipeline/classify.js. The generator itself never invents a verdict.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SITE_URL = process.env.SITE_URL || 'https://gta-cash-exchange.kivov-digital.workers.dev';
const SITE_NAME = 'GTA Cash Exchange Directory';
const REPO_URL = 'https://github.com/kimwwk/currency-exchange-listings';
// Public by design (ships in client HTML) — protected via HTTP-referrer
// restriction in Google Cloud Console, NOT by secrecy.
const MAPS_KEY = process.env.GOOGLE_MAPS_KEY || 'AIzaSyA19nEB0g7TlQBhKp17adL8qM1htJV03Vw';

const shops = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'shops.json'), 'utf8'));
const summary = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'shops-summary.json'), 'utf8'));

const AREAS = {
  'toronto': { title: 'Toronto (city-wide)', blurb: 'City-wide results — the search where Google Maps is most polluted: our scrape found only 6 of the top 10 results were real walk-in shops.' },
  'downtown': { title: 'Downtown Toronto', blurb: 'Watch for office-tower traps downtown: several top-rated "currency exchange" listings are online-only offices that take no cash at the door.' },
  'scarborough': { title: 'Scarborough', blurb: 'One of the densest corridors for independent exchange shops in the GTA.' },
  'north-york': { title: 'North York', blurb: 'The cleanest area in our scrape — but hours and walk-in status still change without notice. Call ahead.' },
  'markham': { title: 'Markham', blurb: 'The most polluted suburban search in our scrape: only 5 of the top 10 Google results were real walk-in shops.' },
  'mississauga': { title: 'Mississauga', blurb: 'Dense corridor of exchange shops; a handful of online-only and remittance-first listings mixed in.' },
};

const STATUS_META = {
  walk_in_confirmed: { label: 'Walk-in confirmed', cls: 'ok', desc: 'We have direct evidence this location exchanges cash in person.' },
  walk_in_unverified: { label: 'Likely walk-in — call ahead', cls: 'warn', desc: 'Listed as a retail currency exchange with a storefront address and phone, but we have not yet confirmed walk-in cash service directly.' },
  remittance_first: { label: 'Money transfer first — call ahead', cls: 'warn', desc: 'Primarily a money-transfer business. Some exchange cash as a sideline; confirm by phone before going.' },
  online_only: { label: 'Online only — no walk-in cash', cls: 'bad', desc: 'Evidence shows this business does not exchange cash at a counter.' },
  invalid: { label: 'Invalid listing', cls: 'na', desc: 'This Google Maps "currency exchange" listing does not appear to be a currency exchange business at all. We keep it visible (instead of hiding it) so it can be validated — if you know this place, tell us.' },
};

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// hours_line from the scrape often ends with the phone number — strip it for display
const cleanHours = (s) => String(s ?? '').replace(/\s*·?\s*\(\d{3}\)\s*\d{3}-\d{4}\s*$/, '').trim();
const updatedDate = (shops.find((s) => s.sources && s.sources.maps_scraped_at) || {}).sources?.maps_scraped_at?.slice(0, 10) || '2026-06-03';

function mapsLink(shop) {
  return 'https://www.google.com/maps/search/' + encodeURIComponent(`${shop.name} ${shop.address || ''}`);
}

function page({ title, description, canonicalPath, body, jsonLd, h1 }) {
  const ld = jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : '';
  return `<!doctype html>
<html lang="en-CA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="google-site-verification" content="Ye_IMYi1SiV2M2haI9gEqUoeOJr3WJVGUXEurMIXcG8" />
<link rel="canonical" href="${SITE_URL}${canonicalPath}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="/style.css">
<script src="/app.js" defer></script>
${ld}
</head>
<body>
<header class="site-header">
  <a href="/" class="brand">${SITE_NAME}</a>
  <nav>
    <a href="/no-cash-list/">No-cash list</a>
    <a href="/how-we-verify/">How we verify</a>
    <a href="/contact/">Contact</a>
  </nav>
</header>
<main>
${h1 ? `<h1>${h1}</h1>` : ''}
${body}
</main>
<footer>
  <p><strong>Always call before you go.</strong> Hours, locations and walk-in policies change without notice. We list verification status honestly — "likely walk-in" means exactly that, not a guarantee.</p>
  <h2 class="footer-rules-title">How statuses are decided</h2>
  <ul class="footer-rules">
    <li><span class="badge ok">Walk-in confirmed</span> — direct, dated evidence of in-person cash exchange: the shop's own website says it (counter / visit-us / cash), a logged phone call, <em>or</em> a strong Google-review signal — many reviews (we use 10+) that describe exchanging cash in person, with activity in the last month. A handful of old reviews is not enough.</li>
    <li><span class="badge warn">Call ahead</span> — looks like a real storefront exchange (retail address + phone) but none of the confirmations above yet. The honest default.</li>
    <li><span class="badge bad">Online only</span> — evidence shows no cash at a counter (quoted on the shop's page).</li>
    <li><span class="badge na">Invalid listing</span> — appears on Google Maps as "currency exchange" but isn't an exchange business at all. We list these in grey instead of hiding them, so anyone can validate and correct us.</li>
    <li><span class="badge live">Live rates</span> — the shop's own website publishes today's rates online; the badge links straight to them.</li>
  </ul>
  <p>Know one of these shops? <a href="/contact/">Help us validate</a> — a one-line email is enough, we correct fast.</p>
  <p>Data: Google Maps results scraped ${updatedDate} · FINTRAC MSB Registry (<a href="https://open.canada.ca/en/open-government-licence-canada" rel="nofollow">Open Government Licence — Canada</a>).</p>
  <p>Spotted an error? <a href="/contact/">Contact us</a> or <a href="${REPO_URL}/issues" target="_blank" rel="noopener">open an issue</a>. Built from an open pipeline: <a href="${REPO_URL}" target="_blank" rel="noopener">source</a>.</p>
</footer>
</body>
</html>`;
}

function statusBadge(shop) {
  const m = STATUS_META[shop.status];
  if (!m) return '';
  const verified = shop.verified_phone && shop.verified_phone.date
    ? ` <span class="verified-date">verified by phone ${esc(shop.verified_phone.date)}</span>` : '';
  return `<span class="badge ${m.cls}">${m.label}</span>${verified}`;
}

// Badge linking to the shop's own live-rates page (opens in a new tab).
function liveRatesBadge(shop) {
  return shop.live_rates_url
    ? ` <a class="badge live" href="${esc(shop.live_rates_url)}" target="_blank" rel="noopener nofollow">Live rates ↗</a>` : '';
}

function ratingText(shop) {
  if (!shop.rating) return '';
  const n = shop.review_count != null ? ` (${shop.review_count})` : '';
  return ` <span class="rating">· ★ ${shop.rating}${n} Google</span>`;
}

function shopCard(shop) {
  const coords = shop.lat != null ? ` data-lat="${shop.lat}" data-lng="${shop.lng}"` : '';
  const cls = shop.status === 'invalid' ? ' invalid' : '';
  return `<div class="shop-card${cls}"${coords}>
  <h3><a href="/shop/${shop.slug}/">${esc(shop.name)}</a></h3>
  <p class="badges">${statusBadge(shop)}${shop.fintrac_registered ? ' <span class="badge fintrac">FINTRAC registered</span>' : ''}${liveRatesBadge(shop)}</p>
  ${shop.address ? `<p class="meta"><span class="k">addr</span> ${esc(shop.address)} · <a href="${mapsLink(shop)}" target="_blank" rel="noopener nofollow">map ↗</a></p>` : ''}
  <p class="meta"><span class="k">tel</span> ${shop.phone ? `<a href="tel:${esc(shop.phone.replace(/[^\d+]/g, ''))}">${esc(shop.phone)}</a>` : 'not listed'}${ratingText(shop)}</p>
  ${shop.hours_line ? `<p class="hours"><span class="k">hrs</span> ${esc(cleanHours(shop.hours_line))}</p>` : ''}
</div>`;
}

// Honesty split: a flat "won't take your cash" claim requires confident evidence.
// Entries whose evidence is marked UNCERTAIN are shown separately, softer, pending verification.
const isUncertain = (s) => /uncertain/i.test(s.evidence || '');
const trapsAll = shops.filter((s) => s.status === 'online_only')
  .sort((a, b) => (b.rating || 0) - (a.rating || 0));
const trapsConfirmed = trapsAll.filter((s) => !isUncertain(s));
const trapsUncertain = trapsAll.filter(isUncertain);

// ---------- area pages ----------
// listable = shown in walk-in candidate lists. `invalid` listings are rendered
// too, but in their own grey section at the bottom (visible, never hidden).
const listable = (s) => ['walk_in_confirmed', 'walk_in_unverified', 'remittance_first'].includes(s.status);
const hasPage = (s) => listable(s) || s.status === 'invalid';
const statusOrder = { walk_in_confirmed: 0, walk_in_unverified: 1, remittance_first: 2 };

for (const [slug, area] of Object.entries(AREAS)) {
  const areaShops = shops
    .filter((s) => listable(s) && (s.areas || []).includes(slug))
    .sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || (b.rating || 0) - (a.rating || 0));
  if (!areaShops.length) continue;
  const areaInvalid = shops.filter((s) => s.status === 'invalid' && (s.areas || []).includes(slug));

  const traps = trapsConfirmed.filter((s) => (s.areas || []).includes(slug));
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Currency exchange in ${area.title} — walk-in shops that take cash`,
    numberOfItems: areaShops.length,
    itemListElement: areaShops.slice(0, 25).map((s, i) => ({
      '@type': 'ListItem', position: i + 1, name: s.name, url: `${SITE_URL}/shop/${s.slug}/`,
    })),
  };

  const body = `
<p class="intro">${esc(area.blurb)}</p>
<p class="trap-note">${traps.length ? `<strong>${traps.length} "currency exchange" listing${traps.length > 1 ? 's' : ''} in this search are online-only</strong> — they will not exchange your cash at a counter. <a href="/no-cash-list/">See the no-cash list</a>.` : `No confirmed online-only traps in this area's search results — but always <a href="/how-we-verify/">check the status badge</a>.`}</p>
<p class="legend"><span class="badge ok">Walk-in confirmed</span> verified, dated <span class="badge warn">Call ahead</span> likely walk-in, unconfirmed <span class="badge bad">Online only</span> flagged, excluded <span class="badge na">Invalid</span> not an exchange <span class="badge live">Live rates</span> rates on shop's site</p>
<p class="count">${areaShops.length} walk-in candidates · updated ${updatedDate} · <button type="button" class="btn-sort" id="sort-distance-btn">Sort by distance</button></p>
<div id="shop-list">
${areaShops.map(shopCard).join('\n')}
</div>
${areaInvalid.length ? `
<h2>Invalid listings in this search</h2>
<p class="status-desc">These appear in Google Maps "currency exchange" results for this area but don't seem to be currency exchange businesses at all. We list them in grey instead of hiding them — <a href="/contact/">tell us</a> if you can validate one either way.</p>
${areaInvalid.map(shopCard).join('\n')}` : ''}
`;
  const dir = path.join(DIST, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), page({
    title: `Currency Exchange in ${area.title} That Takes Cash (${areaShops.length} Walk-In Shops) | ${SITE_NAME}`,
    description: `Walk-in currency exchange shops in ${area.title} with addresses, phone numbers and honest verification status. ${traps.length} online-only traps flagged. Updated ${updatedDate}.`,
    canonicalPath: `/${slug}/`,
    h1: `Currency exchange in ${area.title} — shops that take cash`,
    body, jsonLd,
  }));
}

// ---------- shop pages ----------
for (const shop of shops.filter(hasPage)) {
  const m = STATUS_META[shop.status];
  // No FinancialService schema for invalid listings — they aren't one.
  const jsonLd = shop.status === 'invalid' ? null : {
    '@context': 'https://schema.org',
    '@type': 'FinancialService',
    name: shop.name,
    ...(shop.address ? { address: { '@type': 'PostalAddress', streetAddress: shop.address, addressLocality: 'Toronto', addressRegion: 'ON', addressCountry: 'CA' } } : {}),
    ...(shop.phone ? { telephone: shop.phone } : {}),
    url: `${SITE_URL}/shop/${shop.slug}/`,
  };
  const body = `
<p class="badges">${statusBadge(shop)}${shop.fintrac_registered ? ' <span class="badge fintrac">FINTRAC registered</span>' : ''}${liveRatesBadge(shop)}</p>
<p class="status-desc">${esc(m.desc)}</p>
${shop.evidence ? `<p class="evidence"><strong>Evidence:</strong> ${esc(shop.evidence)}</p>` : ''}
<table class="shop-table">
${shop.address ? `<tr><th>Address</th><td>${esc(shop.address)} (<a href="${mapsLink(shop)}" target="_blank" rel="noopener nofollow">open in Google Maps ↗</a>)</td></tr>` : ''}
${shop.phone ? `<tr><th>Phone</th><td><a href="tel:${esc(shop.phone.replace(/[^\d+]/g, ''))}">${esc(shop.phone)}</a> — call to confirm hours, walk-in service and today's rate</td></tr>` : ''}
${shop.website ? `<tr><th>Website</th><td><a href="${esc(shop.website)}" target="_blank" rel="noopener nofollow">${esc(shop.website.replace(/^https?:\/\//, '').replace(/\/$/, ''))} ↗</a></td></tr>` : ''}
${shop.live_rates_url ? `<tr><th>Live rates</th><td><a href="${esc(shop.live_rates_url)}" target="_blank" rel="noopener nofollow">today's rates on the shop's site ↗</a> — the shop publishes real-time rates online (still confirm by phone for large amounts)</td></tr>` : ''}
${shop.hours_line ? `<tr><th>Hours (as scraped)</th><td>${esc(cleanHours(shop.hours_line))}</td></tr>` : ''}
${shop.rating ? `<tr><th>Google rating</th><td>★ ${shop.rating}${shop.review_count != null ? ` (${shop.review_count} reviews)` : ''}</td></tr>` : ''}
<tr><th>FINTRAC MSB registry</th><td>${shop.fintrac_registered === true ? 'Registered' : shop.fintrac_registered === false ? 'No match found' : 'Not checked'}</td></tr>
<tr><th>Areas</th><td>${(shop.areas || []).map((a) => AREAS[a] ? `<a href="/${a}/">${AREAS[a].title}</a>` : a).join(' · ')}</td></tr>
<tr><th>Last scraped</th><td>${updatedDate}</td></tr>
</table>
${shop.live_rates_url ? '' : `<p class="disclaimer">No rates shown — this shop quotes by phone. Rates change hourly; the phone number above is the freshest source.</p>`}
`;
  const dir = path.join(DIST, 'shop', shop.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), page({
    title: `${shop.name} — ${m.label} | ${SITE_NAME}`,
    description: `${shop.name}${shop.address ? ', ' + shop.address : ''}. Status: ${m.label}. Phone, hours and verification evidence.`,
    canonicalPath: `/shop/${shop.slug}/`,
    h1: esc(shop.name),
    body, jsonLd,
  }));
}

// ---------- no-cash exposé page ----------
const trapCard = (s, badgeHtml) => `<div class="shop-card trap">
  <h3>${esc(s.name)}</h3>
  <p class="badges">${badgeHtml}</p>
  ${s.address ? `<p class="meta"><span class="k">addr</span> ${esc(s.address)}</p>` : ''}
  ${s.evidence ? `<p class="evidence"><strong>Evidence:</strong> ${esc(s.evidence)}</p>` : ''}
</div>`;

const trapBody = `
<p class="intro">These businesses appear in Google Maps results for "currency exchange" in the GTA — but our evidence says they <strong>do not exchange cash at a walk-in counter</strong>. Several are well-rated online FX services; nothing wrong with them as businesses, but if you show up with cash, you'll leave with the same cash.</p>
<p class="count">${trapsConfirmed.length} listings with confirmed evidence · ${trapsUncertain.length} more pending verification · updated ${updatedDate}</p>
${trapsConfirmed.map((s) => trapCard(s, '<span class="badge bad">Online only — no walk-in cash</span>')).join('\n')}
${trapsUncertain.length ? `
<h2>Pending verification — likely not walk-in</h2>
<p>Signals point to no walk-in cash service (office-floor addresses, non-retail Google categories), but we have not confirmed these directly yet. Treated cautiously: excluded from our walk-in lists until verified either way.</p>
${trapsUncertain.map((s) => trapCard(s, '<span class="badge warn">Unconfirmed — likely online only</span>')).join('\n')}` : ''}
<p>Think we got one wrong? <a href="${REPO_URL}/issues">Tell us</a> — we correct fast.</p>
`;
fs.mkdirSync(path.join(DIST, 'no-cash-list'), { recursive: true });
fs.writeFileSync(path.join(DIST, 'no-cash-list', 'index.html'), page({
  title: `${trapsConfirmed.length} GTA "Currency Exchange" Listings That Won't Take Your Cash | ${SITE_NAME}`,
  description: `${trapsConfirmed.length} Google Maps "currency exchange" results in Toronto/GTA that are online-only — no walk-in counter, no cash accepted. With evidence for each.`,
  canonicalPath: '/no-cash-list/',
  h1: `${trapsConfirmed.length} GTA "currency exchange" listings that won't take your cash`,
  body: trapBody,
}));

// ---------- how we verify ----------
const counts = summary.overall || {};
const verifyBody = `
<p class="intro">This site exists because Google Maps' "currency exchange" category mixes real walk-in shops with online-only offices, banks, Bitcoin ATMs and money-transfer counters. We measured it: in our ${updatedDate} scrape of ${summary.total_unique || shops.length} unique places, ${counts.online_only || 0} were online-only businesses listed as currency exchanges.</p>
<h2>Our pipeline</h2>
<ol>
  <li><strong>Scrape:</strong> we collect the actual Google Maps results a user sees for "currency exchange" across 6 GTA searches (headless browser, re-runnable any time).</li>
  <li><strong>Classify:</strong> deterministic rules sort every place — banks, Western Union counters, Bitcoin ATMs and payday lenders are filtered out; businesses with documented no-cash policies are flagged.</li>
  <li><strong>Evidence overrides:</strong> where we have direct evidence (a shop's own website saying "we do not accept cash", or a confirmed in-person pickup policy), it overrides everything and is quoted on the shop's page.</li>
  <li><strong>Phone verification (rolling):</strong> ambiguous shops get a 90-second call — "do you exchange cash in person, walk-in?" Answers are date-stamped and shown as <span class="badge ok">Walk-in confirmed</span>.</li>
  <li><strong>Review signal:</strong> Google reviews count as confirming evidence only when both volume and freshness are there — <strong>10+ reviews</strong> that describe exchanging cash in person, including <strong>activity within the last month</strong>. A handful of old reviews proves a shop existed, not that it's still exchanging cash today. Review-based confirmations are quoted on the shop's page like any other evidence.</li>
</ol>
<h2>What the badges mean</h2>
<table class="shop-table">
<tr><th><span class="badge ok">Walk-in confirmed</span></th><td>Direct evidence of in-person cash exchange (dated): website statement, phone call, or the review signal above.</td></tr>
<tr><th><span class="badge warn">Likely walk-in — call ahead</span></th><td>Retail storefront + phone, but not yet directly confirmed. Honest default — most listings start here.</td></tr>
<tr><th><span class="badge warn">Money transfer first</span></th><td>Primarily remittance; may exchange cash as a sideline.</td></tr>
<tr><th><span class="badge bad">Online only</span></th><td>Evidence shows no walk-in cash service. Excluded from area lists, shown on the <a href="/no-cash-list/">no-cash list</a>.</td></tr>
<tr><th><span class="badge na">Invalid listing</span></th><td>Appears in Google Maps "currency exchange" results but isn't an exchange business at all (wrong category, SEO listing). Kept visible in grey — Google Maps confuses people with these too, and someone local can <a href="/contact/">validate</a> it.</td></tr>
<tr><th><span class="badge live">Live rates</span></th><td>Not a status — an extra tag for shops whose own website publishes today's rates (e.g. a /usd/ rates page). The badge links directly to the shop's rate page.</td></tr>
</table>
<h2>What we don't do</h2>
<p>We don't publish exchange rates ourselves — any rate we copied would be stale or fake. Where a shop's own site shows live rates we link straight to it (the <span class="badge live">Live rates</span> tag); everywhere else, the phone is the freshest source. We don't take placement fees. We don't claim a shop is verified when it isn't.</p>
<p>Pipeline and data are open source: <a href="${REPO_URL}">${REPO_URL.replace('https://', '')}</a></p>
`;
fs.mkdirSync(path.join(DIST, 'how-we-verify'), { recursive: true });
fs.writeFileSync(path.join(DIST, 'how-we-verify', 'index.html'), page({
  title: `How We Verify Walk-In Cash Exchange | ${SITE_NAME}`,
  description: 'Our pipeline: scrape real Google Maps results, classify with deterministic rules, override with documented evidence, confirm by phone. Every badge traces to evidence.',
  canonicalPath: '/how-we-verify/',
  h1: 'How we verify',
  body: verifyBody,
}));

// ---------- contact / validate ----------
// Reports go to an automation webhook (n8n) — no personal email in the HTML.
const CONTACT_WEBHOOK = 'https://automation.getjustgo.com/webhook/GTA-currency-exchange-contact';
const contactBody = `
<p class="intro">This directory gets better every time someone who actually knows a shop tells us what they saw. One line is enough.</p>
<h2>Tell us about a shop</h2>
<p>Useful reports, in order of value:</p>
<ul>
  <li><strong>"I exchanged cash there on &lt;date&gt;"</strong> — instantly promotes a shop toward <span class="badge ok">Walk-in confirmed</span>.</li>
  <li><strong>"I went and there was no counter / they refused cash"</strong> — moves it to the <a href="/no-cash-list/">no-cash list</a> with your report as evidence.</li>
  <li><strong>"That listing isn't a currency exchange at all"</strong> — confirms an <span class="badge na">Invalid listing</span> verdict (or tells us we got one wrong).</li>
  <li>Corrections to hours, phone numbers, closures, or a shop we're missing entirely.</li>
</ul>
<h2>Send a report</h2>
<form id="contact-form" action="${CONTACT_WEBHOOK}" method="post">
  <div class="form-row">
    <label for="cf-name">Your name <span class="req">required</span></label>
    <input id="cf-name" name="name" type="text" required maxlength="120" autocomplete="name">
  </div>
  <div class="form-row">
    <label for="cf-email">Your email <span class="opt">optional — only if you want a reply</span></label>
    <input id="cf-email" name="email" type="email" maxlength="200" autocomplete="email">
  </div>
  <div class="form-row">
    <label for="cf-company">Shop you're reporting <span class="opt">optional</span></label>
    <input id="cf-company" name="company" type="text" maxlength="200" placeholder="e.g. Silk Road Currency Exchange, 301 Spadina">
  </div>
  <div class="form-row">
    <label for="cf-message">What you saw <span class="req">required</span></label>
    <textarea id="cf-message" name="message" required rows="5" maxlength="4000" placeholder="e.g. Exchanged USD cash at the counter on June 10 — no issues. / Went there, office only, they refused cash."></textarea>
  </div>
  <button type="submit" class="btn-near" id="cf-submit">Send report</button>
  <p id="cf-status" class="count" role="status" aria-live="polite"></p>
</form>
<p class="disclaimer">We typically reply within 1 business day (if you left an email). Prefer GitHub? <a href="${REPO_URL}/issues" target="_blank" rel="noopener">Open an issue</a> — the whole pipeline and dataset are public.</p>
<p>Every report is checked against our <a href="/how-we-verify/">verification rules</a> before a badge changes — your report becomes the dated evidence shown on the shop's page.</p>
`;
fs.mkdirSync(path.join(DIST, 'contact'), { recursive: true });
fs.writeFileSync(path.join(DIST, 'contact', 'index.html'), page({
  title: `Contact & Validate a Shop | ${SITE_NAME}`,
  description: 'Report a shop you visited, correct a wrong badge, or validate an invalid listing. One-line reports become dated evidence on the shop page.',
  canonicalPath: '/contact/',
  h1: 'Help us validate — contact',
  body: contactBody,
}));

// ---------- index ----------
const areaCards = Object.entries(AREAS).map(([slug, area]) => {
  const n = shops.filter((s) => listable(s) && (s.areas || []).includes(slug)).length;
  if (!n) return '';
  return `<a class="area-card" href="/${slug}/"><strong>${area.title}</strong><span>${n} walk-in candidates</span></a>`;
}).join('\n');

const confirmed = shops.filter((s) => s.status === 'walk_in_confirmed').length;
const totalUnique = summary.total_unique || shops.length;

// Minimal dataset for the client-side "near me" ranking (listable shops only).
const nearMeData = shops.filter(listable).map((s) => ({
  slug: s.slug, name: s.name, status: s.status, phone: s.phone, lat: s.lat, lng: s.lng,
}));
const nearMeJson = JSON.stringify(nearMeData).replace(/</g, '\\u003c');

const indexBody = `
<div class="hero">
<p class="languages">Cash exchange · 唱錢 · 换汇 · صرافی · обмен валют</p>
<p class="promise intro">Walk-in currency exchange shops across the GTA — with the one fact Google Maps won't tell you: <strong>does it actually take cash at a counter?</strong></p>
<div class="action-row">
  <button type="button" class="btn-near" id="near-me-btn">Find shops near me</button>
</div>
</div>
<div id="near-me-results" hidden></div>

<section class="home-section">
<h2><span class="sec-no">01</span> Pick your area</h2>
<div class="area-grid">
${areaCards}
</div>
</section>

<section class="home-section">
<h2><span class="sec-no">02</span> Or spot them on the map</h2>
<div id="map" data-key="${MAPS_KEY}" role="region" aria-label="Map of GTA walk-in currency exchange shops"><p class="map-loading">Map loads as you scroll…</p></div>
<p class="count map-legend"><span class="dot dot-ok"></span> walk-in confirmed · <span class="dot dot-warn"></span> call ahead · <span class="dot dot-you"></span> you (approximate until you allow precise location)</p>
</section>

<section class="home-section">
<h2><span class="sec-no">03</span> Avoid the traps</h2>
<p class="trap-note"><strong><a href="/no-cash-list/">${trapsConfirmed.length} "currency exchange" listings won't take your cash</a></strong> — online-only offices that look like shops on Google Maps. Don't make the trip for nothing.</p>
<p>A friend of ours searched "currency exchange" on Google Maps, travelled to a well-rated result, and found an office that only does online transfers — no counter, no cash. It's not rare: <strong>${trapsConfirmed.length} of ${totalUnique} listings we scraped (${Math.round((trapsConfirmed.length / totalUnique) * 100)}%) are confirmed online-only</strong>, with ${trapsUncertain.length} more pending verification.</p>
</section>

<section class="home-section">
<h2><span class="sec-no">04</span> Trust the badges, not the category</h2>
<p class="legend"><span class="badge ok">Walk-in confirmed</span> verified, dated <span class="badge warn">Call ahead</span> likely walk-in <span class="badge bad">Online only</span> flagged <span class="badge na">Invalid</span> not an exchange <span class="badge live">Live rates</span> rates on shop's site</p>
<p>${confirmed ? `${confirmed} shops are walk-in confirmed so far; the rest carry an honest "call ahead" badge until we verify them.` : `Every listing carries an honest status badge — "likely walk-in, call ahead" until we directly verify it.`} Every badge traces to dated evidence shown on the shop's page. <a href="/how-we-verify/">How we verify →</a></p>
</section>

<section class="home-section">
<h2><span class="sec-no">05</span> Been to one of these shops?</h2>
<p>A one-line report ("I exchanged cash there last week") is exactly the evidence this directory runs on. <a href="/contact/">Tell us what you saw →</a></p>
</section>
<script type="application/json" id="shops-data">${nearMeJson}</script>
`;
fs.writeFileSync(path.join(DIST, 'index.html'), page({
  title: `Currency Exchange in Toronto & GTA That Takes Cash — Walk-In Shops Directory`,
  description: `Walk-in currency exchange shops across Toronto, Scarborough, North York, Markham and Mississauga — with phone numbers, hours and honest verification status. ${trapsConfirmed.length} online-only traps flagged.`,
  canonicalPath: '/',
  h1: 'Currency exchange shops that take cash — Toronto & GTA',
  body: indexBody,
  jsonLd: { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: SITE_URL },
}));

// ---------- static, robots, sitemap, 404 ----------
fs.copyFileSync(path.join(__dirname, 'static', 'style.css'), path.join(DIST, 'style.css'));
fs.copyFileSync(path.join(__dirname, 'static', 'app.js'), path.join(DIST, 'app.js'));
fs.writeFileSync(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);

const urls = ['/', '/no-cash-list/', '/how-we-verify/', '/contact/',
  ...Object.keys(AREAS).filter((slug) => shops.some((s) => listable(s) && (s.areas || []).includes(slug))).map((s) => `/${s}/`),
  ...shops.filter(hasPage).map((s) => `/shop/${s.slug}/`)];
fs.writeFileSync(path.join(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map((u) => `  <url><loc>${SITE_URL}${u}</loc><lastmod>${updatedDate}</lastmod></url>`).join('\n') +
  `\n</urlset>\n`);

fs.writeFileSync(path.join(DIST, '404.html'), page({
  title: `Page not found | ${SITE_NAME}`,
  description: 'Page not found.',
  canonicalPath: '/404.html',
  h1: 'Page not found',
  body: `<p>That page doesn't exist. Try the <a href="/">directory home</a>.</p>`,
}));

console.log(`Built ${urls.length} pages -> dist/ (${shops.filter(hasPage).length} shop pages incl. ${shops.filter((s) => s.status === 'invalid').length} invalid, ${Object.keys(AREAS).length} area pages, ${trapsConfirmed.length}+${trapsUncertain.length} no-cash entries)`);
