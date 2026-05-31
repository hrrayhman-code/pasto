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
    return `<img src="${item.imageUrl}" alt="${item.name}" loading="lazy">`;
  }

  // Otherwise, return the illustrated icon
  const c = item.accentColor;

  if (item.id === 'alfredo' || item.id === 'pink' || item.id === 'green') {
    return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="42" fill="${item.iconColor}" stroke="#1A1A1A" stroke-width="1.5"/>
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
      <rect x="18" y="38" width="64" height="24" rx="4" fill="${item.iconColor}" stroke="#1A1A1A" stroke-width="1.5"/>
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
      <rect x="22" y="40" width="56" height="20" rx="3" fill="${item.iconColor}" stroke="#1A1A1A" stroke-width="1.5"/>
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
    <circle cx="50" cy="50" r="42" fill="${item.iconColor || '#FFF8F0'}" stroke="#1A1A1A" stroke-width="1.5"/>
    <text x="50" y="58" text-anchor="middle" font-family="Fraunces, serif" font-size="32" font-weight="500" fill="${c || '#E63946'}">P</text>
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
    <div class="menu-card reveal" data-id="${item.id}">
      <div class="menu-card-visual">
        <span class="menu-card-tag ${item.tag}">${item.tagLabel}</span>
        ${dishVisual(item)}
      </div>
      <h3 class="menu-card-title">${item.name}</h3>
      <p class="menu-card-desc">${item.desc}</p>
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
    return `<img class="review-avatar-img" src="${review.imageUrl}" alt="${review.name}" loading="lazy">`;
  }
  const initials = (review.name || '?')
    .split(/\s+/).map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  // Stable color from name
  const palette = ['#E63946', '#2d6a3f', '#d97706', '#1A1A1A', '#8B5CF6'];
  const idx = (review.name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length;
  const bg = review.accentColor || palette[idx];
  return `<div class="review-avatar-initial" style="background:${bg}">${initials}</div>`;
}

