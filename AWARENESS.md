# What to be aware of — GTA Cash Exchange Directory

The honest risk register. Read this before investing more time. Sources: idea-attack round 1 (4 adversarial agents + fact-checker, 2026-06-03), Test 0 Maps scrape (274 places), office-hours session (2026-06-04).

## The hard truths (from the attack round)

1. **Moat is thin by design.** The bare list scored 2/10 — anyone can replicate it with a Google My Maps post in an afternoon. The only defensible assets are (a) the evidence ledger (dated verdicts with quotes) and (b) the repeatable pipeline. If a Redditor clones the visible value within weeks of launch, the moat thesis was wrong — that's a recorded KILL signal, take it seriously.
2. **Demand for "takes cash" is a hypothesis.** Confirmed demand exists only for the generic query ("currency exchange + place", 9 years of RedFlagDeals threads). Nobody searches "currency exchange that takes cash" — the trap is discovered at the shop door. The SEO design targets the generic query for this reason. Don't build niche-phrase pages expecting volume.
3. **Maps mostly works in the suburbs.** North York 10/10, Scarborough 9/10, Mississauga 9/10 first-page accuracy. The site's edge is real only in: generic city-wide searches (6/10), Markham (5/10), downtown towers (7/10), and the trust layer itself. Don't oversell the gap.
4. **Cash FX is a shrinking category.** Cash fell from ~25% to 11% of Canadian transactions 2019-2024 (Payments Canada). Wise/KnightsbridgeFX absorb the rate-shoppers. The durable segment: newcomers, travel cash, cash-preferring communities. Ceiling acknowledged: lifestyle utility, not a startup (R1: ~$4-8K MRR GTA best case, and that requires shop monetization we haven't designed).
5. **Two predecessors died here.** "Currency Exchange Near Me" (2020) and "Foreign Currency Finder" (2016), both geographic aggregators, both zero ratings. Their (assumed) failure mode: stale unverified data + no distribution. Our counters: evidence badges + SEO pages + repeatable refresh. If refresh discipline lapses, we become predecessor #3.

## Operational risks

6. **The scraper depends on Google's DOM and tolerance.** It worked clean on 2026-06-03 from a residential WSL connection. It WILL eventually break (selector changes) or get challenged (captcha). Mitigations: run locally (never CI — datacenter IPs are blocked), keep query count low (6), random delays. Fallback if blocked permanently: Apify's `compass/crawler-google-places` actor (~$4/1000 places, free $5/mo credit covers a monthly refresh).
7. **Auto-classification has a measured-ish error rate.** The cold-read reviewer predicted 60-75% precision on the ambiguous tail, with errors in the dangerous direction (false "walk-in"). That's why the default badge is "call ahead", never "confirmed". DO NOT relax this honesty rule for nicer-looking pages — a wrong "confirmed" badge recreates the exact trap this site exists to fix, with our name on it.
8. **122 of 274 original classifications were UNCERTAIN** (mostly small independents assumed walk-in from category+address). The phone pass (~30-50 calls, one afternoon) is the single highest-value data improvement available. It is also The Assignment from the design doc.
9. **Hours data is a snapshot.** The `hours_line` field is whatever Maps showed on scrape day ("Closed · Opens 10 a.m. Thu"). It's labeled "as scraped" on shop pages. Don't present it as live.
10. **FINTRAC join is fuzzy name-matching.** False negatives guaranteed (registry names ≠ storefront names). "No match found" is shown neutrally, never as an accusation. Also: FINTRAC registration ≠ walk-in cash (online-only MSBs register too).

## Legal / etiquette

11. **Scraping Google Maps** violates Google's ToS (a civil/contract matter, not criminal; widely done — GasBuddy-style aggregators live on it). Risk: IP blocks, not lawsuits, at this scale. Don't republish Google's reviews text; we only use category/address/phone/hours/rating facts.
12. **Listing businesses without consent is legal and standard** (Yelp/YellowPages model — confirmed in R1 legal check). The no-cash list states facts with quoted evidence; truth is the defence. Keep evidence strings verbatim and dated. If a business disputes, verify by phone and correct fast — the GitHub issues link exists for this.
13. **FINTRAC open data** is commercially reusable (Open Government Licence — Canada), attribution required — it's in the site footer. Displaying FX information does not make us an MSB (no transactions conducted).

## Strategy notes

14. **Scoreboard (D1 decision, final):** Search Console organic clicks + repeat visits. Community growth explicitly waived for this project. Do not re-litigate in month 4.
15. **Kill/continue checkpoints:** Week 4 — site indexed, any organic impressions on area queries? Week 8 — clicks trending up? If zero impressions by week 8, the SEO bet failed; either seed via Reddit answers (RFD thread, r/askTO) or shelve. The site costs $0/mo to leave running either way.
16. **Rates stay out until shops post them.** Every rate-display idea collapses on the same fact: GTA shops quote by phone only. Crowdsourced rates need contributor mass we don't have (R1: GasBuddy loop structurally impossible here). Revisit only if shops start submitting rates themselves.
17. **The exposé page is the marketing asset.** "35 GTA currency exchange listings that won't take your cash" is the shareable, linkable thing. If you do one piece of outreach, it's that page answered into the standing RFD/Reddit threads.

## The assignment (one afternoon, highest ROI)

Call the ambiguous-tail shops (~30-50). One question: "Do you exchange cash in person, walk-in?" Log into `data/overrides.json` as `verified_phone: {date, answer}`, rerun `bash pipeline/refresh.sh --no-scrape`, redeploy. This converts the site's weakest claim ("likely walk-in") into its moat.
