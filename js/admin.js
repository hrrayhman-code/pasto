// ==================================================
// PASTO — Admin dashboard logic
// ==================================================

let _adminState = {
  section: 'orders',
  tab: 'pending',
  search: '',
  all: []   // cached full review list
};

let _ordersState = {
  tab: 'active',
  search: '',
  all: [],
  autoRefresh: true,
  timer: null
};

// ----- Toast (shared style with main site) -----
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

function escapeHTML(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function starsAdmin(rating) {
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  return '★'.repeat(r) + '☆'.repeat(5 - r);
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ==================================================
// AUTH GATE
// ==================================================
async function bootstrap() {
  const session = await AuthAPI.getSession();
  if (session) {
    showDashboard(session);
  } else {
    showLogin();
  }

  AuthAPI.onAuthChange(session => {
    if (session) showDashboard(session); else showLogin();
  });

  // Sanity check that Supabase is actually configured
  if (!window.sb) {
    const errEl = document.getElementById('loginError');
    errEl.textContent = 'Supabase client failed to load. Check the browser console.';
    errEl.hidden = false;
    console.error('[Pasto Admin] window.sb is undefined. supabase-js failed to load or SUPABASE config is missing in js/config.js.');
  } else if (!SUPABASE.url || SUPABASE.url.includes('YOUR-PROJECT-REF')) {
    const errEl = document.getElementById('loginError');
    errEl.textContent = 'SUPABASE URL / anon key are still placeholders. Edit js/config.js.';
    errEl.hidden = false;
    console.error('[Pasto Admin] SUPABASE config still contains placeholders.');
  }

  // Login form
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('adminEmail').value.trim();
    const password = document.getElementById('adminPassword').value;
    const errEl = document.getElementById('loginError');
    const submitBtn = e.target.querySelector('button[type="submit"]');

    errEl.hidden = true;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Signing in…'; }

    try {
      const result = await AuthAPI.signIn(email, password);
      console.info('[Pasto Admin] Sign-in OK:', result?.user?.email);
    } catch (err) {
      console.error('[Pasto Admin] Sign-in failed:', err);
      let msg = err.message || 'Sign-in failed';
      // Friendlier copy for the most common cases
      if (/invalid login credentials/i.test(msg)) {
        msg = 'Wrong email or password. (Did you create the user in Supabase → Authentication → Users?)';
      } else if (/email not confirmed/i.test(msg)) {
        msg = 'Email not confirmed. In Supabase → Authentication → Users, click your user and confirm the email (or re-create with "Auto Confirm User" ticked).';
      } else if (/failed to fetch|network/i.test(msg)) {
        msg = 'Network error. Check the SUPABASE.url value in js/config.js (no trailing slash) and your internet connection.';
      }
      errEl.textContent = msg;
      errEl.hidden = false;
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Sign in'; }
    }
  });

  // Top-level section tabs (Orders | Reviews)
  document.querySelectorAll('.admin-section-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-section-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _adminState.section = btn.dataset.section;
      document.querySelectorAll('.admin-section').forEach(s => {
        s.hidden = s.dataset.section !== _adminState.section;
      });
    });
  });

  // Review tabs
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _adminState.tab = btn.dataset.tab;
      renderList();
    });
  });
  document.getElementById('adminSearch').addEventListener('input', (e) => {
    _adminState.search = e.target.value.toLowerCase();
    renderList();
  });

  // Order tabs
  document.querySelectorAll('[data-otab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-otab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _ordersState.tab = btn.dataset.otab;
      renderOrders();
    });
  });
  document.getElementById('adminOrderSearch').addEventListener('input', (e) => {
    _ordersState.search = e.target.value.toLowerCase();
    renderOrders();
  });
  document.getElementById('adminAutoRefresh').addEventListener('change', (e) => {
    _ordersState.autoRefresh = e.target.checked;
    setupOrdersAutoRefresh();
  });
}

function showLogin() {
  document.getElementById('loginView').hidden = false;
  document.getElementById('dashView').hidden = true;
}

function showDashboard(session) {
  document.getElementById('loginView').hidden = true;
  document.getElementById('dashView').hidden = false;
  document.getElementById('adminUserLabel').textContent = session.user.email;
  loadAdminData();
  loadOrders();
  loadCoupons();
  loadMenuItems();
  loadSiteImagePreview();
  loadBankSettings();
  loadLaunchSignups();
  setupOrdersAutoRefresh();
  // Realtime push: get sound + notification the moment an order comes in
  subscribeToNewOrders();
  updateNotifPermUI();
}

async function adminSignOut() {
  await AuthAPI.signOut();
  showLogin();
}

// ==================================================
// DATA LOAD + RENDER
// ==================================================
async function loadAdminData() {
  try {
    const [all, stats] = await Promise.all([
      ReviewsAPI.listAll(),
      ReviewsAPI.stats()
    ]);
    _adminState.all = all;

    document.getElementById('statTotal').textContent    = stats.total;
    document.getElementById('statPending').textContent  = stats.pending;
    document.getElementById('statApproved').textContent = stats.approved;
    document.getElementById('statRejected').textContent = stats.rejected;
    document.getElementById('statAvg').textContent      = stats.avg ? stats.avg.toFixed(1) : '–';

    document.getElementById('tabCountPending').textContent  = stats.pending;
    document.getElementById('tabCountApproved').textContent = stats.approved;
    document.getElementById('tabCountRejected').textContent = stats.rejected;

    renderList();
  } catch (err) {
    console.error(err);
    document.getElementById('adminList').innerHTML =
      `<div class="admin-empty error">Failed to load reviews: ${escapeHTML(err.message)}</div>`;
  }
}

function renderList() {
  const list = document.getElementById('adminList');
  const tab = _adminState.tab;
  const q = _adminState.search;

  let items = _adminState.all;
  if (tab !== 'all') items = items.filter(r => r.status === tab);
  if (q) items = items.filter(r =>
    (r.name || '').toLowerCase().includes(q) ||
    (r.location || '').toLowerCase().includes(q) ||
    (r.quote || '').toLowerCase().includes(q)
  );

  // Pending → newest first; approved → pinned first then newest.
  items.sort((a, b) => {
    if (a.status === 'approved' && b.status === 'approved') {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    }
    return new Date(b.created_at) - new Date(a.created_at);
  });

  if (items.length === 0) {
    list.innerHTML = `<div class="admin-empty">No reviews in this view.</div>`;
    return;
  }

  list.innerHTML = items.map(r => renderRow(r)).join('');
}

