# Barona Mobile Detailing — Website

A fast, secure, 100% free-to-host website: plain HTML/CSS/JS, no framework.
Built using your real logo, brand colors (black / white / gold), and the BMW
photo from your flyer. The one exception to "no server, no database" is the
booking calendar below — showing real-time availability to every visitor
needs a small shared database, so that one piece runs on a free Cloudflare
Worker + D1 database instead of being plain static files.

## 0. Booking calendar setup (one-time, ~15 minutes)

The site now shows a live calendar on the Book Your Detail section — green
days have open times, red days are fully booked, gray days are closed. It's
powered by three new files: `worker.js` (the logic), `wrangler.toml` (tells
Cloudflare about the database), and `schema.sql` (the database structure).

**Business hours baked in:** Mon–Sat, 9am–5pm, offering start times on the
hour. Sundays are always closed. Appointment length depends on the service
picked: Exterior Detail and Interior Detail are 3 hours, Full Detail is 6
hours ("Not sure" defaults to 6 hours, to be safe). That means the calendar
shows different open times for different services — e.g. Full Detail can
only start at 9, 10, or 11am (so it still finishes by 5pm), while a 3-hour
service can start any hour from 9am to 2pm. To change hours, appointment
lengths, or pricing text, edit `OPEN_MIN` / `CLOSE_MIN` / `SERVICE_META` at
the top of `worker.js`.

Steps:

1. In the Cloudflare dashboard, go to **Storage & Databases → D1** and
   create a new database named `barona-bookings`.
2. Open it and find its **Database ID** (shown on its overview/settings
   page) — copy it.
3. In `wrangler.toml` (in your GitHub repo), replace
   `PASTE_YOUR_D1_DATABASE_ID_HERE` with that ID and commit.
4. Back in the database's dashboard page, find the **Console** (sometimes
   called "Query" or "Execute SQL") tab. Paste in the entire contents of
   `schema.sql` and run it — this creates the `bookings` and `closed_days`
   tables. You only do this once.
5. Make sure `worker.js`, `wrangler.toml`, and `schema.sql` are all uploaded
   to your GitHub repo (root folder, alongside `index.html`), along with the
   updated `index.html`, `style.css`, `script.js`, and the new `calendar.js`.
   Commit changes — Cloudflare will redeploy automatically.
6. Open the live site and check the Book Your Detail section: you should
   see a calendar with green days. Click one, pick a time, and submit a
   test booking — then reload the page and confirm that day/time now shows
   as booked (or red, if it was the only open slot).

**To view or cancel bookings:** Cloudflare dashboard → your D1 database →
**Tables** → `bookings`. No extra login or admin page needed — you can see
every booking there, and change a row's `status` to `cancelled` to free that
slot back up. To block off a specific day (vacation, etc.) even though it'd
normally be open, add a row to the `closed_days` table with that date.

Every new booking still emails you (via the same Web3Forms setup as before)
so you don't have to keep the dashboard open — the calendar is the source
of truth, the email is just the heads-up.

## 1. Two things still needed from you

I couldn't find these anywhere in the vault folder yet, so they're still
`[Bracketed]` placeholders in `index.html`:

- **About section**: a couple sentences about you / how you started.
- **Service Area section**: the cities or zip radius you serve.

Just send the text and I'll drop it in — or edit it directly in `index.html`
(search for `[A couple sentences...]` and `[Service Area —`).

Also still a placeholder: **`[yourdomain].com`**, which appears a few times
(Open Graph tags, JSON-LD) — update once you pick a domain in step 6 below,
or leave as-is on the free `*.pages.dev` URL.

## 2. Reviews section

The Reviews section (`#reviews` in `index.html`) is built and styled but
currently shows a placeholder message + a link straight to your Google
listing, because Google blocks automated tools from scraping review text
(both the search page and Maps returned "access denied" when I tried). To
finish it, send me the review text/star ratings/names directly (copy-paste
or a screenshot works) and I'll drop them into the `.review-card` markup —
the HTML comment right above the placeholder shows the exact format.

## 3. Add more photos

Drop new photos into `assets/` and swap them into the Gallery section
(`<div class="gallery-item gallery-photo">`), same pattern as the 5 photos
already there. Before/after pairs sell the most — worth prioritizing those
as you shoot more jobs.