function escapeHTML(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
function addToCart(id) {
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
            <div class="cart-item-name">${item.name}</div>
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
  if (cartItemCount() === 0) return;
  closeCart();
  setTimeout(() => {
    document.getElementById('checkoutModal').classList.add('open');
    document.getElementById('overlay').classList.add('show');
    document.body.style.overflow = 'hidden';
    renderCheckoutTotal();
    refreshLoyaltyForCheckout();
  }, 300);
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

function toggleFreeCredit(on) {
  _useFreeCredit = !!on;
  renderCheckoutTotal();
}

function stampRow(progress) {
  let html = '<div class="loyalty-stamps">';
  for (let i = 0; i < 5; i++) {
    const filled = i < progress;
    html += `<div class="loyalty-stamp ${filled ? 'on' : ''}">${filled ? '★' : i + 1}</div>`;
  }
  html += '</div>';
  return html;
}

function renderCheckoutTotal() {
  const wrap = document.getElementById('checkoutTotal');
  if (!wrap) return;
  const total = cartTotal();
  const bulk = bulkFreeDiscount();                              // auto buy-5-get-1-free
  const couponDisc = _appliedCoupon?.computed_discount || 0;
  const totalDisc = Math.min(total, bulk.amount + couponDisc);
  const payable = Math.max(0, total - totalDisc);

  const lines = [`<div class="ct-line"><span>Subtotal</span><span>${CONFIG.currency} ${total}</span></div>`];
  if (bulk.qualifies && bulk.amount > 0) {
    lines.push(`<div class="ct-line ct-disc"><span>★ Free ${escapeHTML(bulk.freeItem.name)} (5+ items)</span><span>− ${CONFIG.currency} ${bulk.amount}</span></div>`);
  }
  if (couponDisc > 0) {
    lines.push(`<div class="ct-line ct-disc"><span>Promo ${escapeHTML(_appliedCoupon.code)}</span><span>− ${CONFIG.currency} ${couponDisc}</span></div>`);
  }
  lines.push(`<div class="ct-line ct-total"><span>You pay</span><span>${CONFIG.currency} ${payable}</span></div>`);
  wrap.innerHTML = lines.join('');
}

async function submitOrder() {
  const name = document.getElementById('custName').value.trim();
  const phone = document.getElementById('custPhone').value.trim();
  const address = document.getElementById('custAddress').value.trim();
  const notes = document.getElementById('custNotes').value.trim();
  const coupon = (document.getElementById('custCoupon').value || '').trim() || null;

  if (!name || !phone || !address) {
    showToast('Please fill in name, phone, and address');
    return;
  }

  // Build items payload + total for the DB
  const items = Object.entries(cart).map(([id, qty]) => {
    const item = MENU.find(m => m.id === id);
    return { id, name: item?.name || id, qty, price: item?.price || 0 };
  });
  const total = cartTotal();

  const submitBtn = document.querySelector('#checkoutModal .modal-submit');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending...'; }

  let placed = null;
  try {
    placed = await OrdersAPI.place({
      name, phone, address, notes, items, total,
      couponCode: coupon,
      useCredit: _useFreeCredit
    });
  } catch (err) {
    console.error('[Pasto] place_order failed:', err);
    // Build a friendlier, more specific message
    const raw = (err && (err.message || err.error_description || err.hint)) || '';
    let friendly = 'Could not save your order — please try again';
    if (/function .*place_order.* does not exist/i.test(raw) ||
        /could not find the function/i.test(raw) ||
        /404|PGRST202|PGRST302/i.test(raw)) {
      friendly = 'Orders table not set up yet. Re-run database/schema.sql in Supabase.';
    } else if (/relation .*orders.* does not exist/i.test(raw)) {
      friendly = 'Orders table missing. Re-run database/schema.sql in Supabase.';
    } else if (/Invalid order payload/i.test(raw)) {
      friendly = 'Please double-check your name, phone, and address.';
    } else if (/permission denied|JWT|rls/i.test(raw)) {
      friendly = 'Database permission error — re-run database/schema.sql to fix policies.';
    } else if (/failed to fetch|networkerror|cors/i.test(raw)) {
      friendly = 'Network error — check your internet and SUPABASE.url in js/config.js.';
    } else if (raw) {
      friendly = 'Could not save order: ' + raw;
    }
    showToast(friendly);
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Send to WhatsApp'; }
    return;
  }

  // Build the WhatsApp message (now includes the order code + discounts)
  const discount = placed.discount || 0;
  const payable = Math.max(0, total - discount);
  let msg = `*New Pasto order #${placed.short_code}*\n\n`;
  msg += `*Customer:* ${name}\n`;
  msg += `*Phone:* ${phone}\n`;
  msg += `*Address:* ${address}\n\n`;
  msg += `*Order:*\n`;
  items.forEach(it => {
    msg += `• ${it.qty}× ${it.name} — ${CONFIG.currency} ${it.price * it.qty}\n`;
  });
  const bulkFree = placed.bulk_free_amount || 0;
  const couponDisc = Math.max(0, discount - bulkFree);
  msg += `\n*Subtotal:* ${CONFIG.currency} ${total}\n`;
  if (bulkFree > 0)  msg += `*Buy 5 get 1 free:* −${CONFIG.currency} ${bulkFree}\n`;
  if (coupon && couponDisc > 0) msg += `*Promo ${coupon}:* −${CONFIG.currency} ${couponDisc}\n`;
  if (discount > 0)  msg += `*Total payable:* ${CONFIG.currency} ${payable}\n`;
  else               msg += `*Total:* ${CONFIG.currency} ${total}\n`;
  msg += `*Payment:* Cash on delivery`;
  if (notes) msg += `\n\n*Notes:* ${notes}`;

  const url = `https://wa.me/${CONFIG.whatsappNumber}?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');

  // Remember the order id locally so the tracker survives page reloads.
  lsSet('pastoActiveOrder', {
    id: placed.id,
    short_code: placed.short_code,
    referral_code: placed.referral_code || null,
    placedAt: Date.now()
  });

  // Clear cart
  cart = {};
  saveCart();
  renderCart();
  updateCartCount();
  updateAllMenuCardControls();
  closeModal();
  showToast(`Order #${placed.short_code} placed! Tracking below.`);

  // Clear form fields and coupon state
  ['custName', 'custPhone', 'custAddress', 'custNotes', 'custCoupon'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('couponFeedback').textContent = '';
  document.getElementById('checkoutLoyalty').hidden = true;
  document.getElementById('checkoutTotal').innerHTML = '';
  _appliedCoupon = null;
  _useFreeCredit = false;
  _loyaltyForCheckout = null;
  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Send to WhatsApp'; }

  // Start the live tracker
  startOrderTracker(placed.id);
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
  pollTracker();
  if (_trackerTimer) clearInterval(_trackerTimer);
  _trackerTimer = setInterval(pollTracker, 15000); // every 15s
}

function stopOrderTracker() {
  if (_trackerTimer) clearInterval(_trackerTimer);
  _trackerTimer = null;
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
  footEl.innerHTML = refHTML + `<div class="tracker-foot-line">${foot}</div>`;
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
// INITIALIZATION
// ==================================================
document.addEventListener('DOMContentLoaded', () => {
  renderMenu();
  renderReviews();
  setupRatingInput();
  renderCart();
  renderContactLinks();
  setupConfigLinks();
  updateCartCount();
  observeReveals();
  resumeTrackerIfActive();

  document.getElementById('orderTrackerClose')?.addEventListener('click', dismissTracker);

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
            <p>Place your first order and your loyalty card starts automatically — plus you'll get your own referral code to share.</p>
          </div>`;
        return;
      }
      const credits = row.free_credits || 0;
      resultEl.innerHTML = `
        <div class="rewards-result-card">
          <div class="rewards-card-head">
            <div>
              <div class="rewards-card-name">${escapeHTML(row.name || 'Pasto regular')}</div>
              <div class="rewards-card-count">${row.order_count} order${row.order_count === 1 ? '' : 's'} so far</div>
            </div>
            ${credits > 0
              ? `<div class="rewards-credit-pill">${credits} free item${credits === 1 ? '' : 's'} ready</div>`
              : `<div class="rewards-credit-pill muted">${5 - row.progress} to go</div>`}
          </div>
          ${stampRow(row.progress)}
          <div class="rewards-card-foot">
            <div class="rewards-referral">
              <div class="rewards-referral-label">Your referral code</div>
              <div class="rewards-referral-row">
                <code>${escapeHTML(row.referral_code)}</code>
                <button class="btn btn-secondary" onclick="copyReferral('${escapeHTML(row.referral_code)}')">Copy</button>
              </div>
              <div class="rewards-referral-hint">Share it — they get a discount, you get extra credits when they order.</div>
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
    }
  });

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