function renderRow(r) {
  const status = r.status;
  const isPending = status === 'pending';
  const isApproved = status === 'approved';
  const isRejected = status === 'rejected';

  return `
    <article class="admin-row status-${status} ${r.pinned ? 'pinned' : ''}" data-id="${r.id}">
      <div class="admin-row-head">
        <div class="admin-row-meta">
          <span class="admin-row-name">${escapeHTML(r.name)}</span>
          ${r.location ? `<span class="admin-row-sub">· ${escapeHTML(r.location)}</span>` : ''}
          <span class="admin-row-sub">· ${fmtDate(r.created_at)}</span>
        </div>
        <div class="admin-row-badges">
          ${r.pinned ? '<span class="badge pin">📌 Pinned</span>' : ''}
          <span class="badge status-${status}">${status}</span>
          <span class="admin-row-rating" title="${r.rating} / 5">${starsAdmin(r.rating)}</span>
        </div>
      </div>
      <p class="admin-row-quote">${escapeHTML(r.quote)}</p>
      <div class="admin-row-foot">
        <div class="admin-row-likes">❤ ${r.likes || 0} likes</div>
        <div class="admin-row-actions">
          ${isPending ? `
            <button class="admin-action approve" onclick="actApprove('${r.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Approve
            </button>
            <button class="admin-action reject" onclick="actReject('${r.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              Reject
            </button>
          ` : ''}
          ${isApproved ? `
            <button class="admin-action ${r.pinned ? 'on' : ''}" onclick="actTogglePin('${r.id}', ${!r.pinned})">
              <svg viewBox="0 0 24 24" fill="${r.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3l5 5-6 1-3 3 4 4-2 2-4-4-3 3-1-1 3-3-4-4 2-2 4 4 3-3 1-6z"/></svg>
              ${r.pinned ? 'Unpin' : 'Pin'}
            </button>
            <button class="admin-action reject" onclick="actReject('${r.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              Unpublish
            </button>
          ` : ''}
          ${isRejected ? `
            <button class="admin-action approve" onclick="actApprove('${r.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Approve instead
            </button>
          ` : ''}
          <button class="admin-action danger" onclick="actDelete('${r.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
            Delete
          </button>
        </div>
      </div>
    </article>
  `;
}

// ==================================================
// ACTIONS
// ==================================================
async function actApprove(id) {
  try {
    await ReviewsAPI.setStatus(id, 'approved');
    showToast('Approved · now live on the site');
    loadAdminData();
  } catch (err) { showToast('Failed: ' + err.message); }
}

async function actReject(id) {
  try {
    await ReviewsAPI.setStatus(id, 'rejected');
    showToast('Rejected · hidden from site');
    loadAdminData();
  } catch (err) { showToast('Failed: ' + err.message); }
}

async function actTogglePin(id, pinned) {
  try {
    await ReviewsAPI.setPinned(id, pinned);
    showToast(pinned ? 'Pinned to top' : 'Unpinned');
    loadAdminData();
  } catch (err) { showToast('Failed: ' + err.message); }
}

async function actDelete(id) {
  if (!confirm('Permanently delete this review? This cannot be undone.')) return;
  try {
    await ReviewsAPI.remove(id);
    showToast('Deleted');
    loadAdminData();
  } catch (err) { showToast('Failed: ' + err.message); }
}

// ==================================================
// ORDERS DASHBOARD
// ==================================================
const ORDER_STATUS_LABELS = {
  received:         'Received',
  preparing:        'Preparing',
  baking:           'In the oven',
  out_for_delivery: 'On the way',
  delivered:        'Delivered',
  cancelled:        'Cancelled'
};
const STATUS_FLOW = ['received', 'preparing', 'baking', 'out_for_delivery', 'delivered'];
const NEXT_STATUS = {
  received:         'preparing',
  preparing:        'baking',
  baking:           'out_for_delivery',
  out_for_delivery: 'delivered'
};
const PREV_STATUS = {
  preparing:        'received',
  baking:           'preparing',
  out_for_delivery: 'baking',
  delivered:        'out_for_delivery'
};

function setupOrdersAutoRefresh() {
  if (_ordersState.timer) { clearInterval(_ordersState.timer); _ordersState.timer = null; }
  if (_ordersState.autoRefresh) {
    // Poll every 5 seconds. Combined with the deduping seen-set, this
    // gives us a reliable fallback for when Realtime silently fails
    // (which is common on mobile browsers with power management).
    _ordersState.timer = setInterval(loadOrders, 5000);
  }
}

// Track which order IDs we've already alerted for — so polling can
// detect "new since last load" and fire the alert if Realtime is
// broken or the tab was backgrounded.
const _seenOrderIds = new Set();
let _ordersFirstLoadDone = false;

async function loadOrders() {
  try {
    const orders = await OrdersAPI.listAll();

    // Detect brand-new orders vs the last snapshot we saw. On the very
    // first load we just seed the seen-set without firing alerts
    // (otherwise every order in history would ring on page load).
    if (_ordersFirstLoadDone) {
      const newlyArrived = orders.filter(o => !_seenOrderIds.has(o.id));
      newlyArrived
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .forEach(o => {
          console.info('[Pasto Admin] Polling caught new order:', o.short_code);
          handleRealtimeNewOrder(o);
        });
    }
    orders.forEach(o => _seenOrderIds.add(o.id));
    _ordersFirstLoadDone = true;
    _lastPollAt = Date.now();

    _ordersState.all = orders;
    renderOrdersStats();
    renderOrdersTabCounts();
    renderOrders();
  } catch (err) {
    console.error(err);
    document.getElementById('adminOrdersList').innerHTML =
      `<div class="admin-empty error">Failed to load orders: ${escapeHTML(err.message)}</div>`;
  }
}

function isActive(o) {
  return o.status !== 'delivered' && o.status !== 'cancelled';
}

function isToday(iso) {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
      && d.getMonth() === now.getMonth()
      && d.getDate() === now.getDate();
}

function renderOrdersStats() {
  const all = _ordersState.all;
  const active = all.filter(isActive).length;
  const today = all.filter(o => isToday(o.created_at)).length;
  const delivered = all.filter(o => o.status === 'delivered').length;
  const revenueToday = all
    .filter(o => isToday(o.created_at) && o.status !== 'cancelled')
    .reduce((s, o) => s + (o.total || 0), 0);

  document.getElementById('oStatTotal').textContent     = all.length;
  document.getElementById('oStatActive').textContent    = active;
  document.getElementById('oStatToday').textContent     = today;
  document.getElementById('oStatDelivered').textContent = delivered;
  document.getElementById('oStatRevenue').textContent   = 'Rs. ' + revenueToday;
}

