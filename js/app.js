// ==================================================
// PASTO — APPLICATION LOGIC
// ==================================================
// This file handles:
//   - Rendering the menu cards
//   - Cart management (add/remove/update quantities)
//   - Cart drawer open/close
//   - Checkout modal
//   - Sending order to WhatsApp
//   - Scroll reveal animations
//
// You generally don't need to edit this file.
// Edit js/config.js to change menu items and contact info.
// ==================================================


// ==================================================
// STATE
// ==================================================
let cart = JSON.parse(localStorage.getItem('pastoCart') || '{}');


// ==================================================
// DISH ICON GENERATOR
// Returns either the illustration SVG or the photo IMG
// ==================================================
function dishVisual(item, size = 'large') {
  // If a photo URL is provided in config, use it
  if (item.imageUrl) {
    return `<img src="${escapeHTML(item.imageUrl)}" alt="${escapeHTML(item.name)}" loading="lazy">`;
  }

  // Otherwise, return the illustrated icon. Validate DB-sourced colors (Finding 14).
  const c = hexOr(item.accentColor, '#E63946');
  const ic = hexOr(item.iconColor, '#FFF8F0');

  if (item.id === 'alfredo' || item.id === 'pink' || item.id === 'green') {
    return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="42" fill="${ic}" stroke="#1A1A1A" stroke-width="1.5"/>
      <ellipse cx="50" cy="50" rx="34" ry="10" fill="${c}" opacity="0.2"/>
      <g stroke="${c}" stroke-width="2.5" fill="none" stroke-linecap="round">
        <path d="M 22 48 Q 38 42 50 48 Q 62 54 78 48"/>
        <path d="M 24 52 Q 40 56 52 50 Q 64 44 76 52"/>
        <path d="M 24 46 Q 38 38 52 46 Q 66 52 76 44"/>
      </g>
      ${item.id === 'green' ? '<g fill="#2d6a3f"><ellipse cx="40" cy="50" rx="3" ry="1.5" transform="rotate(-30 40 50)"/><ellipse cx="60" cy="48" rx="2.5" ry="1.5" transform="rotate(20 60 48)"/></g>' : ''}
      ${item.id === 'pink' ? '<g fill="#E63946"><circle cx="42" cy="52" r="2"/><circle cx="58" cy="48" r="1.8"/></g>' : ''}
    </svg>`;
  }

  if (item.id === 'garlic') {
    return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="18" y="38" width="64" height="24" rx="4" fill="${ic}" stroke="#1A1A1A" stroke-width="1.5"/>
      <line x1="34" y1="38" x2="34" y2="62" stroke="#1A1A1A" stroke-width="1"/>
      <line x1="50" y1="38" x2="50" y2="62" stroke="#1A1A1A" stroke-width="1"/>
      <line x1="66" y1="38" x2="66" y2="62" stroke="#1A1A1A" stroke-width="1"/>
      <g fill="#2d6a3f">
        <ellipse cx="26" cy="46" rx="2.5" ry="1.2" transform="rotate(-30 26 46)"/>
        <ellipse cx="42" cy="42" rx="2.5" ry="1.2" transform="rotate(15 42 42)"/>
        <ellipse cx="58" cy="50" rx="2.5" ry="1.2" transform="rotate(-20 58 50)"/>
        <ellipse cx="74" cy="46" rx="2.5" ry="1.2" transform="rotate(25 74 46)"/>
      </g>
    </svg>`;
  }

  if (item.id === 'sausage') {
    return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="22" y="40" width="56" height="20" rx="3" fill="${ic}" stroke="#1A1A1A" stroke-width="1.5"/>
      <g fill="#d97706">
        <ellipse cx="35" cy="45" rx="6" ry="2.5" transform="rotate(-10 35 45)"/>
        <ellipse cx="50" cy="48" rx="6" ry="2.5" transform="rotate(15 50 48)"/>
        <ellipse cx="66" cy="46" rx="6" ry="2.5" transform="rotate(-20 66 46)"/>
      </g>
      <g fill="#E63946">
        <circle cx="32" cy="52" r="1.5"/>
        <circle cx="48" cy="54" r="1.5"/>
        <circle cx="62" cy="52" r="1.5"/>
      </g>
      <g fill="#2d6a3f">
        <ellipse cx="40" cy="56" rx="2" ry="1" transform="rotate(-30 40 56)"/>
        <ellipse cx="58" cy="55" rx="2" ry="1" transform="rotate(20 58 55)"/>
      </g>
    </svg>`;
  }

  // Fallback for any new item without a custom icon
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="42" fill="${ic}" stroke="#1A1A1A" stroke-width="1.5"/>
    <text x="50" y="58" text-anchor="middle" font-family="Fraunces, serif" font-size="32" font-weight="500" fill="${c}">P</text>
  </svg>`;
}


// ==================================================
// RENDER MENU
// ==================================================
function menuCardControlHTML(id) {
  const qty = cart[id] || 0;
  if (qty > 0) {
    return `
      <div class="menu-qty" data-id="${id}">
        <button class="qty-btn" onclick="changeQty('${id}', -1)" aria-label="Decrease">−</button>
        <span class="qty-val">${qty}</span>
        <button class="qty-btn" onclick="changeQty('${id}', 1)" aria-label="Increase">+</button>
      </div>
    `;
  }
  return `
    <button class="add-btn" data-id="${id}" onclick="addToCart('${id}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
      Add
    </button>
  `;
}

function updateMenuCardControl(id) {
  const card = document.querySelector(`.menu-card[data-id="${id}"]`);
  if (!card) return;
  const slot = card.querySelector('.menu-card-control');
  if (slot) slot.innerHTML = menuCardControlHTML(id);
}

function updateAllMenuCardControls() {
  document.querySelectorAll('.menu-card[data-id]').forEach(card => {
    const id = card.getAttribute('data-id');
    const slot = card.querySelector('.menu-card-control');
    if (slot) slot.innerHTML = menuCardControlHTML(id);
  });
}

function renderMenu() {
  const grid = document.getElementById('menuGrid');
  grid.innerHTML = MENU.map(item => `
    <div class="menu-card reveal" data-id="${escapeHTML(item.id)}">
      <div class="menu-card-visual">
        <span class="menu-card-tag ${String(item.tag || '').replace(/[^a-z]/gi, '')}">${escapeHTML(item.tagLabel)}</span>
        ${dishVisual(item)}
      </div>
      <h3 class="menu-card-title">${escapeHTML(item.name)}</h3>
      <p class="menu-card-desc">${escapeHTML(item.desc)}</p>
      <div class="menu-card-foot">
        <div class="menu-price"><span class="menu-price-currency">${CONFIG.currency}</span>${item.price}</div>
        <div class="menu-card-control">${menuCardControlHTML(item.id)}</div>
      </div>
    </div>
  `).join('');
  observeReveals();
  setupMenuScroller();
}


// ==================================================
// MENU SCROLLER — arrows, edge fades, swipe hint
// ==================================================
function setupMenuScroller() {
  const grid     = document.getElementById('menuGrid');
  const scroller = grid?.closest('.menu-scroller');
  const controls = document.getElementById('menuControls');
  const left     = document.getElementById('menuArrowLeft');
  const right    = document.getElementById('menuArrowRight');
  const progress = document.getElementById('menuProgress');
  const thumb    = document.getElementById('menuProgressThumb');
  const hint     = document.getElementById('menuScrollHint');
  if (!grid || !scroller || !left || !right || !thumb) return;

  // How far to scroll per click: one card + the gap.
  const scrollStep = () => {
    const card = grid.querySelector('.menu-card');
    if (!card) return 320;
    const style = getComputedStyle(grid);
    const gap = parseFloat(style.columnGap || style.gap || 24);
    return card.getBoundingClientRect().width + gap;
  };

  // Cache the layout-derived values so the high-frequency scroll path
  // doesn't trigger expensive reads. They get refreshed in onResize().
  let _trackWidth = progress.clientWidth;
  let _thumbWidth = thumb.offsetWidth || 26;
  let _travel = Math.max(0, _trackWidth - _thumbWidth);
  let _maxScroll = grid.scrollWidth - grid.clientWidth;
  let _overflows = _maxScroll > 4;
  let _rafPending = false;

  const refreshLayout = () => {
    _trackWidth = progress.clientWidth;
    _thumbWidth = thumb.offsetWidth || 26;
    _travel = Math.max(0, _trackWidth - _thumbWidth);
    _maxScroll = grid.scrollWidth - grid.clientWidth;
    _overflows = _maxScroll > 4;
  };

  // Hot path: only updates the thumb transform on every scroll tick.
  // Everything else (arrow disabled state, has-prev/has-next classes,
  // hint hiding) is cheap and only re-applied when needed.
  const onScrollFrame = () => {
    _rafPending = false;
    const x = grid.scrollLeft;
    const positionRatio = _maxScroll > 0 ? x / _maxScroll : 0;
    const px = positionRatio * _travel;
    // Move the thumb via translate3d for GPU compositing — no layout cost.
    thumb.style.transform = `translate3d(${px}px, -50%, 0)`;

    const atStart = x <= 4;
    const atEnd   = x >= _maxScroll - 4;
    if (left.disabled !== atStart || !_overflows)  left.disabled  = atStart || !_overflows;
    if (right.disabled !== atEnd  || !_overflows)  right.disabled = atEnd   || !_overflows;
    scroller.classList.toggle('has-prev', !atStart && _overflows);
    scroller.classList.toggle('has-next', !atEnd   && _overflows);

    if (hint && (!_overflows || x > 8)) hint.classList.add('hidden');
  };

  const onScroll = () => {
    if (_rafPending) return;
    _rafPending = true;
    requestAnimationFrame(onScrollFrame);
  };

  const updateState = () => {
    refreshLayout();
    controls.classList.toggle('is-hidden', !_overflows);
    onScrollFrame();
  };

  left.onclick  = () => grid.scrollBy({ left: -scrollStep(), behavior: 'smooth' });
  right.onclick = () => grid.scrollBy({ left:  scrollStep(), behavior: 'smooth' });

  // Click anywhere on the progress track to jump there.
  progress.addEventListener('click', (e) => {
    const rect = progress.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const target = ratio * (grid.scrollWidth - grid.clientWidth);
    grid.scrollTo({ left: target, behavior: 'smooth' });
  });

  grid.onscroll = onScroll;                  // rAF-coalesced, GPU-friendly
  window.addEventListener('resize', updateState);

  // Re-run several times to handle late layout (fonts, images, etc.)
  updateState();
  requestAnimationFrame(updateState);
  setTimeout(updateState, 100);
  setTimeout(updateState, 500);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(updateState);
  }
  window.addEventListener('load', updateState);
}