## 4. Turn on the contact form (2 min, free)

1. Go to https://web3forms.com and enter your email — no account needed,
   you just get a free "Access Key" emailed to you.
2. Paste that key into `index.html`, replacing `YOUR_WEB3FORMS_ACCESS_KEY`
   in the hidden `access_key` input inside the booking form.
3. Every booking request will land in your inbox. Free tier covers plenty
   of volume for a local business; spam filtering is built in.

## 5. Put it on GitHub (free)

1. Create a free account at https://github.com (if you don't have one).
2. Create a new **public** repository, e.g. `mobile-detailing-site`.
3. Upload all files in this folder to that repository (drag-and-drop
   works fine on github.com, or use `git push` if you're comfortable
   with git).

## 6. Deploy for free with Cloudflare Pages

Cloudflare Pages gives you: free hosting, free global CDN (fast
everywhere), free SSL/HTTPS, free DDoS protection, and no bandwidth caps
on the free tier — this is the most efficient and secure free option
available.

1. Go to https://dash.cloudflare.com → sign up free.
2. **Workers & Pages → Create → Pages → Connect to Git.**
3. Pick the GitHub repo you just made.
4. Build settings: leave the build command **empty** (this is a static
   site, nothing to build) and set the output directory to `/`.
5. Click **Save and Deploy**. In under a minute you'll get a live URL
   like `https://mobile-detailing-site.pages.dev` — that's your free
   website, live on the internet.

From now on, every time you edit a file in GitHub, Cloudflare
auto-redeploys the update within seconds — no manual re-upload ever again.

### Alternative: GitHub Pages
If you'd rather stay entirely inside GitHub: repo **Settings → Pages →
Deploy from branch → main**. You'll get `https://yourusername.github.io/mobile-detailing-site`.
Cloudflare Pages is recommended over this because it adds a security layer
(WAF/DDoS protection) and a faster global CDN, both still free.

## 7. (Optional) Add a real domain — cheapest path (~$9–10/yr)

A domain is the only part of this that isn't free — registries charge
Cloudflare and everyone else a wholesale fee. Cloudflare Registrar sells
at that wholesale cost with **no markup** and includes free WHOIS privacy,
which is typically the cheapest legitimate way to buy a `.com`.

1. In the Cloudflare dashboard: **Domain Registration → Register a
   Domain**, search your name, and buy it (~$9–10/yr for `.com`).
2. Go to your Pages project → **Custom domains → Set up a custom domain**
   → pick the domain you just bought. Cloudflare wires up the DNS and
   HTTPS certificate automatically, free.
3. (Optional, free) **Email Routing** in the Cloudflare dashboard lets you
   receive email at `you@yourdomain.com` and have it forwarded straight to
   your personal inbox — a free professional email address.

Until you're ready to pay for a domain, the free `*.pages.dev` address
works perfectly and is fully live on the public internet — share it, put
it on a business card QR code, whatever you like.

## 8. Free, privacy-respecting analytics (optional)

Cloudflare Pages → your project → **Analytics → Web Analytics → Enable**.
No cookies, no tracking scripts, GDPR-friendly, and free — a better choice
than Google Analytics if you want visitor counts without the tracking
baggage.

## Why this stack

- **Free**: hosting, CDN, SSL, DDoS protection, and the contact form are
  all $0. The only optional cost is a custom domain (~$9–10/yr).
- **Secure**: a static site has no server, no database, and no login —
  the most common attack vectors (SQL injection, server exploits, leaked
  credentials) simply don't apply. `_headers` adds standard hardening
  headers on top.
- **Efficient**: no build step, no framework overhead, loads fast on
  mobile, and auto-deploys from git on every edit.
- **No lock-in**: it's just files in a git repo you own — move host at
  any time, nothing proprietary.

**One tradeoff worth knowing:** the headline/accent fonts (Archivo Black +
Playfair Display, matching your logo's look) load from Google Fonts —
still free, but it's the one external request on the page. If you'd rather
have zero third-party requests, swap the `<link>` tags in the `<head>` for
a system font stack in `style.css` (`--font-display` / `--font-serif`) —
it'll look slightly plainer but be 100% self-contained.