function renderOrdersTabCounts() {
  const all = _ordersState.all;
  const count = (s) => all.filter(o => o.status === s).length;
  document.getElementById('oTabCountActive').textContent    = all.filter(isActive).length;
  document.getElementById('oTabCountReceived').textContent  = count('received');
  document.getElementById('oTabCountPreparing').textContent = count('preparing');
  document.getElementById('oTabCountBaking').textContent    = count('baking');
  document.getElementById('oTabCountOFD').textContent       = count('out_for_delivery');
  document.getElementById('oTabCountDelivered').textContent = count('delivered');
}

function renderOrders() {
  const list = document.getElementById('adminOrdersList');
  let items = _ordersState.all;
  const q = _ordersState.search;
  const tab = _ordersState.tab;

  if (tab === 'active') items = items.filter(isActive);
  else if (tab !== 'all') items = items.filter(o => o.status === tab);

  if (q) items = items.filter(o =>
    (o.customer_name || '').toLowerCase().includes(q) ||
    (o.customer_phone || '').toLowerCase().includes(q) ||
    (o.short_code || '').toLowerCase().includes(q) ||
    (o.customer_address || '').toLowerCase().includes(q)
  );

  if (items.length === 0) {
    list.innerHTML = `<div class="admin-empty">No orders in this view.</div>`;
    return;
  }

  list.innerHTML = items.map(renderOrderRow).join('');
}

function renderOrderRow(o) {
  const itemsHTML = (o.items || []).map(it =>
    `<li>${it.qty}× ${escapeHTML(it.name)} <span class="ord-item-price">Rs. ${it.price * it.qty}</span></li>`
  ).join('');

  const next = NEXT_STATUS[o.status];
  const prev = PREV_STATUS[o.status];
  const nextLabel = next ? ORDER_STATUS_LABELS[next] : null;
  const prevLabel = prev ? ORDER_STATUS_LABELS[prev] : null;
  const active = isActive(o);
  const elapsed = Math.max(0, Math.round((Date.now() - new Date(o.created_at).getTime()) / 60000));

  // Dropdown options: every stage + Cancelled. Disable current.
  const dropdownOptions = STATUS_FLOW.map(s =>
    `<option value="${s}" ${s === o.status ? 'selected' : ''}>${ORDER_STATUS_LABELS[s]}</option>`
  ).join('') + `<option value="cancelled" ${o.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>`;

  return `
    <article class="admin-row order-row status-${o.status}" data-id="${o.id}">
      <div class="admin-row-head">
        <div class="admin-row-meta">
          <span class="ord-code">#${escapeHTML(o.short_code)}</span>
          <span class="admin-row-name">${escapeHTML(o.customer_name)}</span>
          <span class="admin-row-sub">· ${escapeHTML(o.customer_phone)}</span>
          <span class="admin-row-sub">· ${elapsed}m ago</span>
        </div>
        <div class="admin-row-badges">
          <span class="badge order-status-${o.status}">${ORDER_STATUS_LABELS[o.status]}</span>
          <span class="ord-total">Rs. ${o.total}</span>
        </div>
      </div>

      <div class="ord-body">
        <div class="ord-address">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          <span>${escapeHTML(o.customer_address)}</span>
        </div>
        <ul class="ord-items">${itemsHTML}</ul>
        ${o.notes ? `<div class="ord-notes"><strong>Notes:</strong> ${escapeHTML(o.notes)}</div>` : ''}
        ${renderPaymentInfo(o)}
      </div>

      <div class="admin-row-foot">
        <div class="admin-row-sub">Placed ${fmtDate(o.created_at)}</div>
        <div class="admin-row-actions">
          ${prev ? `
            <button class="admin-action secondary" onclick="actSetOrderStatus('${o.id}', '${prev}')" title="Move status back one step">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              Back to ${prevLabel}
            </button>
          ` : ''}
          ${active && next ? `
            <button class="admin-action approve" onclick="actSetOrderStatus('${o.id}', '${next}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              Mark as ${nextLabel}
            </button>
          ` : ''}

          <!-- Direct jump picker -->
          <label class="admin-status-picker" title="Jump to any status">
            <span class="picker-label">Set:</span>
            <select onchange="actSetOrderStatus('${o.id}', this.value)">
              ${dropdownOptions}
            </select>
          </label>

          ${active ? `
            <button class="admin-action reject" onclick="actSetOrderStatus('${o.id}', 'cancelled')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              Cancel
            </button>
          ` : ''}
          ${o.status === 'cancelled' ? `
            <button class="admin-action approve" onclick="actSetOrderStatus('${o.id}', 'received')">Restore</button>
          ` : ''}
          <button class="admin-action danger" onclick="actDeleteOrder('${o.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
            Delete
          </button>
        </div>
      </div>
    </article>
  `;
}

async function actSetOrderStatus(id, status) {
  try {
    await OrdersAPI.setStatus(id, status);
    showToast('Updated · ' + ORDER_STATUS_LABELS[status]);
    loadOrders();
  } catch (err) { showToast('Failed: ' + err.message); }
}

async function actDeleteOrder(id) {
  if (!confirm('Permanently delete this order? This cannot be undone.')) return;
  try {
    await OrdersAPI.remove(id);
    showToast('Deleted');
    loadOrders();
  } catch (err) { showToast('Failed: ' + err.message); }
}

// ==================================================
// COUPONS
// ==================================================
async function loadCoupons() {
  const list = document.getElementById('adminCouponsList');
  if (!list) return;
  try {
    const coupons = await RewardsAPI.listCoupons();
    if (coupons.length === 0) {
      list.innerHTML = `<div class="admin-empty">No codes yet — click "+ New code" to create one.</div>`;
      return;
    }
    list.innerHTML = coupons.map(renderCouponRow).join('');
  } catch (err) {
    list.innerHTML = `<div class="admin-empty error">Failed to load coupons: ${escapeHTML(err.message)}</div>`;
  }
}

