#!/usr/bin/env node
/*
 * classify.js — GTA Cash Exchange Directory data pipeline.
 *
 * Reads:   data/raw/*.json          (Google Maps scrape files)
 *          data/overrides.json      (manual verdicts that survive re-scrapes)
 *          data/fintrac/fintrac.csv (optional MSB registry; absence handled gracefully)
 *          data/fintrac/reg-eng.xlsx (optional fallback if no fintrac.csv)
 *
 * Writes:  data/shops.json          (one record per unique place)
 *          data/shops-summary.json  (counts per status per area + total)
 *
 * Plain Node v24, no npm deps. CommonJS. Deterministic + re-runnable.
 *
 * Classification priority (first match wins):
 *   (a) override (by feature_id, else name_regex)         -> confidence "override"
 *   (b) noise filters (banks / WU·MG·Ria / crypto ATM /
 *       payday·pawn·gold·jewellery / cheque cashing)      -> status "noise"
 *   (c) "Money transfer service" w/o exchange signals     -> "remittance_first"
 *   (d) "Currency exchange service" + street address + phone -> "walk_in_unverified"
 *   (e) anything ambiguous                                -> "unknown"
 *
 * Status vocabulary (exact):
 *   walk_in_confirmed | walk_in_unverified | remittance_first | online_only | noise | unknown
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------------------------------------------------------------------------
// Paths (resolved from repo root, regardless of cwd)
// ---------------------------------------------------------------------------
const ROOT = path.resolve(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'data', 'raw');
const OVERRIDES_PATH = path.join(ROOT, 'data', 'overrides.json');
const FINTRAC_CSV = path.join(ROOT, 'data', 'fintrac', 'fintrac.csv');
const FINTRAC_XLSX = path.join(ROOT, 'data', 'fintrac', 'reg-eng.xlsx');
const SHOPS_OUT = path.join(ROOT, 'data', 'shops.json');
const SUMMARY_OUT = path.join(ROOT, 'data', 'shops-summary.json');

// Map raw filename (without .json) -> area slug. "generic" -> "toronto".
const FILE_TO_AREA = {
  downtown: 'downtown',
  scarborough: 'scarborough',
  northyork: 'north-york',
  markham: 'markham',
  mississauga: 'mississauga',
  generic: 'toronto',
};
const AREA_ORDER = ['toronto', 'downtown', 'scarborough', 'north-york', 'markham', 'mississauga'];

const FEATURE_ID_RE = /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/;

// ---------------------------------------------------------------------------
// Known categories that appear as the first token of the category/address line.
// Used to locate the category line robustly regardless of rating presence.
// ---------------------------------------------------------------------------
const KNOWN_CATEGORIES = [
  'Currency exchange service', 'Money transfer service', 'Corporate office',
  'Gold dealer', 'Bank', 'Financial institution', 'Investment service',
  'Loan agency', 'Shopping mall', 'Money order service', 'Coin dealer',
  'Business center', 'Financial consultant', 'Pawn shop', 'Second hand store',
  'Drug store', 'Beer distributor', 'Video arcade', 'Government office',
  'Jewelry buyer', 'Education center', 'Consultant', 'Legal services',
  'Laundry service', 'Insurance agency', 'ATM', 'Used clothing store',
  'Information services', 'Oil change service', 'English language school',
  'Market', 'Gym', 'Gas station', 'Jewelry store', 'Jeweler',
];

// ---------------------------------------------------------------------------
// Noise regexes (sub-typed). Tested against name + category + address.
// ---------------------------------------------------------------------------
const NOISE_RULES = [
  { sub: 'bank', re: /\b(TD|RBC|BMO|CIBC|Scotiabank|Scotia|HSBC|Tangerine|National Bank|Bank of Montreal|Royal Bank|Toronto[- ]Dominion)\b|credit union|\bbank\b/i,
    // guard: do not flag the literal category-only token "Bank" inside place names like "Bank St"; handled in code.
  },
  { sub: 'agent', re: /western union|moneygram|money ?gram|\bria\b|ria money/i },
  { sub: 'bitcoin_atm', re: /bitcoin|\bbtc\b|crypto|localcoin|coinflip|fastbtc|\bhodl\b|coinsquare|bitbuy|cryptocurrency|\batm\b.*coin|coin.*\batm\b/i },
  { sub: 'payday_pawn_gold', re: /money ?mart|payday|pay ?day|pawn|\bgold\b|jewell?er|jewell?ery|jewelry|cash ?money|loan|cheque ?cashing|check ?cashing/i },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function kebab(s) {
  return String(s)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')      // strip combining marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-') || 'shop';
}

// Is a `lines[]` entry a rating line? e.g. "4.5", "4.5(24)", "4.5(56,672)",
// "3.9(3,341) · $", or "No reviews".
function parseRatingLine(line) {
  if (line == null) return { isRating: false, rating: null };
  if (line === 'No reviews') return { isRating: true, rating: null };
  const m = line.match(/^(\d(?:\.\d)?)(?:\([\d,]+\))?(?:\s*·\s*\$+)?$/);
  if (m) return { isRating: true, rating: parseFloat(m[1]) };
  return { isRating: false, rating: null };
}

// A status/hours line mentions opening/closing keywords or is a pure phone line.
function isStatusLine(line) {
  return /(^|\s)(Open|Opens|Closed|Closes|Open 24 hours|Temporarily closed|Permanently closed)\b/.test(line)
    || /\b(a\.m\.|p\.m\.)\b/.test(line)
    || /^\(?\+?\d[\d\s().-]{6,}$/.test(line.trim()); // bare phone line
}

// Phone matcher: (NNN) NNN-NNNN primarily, plus +1 NNN-NNN-NNNN / +NN ... fallbacks.
const PHONE_RE = /(\(\d{3}\)\s?\d{3}-\d{4})|(\+1\s?\d{3}-\d{3}-\d{4})|(\+\d{1,3}\s?\d{2,4}-\d{3,4}-?\d{0,4})/;

function extractPhone(lines) {
  for (const l of lines) {
    const m = l.match(PHONE_RE);
    if (m) return m[0].trim();
  }
  return null;
}

// Find the category/address line: first line whose first " · "-segment is a
// known category. Returns { raw, category, address }.
function parseCategoryLine(lines) {
  for (const l of lines) {
    if (!l || !l.includes('·')) continue;
    const head = l.split('·')[0].trim();
    if (KNOWN_CATEGORIES.includes(head)) {
      // Address = last non-empty " · " segment that is not the category and not a price marker.
      const segs = l.split('·').map((s) => s.trim()).filter((s) => s.length > 0);
      let category = head;
      let address = null;
      // segs[0] is category; remaining non-$ segment is address (skip empty price placeholder)
      const rest = segs.slice(1).filter((s) => s !== '$' && s !== '$$' && s !== '$$$' && s !== '$$$$');
      if (rest.length) address = rest[rest.length - 1];
      return { raw: l, category, address };
    }
  }
  // Fallback: a line that looks like "<something> · <address>" even if category unknown
  for (const l of lines) {
    if (l && l.includes('·')) {
      const segs = l.split('·').map((s) => s.trim()).filter(Boolean);
      if (segs.length >= 2 && !isStatusLine(l)) {
        return { raw: l, category: segs[0], address: segs[segs.length - 1] };
      }
    }
  }
  return { raw: null, category: null, address: null };
}

// Find the hours/status line (the one with open/close keywords + maybe phone).
function parseHoursLine(lines, categoryRaw) {
  for (const l of lines) {
    if (l === categoryRaw) continue;
    if (!l) continue;
    if (isStatusLine(l) && /(Open|Opens|Closed|Closes|24 hours|Temporarily|Permanently)/.test(l)) {
      return l;
    }
  }
  return null;
}

// Does an address look like street retail (a number + a street word)?
function looksLikeStreetAddress(addr) {
  if (!addr) return false;
  // Has a street number and a typical street suffix OR a unit/suite.
  const hasNumber = /\d/.test(addr);
  const hasStreetWord = /\b(St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Dundas|Yonge|Bloor|Bay|King|Queen|Spadina|Lawrence|Steeles|Hwy|Highway|Pkwy|Parkway|Cres|Crescent|Way|Pl|Place|Centre|Center|Plaza|Mall|Quay|Gate|Gardens|Gdns|Sq|Square|Terrace|Trail|Court|Crt|Ct|Circle|Cir|Line|Sideroad|Concession|Unit|Ste|Suite|Floor|Fl|Rm|Room)\b/i.test(addr)
    || /#\s*\d/.test(addr); // unit number form "#775"
  return hasNumber && hasStreetWord;
}

// Exchange signals in name/category — distinguishes remittance-only from FX.
function hasExchangeSignal(name, category) {
  return /exchange|currency|forex|\bfx\b|صرافی|换汇|兑换|外汇/i.test(name + ' ' + (category || ''));
}

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

function loadOverrides() {
  if (!fs.existsSync(OVERRIDES_PATH)) return [];
  const o = readJSON(OVERRIDES_PATH);
  const list = Array.isArray(o) ? o : (o.overrides || []);
  return list.map((e) => ({
    nameRegex: e.match && e.match.name_regex ? new RegExp(e.match.name_regex, 'i') : null,
    featureIds: new Set((e.match && e.match.feature_ids) || []),
    status: e.status,
    sub_type: e.sub_type || null,
    evidence: e.evidence || null,
    source: e.source || null,
    note: e.note || null,
    verified_phone: e.verified_phone || null,
  }));
}

function matchOverride(overrides, id, name) {
  // feature_id first
  for (const o of overrides) {
    if (id && o.featureIds.has(id)) return o;
  }
  // then name_regex
  for (const o of overrides) {
    if (o.nameRegex && o.nameRegex.test(name)) return o;
  }
  return null;
}

// ---------------------------------------------------------------------------
// FINTRAC: load registered Ontario FX MSB names (best effort).
// Prefer fintrac.csv; fall back to reg-eng.xlsx parsed via the zip reader.
// Returns Set<normalizedName> or null if neither source is usable.
// ---------------------------------------------------------------------------

function normalizeBizName(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/&AMP;/g, '&')
    .replace(/[.,/#!$%^*;:{}=_`~()'"\\?-]/g, ' ')
    .replace(/\b(INC|LTD|LIMITED|CORP|CORPORATION|CO|COMPANY|LLC|LLP|ENTERPRISES?|GROUP|CANADA|TORONTO|THE)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQ = false; }
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function loadFintracFromCSV() {
  const text = fs.readFileSync(FINTRAC_CSV, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return null;
  const header = parseCSVLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (names) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const nameI = idx(['organization', 'name', 'legal']);
  const addrI = idx(['address']);
  const servI = idx(['service']);
  const statI = idx(['status']);
  if (nameI < 0) return null;
  const set = new Set();
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const name = cols[nameI] || '';
    const addr = (addrI >= 0 ? cols[addrI] : '') || '';
    const serv = (servI >= 0 ? cols[servI] : '') || '';
    const stat = (statI >= 0 ? cols[statI] : '') || '';
    addFintracRow(set, name, addr, serv, stat);
  }
  return set;
}

// --- minimal XLSX (zip + SpreadsheetML) reader, no deps ---
function readZipCentralDir(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('XLSX: no EOCD');
  const cdCount = buf.readUInt16LE(eocd + 10);
  const cdOff = buf.readUInt32LE(eocd + 16);
  const map = {};
  let p = cdOff;
  for (let n = 0; n < cdCount; n++) {
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    map[name] = lho;
    p = p + 46 + nameLen + extraLen + commentLen;
  }
  return map;
}

function extractZipEntry(buf, map, name) {
  const lho = map[name];
  if (lho == null) throw new Error('XLSX: missing entry ' + name);
  const nameLen = buf.readUInt16LE(lho + 26);
  const extraLen = buf.readUInt16LE(lho + 28);
  const method = buf.readUInt16LE(lho + 8);
  const compSize = buf.readUInt32LE(lho + 18);
  const dataStart = lho + 30 + nameLen + extraLen;
  const comp = buf.slice(dataStart, dataStart + compSize);
  return method === 8 ? zlib.inflateRawSync(comp) : comp;
}

function decodeXmlEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
}

function loadFintracFromXLSX() {
  const buf = fs.readFileSync(FINTRAC_XLSX);
  const map = readZipCentralDir(buf);
  const ssXml = extractZipEntry(buf, map, 'xl/sharedStrings.xml').toString('utf8');
  const strings = [];
  {
    const re = /<si>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = re.exec(ssXml))) {
      const t = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('');
      strings.push(decodeXmlEntities(t));
    }
  }
  const sheetXml = extractZipEntry(buf, map, 'xl/worksheets/sheet1.xml').toString('utf8');
  const set = new Set();
  const rows = sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g);
  let first = true;
  for (const row of rows) {
    if (first) { first = false; continue; } // skip header
    const cells = {};
    const cellMatches = row[1].matchAll(/<c[^>]*r="([A-Z]+)\d+"[^>]*?(\/>|>([\s\S]*?)<\/c>)/g);
    for (const c of cellMatches) {
      const col = c[1];
      const inner = c[3] || '';
      const isStr = /t="s"/.test(c[0]);
      const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (v == null) continue;
      cells[col] = isStr ? (strings[parseInt(v, 10)] || '') : v;
    }
    addFintracRow(set, cells.A || '', cells.B || '', cells.D || '', cells.E || '');
  }
  return set;
}

// Add a FINTRAC row to the name set IF it is an Ontario FX dealer.
function addFintracRow(set, nameField, address, services, status) {
  if (!/foreign exchange/i.test(services)) return;
  if (!/ontario/i.test(address)) return;
  if (!/^registered$/i.test(String(status).trim())) return;
  // nameField may contain "Legal Name: X, Operating Name: Y"
  const m = nameField.match(/Legal Name:\s*([^,\r\n]+)/i);
  const oper = nameField.match(/Operating Name:\s*([^,\r\n]+)/i);
  if (m) set.add(normalizeBizName(m[1]));
  if (oper) set.add(normalizeBizName(oper[1]));
  if (!m && !oper) set.add(normalizeBizName(nameField));
}

function loadFintrac() {
  try {
    if (fs.existsSync(FINTRAC_CSV)) {
      const s = loadFintracFromCSV();
      if (s && s.size) return { set: s, src: 'csv' };
    }
  } catch (e) {
    console.warn('FINTRAC CSV parse failed (' + e.message + '), trying XLSX...');
  }
  try {
    if (fs.existsSync(FINTRAC_XLSX)) {
      const s = loadFintracFromXLSX();
      if (s && s.size) return { set: s, src: 'xlsx' };
    }
  } catch (e) {
    console.warn('FINTRAC XLSX parse failed (' + e.message + '); fintrac_registered will be null.');
  }
  return { set: null, src: null };
}

// ---------------------------------------------------------------------------
// Rule-based classification (for places with no override)
// ---------------------------------------------------------------------------

function classifyByRules(place) {
  const { name, category, address } = place;
  const hay = `${name} ${category || ''} ${address || ''}`;

  // (b) noise filters
  // bank: avoid false positives on street names containing "Bank St"; only flag
  // when the bank token is a brand word or the category is Bank.
  if (category === 'Bank') return { status: 'noise', sub_type: 'bank' };
  if (/\b(TD Canada Trust|RBC|Royal Bank|BMO|Bank of Montreal|CIBC|Scotiabank|Scotia ?bank|HSBC|Tangerine|National Bank)\b/i.test(name)
      || /credit union/i.test(hay)) {
    return { status: 'noise', sub_type: 'bank' };
  }
  if (NOISE_RULES[1].re.test(hay)) return { status: 'noise', sub_type: 'agent' }; // WU/MG/Ria
  if (NOISE_RULES[2].re.test(hay)) return { status: 'noise', sub_type: 'bitcoin_atm' };
  // A bare "ATM" category with no crypto signal AND no currency-exchange signal is junk;
  // but a currency-exchange ATM (e.g. "Kantor Currency Exchange ATM") is a real walk-in
  // self-serve FX kiosk — let it fall through to the walk-in path below.
  if (category === 'ATM' && !hasExchangeSignal(name, category)) {
    return { status: 'noise', sub_type: 'atm_other' };
  }
  if (NOISE_RULES[3].re.test(hay)
      || /Pawn shop|Gold dealer|Coin dealer|Jewelry buyer|Jewelry store|Jeweler/.test(category || '')) {
    return { status: 'noise', sub_type: 'payday_pawn_gold' };
  }
  // obvious non-FX categories -> noise
  if (/Shopping mall|Beer distributor|Video arcade|Government office|Laundry service|Oil change service|English language school|Gym|Gas station|Used clothing store|Second hand store|Drug store/.test(category || '')) {
    return { status: 'noise', sub_type: 'other' };
  }

  // (c) Money transfer service without exchange signals -> remittance_first
  if (category === 'Money transfer service' && !hasExchangeSignal(name, category)) {
    return { status: 'remittance_first', sub_type: 'money_transfer' };
  }
  if (category === 'Money order service') {
    return { status: 'remittance_first', sub_type: 'money_order' };
  }

  // (d) Currency exchange service + street retail address + phone -> walk_in_unverified
  if (category === 'Currency exchange service'
      && looksLikeStreetAddress(address)
      && place.phone) {
    return { status: 'walk_in_unverified', sub_type: null };
  }
  // A currency-exchange ATM kiosk with a street address is a self-serve walk-in FX point.
  if (category === 'ATM' && hasExchangeSignal(name, category) && looksLikeStreetAddress(address)) {
    return { status: 'walk_in_unverified', sub_type: 'self_serve_atm' };
  }
  // A money-transfer listing that DOES carry exchange signals + street address + phone
  // is a plausible walk-in FX counter too, but flag it as remittance_first candidate.
  if (category === 'Money transfer service' && hasExchangeSignal(name, category)
      && looksLikeStreetAddress(address) && place.phone) {
    return { status: 'remittance_first', sub_type: 'money_transfer_fx' };
  }

  // (e) ambiguous
  return { status: 'unknown', sub_type: null };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const overrides = loadOverrides();
  const fintrac = loadFintrac();

  const rawFiles = fs.readdirSync(RAW_DIR).filter((f) => f.endsWith('.json')).sort();

  // Accumulate per unique feature id.
  const places = new Map(); // id -> place record
  let earliestScrape = null;
  let latestScrape = null;

  for (const file of rawFiles) {
    const base = file.replace(/\.json$/, '');
    const area = FILE_TO_AREA[base] || base;
    const data = readJSON(path.join(RAW_DIR, file));
    const scrapedAt = data.scrapedAt || null;
    if (scrapedAt) {
      if (!earliestScrape || scrapedAt < earliestScrape) earliestScrape = scrapedAt;
      if (!latestScrape || scrapedAt > latestScrape) latestScrape = scrapedAt;
    }

    for (const r of data.results || []) {
      const idm = (r.href || '').match(FEATURE_ID_RE);
      const id = idm ? idm[1] : null;
      if (!id) continue; // every row has an ID per Test 0; skip the impossible miss
      const lines = r.lines || [];

      // Parse fields from lines[]
      let rating = null;
      for (const l of lines) {
        const pr = parseRatingLine(l);
        if (pr.isRating) { rating = pr.rating; break; }
      }
      const cat = parseCategoryLine(lines);
      const hours_line = parseHoursLine(lines, cat.raw);
      const phone = extractPhone(lines);

      if (!places.has(id)) {
        places.set(id, {
          id,
          name: r.name,
          rating,
          category: cat.category,
          address: cat.address,
          phone,
          hours_line,
          areas: new Set([area]),
          scrapedAt,
          _firstScrape: scrapedAt,
          _lastScrape: scrapedAt,
        });
      } else {
        const ex = places.get(id);
        ex.areas.add(area);
        // backfill any missing fields from a richer duplicate
        if (ex.rating == null && rating != null) ex.rating = rating;
        if (!ex.category && cat.category) ex.category = cat.category;
        if (!ex.address && cat.address) ex.address = cat.address;
        if (!ex.phone && phone) ex.phone = phone;
        if (!ex.hours_line && hours_line) ex.hours_line = hours_line;
        if (scrapedAt) {
          if (!ex._firstScrape || scrapedAt < ex._firstScrape) ex._firstScrape = scrapedAt;
          if (!ex._lastScrape || scrapedAt > ex._lastScrape) ex._lastScrape = scrapedAt;
        }
      }
    }
  }

  // Classify + assemble output, with deduped slugs.
  const usedSlugs = new Map();
  const shops = [];
  let fintracMatches = 0;
  let fintracEligible = 0; // places we attempt to match (have a name + fintrac loaded)

  for (const p of places.values()) {
    const ov = matchOverride(overrides, p.id, p.name);
    let status, sub_type, evidence, confidence, verified_phone;

    if (ov) {
      status = ov.status;
      sub_type = ov.sub_type;
      evidence = ov.evidence;
      confidence = 'override';
      verified_phone = ov.verified_phone || null;
    } else {
      const ruled = classifyByRules(p);
      status = ruled.status;
      sub_type = ruled.sub_type;
      confidence = (status === 'unknown') ? 'weak' : 'rule';
      evidence = ruleEvidence(status, sub_type, p);
      verified_phone = null;
    }

    // FINTRAC join
    let fintrac_registered = null;
    if (fintrac.set) {
      fintracEligible++;
      fintrac_registered = fintracHas(fintrac.set, p.name);
      if (fintrac_registered) fintracMatches++;
    }

    // dedupe slug
    let slug = kebab(p.name);
    if (usedSlugs.has(slug)) {
      const n = usedSlugs.get(slug) + 1;
      usedSlugs.set(slug, n);
      slug = `${slug}-${n}`;
    } else {
      usedSlugs.set(slug, 1);
    }

    const areas = [...p.areas].sort((a, b) => AREA_ORDER.indexOf(a) - AREA_ORDER.indexOf(b));

    shops.push({
      id: p.id,
      slug,
      name: p.name,
      status,
      ...(sub_type ? { sub_type } : {}),
      evidence: evidence || null,
      confidence,
      rating: p.rating,
      ratings_source: 'google_maps',
      category: p.category || null,
      address: p.address || null,
      phone: p.phone || null,
      hours_line: p.hours_line || null,
      areas,
      fintrac_registered,
      verified_phone: verified_phone,
      sources: { maps_scraped_at: p._lastScrape || p.scrapedAt || null },
      first_seen: p._firstScrape || null,
      last_seen: p._lastScrape || null,
    });
  }

  // Stable sort: by area-rank of first area, then name.
  shops.sort((a, b) => {
    const ar = AREA_ORDER.indexOf(a.areas[0]);
    const br = AREA_ORDER.indexOf(b.areas[0]);
    if (ar !== br) return ar - br;
    return a.name.localeCompare(b.name);
  });

  fs.writeFileSync(SHOPS_OUT, JSON.stringify(shops, null, 2) + '\n');

  // ---- summary ----
  const STATUSES = ['walk_in_confirmed', 'walk_in_unverified', 'remittance_first', 'online_only', 'noise', 'unknown'];
  const summary = {
    generated_at: new Date().toISOString(),
    total_unique_places: shops.length,
    maps_scraped: { earliest: earliestScrape, latest: latestScrape },
    fintrac: {
      source: fintrac.src,
      registry_names_loaded: fintrac.set ? fintrac.set.size : 0,
      places_matched: fintrac.set ? fintracMatches : null,
      places_checked: fintrac.set ? fintracEligible : null,
      match_rate: (fintrac.set && fintracEligible)
        ? +(fintracMatches / fintracEligible).toFixed(3) : null,
    },
    by_status: {},
    by_area: {},
  };
  for (const s of STATUSES) summary.by_status[s] = 0;
  for (const a of AREA_ORDER) {
    summary.by_area[a] = { total: 0 };
    for (const s of STATUSES) summary.by_area[a][s] = 0;
  }
  for (const shop of shops) {
    summary.by_status[shop.status] = (summary.by_status[shop.status] || 0) + 1;
    for (const a of shop.areas) {
      if (!summary.by_area[a]) { summary.by_area[a] = { total: 0 }; for (const s of STATUSES) summary.by_area[a][s] = 0; }
      summary.by_area[a].total++;
      summary.by_area[a][shop.status]++;
    }
  }
  fs.writeFileSync(SUMMARY_OUT, JSON.stringify(summary, null, 2) + '\n');

  printSummary(summary, STATUSES);
}

function ruleEvidence(status, sub_type, p) {
  switch (status) {
    case 'noise':
      return `Rule: classified as noise (${sub_type}) from name/category "${p.category || ''}".`;
    case 'remittance_first':
      return `Rule: category "${p.category}" (money transfer/order) without strong exchange signal — unverified walk-in candidate, FLAGGED.`;
    case 'walk_in_unverified':
      return `Rule: "Currency exchange service" with street-retail address + phone. Honest default — NOT confirmed; needs phone/in-person check.`;
    case 'unknown':
      return `Rule: ambiguous (category "${p.category || '?'}", address "${p.address || '?'}"). Needs review.`;
    default:
      return null;
  }
}

// Industry-generic words that must NOT carry a fuzzy match on their own, else
// "X Currency Exchange" matches every "Y Currency Exchange" in the registry.
const FINTRAC_STOPWORDS = new Set([
  'CURRENCY', 'EXCHANGE', 'FOREIGN', 'MONEY', 'TRANSFER', 'TRANSFERS', 'FINANCIAL',
  'FINANCE', 'SERVICE', 'SERVICES', 'TRADING', 'TRADE', 'GLOBAL', 'INTERNATIONAL',
  'CASH', 'PAYMENTS', 'PAYMENT', 'REMITTANCE', 'FX', 'FOREX', 'BANK', 'BANKING',
  'CONSULTING', 'SOLUTIONS', 'CENTRE', 'CENTER', 'WORLD', 'CROSS', 'BORDER',
]);

function distinctiveTokens(norm) {
  return norm.split(' ').filter((t) => t.length >= 3 && !FINTRAC_STOPWORDS.has(t));
}

function fintracHas(set, name) {
  const norm = normalizeBizName(name);
  if (!norm) return false;
  if (set.has(norm)) return true; // exact normalized hit always wins

  // Fuzzy match on DISTINCTIVE tokens only (brand/family words, not industry words).
  const tokens = distinctiveTokens(norm);
  if (tokens.length < 1) return false;
  const tokenSet = new Set(tokens);
  for (const reg of set) {
    const regDistinct = new Set(distinctiveTokens(reg));
    if (regDistinct.size === 0) continue;
    let shared = 0;
    for (const t of tokenSet) if (regDistinct.has(t)) shared++;
    // Require either 2+ shared distinctive tokens, or — when the place name has a
    // single distinctive token — that token to exactly identify a short registry name.
    if (shared >= 2) return true;
    if (tokens.length === 1 && regDistinct.size === 1 && regDistinct.has(tokens[0])) return true;
  }
  return false;
}

function pad(s, n) { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)); }
function padL(s, n) { s = String(s); return ' '.repeat(Math.max(0, n - s.length)) + s; }

function printSummary(summary, STATUSES) {
  console.log('\n=== GTA Cash Exchange Directory — classification summary ===');
  console.log(`Total unique places: ${summary.total_unique_places}`);
  console.log(`Maps scraped: ${summary.maps_scraped.earliest} … ${summary.maps_scraped.latest}`);
  const f = summary.fintrac;
  if (f.source) {
    console.log(`FINTRAC: source=${f.source}, registry FX names=${f.registry_names_loaded}, matched ${f.places_matched}/${f.places_checked} (rate ${f.match_rate})`);
  } else {
    console.log('FINTRAC: not available — fintrac_registered=null for all places.');
  }

  // header
  const SHORT = {
    walk_in_confirmed: 'wi_conf', walk_in_unverified: 'wi_unver',
    remittance_first: 'remit', online_only: 'online', noise: 'noise', unknown: 'unknown',
  };
  const areaCol = 12;
  const cols = STATUSES.map((s) => padL(SHORT[s], 9)).join('');
  console.log('\n' + pad('AREA', areaCol) + cols + padL('TOTAL', 8));
  console.log('-'.repeat(areaCol + STATUSES.length * 9 + 8));
  for (const a of Object.keys(summary.by_area)) {
    const row = summary.by_area[a];
    const cells = STATUSES.map((s) => padL(row[s] || 0, 9)).join('');
    console.log(pad(a, areaCol) + cells + padL(row.total || 0, 8));
  }
  console.log('-'.repeat(areaCol + STATUSES.length * 9 + 8));
  const totalRow = STATUSES.map((s) => padL(summary.by_status[s] || 0, 9)).join('');
  console.log(pad('UNIQUE', areaCol) + totalRow + padL(summary.total_unique_places, 8));
  console.log('\n(area rows count appearances; a place in N queries is counted in N areas)');
  console.log('Wrote data/shops.json and data/shops-summary.json\n');
}

main();