// ==================================================
// REVIEWS — Supabase-backed
// ==================================================
// All approved reviews are fetched from Supabase. New customer
// submissions go in as 'pending' and are only shown after the owner
// approves them at /admin.html.
//
// "Liked" state (which reviews this device has liked) is still kept
// in localStorage as a UX nicety to prevent spam-likes from the UI —
// the like count itself lives in the database.
// ==================================================

const LS_REVIEW_LIKED = 'pastoReviewLiked';   // { reviewId: true }  (this device liked)

function lsGet(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function lsSet(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

// Local cache of the most recent fetch so the UI can re-render quickly.
let _reviewsCache = [];

function formatReviewDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function starsHTML(rating) {
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  let out = '';
  for (let i = 1; i <= 5; i++) {
    out += `<svg class="star ${i <= r ? 'filled' : ''}" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
    </svg>`;
  }
  return `<div class="review-stars" role="img" aria-label="${r} out of 5 stars">${out}</div>`;
}

function avatarHTML(review) {
  if (review.imageUrl) {
    return `<img class="review-avatar-img" src="${escapeHTML(review.imageUrl)}" alt="${escapeHTML(review.name)}" loading="lazy">`;
  }
  const initials = (review.name || '?')
    .split(/\s+/).map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  // Stable color from name
  const palette = ['#E63946', '#2d6a3f', '#d97706', '#1A1A1A', '#8B5CF6'];
  const idx = (review.name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length;
  const bg = hexOr(review.accentColor, palette[idx]);
  return `<div class="review-avatar-initial" style="background:${bg}">${escapeHTML(initials)}</div>`;
}

function escapeHTML(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Only allow a valid hex color through; otherwise use the fallback. Used for
// DB-sourced color fields interpolated into SVG/style attributes (Finding 14).
function hexOr(v, fb) {
  return /^#[0-9a-fA-F]{3,8}$/.test(v || '') ? v : fb;
}

function renderReviewsFromCache() {
  const grid = document.getElementById('reviewsGrid');
  const summary = document.getElementById('reviewsSummary');
  const empty = document.getElementById('reviewsEmpty');
  if (!grid) return;

  const liked = lsGet(LS_REVIEW_LIKED, {});
  const reviews = _reviewsCache;

  if (reviews.length === 0) {
    grid.innerHTML = '';
    if (empty) empty.hidden = false;
  } else {
    if (empty) empty.hidden = true;
    grid.innerHTML = reviews.map(rev => {
      const id = rev.id;
      const isLiked = !!liked[id];
      const isPinned = !!rev.pinned;
      const date = formatReviewDate(rev.approved_at || rev.created_at);
      const subBits = [escapeHTML(rev.location), escapeHTML(date)].filter(Boolean).join(' · ');

      return `
        <article class="review-card reveal ${isPinned ? 'pinned' : ''}" data-id="${escapeHTML(id)}">
          ${isPinned ? '<span class="review-pin-flag"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 3l5 5-6 1-3 3 4 4-2 2-4-4-3 3-1-1 3-3-4-4 2-2 4 4 3-3 1-6z"/></svg>Pinned</span>' : ''}
          <div class="review-quote-mark" aria-hidden="true">"</div>
          ${starsHTML(rev.rating)}
          <p class="review-quote">${escapeHTML(rev.quote)}</p>
          <div class="review-author">
            <div class="review-avatar">${avatarHTML(rev)}</div>
            <div class="review-author-meta">
              <div class="review-author-name">${escapeHTML(rev.name)}</div>
              <div class="review-author-sub">${subBits}</div>
            </div>
            <div class="review-verified" title="Approved review">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Verified
            </div>
          </div>
          <div class="review-actions">
            <button class="review-like ${isLiked ? 'on' : ''}" onclick="toggleLike('${escapeHTML(id)}')" aria-label="Like this review" ${isLiked ? 'disabled' : ''}>
              <svg viewBox="0 0 24 24" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              <span class="review-like-count">${rev.likes || 0}</span>
            </button>
          </div>
        </article>
      `;
    }).join('');
  }

  if (summary) {
    if (reviews.length === 0) {
      summary.innerHTML = `<span class="reviews-summary-text">Be the first to leave a review.</span>`;
    } else {
      const avg = reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length;
      summary.innerHTML = `
        ${starsHTML(avg)}
        <span class="reviews-summary-text">
          <strong>${avg.toFixed(1)}</strong> out of 5 · ${reviews.length} review${reviews.length === 1 ? '' : 's'}
        </span>
      `;
    }
  }

  observeReveals();
}

async function renderReviews() {
  try {
    _reviewsCache = await ReviewsAPI.listApproved();
  } catch (err) {
    console.error('[Pasto] Failed to load reviews:', err);
    _reviewsCache = [];
  }
  renderReviewsFromCache();
}

// ----- Like (one per device, server-side count) -----
async function toggleLike(id) {
  const liked = lsGet(LS_REVIEW_LIKED, {});
  if (liked[id]) return; // already liked from this device

  // Optimistic UI
  const idx = _reviewsCache.findIndex(r => r.id === id);
  if (idx >= 0) _reviewsCache[idx] = { ..._reviewsCache[idx], likes: (_reviewsCache[idx].likes || 0) + 1 };
  liked[id] = true;
  lsSet(LS_REVIEW_LIKED, liked);
  renderReviewsFromCache();

  try {
    const newCount = await ReviewsAPI.like(id);
    if (idx >= 0 && typeof newCount === 'number') {
      _reviewsCache[idx].likes = newCount;
      renderReviewsFromCache();
    }
  } catch (err) {
    console.error('[Pasto] Like failed:', err);
    // Roll back
    delete liked[id];
    lsSet(LS_REVIEW_LIKED, liked);
    if (idx >= 0) _reviewsCache[idx].likes = Math.max(0, (_reviewsCache[idx].likes || 1) - 1);
    renderReviewsFromCache();
    showToast('Could not save like — try again');
  }
}

// ----- Submission flow -----
let selectedRating = 0;

function openReviewModal() {
  selectedRating = 0;
  document.getElementById('revName').value = '';
  document.getElementById('revLocation').value = '';
  document.getElementById('revQuote').value = '';
  updateRatingStars(0);
  document.getElementById('reviewModal').classList.add('open');
  document.getElementById('overlay').classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeReviewModal() {
  document.getElementById('reviewModal').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
  document.body.style.overflow = '';
}

function updateRatingStars(value) {
  document.querySelectorAll('#ratingInput .rating-star').forEach(btn => {
    btn.classList.toggle('on', Number(btn.dataset.value) <= value);
  });
}

function setupRatingInput() {
  document.querySelectorAll('#ratingInput .rating-star').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedRating = Number(btn.dataset.value);
      updateRatingStars(selectedRating);
    });
    btn.addEventListener('mouseenter', () => updateRatingStars(Number(btn.dataset.value)));
    btn.addEventListener('mouseleave', () => updateRatingStars(selectedRating));
  });
}

async function submitReview() {
  const name = document.getElementById('revName').value.trim();
  const location = document.getElementById('revLocation').value.trim();
  const quote = document.getElementById('revQuote').value.trim();

  if (!name) { showToast('Please enter your name'); return; }
  if (selectedRating < 1) { showToast('Please pick a star rating'); return; }
  if (quote.length < 10) { showToast('Please write a slightly longer review'); return; }

  const submitBtn = document.querySelector('#reviewModal .modal-submit');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting...'; }

  try {
    await ReviewsAPI.submit({ name, location, rating: selectedRating, quote });
    closeReviewModal();
    showToast('Thanks! Your review will appear after a quick review.');
    document.getElementById('reviews')?.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    console.error('[Pasto] Submit failed:', err);
    showToast('Could not submit — please try again');
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit review'; }
  }
}


// ==================================================
// RENDER CONTACT LINKS
// ==================================================
function renderContactLinks() {
  const container = document.getElementById('contactLinks');
  if (!container) return;
  container.innerHTML = `
    <a href="https://wa.me/${CONFIG.whatsappNumber}" target="_blank" rel="noopener">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
      WhatsApp: ${CONFIG.phoneDisplay}
    </a>
    <a href="https://instagram.com/${CONFIG.instagramHandle}" target="_blank" rel="noopener">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37zM17.5 6.5h.01"/></svg>
      Instagram: @${CONFIG.instagramHandle}
    </a>
    <a href="mailto:${CONFIG.email}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
      ${CONFIG.email}
    </a>
  `;
}


// ==================================================
// CART OPERATIONS
// ==================================================
// ==================================================
// DELIVERY ZONE CHECK
// ==================================================
// A non-blocking floating widget that asks for the user's
// geolocation, calculates their distance from the kitchen,
// and tells them whether we can deliver.
//
// State is persisted in localStorage:
//   pastoDeliveryCheck = { status, distanceKm, ts }
//   pastoDeliveryDismissed = boolean (user closed widget)
// ==================================================

const LS_DELIVERY = 'pastoDeliveryCheck';
const LS_DELIVERY_DISMISSED = 'pastoDeliveryDismissed';

// How long the widget stays hidden after the user closes it before
// popping back up. Only applies when location hasn't been resolved yet.
const DELIVERY_REAPPEAR_MS = 3000;

// How long a resolved (in_zone / out_of_zone) result is considered
// "fresh" before we ask the customer again. Set to 6 hours — same
// browsing session won't be re-prompted, but a return visit later
// (e.g. lunch -> dinner, or the next day) will see a fresh prompt.
const DELIVERY_RESULT_TTL_MS = 6 * 60 * 60 * 1000;

let _deliveryReappearTimer = null;

// Returns true when the saved zone result is still recent enough
// that we shouldn't pester the customer.
function isDeliveryResultFresh() {
  const s = getDeliveryState();
  if (!s || (s.status !== 'in_zone' && s.status !== 'out_of_zone')) return false;
  if (!s.ts) return false;
  return (Date.now() - s.ts) < DELIVERY_RESULT_TTL_MS;
}

// Defaults — overridden at runtime by site_settings from Supabase.
// Owner sets the real kitchen coordinates from admin.html → Site tab.
let DELIVERY = {
  kitchenLat: 24.8607,
  kitchenLng: 67.0011,
  radiusKm: 10,
  fee: 250
};

// Haversine formula: great-circle distance between two lat/lng points in km.
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth's mean radius in km
  const toRad = (deg) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function getDeliveryState() {
  return lsGet(LS_DELIVERY, null);
}

function setDeliveryState(state) {
  lsSet(LS_DELIVERY, { ...state, ts: Date.now() });
}

function clearDeliveryState() {
  localStorage.removeItem(LS_DELIVERY);
}

function isInDeliveryZone() {
  const s = getDeliveryState();
  if (!s || s.status !== 'in_zone') return false;
  // Treat stale results as unknown so we re-check rather than charge
  // a delivery fee on an outdated zone assumption.
  if (s.ts && (Date.now() - s.ts) >= DELIVERY_RESULT_TTL_MS) return false;
  return true;
}

function applicableDeliveryFee() {
  // Charge the delivery fee only when geolocation has confirmed in-zone.
  // (For users who didn't share location, no auto-fee — admin handles
  // manually based on the address they typed.)
  return isInDeliveryZone() ? DELIVERY.fee : 0;
}

// ----- Widget rendering -----
function renderDeliveryWidget() {
  const widget = document.getElementById('deliveryWidget');
  const body = document.getElementById('deliveryWidgetBody');
  if (!widget || !body) return;

  const state = getDeliveryState();
  widget.hidden = false;

  if (!state) {
    // First-time prompt
    body.innerHTML = `
      <div class="dw-icon">📍</div>
      <div class="dw-title">Do we deliver to you?</div>
      <div class="dw-text">
        We deliver within ${DELIVERY.radiusKm} km of our kitchen.
        Allow location and we'll check instantly.
      </div>
      <div class="dw-actions">
        <button class="dw-btn dw-btn-primary" onclick="requestDeliveryCheck()">Check now</button>
        <button class="dw-btn dw-btn-ghost" onclick="dismissDeliveryWidget()">Later</button>
      </div>
    `;
    return;
  }

  if (state.status === 'checking') {
    body.innerHTML = `
      <div class="dw-icon">⏳</div>
      <div class="dw-title">Locating you…</div>
      <div class="dw-text">Allow location access in your browser.</div>
    `;
    return;
  }

  if (state.status === 'in_zone') {
    body.innerHTML = `
      <div class="dw-icon">✅</div>
      <div class="dw-title">We deliver to you!</div>
      <div class="dw-text">
        <strong>${state.distanceKm.toFixed(1)} km</strong> away · standard delivery fee
        <strong>${CONFIG.currency} ${DELIVERY.fee}</strong> applies.
      </div>
      <div class="dw-actions">
        <button class="dw-btn dw-btn-primary" onclick="dismissDeliveryWidget()">Got it</button>
      </div>
    `;
    return;
  }

  if (state.status === 'out_of_zone') {
    const inquireMsg = `Hi! I'd like to order from Pasto but I'm ${state.distanceKm.toFixed(1)} km away (outside the standard ${DELIVERY.radiusKm} km zone). Could you deliver to me as an exception?`;
    const inquireUrl = `https://wa.me/${CONFIG.whatsappNumber}?text=${encodeURIComponent(inquireMsg)}`;
    body.innerHTML = `
      <div class="dw-icon">⚠️</div>
      <div class="dw-title">Slightly out of range</div>
      <div class="dw-text">
        You're <strong>${state.distanceKm.toFixed(1)} km</strong> away.
        Our standard zone is ${DELIVERY.radiusKm} km — but message us, we might be able to make an exception 🍝
      </div>
      <div class="dw-actions">
        <a class="dw-btn dw-btn-primary" href="${inquireUrl}" target="_blank" rel="noopener">WhatsApp us</a>
        <button class="dw-btn dw-btn-ghost" onclick="dismissDeliveryWidget()">Close</button>
      </div>
    `;
    return;
  }

  if (state.status === 'denied' || state.status === 'error') {
    body.innerHTML = `
      <div class="dw-icon">📍</div>
      <div class="dw-title">Location not shared</div>
      <div class="dw-text">
        No worries — you can still order. We'll confirm delivery to your address before cooking.
      </div>
      <div class="dw-actions">
        <button class="dw-btn dw-btn-primary" onclick="requestDeliveryCheck()">Try again</button>
        <button class="dw-btn dw-btn-ghost" onclick="dismissDeliveryWidget()">Got it</button>
      </div>
    `;
    return;
  }
}

function requestDeliveryCheck() {
  if (!navigator.geolocation) {
    setDeliveryState({ status: 'error' });
    renderDeliveryWidget();
    return;
  }
  setDeliveryState({ status: 'checking' });
  renderDeliveryWidget();

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const distanceKm = haversineKm(lat, lng, DELIVERY.kitchenLat, DELIVERY.kitchenLng);
      const status = distanceKm <= DELIVERY.radiusKm ? 'in_zone' : 'out_of_zone';
      setDeliveryState({ status, distanceKm, lat, lng });
      renderDeliveryWidget();
      // If the user happens to be in checkout, refresh the total
      renderCheckoutTotal();
      renderCart();
    },
    (err) => {
      const status = err.code === 1 ? 'denied' : 'error';
      setDeliveryState({ status });
      renderDeliveryWidget();
    },
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 }
  );
}

