# GTA Cash Exchange Directory

Walk-in currency exchange shops in Toronto/GTA that **actually take cash at the counter** — with honest verification badges. Built because Google Maps' "currency exchange" category mixes real shops with online-only offices (we measured ~13% of 274 listings; 31 carry named evidence and are listed publicly).

**Live site:** https://gta-cash-exchange.kivov-digital.workers.dev

## How it works

```
pipeline/scrape.js     Google Maps results (headless Playwright, 6 GTA queries)
        ↓ data/raw/*.json
pipeline/classify.js   deterministic rules + evidence overrides + FINTRAC join
        ↓ data/shops.json
site/build.js          static HTML (area pages, shop pages, no-cash exposé, sitemap)
        ↓ dist/
wrangler pages deploy  Cloudflare Pages
```

One command refresh: `bash pipeline/refresh.sh` (or `--no-scrape` to reuse raw data).

## Honesty rules (read before editing)

- `walk_in_confirmed` is ONLY set via `data/overrides.json` with dated evidence (a website quote, a phone call). The classifier never auto-confirms.
- The default for a plausible shop is `walk_in_unverified` → shown as "Likely walk-in — call ahead".
- `online_only` verdicts carry their evidence string and are shown publicly on `/no-cash-list/`.
- Phone verifications go in `overrides.json` as `"verified_phone": {"date": "YYYY-MM-DD", "answer": "yes|no"}`.

## Run locally

```bash
npm install            # playwright (scrape only; classify+build are dep-free)
node pipeline/classify.js
node site/build.js
npx serve dist
```

Scraping must run from a residential connection (datacenter IPs get blocked by Google). On WSL without root, see the lib note at the top of `pipeline/scrape.js`.

## Deploy

```bash
npx wrangler login     # one-time
npm run deploy
```

## Data sources

- Google Maps search results (scraped 2026-06-03)
- [FINTRAC MSB Registry](https://open.canada.ca/data/en/dataset/8beacccf-3b54-4d12-9cf7-24e2ada90a83) — Open Government Licence, Canada
- Manual evidence research (quoted per shop)

## Origin

Validated through an idea-attack process (4 adversarial agents + fact-checker) and a measured Test 0 (real Maps scrape) before any code was written. Design doc: `DESIGN.md`. Things to watch: `AWARENESS.md`.