function renderCouponRow(c) {
  const expired = c.expires_at && new Date(c.expires_at) < new Date();
  const exhausted = c.max_uses && c.used_count >= c.max_uses;
  const status = !c.active ? 'inactive' : expired ? 'expired' : exhausted ? 'exhausted' : 'active';
  const valueLabel = c.discount_type === 'percent' ? `${c.discount_value}% off` : `Rs. ${c.discount_value} off`;
  const usesLabel = c.max_uses ? `${c.used_count} / ${c.max_uses}` : `${c.used_count} used`;
  return `
    <article class="admin-row coupon-row coupon-status-${status}">
      <div class="admin-row-head">
        <div class="admin-row-meta">
          <span class="coupon-code">${escapeHTML(c.code)}</span>
          <span class="badge coupon-kind-${c.kind}">${c.kind}</span>
          ${c.description ? `<span class="admin-row-sub">· ${escapeHTML(c.description)}</span>` : ''}
        </div>
        <div class="admin-row-badges">
          <span class="badge coupon-status-badge-${status}">${status}</span>
        </div>
      </div>
      <div class="coupon-body">
        <div><strong>${escapeHTML(valueLabel)}</strong></div>
        <div class="admin-row-sub">${usesLabel}</div>
        ${c.min_order_total > 0 ? `<div class="admin-row-sub">Min order Rs. ${c.min_order_total}</div>` : ''}
        ${c.expires_at ? `<div class="admin-row-sub">Expires ${fmtDate(c.expires_at)}</div>` : ''}
        ${c.owner_phone ? `<div class="admin-row-sub">Referral owner: ${escapeHTML(c.owner_phone)}</div>` : ''}
      </div>
      <div class="admin-row-actions">
        <button class="admin-action ${c.active ? 'reject' : 'approve'}" onclick="toggleCouponActive('${escapeHTML(c.code)}', ${!c.active})">
          ${c.active ? 'Disable' : 'Enable'}
        </button>
        <button class="admin-action danger" onclick="deleteCoupon('${escapeHTML(c.code)}')">Delete</button>
      </div>
    </article>
  `;
}

function openCouponForm() {
  document.getElementById('couponForm').hidden = false;
  document.getElementById('cpCode').focus();
}
function closeCouponForm() {
  document.getElementById('couponForm').hidden = true;
  document.getElementById('couponForm').reset();
}

async function saveCoupon(e) {
  e.preventDefault();
  const payload = {
    code: document.getElementById('cpCode').value.trim().toUpperCase(),
    description: document.getElementById('cpDesc').value.trim() || null,
    discount_type: document.getElementById('cpType').value,
    discount_value: parseInt(document.getElementById('cpValue').value, 10),
    min_order_total: parseInt(document.getElementById('cpMin').value, 10) || 0,
    max_uses: document.getElementById('cpMax').value ? parseInt(document.getElementById('cpMax').value, 10) : null,
    expires_at: document.getElementById('cpExpires').value ? new Date(document.getElementById('cpExpires').value).toISOString() : null,
    active: true,
    kind: 'promo'
  };
  if (!payload.code || !payload.discount_value) { showToast('Please fill code and value'); return; }
  try {
    await RewardsAPI.createCoupon(payload);
    showToast('Code created');
    closeCouponForm();
    loadCoupons();
  } catch (err) {
    showToast('Failed: ' + (err.message || ''));
  }
}

async function toggleCouponActive(code, active) {
  try {
    await RewardsAPI.updateCoupon(code, { active });
    loadCoupons();
  } catch (err) { showToast('Failed: ' + err.message); }
}
async function deleteCoupon(code) {
  if (!confirm(`Delete code ${code}? This cannot be undone.`)) return;
  try {
    await RewardsAPI.deleteCoupon(code);
    showToast('Deleted');
    loadCoupons();
  } catch (err) { showToast('Failed: ' + err.message); }
}


// ==================================================
// MENU MANAGEMENT
// ==================================================
let _menuCache = [];

async function loadMenuItems() {
  const list = document.getElementById('adminMenuList');
  if (!list) return;
  try {
    _menuCache = await MenuAPI.listAll();
    if (_menuCache.length === 0) {
      list.innerHTML = `<div class="admin-empty">No items yet — click "+ New item" to add one.</div>`;
      return;
    }
    list.innerHTML = _menuCache.map(renderMenuRow).join('');
  } catch (err) {
    list.innerHTML = `<div class="admin-empty error">Failed to load menu: ${escapeHTML(err.message)}</div>`;
  }
}

function renderMenuRow(m) {
  const imgHTML = m.image_url
    ? `<img src="${escapeHTML(m.image_url)}" alt="" class="menu-row-thumb">`
    : `<div class="menu-row-thumb placeholder" style="background:${escapeHTML(m.icon_color)};color:${escapeHTML(m.accent_color)}">P</div>`;
  return `
    <article class="admin-row menu-row ${m.active ? '' : 'inactive'}">
      <div class="menu-row-grid">
        ${imgHTML}
        <div class="menu-row-info">
          <div class="admin-row-head">
            <div class="admin-row-meta">
              <span class="admin-row-name">${escapeHTML(m.name)}</span>
              <span class="admin-row-sub">· ${escapeHTML(m.id)}</span>
              <span class="admin-row-sub">· Rs. ${m.price}</span>
              ${m.tag ? `<span class="badge order-status-${m.tag === 'signature' ? 'baking' : m.tag === 'veg' ? 'delivered' : 'preparing'}">${escapeHTML(m.tag_label || m.tag)}</span>` : ''}
              ${!m.active ? `<span class="badge coupon-status-badge-inactive">Hidden</span>` : ''}
            </div>
            <div class="admin-row-badges">
              <span class="admin-row-sub">Order: ${m.sort_order}</span>
            </div>
          </div>
          <p class="admin-row-quote menu-row-desc">${escapeHTML(m.description || '')}</p>
        </div>
      </div>
      <div class="admin-row-actions">
        <button class="admin-action" onclick='editMenuItem(${JSON.stringify(m.id)})'>Edit</button>
        <button class="admin-action ${m.active ? 'reject' : 'approve'}" onclick='toggleMenuActive(${JSON.stringify(m.id)}, ${!m.active})'>
          ${m.active ? 'Hide' : 'Show'}
        </button>
        <button class="admin-action danger" onclick='deleteMenuItem(${JSON.stringify(m.id)})'>Delete</button>
      </div>
    </article>
  `;
}

function openMenuForm() {
  resetMenuForm();
  document.getElementById('menuForm').hidden = false;
  document.getElementById('miId').focus();
}
function closeMenuForm() {
  document.getElementById('menuForm').hidden = true;
  resetMenuForm();
}
function resetMenuForm() {
  const f = document.getElementById('menuForm');
  if (f) f.reset();
  document.getElementById('miOriginalId').value = '';
  document.getElementById('miImageUrl').value = '';
  document.getElementById('miImagePreview').hidden = true;
  document.getElementById('miImagePreview').innerHTML = '';
  document.getElementById('miIconColor').value = '#FFF8F0';
  document.getElementById('miAccentColor').value = '#E63946';
  document.getElementById('miActive').checked = true;
}