function dismissDeliveryWidget() {
  // Hide the widget immediately
  const w = document.getElementById('deliveryWidget');
  if (w) w.hidden = true;

  // If they've already shared location AND the result is still fresh
  // (within TTL), don't pester them further this session. The widget
  // will re-appear on a future visit once the TTL elapses.
  if (isDeliveryResultFresh()) return;

  // Otherwise: they dismissed without sharing location. Bring the
  // widget back in DELIVERY_REAPPEAR_MS so we keep asking.
  if (_deliveryReappearTimer) clearTimeout(_deliveryReappearTimer);
  _deliveryReappearTimer = setTimeout(() => {
    // Clear any stale "denied" / "error" / "checking" state so the
    // widget shows the initial prompt fresh, not a recovery message.
    const cur = getDeliveryState();
    if (cur && (cur.status === 'denied' || cur.status === 'error' || cur.status === 'checking')) {
      clearDeliveryState();
    }
    renderDeliveryWidget();
  }, DELIVERY_REAPPEAR_MS);
}

// Show the widget after a short delay, so it doesn't crash the first paint.
function initDeliveryWidget() {
  // Load delivery settings from Supabase (overrides defaults)
  SettingsAPI.getAll().then(s => {
    if (s.kitchen_lat)         DELIVERY.kitchenLat = parseFloat(s.kitchen_lat) || DELIVERY.kitchenLat;
    if (s.kitchen_lng)         DELIVERY.kitchenLng = parseFloat(s.kitchen_lng) || DELIVERY.kitchenLng;
    if (s.delivery_radius_km)  DELIVERY.radiusKm   = parseFloat(s.delivery_radius_km) || DELIVERY.radiusKm;
    if (s.delivery_fee)        DELIVERY.fee        = parseInt(s.delivery_fee, 10) || DELIVERY.fee;
  }).catch(() => { /* fall back to defaults */ });

  // If the customer's zone was checked recently (within the TTL —
  // currently 6 hours), don't ask again. They're in the middle of
  // a session and already know their result.
  // Once the TTL elapses, the stale result is cleared and we ask
  // fresh (handles "they ordered at lunch, come back at dinner" or
  // "they checked yesterday, come back today").
  if (isDeliveryResultFresh()) {
    document.getElementById('deliveryWidgetClose')?.addEventListener('click', dismissDeliveryWidget);
    return;
  }

  // If the stored state is stale (older than TTL), wipe it so the
  // widget shows the friendly initial prompt, not a recovery message.
  const state = getDeliveryState();
  if (state && state.ts && (Date.now() - state.ts) >= DELIVERY_RESULT_TTL_MS) {
    clearDeliveryState();
  }

  // Show after a short delay so it doesn't crash first paint.
  setTimeout(() => {
    renderDeliveryWidget();
  }, 3000);

  document.getElementById('deliveryWidgetClose')?.addEventListener('click', dismissDeliveryWidget);
}


// ==================================================
// BUSINESS HOURS
// ==================================================
// Orders can only be placed during business hours (6 PM–11 PM
// Karachi time by default — configurable in js/config.js).
// Menu browsing and cart adding are still allowed outside hours.
// ==================================================

function _karachiNow() {
  // Karachi is UTC+5 with no DST.
  const nowUtcMs = Date.now();
  const karachiMs = nowUtcMs + 5 * 60 * 60 * 1000;
  return new Date(karachiMs);
}

function _parseHm(hm) {
  if (!hm) return null;
  const [h, m] = hm.split(':').map(n => parseInt(n, 10));
  return { h: h || 0, m: m || 0 };
}

// Runtime business hours: default from js/config.js, overridden at page load
// by the admin-set values in site_settings (business_hours_start/end).
let _bizStart = CONFIG.businessHoursStart || '18:00';
let _bizEnd   = CONFIG.businessHoursEnd   || '23:00';

function isBusinessHours() {
  const start = _parseHm(_bizStart);
  const end   = _parseHm(_bizEnd);
  if (!start || !end) return true; // if misconfigured, don't block

  const kt = _karachiNow();
  const curMins = kt.getUTCHours() * 60 + kt.getUTCMinutes();
  const startMins = start.h * 60 + start.m;
  const endMins   = end.h * 60 + end.m;

  // Simple case (hours don't cross midnight) — matches Pasto's 18:00–23:00
  if (startMins <= endMins) {
    return curMins >= startMins && curMins < endMins;
  }
  // Wrap-around case (e.g. 22:00 – 03:00)
  return curMins >= startMins || curMins < endMins;
}

function minutesUntilOpen() {
  const start = _parseHm(_bizStart);
  if (!start) return null;
  const kt = _karachiNow();
  const curMins = kt.getUTCHours() * 60 + kt.getUTCMinutes();
  const startMins = start.h * 60 + start.m;
  let diff = startMins - curMins;
  if (diff <= 0) diff += 24 * 60; // opens tomorrow
  return diff;
}

