# Pasto Website

A single-page website for Pasto, the home-based Italian pasta brand in Karachi. Built with plain HTML, CSS, and JavaScript — no build tools, no frameworks, no dependencies.

## Project structure

```
pasto-website/
├── index.html              ← Page structure (edit text content here)
├── css/
│   └── styles.css          ← All visual styling (colors, fonts, layout)
├── js/
│   ├── config.js           ← Menu items, prices, contact info ⭐ EDIT THIS MOST
│   └── app.js              ← Cart logic, checkout, animations
├── images/                 ← Drop food photos here when you have them
│   └── README.md           ← Photo specs and instructions
├── assets/
│   ├── favicon.svg         ← Browser tab icon
│   ├── logo-primary.svg    ← Full logo with tagline
│   ├── logo-horizontal.svg ← Horizontal lockup
│   ├── logo-icon.svg       ← Square icon
│   ├── og-image.png        ← Social sharing preview (1200×630)
│   └── og-image.svg        ← Editable source
└── README.md               ← This file
```

## Quick start

1. Open the `pasto-website` folder in **Visual Studio Code**
2. Install the **"Live Server"** extension (by Ritwick Dey) from the Extensions panel
3. Right-click `index.html` → "Open with Live Server"
4. Your browser opens at `http://127.0.0.1:5500` — any change you save reloads instantly

## Before going live — update these 3 things

### 1. WhatsApp number
Open `js/config.js` and find:
```javascript
whatsappNumber: '923XXXXXXXXX',
phoneNumber: '+923XXXXXXXXX',
phoneDisplay: '03XX XXXXXXX',
```

Replace with your real number. **Pakistan format**: remove the leading 0 and add 92.
- Your number: `0301 1234567`
- For `whatsappNumber`: `923011234567`
- For `phoneNumber`: `+923011234567`
- For `phoneDisplay`: `0301 1234567` (this is what customers see)

### 2. Foodpanda URL
In `js/config.js`:
```javascript
foodpandaURL: 'https://www.foodpanda.pk',
```
Replace with your actual Foodpanda restaurant page URL once you create it.

### 3. Menu prices
In `js/config.js`, scroll down to the `MENU` array. Each item has a `price` line marked with `<-- UPDATE PRICE HERE`. Replace the placeholder numbers (650, 700, 750, 250, 350) with your actual prices.

## Common edits

### Change the hero title
Open `index.html`, find:
```html
<h1 class="hero-title">Pasta the way it <em>should</em> be made.</h1>
```
Edit the text. Words inside `<em>` will display in italic red.

### Change the story text
Open `index.html`, find the `<section class="story-section">` block. Edit the quote and paragraph text.

### Change brand colors
Open `css/styles.css`. The first block (`:root`) has all the color values:
```css
--red: #E63946;
--charcoal: #1A1A1A;
--cream: #FFF8F0;
```
Change these and the entire site updates.

### Add a new menu item
Open `js/config.js`, copy any existing menu item block, paste it inside the `MENU` array, and change the `id` (must be unique) plus the name, description, price, etc.

### Add food photos
See `images/README.md` for detailed instructions. Short version:
1. Save photos in `/images` folder (800×600 jpg, under 200KB each)
2. In `js/config.js`, change `imageUrl: null` to `imageUrl: 'images/alfredo.jpg'`

## Deploy to the internet

### Option 1: Netlify (free, easiest, 5 minutes)

1. Go to [netlify.com](https://netlify.com) and sign up with Google
2. Click **"Add new site"** → **"Deploy manually"**
3. Drag your entire `pasto-website` folder into the deploy area
4. Wait 30 seconds. Your site is live at something like `pasto-karachi.netlify.app`
5. Click **"Site settings"** → **"Change site name"** to customize the URL

### Option 2: Custom domain (recommended, ~Rs. 3000/year)

After deploying to Netlify:
1. Buy a domain at [PKNIC](https://pknic.net.pk) (for `.pk`) or [Namecheap](https://namecheap.com) (for `.com`)
2. Recommended: `pasto.pk` or `pastokarachi.com`
3. In Netlify: **Domain settings** → **Add custom domain** → follow DNS instructions
4. Takes 1-24 hours to activate

### Option 3: GitHub Pages (free, if you use Git)

1. Push the `pasto-website` folder to a GitHub repository
2. Go to repo Settings → Pages → Source: main branch
3. Your site is live at `username.github.io/pasto-website`

## How orders work

```
Customer visits pasto.pk
   ↓
Browses menu, adds items to cart
   ↓
Clicks "Cart" → reviews order
   ↓
Clicks "Check out via WhatsApp"
   ↓
Fills in name, phone, address, notes
   ↓
Clicks "Send to WhatsApp"
   ↓
WhatsApp opens with order pre-filled, addressed to YOUR number
   ↓
Customer hits send
   ↓
You receive the order in WhatsApp
   ↓
You confirm with customer, cook order, dispatch for delivery
   ↓
Cash on delivery — handled by your rider
```

## Order message format

Each order arrives formatted like this:

```
*New Pasto order*

*Customer:* Ahmed Khan
*Phone:* 0321 1234567
*Address:* House 45, Street 12, DHA Phase 5, Karachi

*Order:*
• 2× Pasta Alfredo — Rs. 1300
• 1× Garlic Bread — Rs. 250

*Total:* Rs. 1550
*Payment:* Cash on delivery

*Notes:* Less spicy please
```

## Tech notes

- **No framework**: plain HTML, CSS, JavaScript. Loads instantly even on slow Karachi internet.
- **Mobile-first**: tested at 390px (iPhone) and 1440px (desktop)
- **Fonts**: Fraunces (display serif) and DM Sans (body) loaded from Google Fonts
- **Cart persistence**: uses browser `localStorage` — survives page refresh, clears after order
- **No backend**: orders are sent via WhatsApp deep link, no database needed
- **No tracking/cookies**: privacy-respecting by default

## Recommended VS Code extensions

- **Live Server** (Ritwick Dey) — auto-reloading dev server
- **Prettier** (Prettier) — auto-format code
- **Auto Rename Tag** (Jun Han) — when you rename a tag, the closing tag updates too
- **Color Highlight** (Sergii N) — shows hex colors inline in CSS

## Future upgrades to consider

When you grow beyond home-based orders:

- Add Google Analytics (paste a tracking snippet before `</head>`)
- Add Facebook Pixel for retargeting ads
- Add a reviews/testimonials section once you have happy customers
- Add an Instagram feed widget showing recent posts
- Add a blog section if you want to write about pasta and your journey
- Upgrade to a real e-commerce platform (Shopify, etc.) if you start doing 100+ orders/day

## Questions?

Everything in this site is plain HTML/CSS/JavaScript. Any web developer can edit it. The code is heavily commented to make changes easy.

---

**Pasto · real ingredients, real pasta. · Karachi · 2026**