function editMenuItem(id) {
  const m = _menuCache.find(x => x.id === id);
  if (!m) return;
  openMenuForm();
  document.getElementById('miOriginalId').value = m.id;
  document.getElementById('miId').value = m.id;
  document.getElementById('miId').readOnly = true;
  document.getElementById('miName').value = m.name;
  document.getElementById('miDesc').value = m.description || '';
  document.getElementById('miPrice').value = m.price;
  document.getElementById('miTag').value = m.tag || 'signature';
  document.getElementById('miTagLabel').value = m.tag_label || '';
  document.getElementById('miIconColor').value = m.icon_color || '#FFF8F0';
  document.getElementById('miAccentColor').value = m.accent_color || '#E63946';
  document.getElementById('miSortOrder').value = m.sort_order || 0;
  document.getElementById('miActive').checked = !!m.active;
  document.getElementById('miImageUrl').value = m.image_url || '';
  const prev = document.getElementById('miImagePreview');
  if (m.image_url) {
    prev.hidden = false;
    prev.innerHTML = `<img src="${escapeHTML(m.image_url)}" alt=""><span>Current image — pick a file above to replace.</span>`;
  } else {
    prev.hidden = true;
    prev.innerHTML = '';
  }
}

async function saveMenuItem(e) {
  e.preventDefault();
  const isNew = !document.getElementById('miOriginalId').value;
  const id = document.getElementById('miId').value.trim().toLowerCase();
  const fileInput = document.getElementById('miImage');
  const existingUrl = document.getElementById('miImageUrl').value || null;

  if (!id) { showToast('ID is required'); return; }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';

  try {
    let imageUrl = existingUrl;
    if (fileInput.files && fileInput.files[0]) {
      submitBtn.textContent = 'Uploading photo…';
      imageUrl = await MenuAPI.uploadImage(fileInput.files[0], id);
    }

    const payload = {
      id,
      name: document.getElementById('miName').value.trim(),
      description: document.getElementById('miDesc').value.trim(),
      price: parseInt(document.getElementById('miPrice').value, 10),
      tag: document.getElementById('miTag').value || 'signature',
      tag_label: document.getElementById('miTagLabel').value.trim() || 'Signature',
      icon_color: document.getElementById('miIconColor').value,
      accent_color: document.getElementById('miAccentColor').value,
      sort_order: parseInt(document.getElementById('miSortOrder').value, 10) || 0,
      active: document.getElementById('miActive').checked,
      image_url: imageUrl
    };

    if (isNew) {
      await MenuAPI.create(payload);
    } else {
      // ID is immutable after creation; strip it from patch
      const { id: _omit, ...patch } = payload;
      await MenuAPI.update(id, patch);
    }
    document.getElementById('miId').readOnly = false;
    showToast(isNew ? 'Item added' : 'Item updated');
    closeMenuForm();
    loadMenuItems();
  } catch (err) {
    console.error(err);
    showToast('Failed: ' + (err.message || ''));
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save item';
  }
}

async function toggleMenuActive(id, active) {
  try {
    await MenuAPI.update(id, { active });
    loadMenuItems();
    showToast(active ? 'Item visible on site' : 'Item hidden from site');
  } catch (err) { showToast('Failed: ' + err.message); }
}

async function deleteMenuItem(id) {
  if (!confirm(`Delete "${id}" permanently? Orders that already used this item are unaffected.`)) return;
  try {
    await MenuAPI.remove(id);
    loadMenuItems();
    showToast('Deleted');
  } catch (err) { showToast('Failed: ' + err.message); }
}


// ==================================================
// SITE IMAGE (hero photo)
// ==================================================
async function loadSiteImagePreview() {
  const img = document.getElementById('siteHeroPreview');
  const empty = document.getElementById('siteHeroEmpty');
  if (!img) return;
  try {
    const url = await SettingsAPI.get('hero_image_url');
    if (url) {
      img.src = url;
      img.style.display = 'block';
      empty.style.display = 'none';
    } else {
      img.style.display = 'none';
      empty.style.display = 'block';
    }
  } catch (err) {
    console.warn('settings load failed', err);
  }
}

async function saveHeroImage(e) {
  e.preventDefault();
  const input = document.getElementById('siHeroFile');
  if (!input.files || !input.files[0]) { showToast('Pick an image'); return; }
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Uploading…';
  try {
    const url = await SettingsAPI.uploadSiteImage(input.files[0], 'hero');
    await SettingsAPI.set('hero_image_url', url);
    showToast('Hero image applied — reload the homepage to verify');
    input.value = '';
    loadSiteImagePreview();
  } catch (err) {
    console.error(err);
    showToast('Failed: ' + (err.message || ''));
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Upload and apply';
  }
}

async function clearHeroImage() {
  if (!confirm('Remove the hero image and restore the SVG illustration?')) return;
  try {
    await SettingsAPI.set('hero_image_url', '');
    showToast('Hero image cleared');
    loadSiteImagePreview();
  } catch (err) { showToast('Failed: ' + err.message); }
}

// ==================================================
// PAYMENTS — display on orders + verify + bank settings
// ==================================================
const PAY_METHOD_LABELS = {
  cod: 'Cash on delivery',
  bank_transfer: 'Bank transfer',
  card: 'Card / online'
};
const PAY_STATUS_LABELS = {
  pending: 'Pending',
  awaiting_verification: 'Awaiting verification',
  verified: 'Verified',
  failed: 'Failed'
};

function renderPaymentInfo(o) {
  const method = o.payment_method || 'cod';
  const status = o.payment_status || 'pending';
  const methodLabel = PAY_METHOD_LABELS[method] || method;
  const statusLabel = PAY_STATUS_LABELS[status] || status;
  const proofHTML = o.payment_proof_url
    ? `<a class="pay-proof-link" href="${escapeHTML(o.payment_proof_url)}" target="_blank" rel="noopener">View screenshot ↗</a>`
    : '';
  const actions = [];
  if (status !== 'verified') {
    actions.push(`<button class="admin-action approve" onclick="actPayStatus('${o.id}', 'verified')">Mark verified</button>`);
  }
  if (status !== 'failed' && status !== 'verified') {
    actions.push(`<button class="admin-action reject" onclick="actPayStatus('${o.id}', 'failed')">Mark failed</button>`);
  }
  if (status === 'verified') {
    actions.push(`<button class="admin-action secondary" onclick="actPayStatus('${o.id}', 'pending')">Reset</button>`);
  }
  return `
    <div class="ord-payment pay-status-${status}">
      <div class="ord-payment-row">
        <span class="ord-payment-method">💳 ${escapeHTML(methodLabel)}</span>
        <span class="badge pay-badge-${status}">${escapeHTML(statusLabel)}</span>
        ${proofHTML}
      </div>
      ${actions.length ? `<div class="ord-payment-actions">${actions.join('')}</div>` : ''}
    </div>
  `;
}