function formatHhMmDisplay(hm) {
  const p = _parseHm(hm);
  if (!p) return hm;
  const suffix = p.h >= 12 ? 'PM' : 'AM';
  let hr = p.h % 12; if (hr === 0) hr = 12;
  return `${hr}:${String(p.m).padStart(2, '0')} ${suffix}`;
}

function openClosedModal() {
  const startDisp = formatHhMmDisplay(_bizStart);
  const endDisp   = formatHhMmDisplay(_bizEnd);
  const untilOpen = minutesUntilOpen();

  let statusHtml = `<div class="closed-hours">Hours: ${startDisp} – ${endDisp}</div>`;
  if (untilOpen != null) {
    const hrs = Math.floor(untilOpen / 60);
    const mins = untilOpen % 60;
    const partsList = [];
    if (hrs > 0)  partsList.push(`${hrs} hour${hrs === 1 ? '' : 's'}`);
    if (mins > 0) partsList.push(`${mins} minute${mins === 1 ? '' : 's'}`);
    if (partsList.length === 0) partsList.push('less than a minute');
    statusHtml += `<div class="closed-countdown">Opens in <strong>${partsList.join(' ')}</strong></div>`;
  }
  const statusEl = document.getElementById('closedStatus');
  if (statusEl) statusEl.innerHTML = statusHtml;

  document.getElementById('closedModal')?.classList.add('open');
  document.getElementById('overlay')?.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeClosedModal() {
  document.getElementById('closedModal')?.classList.remove('open');
  document.getElementById('overlay')?.classList.remove('show');
  document.body.style.overflow = '';
}


// ==================================================
// PAUSE ORDERS
// ==================================================
// The owner can toggle "ordering_paused" in admin → Site tab. When on,
// a red banner appears at the top of the customer site and any attempt
// to check out shows the paused modal (with the owner's optional reason).
// State is polled every 30 s so browsers already open pick up changes.
// ==================================================

let _pauseState = { paused: false, reason: '' };

function isOrderingPaused() {
  return !!_pauseState.paused;
}

function reflectPauseBanner() {
  const banner = document.getElementById('pauseBanner');
  const reasonEl = document.getElementById('pauseBannerReason');
  if (!banner) return;
  if (_pauseState.paused) {
    banner.hidden = false;
    if (reasonEl) {
      reasonEl.textContent = _pauseState.reason
        ? '  ' + _pauseState.reason
        : '  Back on shortly — check again soon.';
    }
    document.body.classList.add('is-paused');
  } else {
    banner.hidden = true;
    document.body.classList.remove('is-paused');
  }
}

async function refreshPauseState() {
  try {
    const s = await SettingsAPI.getAll();
    const paused = String(s.ordering_paused || 'false').toLowerCase() === 'true';
    const reason = s.ordering_paused_reason || '';
    _pauseState = { paused, reason };
    reflectPauseBanner();
  } catch (err) {
    // Silently ignore — if we can't reach the API we just keep the
    // last-known state (fail-open so ordering isn't accidentally
    // blocked by a transient network glitch).
    console.warn('[Pasto] Could not refresh pause state:', err);
  }
}

function openPausedModal() {
  const msg = document.getElementById('pausedModalMsg');
  if (msg) {
    msg.textContent = _pauseState.reason
      ? _pauseState.reason
      : "We've paused orders for a moment. Please try again shortly — we'll be back on very soon 🍝";
  }
  document.getElementById('pausedModal')?.classList.add('open');
  document.getElementById('overlay')?.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closePausedModal() {
  document.getElementById('pausedModal')?.classList.remove('open');
  document.getElementById('overlay')?.classList.remove('show');
  document.body.style.overflow = '';
}


// ==================================================
// PRE-LAUNCH MODE
// ==================================================
// Reads CONFIG.launchDate. While the current time is BEFORE the
// launch date, the site shows a countdown banner + hero badge and
// blocks all ordering actions with a friendly "we open on X" modal
// that collects WhatsApp signups for launch-day notification.
// ==================================================

function getLaunchDate() {
  if (!CONFIG.launchDate) return null;
  const d = new Date(CONFIG.launchDate);
  return isNaN(d.getTime()) ? null : d;
}

function isPreLaunch() {
  const d = getLaunchDate();
  if (!d) return false;
  return Date.now() < d.getTime();
}

let _countdownTimer = null;

function pad2(n) { return String(n).padStart(2, '0'); }

function updateCountdownDisplay() {
  const launch = getLaunchDate();
  if (!launch) return;
  const diff = launch.getTime() - Date.now();
  if (diff <= 0) {
    // We just hit launch! Reload to refresh the whole page in "live" mode.
    if (_countdownTimer) clearInterval(_countdownTimer);
    location.reload();
    return;
  }
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const mins = Math.floor((diff / (1000 * 60)) % 60);
  const secs = Math.floor((diff / 1000) % 60);

  const targets = [
    ['lcDays', days], ['lcHours', hours], ['lcMins', mins], ['lcSecs', secs],
    ['lcmDays', days], ['lcmHours', hours], ['lcmMins', mins], ['lcmSecs', secs]
  ];
  targets.forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = pad2(val);
  });

  // Also update the hero sub-label with a friendly relative time
  const sub = document.getElementById('heroLaunchSub');
  if (sub) {
    if (days > 1) sub.textContent = `${days} days to go · get notified`;
    else if (days === 1) sub.textContent = `1 day to go · get notified`;
    else if (hours > 0) sub.textContent = `Less than ${hours} hours — get notified`;
    else sub.textContent = `Opening any minute now!`;
  }
}

function syncLaunchBannerHeight() {
  const banner = document.getElementById('launchBanner');
  if (!banner || banner.hidden) {
    document.documentElement.style.setProperty('--launch-banner-h', '0px');
    return;
  }
  const h = banner.getBoundingClientRect().height;
  document.documentElement.style.setProperty('--launch-banner-h', h + 'px');
}

function initPreLaunchMode() {
  if (!isPreLaunch()) {
    document.documentElement.style.setProperty('--launch-banner-h', '0px');
    return;
  }
  // Show banner + hero badge
  const banner = document.getElementById('launchBanner');
  const badge  = document.getElementById('heroLaunchBadge');
  if (banner) banner.hidden = false;
  if (badge)  badge.hidden  = false;
  document.body.classList.add('pre-launch');

  // Make sure the nav slides down by exactly the banner's height,
  // even when it wraps to multiple rows on small screens.
  syncLaunchBannerHeight();
  window.addEventListener('resize', syncLaunchBannerHeight);
  if (window.ResizeObserver && banner) {
    new ResizeObserver(syncLaunchBannerHeight).observe(banner);
  }
  // Belt-and-braces: re-measure after fonts load + on next animation frames
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(syncLaunchBannerHeight);
  }
  requestAnimationFrame(syncLaunchBannerHeight);
  setTimeout(syncLaunchBannerHeight, 200);

  // Start the countdown loop
  updateCountdownDisplay();
  if (_countdownTimer) clearInterval(_countdownTimer);
  _countdownTimer = setInterval(updateCountdownDisplay, 1000);
}

function openLaunchModal() {
  // Pre-fill name/phone from a previous sign-up if they did one earlier
  const stored = lsGet('pastoLaunchSignup', null);
  if (stored) {
    document.getElementById('notifyName').value  = stored.name  || '';
    document.getElementById('notifyPhone').value = stored.phone || '';
  }
  document.getElementById('launchModal').classList.add('open');
  document.getElementById('overlay').classList.add('show');
  document.body.style.overflow = 'hidden';
  updateCountdownDisplay();
}

function closeLaunchModal() {
  document.getElementById('launchModal').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
  document.body.style.overflow = '';
}

async function submitLaunchNotify() {
  const name  = document.getElementById('notifyName').value.trim();
  const phone = document.getElementById('notifyPhone').value.trim();
  if (!phone || phone.length < 6) {
    showToast('Please enter a valid WhatsApp number');
    return;
  }

  const submitBtn = document.querySelector('#launchModal .modal-submit');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving…'; }

  try {
    // Save directly to Supabase so the signup appears in your
    // admin Launch list (no WhatsApp roundtrip needed).
    await LaunchSignupsAPI.submit({ name, phone });
  } catch (err) {
    console.error('[Pasto] launch signup failed:', err);
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Notify me'; }
    const raw = (err && err.message) || '';
    if (/launch_signups.*does not exist|schema cache/i.test(raw)) {
      showToast('Setup pending — please re-run schema.sql in Supabase.');
    } else {
      showToast('Could not save — please try again');
    }
    return;
  }

  // Remember locally so we skip the same form for this visitor
  lsSet('pastoLaunchSignup', { name, phone, ts: Date.now() });

  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Notify me'; }
  closeLaunchModal();
  showToast(`Thanks${name ? ', ' + name : ''}! You'll be the first to know on 1st July 🎉`);
}


function addToCart(id) {
  // Block ordering during pre-launch — show the launch modal instead.
  if (isPreLaunch()) {
    openLaunchModal();
    return;
  }
  const wasInCart = (cart[id] || 0) > 0;
  cart[id] = (cart[id] || 0) + 1;
  saveCart();
  renderCart();
  updateCartCount();

  if (!wasInCart) {
    // First add: briefly show "Added" confirmation, then swap to the stepper.
    const card = document.querySelector(`.menu-card[data-id="${id}"]`);
    const slot = card?.querySelector('.menu-card-control');
    if (slot) {
      slot.innerHTML = `
        <button class="add-btn added" data-id="${id}" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Added
        </button>`;
      setTimeout(() => updateMenuCardControl(id), 900);
    }
  } else {
    updateMenuCardControl(id);
  }

  const item = MENU.find(m => m.id === id);
  showToast(`${item.name} added to cart`);
}

function changeQty(id, delta) {
  cart[id] = Math.max(0, (cart[id] || 0) + delta);
  if (cart[id] === 0) delete cart[id];
  saveCart();
  renderCart();
  updateCartCount();
  updateMenuCardControl(id);
}

function saveCart() {
  localStorage.setItem('pastoCart', JSON.stringify(cart));
}

function cartItemCount() {
  return Object.values(cart).reduce((sum, q) => sum + q, 0);
}

function cartTotal() {
  return Object.entries(cart).reduce((sum, [id, qty]) => {
    const item = MENU.find(m => m.id === id);
    return sum + (item ? item.price * qty : 0);
  }, 0);
}

