// Google Maps scraper — GTA currency exchange listings.
// Proven against real Maps on 2026-06-03 (392 rows, 6 queries, no captchas).
// Runs headless Chromium via Playwright. Designed to run from a RESIDENTIAL
// connection (your machine) — datacenter IPs (CI) will likely get blocked.
//
// Usage:
//   node pipeline/scrape.js                 # scrape all default queries -> data/raw/
//   node pipeline/scrape.js "<query>" out.json   # single query -> file
//
// If chromium is missing libs on WSL/Ubuntu (libnspr4 etc.) and you have no
// root: download the .debs with `apt-get download libnspr4 libnss3 libasound2t64`,
// `dpkg -x` them to a folder, and set LD_LIBRARY_PATH to its lib dir.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const RAW_DIR = path.join(__dirname, '..', 'data', 'raw');

const DEFAULT_QUERIES = [
  ['currency exchange near Downtown Toronto', 'downtown'],
  ['currency exchange near Scarborough, Toronto', 'scarborough'],
  ['currency exchange near North York, Toronto', 'northyork'],
  ['currency exchange near Markham, ON', 'markham'],
  ['currency exchange near Mississauga, ON', 'mississauga'],
  ['currency exchange Toronto', 'generic'],
];

async function scrapeQuery(browser, query) {
  const ctx = await browser.newContext({
    locale: 'en-CA',
    timezoneId: 'America/Toronto',
    geolocation: { latitude: 43.7315, longitude: -79.262 },
    permissions: ['geolocation'],
    viewport: { width: 1440, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();
  const url = 'https://www.google.com/maps/search/' + encodeURIComponent(query) + '?hl=en';
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  if (page.url().includes('consent.google.com')) {
    const btn = await page.$('button[aria-label*="Accept"], form[action*="consent"] button');
    if (btn) { await btn.click(); await page.waitForTimeout(3000); }
  }
  if ((await page.content()).match(/unusual traffic|recaptcha/i)) {
    await ctx.close();
    throw new Error('BLOCKED: captcha for query: ' + query);
  }

  await page.waitForSelector('div[role="feed"]', { timeout: 30000 });
  const feed = page.locator('div[role="feed"]');

  // Scroll the results feed until Google says "reached the end of the list".
  let prevCount = 0, stable = 0;
  for (let i = 0; i < 25; i++) {
    await feed.evaluate((el) => el.scrollBy(0, 3000));
    await page.waitForTimeout(1500 + Math.random() * 800);
    const endMarker = await page.locator('text=/reached the end of the list/i').count();
    const count = await page.locator('div[role="feed"] a[href*="/maps/place/"]').count();
    if (endMarker > 0) break;
    stable = count === prevCount ? stable + 1 : 0;
    if (stable >= 4) break;
    prevCount = count;
  }

  const results = await page.evaluate(() => {
    const cards = [];
    const links = document.querySelectorAll('div[role="feed"] a[href*="/maps/place/"]');
    const seen = new Set();
    for (const a of links) {
      const name = a.getAttribute('aria-label');
      if (!name || seen.has(name)) continue;
      seen.add(name);
      let card = a;
      while (card.parentElement && card.parentElement.getAttribute('role') !== 'feed') card = card.parentElement;
      const text = card.innerText.split('\n').filter((s) => s.trim());
      cards.push({ name, href: a.href, lines: text });
    }
    return cards;
  });

  const endReached = (await page.locator('text=/reached the end of the list/i').count()) > 0;
  await ctx.close();
  return { query, url, endReached, count: results.length, scrapedAt: new Date().toISOString(), results };
}

(async () => {
  const argQuery = process.argv[2];
  const argOut = process.argv[3];

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--lang=en-CA'],
  });

  try {
    if (argQuery) {
      const data = await scrapeQuery(browser, argQuery);
      const out = argOut || path.join(RAW_DIR, 'custom.json');
      fs.writeFileSync(out, JSON.stringify(data, null, 2));
      console.log(`${argQuery} -> ${data.count} results (endReached=${data.endReached}) -> ${out}`);
    } else {
      fs.mkdirSync(RAW_DIR, { recursive: true });
      for (const [query, slug] of DEFAULT_QUERIES) {
        try {
          const data = await scrapeQuery(browser, query);
          const out = path.join(RAW_DIR, slug + '.json');
          fs.writeFileSync(out, JSON.stringify(data, null, 2));
          console.log(`${slug}: ${data.count} results (endReached=${data.endReached})`);
        } catch (e) {
          console.error(`${slug}: FAILED — ${e.message} (keeping previous raw file if present)`);
        }
        // Polite gap between queries.
        await new Promise((r) => setTimeout(r, 5000 + Math.random() * 10000));
      }
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