async function actPayStatus(id, status) {
  try {
    await OrdersAPI.setPaymentStatus(id, status);
    showToast('Payment status: ' + (PAY_STATUS_LABELS[status] || status));
    loadOrders();
  } catch (err) { showToast('Failed: ' + err.message); }
}

async function loadBankSettings() {
  try {
    const s = await SettingsAPI.getAll();
    document.getElementById('bsBank').value     = s.bank_name || '';
    document.getElementById('bsTitle').value    = s.bank_account_title || '';
    document.getElementById('bsNumber').value   = s.bank_account_number || '';
    document.getElementById('bsIban').value     = s.bank_iban || '';
    document.getElementById('bsBranch').value   = s.bank_branch_code || '';
    document.getElementById('bsCardNote').value = s.payment_card_note || '';
    // Delivery settings are in the same site_settings table
    document.getElementById('dsLat').value      = s.kitchen_lat || '';
    document.getElementById('dsLng').value      = s.kitchen_lng || '';
    document.getElementById('dsRadius').value   = s.delivery_radius_km || '';
    document.getElementById('dsFee').value      = s.delivery_fee || '';
  } catch (err) {
    console.warn('load bank settings failed', err);
  }
}

async function saveDeliverySettings(e) {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const lat    = document.getElementById('dsLat').value.trim();
  const lng    = document.getElementById('dsLng').value.trim();
  const radius = document.getElementById('dsRadius').value.trim();
  const fee    = document.getElementById('dsFee').value.trim();

  if (!lat || !lng || isNaN(parseFloat(lat)) || isNaN(parseFloat(lng))) {
    showToast('Please enter valid latitude and longitude'); return;
  }
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';
  try {
    await Promise.all([
      SettingsAPI.set('kitchen_lat',        lat),
      SettingsAPI.set('kitchen_lng',        lng),
      SettingsAPI.set('delivery_radius_km', radius || '10'),
      SettingsAPI.set('delivery_fee',       fee    || '250')
    ]);
    showToast('Delivery settings saved');
  } catch (err) {
    showToast('Failed: ' + (err.message || ''));
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save delivery settings';
  }
}

async function saveBankSettings(e) {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';
  try {
    await Promise.all([
      SettingsAPI.set('bank_name',          document.getElementById('bsBank').value.trim()),
      SettingsAPI.set('bank_account_title', document.getElementById('bsTitle').value.trim()),
      SettingsAPI.set('bank_account_number',document.getElementById('bsNumber').value.trim()),
      SettingsAPI.set('bank_iban',          document.getElementById('bsIban').value.trim()),
      SettingsAPI.set('bank_branch_code',   document.getElementById('bsBranch').value.trim()),
      SettingsAPI.set('payment_card_note',  document.getElementById('bsCardNote').value.trim())
    ]);
    showToast('Bank details saved');
  } catch (err) {
    showToast('Failed: ' + (err.message || ''));
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save bank details';
  }
}


// ==================================================
// LAUNCH SIGNUP LIST
// ==================================================
let _launchSignupsCache = [];

async function loadLaunchSignups() {
  const list = document.getElementById('adminLaunchList');
  if (!list) return;
  try {
    _launchSignupsCache = await LaunchSignupsAPI.listAll();
    renderLaunchStats();
    renderLaunchList();
  } catch (err) {
    list.innerHTML = `<div class="admin-empty error">Failed to load: ${escapeHTML(err.message)}</div>`;
  }
}

function renderLaunchStats() {
  const all = _launchSignupsCache;
  const total = all.length;
  const notified = all.filter(s => s.notified).length;
  const pending = total - notified;
  const today = all.filter(s => {
    const d = new Date(s.created_at);
    const now = new Date();
    return d.getFullYear() === now.getFullYear()
        && d.getMonth() === now.getMonth()
        && d.getDate() === now.getDate();
  }).length;
  document.getElementById('lsStatTotal').textContent    = total;
  document.getElementById('lsStatNotified').textContent = notified;
  document.getElementById('lsStatPending').textContent  = pending;
  document.getElementById('lsStatToday').textContent    = today;
}

function renderLaunchList() {
  const list = document.getElementById('adminLaunchList');
  const q = (document.getElementById('adminLaunchSearch')?.value || '').toLowerCase();
  let items = _launchSignupsCache;
  if (q) items = items.filter(s =>
    (s.name || '').toLowerCase().includes(q) ||
    (s.phone || '').toLowerCase().includes(q)
  );
  if (items.length === 0) {
    list.innerHTML = `<div class="admin-empty">No signups yet — share the homepage countdown to drive sign-ups.</div>`;
    return;
  }
  list.innerHTML = items.map(s => `
    <article class="admin-row ${s.notified ? '' : 'pending-signup'}">
      <div class="admin-row-head">
        <div class="admin-row-meta">
          <span class="admin-row-name">${escapeHTML(s.name || '(no name)')}</span>
          <span class="admin-row-sub">· ${escapeHTML(s.phone)}</span>
          <span class="admin-row-sub">· ${fmtDate(s.created_at)}</span>
        </div>
        <div class="admin-row-badges">
          <span class="badge ${s.notified ? 'pay-badge-verified' : 'pay-badge-awaiting_verification'}">
            ${s.notified ? '✓ Notified' : '⏳ Pending'}
          </span>
        </div>
      </div>
      <div class="admin-row-actions">
        <button class="admin-action approve" onclick="whatsappOneSignup('${escapeHTML(s.phone)}', '${escapeHTML((s.name||'').replace(/'/g,"\\'"))}', '${s.id}')">
          📱 WhatsApp & mark notified
        </button>
        ${s.notified ? `
          <button class="admin-action secondary" onclick="toggleSignupNotified('${s.id}', false)">Mark pending</button>
        ` : ''}
        <button class="admin-action danger" onclick="deleteSignup('${s.id}')">Delete</button>
      </div>
    </article>
  `).join('');
}

document.addEventListener('input', (e) => {
  if (e.target && e.target.id === 'adminLaunchSearch') renderLaunchList();
});