// "Buy 5, get 1 free" — when the cart has 5+ items in it (any mix),
// the cheapest item's price is automatically deducted. Returns
// { qualifies, freeItem, amount } so the UI can show it nicely.
function bulkFreeDiscount() {
  const totalQty = cartItemCount();
  if (totalQty < 5) return { qualifies: false, freeItem: null, amount: 0 };
  let cheapest = null;
  Object.keys(cart).forEach(id => {
    const item = MENU.find(m => m.id === id);
    if (!item) return;
    if (cheapest === null || item.price < cheapest.price) cheapest = item;
  });
  return cheapest
    ? { qualifies: true, freeItem: cheapest, amount: cheapest.price }
    : { qualifies: false, freeItem: null, amount: 0 };
}

function updateCartCount() {
  const count = cartItemCount();
  document.getElementById('cartCount').textContent = count;
  document.getElementById('navCart').classList.toggle('empty', count === 0);
  document.getElementById('checkoutBtn').disabled = count === 0;
}

function renderCart() {
  const body = document.getElementById('cartBody');
  const ids = Object.keys(cart);

  if (ids.length === 0) {
    body.innerHTML = `
      <div class="cart-empty">
        <svg class="cart-empty-icon" viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg">
          <g transform="translate(15, 25)">
            <path d="M 30 22 Q 58 16 67 38 Q 75 58 57 69 Q 39 78 28 64 Q 21 51 34 45 Q 47 41 50 54 Q 50 63 41 63"
                  fill="none" stroke="#E63946" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
          </g>
        </svg>
        <div class="cart-empty-text">Your cart is empty</div>
        <div class="cart-empty-sub">Add something delicious from the menu</div>
      </div>
    `;
  } else {
    const bulk = bulkFreeDiscount();
    const itemsHTML = ids.map(id => {
      const item = MENU.find(m => m.id === id);
      const qty = cart[id];
      return `
        <div class="cart-item">
          <div class="cart-item-icon">${dishVisual(item)}</div>
          <div class="cart-item-info">
            <div class="cart-item-name">${escapeHTML(item.name)}</div>
            <div class="cart-item-price">${CONFIG.currency} ${item.price} × ${qty} = ${CONFIG.currency} ${item.price * qty}</div>
          </div>
          <div class="cart-qty">
            <button class="qty-btn" onclick="changeQty('${id}', -1)" aria-label="Decrease">−</button>
            <span class="qty-val">${qty}</span>
            <button class="qty-btn" onclick="changeQty('${id}', 1)" aria-label="Increase">+</button>
          </div>
        </div>
      `;
    }).join('');

    // Buy-5-get-1-free reward block (shown when cart qualifies)
    const rewardHTML = bulk.qualifies ? `
      <div class="cart-bulk-reward">
        <div class="cart-bulk-reward-head">
          <span class="cart-bulk-reward-tag">★ Reward unlocked</span>
          <span class="cart-bulk-reward-amount">− ${CONFIG.currency} ${bulk.amount}</span>
        </div>
        <div class="cart-bulk-reward-body">
          You've ordered 5+ items — your <strong>${bulk.freeItem.name}</strong> is on us!
        </div>
      </div>
    ` : (cartItemCount() > 0 ? `
      <div class="cart-bulk-hint">
        Add ${5 - cartItemCount()} more item${5 - cartItemCount() === 1 ? '' : 's'} to get the cheapest one <strong>free</strong>.
      </div>
    ` : '');

    body.innerHTML = itemsHTML + rewardHTML;
  }

  // Cart total now reflects buy-5-get-1-free
  const subtotal = cartTotal();
  const bulk = bulkFreeDiscount();
  const payable = Math.max(0, subtotal - bulk.amount);
  const totalEl = document.getElementById('cartTotal');
  if (bulk.qualifies) {
    totalEl.innerHTML = `
      <span class="cart-total-strike">${CONFIG.currency} ${subtotal}</span>
      ${CONFIG.currency} ${payable}
    `;
  } else {
    totalEl.textContent = `${CONFIG.currency} ${subtotal}`;
  }
}


// ==================================================
// UI: DRAWER, MODAL, TOAST
// ==================================================
function openCart() {
  // Don't even open the cart drawer during pre-launch — go straight
  // to the launch modal so users always see the "we open on X" message.
  if (isPreLaunch()) {
    openLaunchModal();
    return;
  }
  document.getElementById('cartDrawer').classList.add('open');
  document.getElementById('overlay').classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeCart() {
  document.getElementById('cartDrawer').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
  document.body.style.overflow = '';
}

function openCheckoutModal() {
  if (isPreLaunch()) {
    closeCart();
    openLaunchModal();
    return;
  }
  // Ordering paused takes priority over the business-hours check
  // (owner can override normal hours to stop mid-service).
  if (isOrderingPaused()) {
    closeCart();
    // Re-verify with the server in case we're on a stale cache, then
    // decide whether to actually block (fresh check protects against
    // an owner who has just resumed).
    refreshPauseState().then(() => {
      if (isOrderingPaused()) openPausedModal();
      else openCheckoutModal();
    });
    return;
  }
  if (!isBusinessHours()) {
    closeCart();
    openClosedModal();
    return;
  }
  if (cartItemCount() === 0) return;
  closeCart();
  setTimeout(() => {
    document.getElementById('checkoutModal').classList.add('open');
    document.getElementById('overlay').classList.add('show');
    document.body.style.overflow = 'hidden';
    renderCheckoutTotal();
    refreshLoyaltyForCheckout();
    onPayMethodChange();
  }, 300);
}

// ----- Payment method handling -----
let _bankSettings = null;

async function loadBankDetails() {
  const bankEl = document.getElementById('bankDetails');
  const cardNoteEl = document.getElementById('payCardNote');
  try {
    const all = await SettingsAPI.getAll();
    _bankSettings = all;
    const rows = [
      ['Bank',          all.bank_name],
      ['Account title', all.bank_account_title],
      ['Account no.',   all.bank_account_number],
      ['IBAN',          all.bank_iban],
      ['Branch code',   all.bank_branch_code]
    ].filter(r => r[1] && r[1].length > 0);

    if (rows.length === 0) {
      bankEl.innerHTML = `<div class="bank-empty">Bank details not configured yet. Please choose Cash on Delivery or contact us on WhatsApp.</div>`;
    } else {
      bankEl.innerHTML = rows.map(([k, v]) => `
        <div>
          <dt>${escapeHTML(k)}</dt>
          <dd>
            <span class="bank-val">${escapeHTML(v)}</span>
            <button type="button" class="bank-copy" onclick="copyBank('${escapeHTML(v)}')">Copy</button>
          </dd>
        </div>
      `).join('');
    }
    if (all.payment_card_note) cardNoteEl.textContent = all.payment_card_note;
  } catch (err) {
    console.warn('[Pasto] Could not load bank details:', err);
    bankEl.innerHTML = `<div class="bank-empty">Could not load bank details — please refresh.</div>`;
  }
}

function copyBank(value) {
  navigator.clipboard?.writeText(value).then(
    () => showToast('Copied'),
    () => showToast('Could not copy — long-press to copy')
  );
}

function selectedPayMethod() {
  const r = document.querySelector('input[name="payMethod"]:checked');
  return r ? r.value : 'cod';
}

// Customers paying via bank transfer get an automatic 5% off the subtotal.
// Keep this constant in sync with the same value in place_order RPC.
const BANK_TRANSFER_DISCOUNT_PCT = 5;
function bankTransferDiscount() {
  if (selectedPayMethod() !== 'bank_transfer') return 0;
  return Math.round(cartTotal() * BANK_TRANSFER_DISCOUNT_PCT / 100);
}

function onPayMethodChange() {
  const method = selectedPayMethod();
  const pp = document.getElementById('prepayPanel');
  if (pp) pp.hidden = method !== 'prepay';
  document.querySelectorAll('.pay-option').forEach(opt => {
    const input = opt.querySelector('input[type="radio"]');
    opt.classList.toggle('active', input && input.checked);
  });
  renderCheckoutTotal();
}

// Live preview of selected screenshot before submit
function setupPayProofPreview() {
  const input = document.getElementById('payProof');
  const preview = document.getElementById('payProofPreview');
  if (!input || !preview) return;
  input.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) { preview.hidden = true; preview.innerHTML = ''; return; }
    const url = URL.createObjectURL(file);
    preview.hidden = false;
    preview.innerHTML = `<img src="${url}" alt="payment screenshot preview">`;
  });
}

function closeModal() {
  document.getElementById('checkoutModal').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
  document.body.style.overflow = '';
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}


// ==================================================
// SUBMIT ORDER VIA WHATSAPP
// ==================================================
// ----- Coupon state (used by submitOrder) -----
let _appliedCoupon = null;          // { code, computed_discount, ... }
let _useFreeCredit = false;
let _loyaltyForCheckout = null;     // last looked-up loyalty row, by phone

async function applyCoupon() {
  const input = document.getElementById('custCoupon');
  const feedback = document.getElementById('couponFeedback');
  const code = (input.value || '').trim();
  const total = cartTotal();
  // Forward the buyer's phone so the server can block self-use of
  // a customer's own referral code.
  const phone = (document.getElementById('custPhone')?.value || '').trim() || null;

  if (!code) {
    _appliedCoupon = null;
    feedback.textContent = '';
    feedback.className = 'coupon-feedback';
    renderCheckoutTotal();
    return;
  }

  feedback.textContent = 'Checking…';
  feedback.className = 'coupon-feedback';

  try {
    const result = await RewardsAPI.validateCoupon(code, total, phone);
    if (result && result.ok) {
      _appliedCoupon = result;
      feedback.textContent = `${result.code} applied — you save ${CONFIG.currency} ${result.computed_discount}`;
      feedback.className = 'coupon-feedback ok';
    } else {
      _appliedCoupon = null;
      feedback.textContent = result?.reason || 'Invalid code';
      feedback.className = 'coupon-feedback bad';
    }
  } catch (err) {
    _appliedCoupon = null;
    feedback.textContent = 'Could not check code — try again';
    feedback.className = 'coupon-feedback bad';
  }
  renderCheckoutTotal();
}

