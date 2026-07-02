// ==================================================
// PASTO — CONFIGURATION FILE
// ==================================================
// This is the file you'll edit most often.
// Change menu items, prices, WhatsApp number, etc. here.
// You don't need to touch index.html or app.js for normal updates.
// ==================================================

// ==================================================
// SUPABASE — Reviews backend
// ==================================================
// 1. Run database/schema.sql in Supabase SQL Editor.
// 2. Supabase Dashboard → Settings → API → copy the values below.
// 3. The "anon public" key is safe to expose in client-side code —
//    Row-Level Security (set up by schema.sql) protects the data.
// ==================================================
const SUPABASE = {
  url: 'https://ftgfqlfgqhckqljrufqd.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ0Z2ZxbGZncWhja3FsanJ1ZnFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3Mjk1MDQsImV4cCI6MjA5NTMwNTUwNH0.hk10kNbhu0HE9Buu-9HmY1EXxI3PRHy76VzqF-ZRqhA'
};

// ==================================================
// WEB PUSH — owner PWA order alerts (Spec #1)
// ==================================================
// The public VAPID key is safe to expose in client code.
// Generate the keypair once with:  npx web-push generate-vapid-keys
// Paste the *Public Key* here; the *Private Key* becomes an Edge Function secret.
const VAPID_PUBLIC_KEY = 'BNetH5RXTrZ8m3cjKwJa-sdW5-IaihqSbil5u07u1GVwpI75XqXZq0gpDDbjaBbHjkCCeW3BA6UH-b2KI2tS2dM';


const CONFIG = {

  // ============================================
  // CONTACT INFORMATION
  // Update these with your real info before going live.
  // ============================================

  // Your WhatsApp number in international format (no + or spaces)
  // Pakistan: replace leading 0 with 92. So 03001234567 becomes 923001234567
  whatsappNumber: '923302811842',

  // Phone number for "Call us" link (clickable on mobile)
  // Format: +923XXXXXXXXX
  phoneNumber: '+923302811842',

  // Display version of phone number (what customers see)
  phoneDisplay: '0330 2811842',

  // Your Foodpanda restaurant page URL (update after creating account)
  foodpandaURL: 'https://www.foodpanda.pk',

  // Your Instagram handle (without the @)
  instagramHandle: 'pastobyaiman',

  // Your email
  email: 'pastobyaiman@gmail.com',

  // ============================================
  // CURRENCY
  // ============================================
  currency: 'Rs.',

  // ============================================
  // DELIVERY HOURS (shown in contact section)
  // ============================================
  deliveryHours: 'Daily, 06:00 pm to 11:00 pm',
  deliveryAreas: 'Most areas of Karachi',

  // ============================================
  // BUSINESS HOURS — orders are BLOCKED outside these hours.
  // Times are in Karachi local time (Asia/Karachi, UTC+5).
  // Format: 'HH:MM' in 24-hour.
  // ============================================
  businessHoursStart: '18:00',   // 6:00 PM
  businessHoursEnd:   '23:00',   // 11:00 PM

  // ============================================
  // LAUNCH DATE
  // ============================================
  // Set this to the moment you want orders to go live.
  // The site shows a countdown + blocks orders until this date.
  // Format: ISO string. Use Karachi time (UTC+5).
  //   Example: '2026-07-01T00:00:00+05:00' = 1 July 2026, midnight Karachi
  // To go live immediately, set launchDate to null or a past date.
  launchDate: '2026-07-01T00:00:00+05:00',
};


// ==================================================
// MENU ITEMS
// ==================================================
// To edit menu items:
//   1. Update name, description, price for existing items
//   2. To add a new item, copy an existing object and change the id (must be unique)
//   3. To remove an item, delete its entire { ... } block
//
// IMAGE OPTIONS:
//   - To use an illustration (default): leave imageUrl as null
//   - To use a photo: set imageUrl: 'images/your-photo.jpg'
//     Photos should be 800x600px or similar 4:3 aspect ratio
//     Save photos in the /images folder
//
// TAG OPTIONS:
//   - 'signature' = red badge (your hero items)
//   - 'veg' = green badge (vegetarian)
//   - 'spicy' = orange badge (for spicy items)
//   - any other text just shows as a dark badge
// ==================================================

// Menu is now managed from the admin dashboard and stored in Supabase.
// The array below is just a fallback shown on first paint while the API
// loads — app.js will overwrite MENU with the live database contents.
let MENU = [
  {
    id: 'alfredo',
    name: 'Pasta Alfredo',
    desc: 'Creamy cheese sauce tossed with tender chicken and fettuccine, finished with cracked black pepper.',
    price: 650,                              // <-- UPDATE PRICE HERE
    tag: 'signature',
    tagLabel: 'Signature',
    imageUrl: null,                          // <-- Set to 'images/alfredo.jpg' when you have a photo
    iconColor: '#FFF8F0',
    accentColor: '#E63946'
  },
  {
    id: 'pink',
    name: 'Pink Sauce Pasta',
    desc: 'Slow-simmered tomato cream sauce with garlic, herbs, and a touch of chili. Comforting, balanced, addictive.',
    price: 700,                              // <-- UPDATE PRICE HERE
    tag: 'signature',
    tagLabel: 'Signature',
    imageUrl: null,                          // <-- Set to 'images/pink.jpg' when you have a photo
    iconColor: '#FFE0E0',
    accentColor: '#E63946'
  },
  {
    id: 'green',
    name: 'Lean Green Pasta',
    desc: 'Fresh basil pesto with spinach, olive oil, garlic, and parmigiano. Bright, herby, satisfying.',
    price: 750,                              // <-- UPDATE PRICE HERE
    tag: 'spicy',
    tagLabel: 'Spicy',
    imageUrl: null,                          // <-- Set to 'images/green.jpg' when you have a photo
    iconColor: '#E8F0E2',
    accentColor: '#2d6a3f'
  },
  {
    id: 'garlic',
    name: 'Classic Garlic Bread',
    desc: 'Buttery, garlicky, herbed bread toasted till the edges crisp. Made fresh, never reheated.',
    price: 250,                              // <-- UPDATE PRICE HERE
    tag: 'veg',
    tagLabel: 'Side',
    imageUrl: null,                          // <-- Set to 'images/garlic.jpg' when you have a photo
    iconColor: '#F5E8C8',
    accentColor: '#C9A876'
  },
  {
    id: 'sausage',
    name: 'Smoky Sausage Bruschetta',
    desc: 'Toasted bread topped with smoky sausage, tomato, herbs, and olive oil. Hearty bite-sized starter.',
    price: 350,                              // <-- UPDATE PRICE HERE
    tag: 'spicy',
    tagLabel: 'Side',
    imageUrl: null,                          // <-- Set to 'images/sausage.jpg' when you have a photo
    iconColor: '#FFE0CC',
    accentColor: '#d97706'
  }
];


// ==================================================
// REVIEWS — now managed in Supabase
// ==================================================
// All reviews live in the Supabase 'reviews' table. Customers submit
// from the website (status='pending'). You moderate at /admin.html:
// approve, pin, delete. The public homepage shows only approved
// reviews automatically.
// ==================================================