function whatsappOneSignup(phone, name, id) {
  const msg = `Hi${name ? ' ' + name : ''}! 🍝\n\n` +
    `We're officially live — Pasto by Aiman is now taking orders!\n\n` +
    `Hand-rolled pasta, slow-simmered sauces, real ingredients only. ` +
    `Cooked fresh and delivered hot across Karachi.\n\n` +
    `As thanks for signing up early, here's *15% off your first order* ` +
    `with code *EARLYPASTO15*.\n\n` +
    `Order now: https://www.pastobyaiman.com\n\n` +
    `— Pasto by Aiman`;
  // Normalize phone (strip non-digits) and force PK country code if missing
  let normalized = phone.replace(/\D/g, '');
  if (normalized.startsWith('0')) normalized = '92' + normalized.substring(1);
  else if (!normalized.startsWith('92')) normalized = '92' + normalized;
  const url = `https://wa.me/${normalized}?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
  // Mark as notified in DB
  toggleSignupNotified(id, true);
}

async function toggleSignupNotified(id, notified) {
  try {
    await LaunchSignupsAPI.markNotified(id, notified);
    loadLaunchSignups();
  } catch (err) { showToast('Failed: ' + err.message); }
}

async function deleteSignup(id) {
  if (!confirm('Delete this signup permanently?')) return;
  try {
    await LaunchSignupsAPI.remove(id);
    loadLaunchSignups();
  } catch (err) { showToast('Failed: ' + err.message); }
}

function whatsappAllSignups() {
  const pending = _launchSignupsCache.filter(s => !s.notified);
  if (pending.length === 0) {
    showToast('No pending signups to notify');
    return;
  }
  if (!confirm(
    `You're about to open WhatsApp ${pending.length} times — one for each pending signup.\n\n` +
    `Send each message, then come back and mark them notified.\n\nContinue?`
  )) return;
  // Open WhatsApp tabs with small delays so browser doesn't block
  pending.forEach((s, i) => {
    setTimeout(() => whatsappOneSignup(s.phone, s.name || '', s.id), i * 500);
  });
}

function exportSignupsCSV() {
  const rows = [['Name', 'Phone', 'Signed up at', 'Notified', 'Notified at']];
  _launchSignupsCache.forEach(s => {
    rows.push([
      s.name || '',
      s.phone || '',
      s.created_at || '',
      s.notified ? 'Yes' : 'No',
      s.notified_at || ''
    ]);
  });
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pasto-launch-signups-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('CSV downloaded');
}

// ==================================================
// REALTIME ORDER NOTIFICATIONS
// ==================================================
// When a customer places an order (regardless of whether their
// WhatsApp goes through), Supabase pushes a Postgres INSERT event
// here. We play a sound, show a browser notification, and refresh
// the orders list — so the owner never misses an order even if the
// customer's WhatsApp step fails.
// ==================================================

let _orderRealtimeChannel = null;

let _realtimeStatus = 'connecting';
let _lastPollAt = null;

function updateAlertStatus() {
  const dot = document.getElementById('aspDot');
  const text = document.getElementById('aspText');
  if (!dot || !text) return;
  let label, cls;
  if (_realtimeStatus === 'SUBSCRIBED') {
    label = 'Live · alerts on';
    cls = 'ok';
  } else if (_realtimeStatus === 'CHANNEL_ERROR' || _realtimeStatus === 'TIMED_OUT' || _realtimeStatus === 'CLOSED') {
    // Polling still works — that's our fallback
    const secs = _lastPollAt ? Math.round((Date.now() - _lastPollAt) / 1000) : null;
    label = `Polling only (updated ${secs != null ? secs + 's' : '?'} ago)`;
    cls = 'warn';
  } else {
    label = 'Connecting…';
    cls = 'muted';
  }
  text.textContent = label;
  dot.className = 'asp-dot ' + cls;
}
setInterval(updateAlertStatus, 2000);

function subscribeToNewOrders() {
  if (_orderRealtimeChannel) return;
  try {
    _orderRealtimeChannel = sb
      .channel('admin-new-orders')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'orders'
      }, (payload) => {
        try {
          handleRealtimeNewOrder(payload.new);
        } catch (err) {
          console.error('[Pasto Admin] Failed to handle new order:', err);
        }
      })
      .subscribe((status) => {
        console.info('[Pasto Admin] Realtime status:', status);
        _realtimeStatus = status;
        updateAlertStatus();
      });
  } catch (err) {
    console.warn('[Pasto Admin] Could not subscribe to realtime — falling back to polling.', err);
    _realtimeStatus = 'CHANNEL_ERROR';
    updateAlertStatus();
  }
}

// Queue of unacknowledged orders (in case multiple come in quickly)
let _pendingOrderQueue = [];
let _currentAlertOrder = null;
let _ringerAudioInterval = null;
let _ringerVibrateInterval = null;
let _wakeLock = null;

function handleRealtimeNewOrder(order) {
  if (!order) return;
  // Deduplicate — orders may reach us both via Realtime AND via the
  // polling fallback. Only fire the alert the first time we see one.
  if (_seenOrderIds.has(order.id)) {
    console.info('[Pasto Admin] Skipping duplicate order:', order.short_code);
    return;
  }
  _seenOrderIds.add(order.id);
  console.info('[Pasto Admin] 🍝 New order:', order.short_code, order.customer_name);
  _pendingOrderQueue.push(order);
  showNewOrderBrowserNotification(order);
  if (!_currentAlertOrder) {
    showNextOrderAlert();
  } else {
    updateExtraBadge();
  }
  // Refresh the list AFTER queuing the alert so the seen-set is
  // already up to date and loadOrders() doesn't re-fire us.
  loadOrders();
}