async function refreshLoyaltyForCheckout() {
  const phone = document.getElementById('custPhone').value.trim();
  const wrap  = document.getElementById('checkoutLoyalty');
  if (!phone || phone.length < 6) {
    wrap.hidden = true;
    _loyaltyForCheckout = null;
    _useFreeCredit = false;
    renderCheckoutTotal();
    return;
  }
  try {
    const row = await RewardsAPI.getLoyalty(phone);
    _loyaltyForCheckout = row;
    if (!row || row.order_count === 0) {
      wrap.hidden = true;
      _useFreeCredit = false;
      renderCheckoutTotal();
      return;
    }
    wrap.hidden = false;
    wrap.innerHTML = `
      <div class="loyalty-mini">
        <div class="loyalty-mini-head">
          <span class="loyalty-mini-title">Welcome back, ${escapeHTML(row.name || 'friend')}!</span>
          <span class="loyalty-mini-count">${row.order_count} order${row.order_count === 1 ? '' : 's'}</span>
        </div>
        ${row.referral_code ? `
          <div class="loyalty-mini-ref">
            Your referral code: <strong>${escapeHTML(row.referral_code)}</strong>
            — share it after delivery for friends to get 10% off.
          </div>
        ` : ''}
      </div>
    `;
  } catch (err) {
    console.warn('[Pasto] loyalty lookup failed:', err);
    wrap.hidden = true;
  }
}

// (Loyalty stamp-card + free-credit UI removed — the cross-order rewards
//  program was dropped in Spec #2; referrals + buy-5-get-1 remain.)

function renderCheckoutTotal() {
  const wrap = document.getElementById('checkoutTotal');
  if (!wrap) return;
  const total = cartTotal();
  const bulk = bulkFreeDiscount();                              // auto buy-5-get-1-free
  const couponDisc = _appliedCoupon?.computed_discount || 0;
  const bankDisc = bankTransferDiscount();                      // 5% if paying via bank
  const deliveryFee = applicableDeliveryFee();                  // Rs.250 if in-zone confirmed
  const totalDisc = Math.min(total, bulk.amount + couponDisc + bankDisc);
  const itemsPayable = Math.max(0, total - totalDisc);
  const grandTotal = itemsPayable + deliveryFee;

  const lines = [`<div class="ct-line"><span>Subtotal</span><span>${CONFIG.currency} ${total}</span></div>`];
  if (bulk.qualifies && bulk.amount > 0) {
    lines.push(`<div class="ct-line ct-disc"><span>★ Free ${escapeHTML(bulk.freeItem.name)} (5+ items)</span><span>− ${CONFIG.currency} ${bulk.amount}</span></div>`);
  }
  if (couponDisc > 0) {
    lines.push(`<div class="ct-line ct-disc"><span>Promo ${escapeHTML(_appliedCoupon.code)}</span><span>− ${CONFIG.currency} ${couponDisc}</span></div>`);
  }
  if (bankDisc > 0) {
    lines.push(`<div class="ct-line ct-disc"><span>Bank transfer (${BANK_TRANSFER_DISCOUNT_PCT}% off)</span><span>− ${CONFIG.currency} ${bankDisc}</span></div>`);
  }
  if (deliveryFee > 0) {
    lines.push(`<div class="ct-line"><span>Delivery fee</span><span>+ ${CONFIG.currency} ${deliveryFee}</span></div>`);
  } else {
    // Subtle note when delivery fee not yet known
    lines.push(`<div class="ct-line ct-note"><span>Delivery fee</span><span>confirmed after location check</span></div>`);
  }
  lines.push(`<div class="ct-line ct-total"><span>You pay</span><span>${CONFIG.currency} ${grandTotal}</span></div>`);
  wrap.innerHTML = lines.join('');
}

async function submitOrder() {
  // Re-check pause state fresh from the server so we don't submit an
  // order the owner has just blocked between opening + submitting.
  await refreshPauseState();
  if (isOrderingPaused()) {
    closeModal();
    openPausedModal();
    return;
  }
  // Client-side hours gate (UX). place_order enforces it server-side too.
  if (!isBusinessHours()) {
    closeModal();
    openClosedModal();
    return;
  }

  const name     = document.getElementById('custName').value.trim();
  const phone    = document.getElementById('custPhone').value.trim();
  const altPhone = (document.getElementById('custAltPhone')?.value || '').trim();
  const email    = (document.getElementById('custEmail')?.value || '').trim();
  const address  = document.getElementById('custAddress').value.trim();
  const notes    = document.getElementById('custNotes').value.trim();
  const coupon   = (document.getElementById('custCoupon').value || '').trim() || null;

  if (!name || !phone || !address) {
    showToast('Please fill in name, phone, and address');
    return;
  }

  // Server recomputes name/price/total from menu_items — send only id + qty.
  const items = Object.entries(cart).map(([id, qty]) => ({ id, qty }));
  if (items.length === 0) { showToast('Your cart is empty'); return; }

  const payMethod = selectedPayMethod();   // 'cod' | 'prepay'

  const submitBtn = document.querySelector('#checkoutModal .modal-submit');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Placing order…'; }

  let placed = null;
  try {
    placed = await OrdersAPI.place({
      name, phone, altPhone, email, address, notes, items,
      couponCode: coupon, paymentMethod: payMethod
    });
  } catch (err) {
    console.error('[Pasto] place_order failed:', err);
    const raw = (err && (err.message || err.error_description || err.hint)) || '';
    let friendly = 'Could not save your order — please try again';
    if (/we are closed/i.test(raw)) {
      closeModal(); openClosedModal();
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Place order'; }
      return;
    } else if (/item not available/i.test(raw)) {
      friendly = 'An item is no longer available — please refresh and rebuild your cart.';
    } else if (/invalid or expired coupon/i.test(raw)) {
      friendly = 'That promo / referral code is invalid or expired.';
    } else if (/function .*place_order.* does not exist/i.test(raw) ||
               /could not find the function/i.test(raw) ||
               /404|PGRST202|PGRST302/i.test(raw)) {
      friendly = 'Orders backend not set up yet. Re-run database/schema.sql in Supabase.';
    } else if (/invalid order payload|invalid item quantity|invalid email|invalid order total/i.test(raw)) {
      friendly = 'Please double-check your details and cart.';
    } else if (/permission denied|JWT|rls/i.test(raw)) {
      friendly = 'Database permission error — re-run database/schema.sql to fix policies.';
    } else if (/failed to fetch|networkerror|cors/i.test(raw)) {
      friendly = 'Network error — check your internet connection.';
    } else if (raw) {
      friendly = 'Could not save order: ' + raw;
    }
    showToast(friendly);
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Place order'; }
    return;
  }

  // Remember the order locally so the tracker survives page reloads.
  lsSet('pastoActiveOrder', {
    id: placed.id,
    short_code: placed.short_code,
    referral_code: placed.referral_code || null,
    placedAt: Date.now()
  });

  // Clear cart + form state
  cart = {};
  saveCart();
  renderCart();
  updateCartCount();
  updateAllMenuCardControls();
  ['custName','custPhone','custAltPhone','custEmail','custAddress','custNotes','custCoupon'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const cf = document.getElementById('couponFeedback'); if (cf) cf.textContent = '';
  const cl = document.getElementById('checkoutLoyalty'); if (cl) cl.hidden = true;
  const ct = document.getElementById('checkoutTotal'); if (ct) ct.innerHTML = '';
  const codRadio = document.querySelector('input[name="payMethod"][value="cod"]');
  if (codRadio) { codRadio.checked = true; onPayMethodChange(); }
  _appliedCoupon = null;
  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Place order'; }

  // Close checkout modal — confirmation modal takes over now
  closeModal();
  showOrderConfirmModal(placed, payMethod);
}


// ==================================================
// ORDER CONFIRMATION MODAL (post-save)
// ==================================================
// Shown AFTER an order is saved to Supabase. Uses different
// WhatsApp URL schemes per platform for maximum reliability:
//   - iOS  → whatsapp://send?phone=X&text=Y (native app scheme)
//   - Web  → https://wa.me/X?text=Y         (universal URL)
// Also provides a "Done" button so the customer can finish the
// flow even if WhatsApp doesn't launch (the order is already
// saved and admin is already notified via realtime).
// ==================================================

function isIOS() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) ||
         (ua.includes('Mac') && 'ontouchend' in document);
}

function buildWhatsAppUrl(phone, message) {
  const encoded = encodeURIComponent(message);
  if (isIOS()) {
    // Native URL scheme — iOS will launch the WhatsApp app directly
    return `whatsapp://send?phone=${phone}&text=${encoded}`;
  }
  return `https://wa.me/${phone}?text=${encoded}`;
}

// Instagram doesn't support pre-filled DMs via URL, so this just
// opens the DM thread (native app on mobile, web on desktop).
function buildInstagramDmUrl(handle) {
  const clean = (handle || '').replace(/^@/, '').trim();
  if (isIOS()) {
    // Native scheme — opens the profile in the app (customer taps
    // Message from there, or Instagram sometimes deep-links straight
    // to the DM if they've messaged before).
    return `instagram://user?username=${clean}`;
  }
  // Universal — ig.me/m goes straight to the DM thread on Android and
  // web. Falls back gracefully to the profile if the app isn't installed.
  return `https://ig.me/m/${clean}`;
}

// Copy the current order code to clipboard.
function copyOrderCode() {
  const code = document.getElementById('confirmOrderCode')?.textContent || '';
  const toCopy = code ? `Order #${code}` : '';
  if (!toCopy) return;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(toCopy).then(
      () => showToast(`Copied "${toCopy}" — paste in the DM`),
      () => showToast('Could not copy — long-press the code to copy manually')
    );
  } else {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = toCopy;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try { document.execCommand('copy'); showToast(`Copied "${toCopy}"`); }
    catch { showToast('Could not copy — long-press the code to copy manually'); }
    document.body.removeChild(textarea);
  }
}

// Called when the customer taps the Instagram button — copy the code
// first so they can paste it into the DM once Instagram opens.
function handleInstagramConfirm() {
  copyOrderCode();
  // Give the clipboard a beat to receive the write on some Safari
  // versions before we let the anchor navigate away.
  // (We don't preventDefault — the anchor navigates naturally after.)
}

// Placeholder to satisfy the confirm modal's Done button;
// populated with the current order's details each time modal opens.
let _pendingOrderInfo = null;

