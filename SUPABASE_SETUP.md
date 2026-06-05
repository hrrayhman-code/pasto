# Pasto Reviews — Supabase setup (one-time, 5 minutes)

Follow these steps once. After that, customer reviews flow into your
admin dashboard automatically.

---

## 1. Create the database schema

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Paste the entire contents of `database/schema.sql`.
3. Click **Run**.

You should see "Success. No rows returned." — that's correct, the
script creates a table, policies, and a function.

---

## 2. Create your admin login

1. Supabase Dashboard → **Authentication** → **Users** → **Add user**.
2. Pick **Create new user**.
3. Enter your email and a strong password.
4. Check **Auto Confirm User** so you can log in immediately.
5. Click **Create user**.

This account is what you'll use to sign into `admin.html`.

---

## 3. Wire the keys into the website

1. Supabase Dashboard → **Settings** → **API**.
2. Copy two values:
   - **Project URL** (e.g. `https://abcd1234.supabase.co`)
   - **anon public** key (long string starting `eyJ…`)
3. Open `js/config.js` and replace the placeholders at the top:

   ```js
   const SUPABASE = {
     url: 'https://abcd1234.supabase.co',
     anonKey: 'eyJ...your-long-anon-public-key...'
   };
   ```

> The "anon public" key is safe to expose in client-side code.
> Row-Level Security (set up by `schema.sql`) is what actually
> protects the data — the public can only read approved reviews and
> insert pending ones; only logged-in admin can approve, pin, delete.

---

## 4. Use it

### Reviews
- **Customers**: open `index.html`, scroll to Reviews, click
  *Leave a review*. Their submission goes in as **pending**.
- **You**: open `admin.html` → sign in → **Reviews** tab.
  - **Pending tab**: Approve (goes live) or Reject (hidden).
  - **Approved tab**: Pin (sticks to top of public site) or Unpublish.
  - **Delete** is permanent on any tab.

### Orders + live status tracker
- **Customers**: build a cart, click *Check out via WhatsApp*, fill
  in the form, submit. The order is saved in Supabase AND a WhatsApp
  message with the order code (e.g. `#A1B2C3`) opens automatically.
  A live tracker card appears at the bottom-right of the page and
  polls every 15s for status changes. It survives page reloads.
- **You**: open `admin.html` → **Orders** tab.
  - The list auto-refreshes every 15 seconds (toggle in the toolbar).
  - For an active order, click **Mark as Preparing → In the oven →
    On the way → Delivered** to advance through the stages. The
    customer's tracker reflects the change within ~15 seconds.
  - **Cancel** sets the status to cancelled (also reflected to customer).
  - **Delete** removes the order permanently.
  - Stats: total orders, currently-active count, today's order count,
    delivered count, today's revenue.

> Want faster than 15s updates? Enable Supabase Realtime on the
> `orders` table (Database → Replication → tick `orders`) and we
> can swap polling for live subscription. Ping me to wire it up.

### Loyalty + Coupons + Referrals
- **Loyalty card (5-stamp)**: every customer is tracked by phone in
  the `loyalty` table. Every 5th order earns 1 free-item credit. The
  customer can check their progress from the new Rewards section on
  the homepage by entering their phone — they'll see a 5-stamp card
  and their personal referral code.
- **Promo codes**: open `admin.html` → **Coupons** tab → "+ New code"
  to create. Pick percent-off or flat-amount-off, optional max uses,
  expiry, and minimum order. Customers paste the code into the new
  Promo / referral code field in the checkout modal — discount is
  shown live before they submit.
- **Referral codes**: auto-generated for every customer when they
  place their first order. Shown in the order tracker (with copy
  button) and in the Rewards lookup. To make a referral *do* anything,
  manually create a matching coupon in admin → Coupons with that
  customer's referral code as the code, then anyone using it gets
  the discount.

### Re-run the schema
The script in `database/schema.sql` is idempotent — re-running it
adds new tables, RPCs, and storage buckets without affecting your
data. Run it again from Supabase → SQL Editor any time you pull
updates.

### Admin-managed menu + hero image
- **Menu** (admin.html → Menu tab): add new dishes, edit name /
  price / description, upload a photo, set display order, toggle
  visibility. Items live in the `menu_items` table; the homepage
  fetches them on every page load.
- **Site image** (admin.html → Site tab): upload a photo to appear
  in the top-right of the homepage hero, replacing the SVG pasta
  bowl. Stored as the `hero_image_url` row in `site_settings`.
- Photos upload to two public Supabase Storage buckets
  (`menu-images` and `site-images`) which the schema creates
  automatically with the correct public-read / authenticated-write
  policies.

---

## Optional: hide the admin link

The homepage footer has a low-opacity `Admin` link to `admin.html`
for convenience. Remove it from `index.html` if you'd rather
bookmark `admin.html` directly.
