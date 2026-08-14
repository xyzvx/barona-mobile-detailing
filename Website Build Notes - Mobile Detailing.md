---
project: Barona Mobile Detailing — Website
status: Hero, maintenance plans, gallery, and reviews shell built — 2 content items + real reviews still needed
last_updated: 2026-08-14
---

# Barona Mobile Detailing — Build Notes

## Goal
Free-to-launch website for Barona Mobile Detailing (mobile car detailing,
they come to the customer). Priorities set by owner: cheapest possible,
most efficient, most secure.

## Business info
- **Name:** Barona Mobile Detailing
- **Phone (call/text):** (309) 373-4642
- **Instagram:** @baronamobiledetailing
- **Google listing:** https://www.google.com/maps?cid=16452466691454619113
  (CID decoded from the share link the owner sent)
- **Tagline:** "Clean. Protect. Maintain." / "Detailing with purpose.
  Excellence in every detail."
- **Services & pricing:** Exterior Detail $150 · Interior Detail $150 ·
  Full Detail $300
- **Maintenance plans (from owner's pricing chart):**

  | Frequency | Visits/yr | Price | Annual | One-time equiv. | Savings |
  |---|---|---|---|---|---|
  | Weekly | 52 | $499/mo | $5,988 | $15,600 | 62% off |
  | Bi-Weekly | 26 | $299/mo | $3,588 | $7,800 | 54% off |
  | Monthly | 12 | $149/mo | $1,788 | $3,600 | 50% off |
  | Quarterly | 4 | $199/visit | $796 | $1,200 | 34% off |
  | Yearly | 1 | $249/visit | $249 | $300 | 17% off |

  (Full Detail plan; interior/exterior-only available at proportional
  pricing, ask when booking.)

## Stack — unchanged (still $0 to go live)
Static HTML/CSS/JS → Cloudflare Pages (free hosting/CDN/SSL/DDoS) ←
GitHub (free repo, auto-deploy) → Web3Forms (free contact form). Optional
custom domain later via Cloudflare Registrar (~$9–10/yr, no markup).

## What changed in this round (round 3)
- **New hero**, replacing the black "Keep Your Vehicle Looking Its Best"
  version: light/white background, bold black headline "Do You Want To
  Keep Your Car Clean?", subtext, black "Get My Car Cleaned" CTA, then a
  full-width photo of a black BMW below — this matches the Canva mockup
  the owner built and dropped in the vault almost exactly (same copy,
  same layout, same photo). Rest of the site stays on the dark/gold
  theme; only the hero is light, for contrast/attention.
- **Added a "Never Think About It Again" Maintenance Plans section**
  (new, between Services and Why Us) — a styled table built from the
  owner's pricing chart screenshot, with the Monthly plan highlighted in
  gold as it's the plan the owner's headline stat ("$149/month = a Full
  Detail at half price") calls out.
- **Added a gold "Now Booking" announcement bar** above the header,
  matching the mockup.
- **Filled the gallery** with 5 real job photos pulled from the owner's
  uploads (previously placeholder "Add Photo" boxes): BMW M4 exterior,
  Cadillac CT5 exterior, 2x BMW interiors, Cadillac interior.
- **Added a Reviews section shell** (`#reviews`) — NOT filled with real
  reviews yet, see "Still to do" below.
- Nav updated: added Plans + Reviews links.

## Still to do (owner action items)
1. **About text + Service Area** — could not find this anywhere in the
   vault folder despite the owner saying it was added; still bracketed
   placeholders in `index.html`. Need the owner to paste the text
   directly or point to where they saved it.
2. **Real Google reviews** — the owner sent a Google search link for the
   business; tried to scrape it two ways (direct fetch of the search
   URL, and the Maps URL built from the decoded CID) and both were
   blocked by Google (403 / robots.txt disallow — Google blocks
   automated scraping of both surfaces). No browser-automation tool was
   connected in this session either, so live browsing wasn't possible
   as a fallback. Reviews section currently shows a placeholder + a
   direct link to the Google listing instead of fabricated content —
   need the owner to paste review text/stars/names (or screenshots)
   directly so real reviews can go in.
3. Get a free Web3Forms access key (web3forms.com) and paste into the
   booking form.
4. Push to GitHub, connect to Cloudflare Pages (README §5–6) → live.
5. Optional later: custom domain via Cloudflare Registrar (README §7).

## Notes / decisions
- Deliberately did NOT invent About text, service area, or review
  content — all three are facts about the business that only the owner
  can confirm; placeholder/pending states were used instead so the site
  never states something untrue about the business.
- Chose Cloudflare Pages over plain GitHub Pages for the built-in
  WAF/DDoS layer and faster global CDN — still free, just more secure.
- No CMS/database used — the business doesn't need frequent content
  publishing; editing raw HTML stays simplest and most secure for this
  use case.