function finishOrderFlow() {
  closeOrderConfirmModal();
  if (_pendingOrderInfo) {
    startOrderTracker(_pendingOrderInfo.id);
    const code = _pendingOrderInfo.short_code || '';
    const toastMsg = _pendingOrderInfo.payMethod === 'bank_transfer'
      ? `Order #${code} placed — we're verifying your payment`
      : `Order #${code} placed! Tracking below.`;
    showToast(toastMsg);
    _pendingOrderInfo = null;
  }
}

// Shared prepay-payment block: wallet account + number + copy + screenshot
// upload. Used by the order-confirmation modal AND the persistent tracker so
// the customer can always pay + upload, even after closing the confirmation.
function prepayBlockHTML(opts) {
  const amountLine = (opts.amount != null)
    ? 'Send <strong>' + CONFIG.currency + ' ' + (Number(opts.amount) || 0) + '</strong> to:'
    : 'Complete your payment to:';
  return '' +
    '<div class="prepay-head">' + amountLine + '</div>' +
    '<div class="prepay-acct">' +
      '<div class="prepay-line"><span class="prepay-label">Account</span>' +
        '<span class="prepay-title">' + escapeHTML(opts.title || '') + '</span></div>' +
      '<div class="prepay-line"><span class="prepay-label">Number</span>' +
        '<span class="prepay-num">' + escapeHTML(opts.number || '') + '</span>' +
        '<button type="button" class="bank-copy prepay-copy-btn">Copy</button></div>' +
    '</div>' +
    '<label class="prepay-upload">Upload your payment screenshot' +
      '<input type="file" class="prepay-proof-input" accept="image/*"></label>' +
    '<div class="prepay-upload-status"></div>';
}

function wirePrepayBlock(container, orderId, number) {
  const copyBtn = container.querySelector('.prepay-copy-btn');
  if (copyBtn) copyBtn.addEventListener('click', () => copyBank(number));
  const inp = container.querySelector('.prepay-proof-input');
  if (inp) inp.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const st = container.querySelector('.prepay-upload-status');
    if (st) st.textContent = 'Uploading…';
    try {
      await OrdersAPI.attachPaymentProof(orderId, f);
      if (st) st.textContent = '✓ Screenshot received — we\'ll verify shortly.';
      if (_trackerOrderId === orderId) pollTracker();  // refresh the tracker status
    } catch (err) {
      console.error('[Pasto] proof upload failed:', err);
      if (st) st.textContent = 'Upload failed — try a smaller image.';
    }
  });
}