function updateExtraBadge() {
  const badge = document.getElementById('noaExtraBadge');
  const count = document.getElementById('noaExtraCount');
  if (!badge || !count) return;
  if (_pendingOrderQueue.length > 0) {
    count.textContent = _pendingOrderQueue.length;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

function showNextOrderAlert() {
  const order = _pendingOrderQueue.shift();
  if (!order) {
    _currentAlertOrder = null;
    hideNewOrderAlert();
    return;
  }
  _currentAlertOrder = order;
  populateAlertModal(order);
  document.getElementById('newOrderAlert').hidden = false;
  document.body.classList.add('noa-ringing');
  updateExtraBadge();
  startRinger();
  requestWakeLock();
}

function populateAlertModal(o) {
  document.getElementById('noaCode').textContent = o.short_code || '–';
  document.getElementById('noaCustomer').textContent = o.customer_name || '–';
  const phoneEl = document.getElementById('noaPhone');
  const phoneDigits = (o.customer_phone || '').replace(/\D/g, '');
  phoneEl.textContent = o.customer_phone || '–';
  phoneEl.href = phoneDigits ? `tel:${phoneDigits}` : '#';
  document.getElementById('noaAddress').textContent = o.customer_address || '–';
  document.getElementById('noaPayment').textContent =
    (PAY_METHOD_LABELS && PAY_METHOD_LABELS[o.payment_method]) || o.payment_method || 'Cash on delivery';
  document.getElementById('noaTotal').textContent = `Rs. ${o.total}`;

  const itemsHTML = (o.items || []).map(it =>
    `<div class="noa-item">
       <span>${it.qty}× ${escapeHTML(it.name)}</span>
       <span>Rs. ${it.price * it.qty}</span>
     </div>`
  ).join('');
  document.getElementById('noaItems').innerHTML = itemsHTML || '<div class="noa-item">(No items)</div>';
}

function hideNewOrderAlert() {
  document.getElementById('newOrderAlert').hidden = true;
  document.body.classList.remove('noa-ringing');
  stopRinger();
  releaseWakeLock();
}

function acknowledgeNewOrder() {
  const ackedCode = _currentAlertOrder?.short_code;
  stopRinger();
  if (_pendingOrderQueue.length > 0) {
    showToast(`#${ackedCode} acknowledged · ${_pendingOrderQueue.length} more waiting`);
    showNextOrderAlert();
  } else {
    _currentAlertOrder = null;
    hideNewOrderAlert();
    showToast(`Order #${ackedCode} acknowledged · get cooking! 🍝`);
  }
}

// ----- Ringer (loops until acknowledged) -----
function startRinger() {
  stopRinger();
  playNewOrderChime();
  _ringerAudioInterval = setInterval(playNewOrderChime, 2500);
  if (navigator.vibrate) {
    const pattern = [400, 150, 400, 150, 400];
    navigator.vibrate(pattern);
    _ringerVibrateInterval = setInterval(() => {
      try { navigator.vibrate(pattern); } catch {}
    }, 2500);
  }
}

function stopRinger() {
  if (_ringerAudioInterval) { clearInterval(_ringerAudioInterval); _ringerAudioInterval = null; }
  if (_ringerVibrateInterval) { clearInterval(_ringerVibrateInterval); _ringerVibrateInterval = null; }
  if (navigator.vibrate) { try { navigator.vibrate(0); } catch {} }
}

// ----- Wake Lock (keeps phone screen from sleeping while ringer is active) -----
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    _wakeLock = await navigator.wakeLock.request('screen');
  } catch (err) {
    console.warn('[Pasto Admin] Wake Lock request failed:', err);
  }
}
function releaseWakeLock() {
  if (_wakeLock) {
    try { _wakeLock.release(); } catch {}
    _wakeLock = null;
  }
}
// Re-acquire the wake lock if the tab becomes visible again while an
// alert is still showing (mobile OS may release it when tab is backgrounded).
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && _currentAlertOrder) requestWakeLock();
});

// Loud rising 3-note chime designed to cut through background noise.
// Called repeatedly by the ringer while an unacknowledged alert is up.
function playNewOrderChime() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    // Three notes: A5 → C#6 → E6 (major chord arpeggio, unmistakably a "chime")
    [880, 1108.73, 1318.51].forEach((freq, i) => {
      setTimeout(() => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = 'triangle';
        gain.gain.setValueAtTime(0.001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.6);
      }, i * 140);
    });
  } catch (err) {
    console.warn('[Pasto Admin] Could not play chime:', err);
  }
}

function showNewOrderBrowserNotification(order) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const notif = new Notification('🍝 New Pasto order!', {
      body: `${order.customer_name} · #${order.short_code} · Rs. ${order.total}`,
      icon: 'assets/logo-icon.png',
      badge: 'assets/logo-icon.png',
      tag: 'new-order-' + order.id,
      requireInteraction: true
    });
    notif.onclick = () => { window.focus(); notif.close(); };
  } catch (err) {
    console.warn('[Pasto Admin] Notification API failed:', err);
  }
}

// Sticky in-page banner shown at the top of admin — impossible to miss.
function showInPageOrderAlert(order) {
  const wrap = document.createElement('div');
  wrap.className = 'admin-new-order-alert';
  wrap.innerHTML = `
    <div class="ao-icon">🍝</div>
    <div class="ao-body">
      <div class="ao-title">New order · #${escapeHTML(order.short_code)}</div>
      <div class="ao-meta">${escapeHTML(order.customer_name)} · Rs. ${order.total} · ${escapeHTML(order.payment_method || 'cod')}</div>
    </div>
    <button class="ao-close" aria-label="Dismiss">✕</button>
  `;
  wrap.querySelector('.ao-close').addEventListener('click', () => wrap.remove());
  document.body.appendChild(wrap);
  // Auto-dismiss after 20 seconds
  setTimeout(() => wrap.remove(), 20000);
}

// Manual test — fires the exact same alert path a real order would.
// Lets you verify chime + vibration + modal + browser notification
// all work on your specific device without having to place a test order.
function fireTestAlert() {
  const fake = {
    id: 'test-' + Date.now(),
    short_code: 'TEST' + Math.floor(Math.random() * 900 + 100),
    customer_name: 'Test Order',
    customer_phone: '03000000000',
    customer_address: 'This is a test alert to verify your notifications',
    payment_method: 'cod',
    total: 999,
    items: [
      { qty: 1, name: 'Pasta Alfredo', price: 650 },
      { qty: 1, name: 'Garlic Bread', price: 250 }
    ],
    notes: null
  };
  handleRealtimeNewOrder(fake);
}

async function requestNotifPermission() {
  if (!('Notification' in window)) {
    showToast('Your browser does not support notifications');
    return;
  }
  if (Notification.permission === 'granted') {
    showToast('Notifications already enabled');
    updateNotifPermUI();
    return;
  }
  try {
    const result = await Notification.requestPermission();
    if (result === 'granted') {
      showToast('Notifications enabled — you\'ll hear a chime for new orders');
      // Fire a test notification so they know it works
      new Notification('🍝 Pasto notifications enabled', {
        body: 'You\'ll be alerted the moment an order comes in.',
        icon: 'assets/logo-icon.png'
      });
      playNewOrderChime();
    } else {
      showToast('Notifications blocked — enable in your browser settings');
    }
    updateNotifPermUI();
  } catch (err) {
    console.error(err);
  }
}

function updateNotifPermUI() {
  const btn = document.getElementById('enableNotifBtn');
  if (!btn) return;
  if (!('Notification' in window)) {
    btn.hidden = true;
    return;
  }
  const perm = Notification.permission;
  if (perm === 'granted') {
    btn.textContent = '🔔 Notifications on';
    btn.classList.add('notif-on');
    btn.disabled = false;
  } else if (perm === 'denied') {
    btn.textContent = '🔕 Notifications blocked';
    btn.classList.remove('notif-on');
    btn.disabled = true;
  } else {
    btn.textContent = '🔔 Enable order alerts';
    btn.classList.remove('notif-on');
    btn.disabled = false;
  }
}


if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