function showOrderConfirmModal(placed, payMethod) {
  const code = placed.short_code || '';
  const codeEl = document.getElementById('confirmOrderCode');
  if (codeEl) codeEl.textContent = code;

  _pendingOrderInfo = { id: placed.id, short_code: code, payMethod };

  // Prepay (Option B): reveal the wallet number + screenshot upload only now.
  const reveal = document.getElementById('prepayReveal');
  if (reveal) {
    if (payMethod === 'prepay' && placed.prepay_number) {
      reveal.hidden = false;
      reveal.innerHTML = prepayBlockHTML({
        title: placed.prepay_title, number: placed.prepay_number, amount: placed.total
      });
      wirePrepayBlock(reveal, placed.id, placed.prepay_number);
    } else {
      reveal.hidden = true;
      reveal.innerHTML = '';
    }
  }

  const modal = document.getElementById('orderConfirmModal');
  const overlay = document.getElementById('overlay');
  if (modal) modal.classList.add('open');
  if (overlay) overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeOrderConfirmModal() {
  const modal = document.getElementById('orderConfirmModal');
  const overlay = document.getElementById('overlay');
  if (modal) modal.classList.remove('open');
  if (overlay) overlay.classList.remove('show');
  document.body.style.overflow = '';

  // Belt and braces — if the customer closed via overlay without tapping,
  // still start the tracker for whatever order is saved locally.
  const active = lsGet('pastoActiveOrder', null);
  if (active && active.id && !_trackerOrderId) {
    startOrderTracker(active.id);
  }
}


// ==================================================
// LIVE ORDER TRACKER
// ==================================================
const TRACKER_STAGES = [
  { key: 'received',         label: 'Received',     desc: 'We got your order',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="14" y2="13"/><line x1="8" y1="17" x2="14" y2="17"/></svg>' },
  { key: 'preparing',        label: 'Preparing',    desc: 'Sauce on the stove',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11h18l-1 9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2L3 11z"/><path d="M6 11V8a6 6 0 0 1 12 0v3"/><path d="M9 8a3 3 0 0 1 6 0"/></svg>' },
  { key: 'baking',           label: 'In the oven',  desc: 'Toasting & finishing',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c0 3-3 4-3 7a3 3 0 0 0 6 0c0-3-3-4-3-7z"/><path d="M6 14a6 6 0 0 0 12 0c0-2-1-3-2-4a4 4 0 0 1-8 0c-1 1-2 2-2 4z"/></svg>' },
  { key: 'out_for_delivery', label: 'On the way',   desc: 'Rider headed to you',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M9 17h6M5 17V8h4l3 5h6l-2-5h-3"/></svg>' },
  { key: 'delivered',        label: 'Delivered',    desc: 'Enjoy your meal',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' },
];

let _trackerTimer = null;
let _trackerOrderId = null;
let _trackerCurrentStatus = null;

function startOrderTracker(orderId) {
  _trackerOrderId = orderId;
  const panel = document.getElementById('orderTracker');
  if (!panel) return;
  panel.hidden = false;
  hideOrderPill();
  pollTracker();
  if (_trackerTimer) clearInterval(_trackerTimer);
  _trackerTimer = setInterval(pollTracker, 15000); // every 15s
}

function stopOrderTracker() {
  if (_trackerTimer) clearInterval(_trackerTimer);
  _trackerTimer = null;
}

// Floating pill to RE-OPEN a dismissed tracker while an order is still active.
function showOrderPill() {
  const saved = lsGet('pastoActiveOrder', null);
  const pill = document.getElementById('orderPill');
  if (!pill || !saved || !saved.id) return;
  const codeEl = pill.querySelector('.order-pill-code');
  if (codeEl) codeEl.textContent = saved.short_code ? '#' + saved.short_code : '';
  pill.hidden = false;
}
function hideOrderPill() {
  const pill = document.getElementById('orderPill');
  if (pill) pill.hidden = true;
}
function reopenTracker() {
  const saved = lsGet('pastoActiveOrder', null);
  if (saved && saved.id) startOrderTracker(saved.id);
}

async function pollTracker() {
  if (!_trackerOrderId) return;
  try {
    const row = await OrdersAPI.track(_trackerOrderId);
    if (!row) {
      // Order was deleted in admin — clean up.
      hideTracker(true);
      return;
    }
    _trackerCurrentStatus = row.status;
    renderTracker(row);
    if (row.status === 'delivered' || row.status === 'cancelled') {
      stopOrderTracker();
      // Auto-clear delivered orders after 2 minutes so the bubble doesn't linger.
      setTimeout(() => hideTracker(true), 2 * 60 * 1000);
    }
  } catch (err) {
    console.error('[Pasto] tracker poll failed:', err);
  }
}

function renderTracker(row) {
  const codeEl   = document.getElementById('trackerCode');
  const statusEl = document.getElementById('trackerStatus');
  const stepsEl  = document.getElementById('trackerSteps');
  const footEl   = document.getElementById('trackerFoot');
  if (!stepsEl) return;

  codeEl.textContent = row.short_code;
  statusEl.textContent = ORDER_LABELS[row.status] || row.status;
  statusEl.className = 'order-tracker-status status-' + row.status;

  const currentIndex = TRACKER_STAGES.findIndex(s => s.key === row.status);
  const cancelled = row.status === 'cancelled';

  stepsEl.innerHTML = TRACKER_STAGES.map((stage, i) => {
    const done = !cancelled && i < currentIndex;
    const active = !cancelled && i === currentIndex;
    const cls = done ? 'done' : active ? 'active' : '';
    return `
      <li class="tracker-step ${cls}">
        <div class="tracker-step-icon">${stage.svg}</div>
        <div class="tracker-step-text">
          <div class="tracker-step-label">${stage.label}</div>
          <div class="tracker-step-desc">${stage.desc}</div>
        </div>
      </li>
    `;
  }).join('');

  // Footer line + referral code
  const updated = new Date(row.updated_at);
  const mins = Math.max(0, Math.round((Date.now() - updated.getTime()) / 60000));
  let foot = '';
  if (cancelled) {
    foot = `Order cancelled · contact us if this was a mistake`;
  } else if (row.status === 'delivered') {
    foot = `Thanks${row.customer_name ? ', ' + row.customer_name : ''}! Hope you loved it.`;
  } else {
    foot = `Last update ${mins === 0 ? 'just now' : mins + ' min ago'} · refreshes every 15s`;
  }
  // Surface payment status if relevant
  if (row.payment_status === 'awaiting_verification') {
    foot = `Verifying your payment screenshot — usually within 10 min`;
  } else if (row.payment_status === 'verified' && row.status === 'received') {
    foot = `Payment verified · order is queued for the kitchen`;
  } else if (row.payment_method === 'prepay' && row.payment_status === 'pending') {
    foot = `Send your payment and upload the screenshot below to start your order`;
  }
  const stored = lsGet('pastoActiveOrder', {});
  const refCode = stored.referral_code;
  let refHTML = '';
  if (refCode) {
    refHTML = `
      <div class="tracker-referral">
        <div class="tracker-referral-label">Share your code, friends get a discount</div>
        <div class="tracker-referral-row">
          <code>${escapeHTML(refCode)}</code>
          <button class="tracker-referral-copy" onclick="copyReferral('${escapeHTML(refCode)}')">Copy</button>
        </div>
      </div>
    `;
  }
  // Prepay: wallet + upload inside the persistent tracker, so the customer can
  // pay/upload even after closing the confirmation modal.
  // Only while awaiting payment (no screenshot yet). Once the screenshot is
  // attached the status flips to 'awaiting_verification' and this block hides,
  // leaving the "Verifying your payment screenshot…" line in the footer.
  const showPrepay = row.payment_method === 'prepay'
    && row.payment_status === 'pending'
    && row.prepay_number;
  const prepayHTML = showPrepay
    ? '<div class="tracker-prepay">' + prepayBlockHTML({
        title: row.prepay_title, number: row.prepay_number, amount: row.total
      }) + '</div>'
    : '';

  footEl.innerHTML = prepayHTML + refHTML + `<div class="tracker-foot-line">${foot}</div>`;
  if (showPrepay) {
    const pc = footEl.querySelector('.tracker-prepay');
    if (pc) wirePrepayBlock(pc, _trackerOrderId, row.prepay_number);
  }
}

function copyReferral(code) {
  navigator.clipboard?.writeText(code).then(
    () => showToast('Referral code copied'),
    () => showToast('Could not copy — long-press to copy')
  );
}

function hideTracker(clearStored) {
  const panel = document.getElementById('orderTracker');
  if (panel) panel.hidden = true;
  if (clearStored) localStorage.removeItem('pastoActiveOrder');
  stopOrderTracker();
  _trackerOrderId = null;
  _trackerCurrentStatus = null;
  // If the order is still active (not cleared), leave a pill to reopen it.
  if (clearStored) hideOrderPill(); else showOrderPill();
}

// Smart close: if the order is already in a terminal state, dismissing
// the card should clear it permanently (don't bring it back on reload).
function dismissTracker() {
  const isTerminal = _trackerCurrentStatus === 'delivered'
                  || _trackerCurrentStatus === 'cancelled';
  hideTracker(isTerminal);
}

async function resumeTrackerIfActive() {
  const saved = lsGet('pastoActiveOrder', null);
  if (!saved || !saved.id) return;

  // If the saved order is older than 24 hours, drop it. It's no longer relevant.
  if (saved.placedAt && Date.now() - saved.placedAt > 24 * 60 * 60 * 1000) {
    localStorage.removeItem('pastoActiveOrder');
    return;
  }

  // Peek at the current status before showing the card. If it's already
  // delivered or cancelled and the user has come back later, just clear
  // it — they're done with this order.
  try {
    const row = await OrdersAPI.track(saved.id);
    if (!row) {                            // Order was deleted in admin
      localStorage.removeItem('pastoActiveOrder');
      return;
    }
    if (row.status === 'delivered' || row.status === 'cancelled') {
      // Only re-show if it was very recent (last 10 minutes), otherwise drop it.
      const updated = new Date(row.updated_at).getTime();
      if (Date.now() - updated > 10 * 60 * 1000) {
        localStorage.removeItem('pastoActiveOrder');
        return;
      }
    }
  } catch (err) {
    console.warn('[Pasto] tracker resume check failed, will retry via polling:', err);
  }

  startOrderTracker(saved.id);
}


// ==================================================
// SETUP DYNAMIC LINKS FROM CONFIG
// ==================================================
// ----- Mobile hamburger nav -----
function toggleMobileNav() {
  const menu = document.getElementById('mobileNav');
  const btn = document.getElementById('navHamburger');
  if (!menu) return;
  const opening = menu.hasAttribute('hidden');
  if (opening) menu.removeAttribute('hidden'); else menu.setAttribute('hidden', '');
  if (btn) {
    btn.classList.toggle('active', opening);
    btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
  }
}
function closeMobileNav() {
  const menu = document.getElementById('mobileNav');
  const btn = document.getElementById('navHamburger');
  if (menu) menu.setAttribute('hidden', '');
  if (btn) { btn.classList.remove('active'); btn.setAttribute('aria-expanded', 'false'); }
}

function setupConfigLinks() {
  // Foodpanda button
  const fpBtn = document.getElementById('foodpandaBtn');
  if (fpBtn) fpBtn.href = CONFIG.foodpandaURL;

  // Call button
  const callBtn = document.getElementById('callBtn');
  if (callBtn) callBtn.href = `tel:${CONFIG.phoneNumber}`;
}


// ==================================================
// SCROLL REVEAL
// ==================================================
function observeReveals() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.reveal:not(.visible)').forEach(el => observer.observe(el));
}


// ==================================================
// LIVE MENU + SITE SETTINGS
// ==================================================
// Fetch the admin-curated menu from Supabase. Falls back to the local
// MENU array (from config.js) if the request fails — that keeps the
// site working even if the database is briefly unreachable.
async function loadMenuFromDB() {
  try {
    const rows = await MenuAPI.listActive();
    if (rows && rows.length > 0) {
      MENU = rows.map(r => ({
        id:          r.id,
        name:        r.name,
        desc:        r.description || '',
        price:       r.price,
        tag:         r.tag,
        tagLabel:    r.tag_label,
        imageUrl:    r.image_url,
        iconColor:   r.icon_color,
        accentColor: r.accent_color
      }));
    }
  } catch (err) {
    console.warn('[Pasto] Could not load menu from server, using fallback:', err);
  }
  renderMenu();
  renderCart();
  updateCartCount();
}

// Apply admin-uploaded hero image (if any) over the SVG illustration.
async function loadSiteSettings() {
  try {
    const settings = await SettingsAPI.getAll();
    // Admin-controlled business hours override the config.js defaults.
    if (settings.business_hours_start) _bizStart = settings.business_hours_start;
    if (settings.business_hours_end)   _bizEnd   = settings.business_hours_end;
    // Pause-orders state (reflected as a red banner and checkout block).
    _pauseState = {
      paused: String(settings.ordering_paused || 'false').toLowerCase() === 'true',
      reason: settings.ordering_paused_reason || ''
    };
    reflectPauseBanner();
    const heroUrl = settings.hero_image_url;
    const heroVisual = document.querySelector('.hero-visual');
    if (heroUrl && heroVisual) {
      heroVisual.classList.add('has-photo');
      // Insert/replace a wrapper img above the SVGs so the photo dominates
      let img = heroVisual.querySelector('.hero-photo');
      if (!img) {
        img = document.createElement('img');
        img.className = 'hero-photo';
        img.alt = 'Pasto signature dish';
        heroVisual.insertBefore(img, heroVisual.firstChild);
      }
      img.src = heroUrl;
    }

    // Admin-uploaded background videos (Story / Rewards / Reviews / Services)
    applySectionBgVideo('.story-section',   settings.bg_video_story);
    applySectionBgVideo('.rewards-section', settings.bg_video_rewards);
    applySectionBgVideo('.reviews-section', settings.bg_video_reviews);
    applySectionBgVideo('.order-section',   settings.bg_video_services);
  } catch (err) {
    console.warn('[Pasto] Could not load site settings:', err);
  }
}

// Injects (or removes) a muted looping background video inside a
// section wrapper. The video sits at low opacity behind the content.
function applySectionBgVideo(sectionSelector, url) {
  const section = document.querySelector(sectionSelector);
  if (!section) return;

  const existing = section.querySelector(':scope > .section-bg-video');

  if (!url) {
    // No video configured — remove any existing one and reset the flag
    if (existing) existing.remove();
    section.classList.remove('has-bg-video');
    return;
  }

  if (existing) {
    if (existing.getAttribute('src') !== url) existing.src = url;
    return;
  }

  const video = document.createElement('video');
  video.className = 'section-bg-video';
  video.muted = true;
  video.loop = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  video.setAttribute('preload', 'metadata');
  video.setAttribute('aria-hidden', 'true');
  video.src = url;
  section.insertBefore(video, section.firstChild);
  section.classList.add('has-bg-video');
  // iOS Safari sometimes swallows the initial autoplay — poke it.
  video.play().catch(() => {});
}


// ==================================================
// INITIALIZATION
// ==================================================
document.addEventListener('DOMContentLoaded', () => {
  initPreLaunchMode();           // countdown + intercepts (must run early)
  initDeliveryWidget();          // floating zone-check widget bottom-left
  renderMenu();                  // immediate paint with fallback
  loadMenuFromDB();              // then replace with DB data
  loadSiteSettings();            // apply hero image if set
  renderReviews();
  setupRatingInput();
  renderCart();
  renderContactLinks();
  setupConfigLinks();
  updateCartCount();
  observeReveals();
  resumeTrackerIfActive();

  document.getElementById('orderTrackerClose')?.addEventListener('click', dismissTracker);
  document.getElementById('orderPill')?.addEventListener('click', reopenTracker);
  setupPayProofPreview();

  // Rewards lookup form
  document.getElementById('rewardsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = document.getElementById('rewardsPhone').value.trim();
    if (!phone) return;
    const resultEl = document.getElementById('rewardsResult');
    resultEl.hidden = false;
    resultEl.innerHTML = `<div class="rewards-result-loading">Looking up your card…</div>`;
    try {
      const row = await RewardsAPI.getLoyalty(phone);
      if (!row || row.order_count === 0) {
        resultEl.innerHTML = `
          <div class="rewards-result-empty">
            <h4>No orders yet under this phone.</h4>
            <p>Place your first order and you'll get your own referral code to share.</p>
          </div>`;
        return;
      }
      resultEl.innerHTML = `
        <div class="rewards-result-card">
          <div class="rewards-card-head">
            <div>
              <div class="rewards-card-name">${escapeHTML(row.name || 'Pasto regular')}</div>
              <div class="rewards-card-count">${row.order_count} order${row.order_count === 1 ? '' : 's'} so far</div>
            </div>
          </div>
          <div class="rewards-card-foot">
            <div class="rewards-referral">
              <div class="rewards-referral-label">Your referral code</div>
              <div class="rewards-referral-row">
                <code>${escapeHTML(row.referral_code)}</code>
                <button class="btn btn-secondary" onclick="copyReferral('${escapeHTML(row.referral_code)}')">Copy</button>
              </div>
              <div class="rewards-referral-hint">Share it — friends get 10% off their first order.</div>
            </div>
          </div>
        </div>
      `;
    } catch (err) {
      console.error(err);
      resultEl.innerHTML = `<div class="rewards-result-empty">Could not look up your rewards. Try again in a moment.</div>`;
    }
  });

  // Refresh loyalty mini whenever the phone field changes in checkout
  document.getElementById('custPhone')?.addEventListener('blur', refreshLoyaltyForCheckout);
  // Recompute discounts when cart changes
  ['custCoupon'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); applyCoupon(); }
    });
  });

  // Close drawer/modal with Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeCart();
      closeModal();
      closeReviewModal();
      closeLaunchModal();
      closeClosedModal();
      closePausedModal();
    }
  });

  // Keep the pause banner in sync every 30 seconds so browsers that
  // have been open all day pick up when the owner toggles it.
  setInterval(refreshPauseState, 30 * 1000);

  // Smooth scroll for in-page anchor links
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
      const id = link.getAttribute('href');
      if (id.length > 1) {
        e.preventDefault();
        document.querySelector(id)?.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
});
