// ==================================================
// PASTO — Supabase client + Reviews API
// ==================================================
// Loaded on both index.html and admin.html.
// Requires the official supabase-js UMD bundle to be loaded first
// (added via <script> in the HTML pages).
// ==================================================

(function () {
  if (!window.supabase || !window.supabase.createClient) {
    console.error('[Pasto] supabase-js library not loaded.');
    return;
  }
  if (!SUPABASE || !SUPABASE.url || !SUPABASE.anonKey
      || SUPABASE.url.includes('YOUR-PROJECT-REF')) {
    console.warn('[Pasto] SUPABASE config missing in js/config.js — reviews will not work until you add your project URL and anon key.');
  }
  window.sb = window.supabase.createClient(SUPABASE.url, SUPABASE.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
})();


// ==================================================
// REVIEWS API
// ==================================================
const ReviewsAPI = {
  // ---------- Public reads ----------
  async listApproved() {
    const { data, error } = await sb
      .from('reviews')
      .select('*')
      .eq('status', 'approved')
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  // ---------- Public submit ----------
  async submit({ name, location, rating, quote }) {
    const payload = {
      name: name.trim(),
      location: (location || '').trim() || null,
      rating: Number(rating),
      quote: quote.trim(),
      status: 'pending',
      pinned: false,
      likes: 0
    };
    const { data, error } = await sb
      .from('reviews')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // ---------- Likes (anon allowed via SECURITY DEFINER RPC) ----------
  async like(id) {
    const { data, error } = await sb.rpc('increment_review_likes', { review_id: id });
    if (error) throw error;
    return data;
  },

  // ---------- Admin reads ----------
  async listAll() {
    const { data, error } = await sb
      .from('reviews')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async listByStatus(status) {
    const { data, error } = await sb
      .from('reviews')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  // ---------- Admin writes ----------
  async setStatus(id, status) {
    const patch = { status };
    if (status === 'approved') patch.approved_at = new Date().toISOString();
    const { error } = await sb.from('reviews').update(patch).eq('id', id);
    if (error) throw error;
  },

  async setPinned(id, pinned) {
    const { error } = await sb.from('reviews').update({ pinned }).eq('id', id);
    if (error) throw error;
  },

  async remove(id) {
    const { error } = await sb.from('reviews').delete().eq('id', id);
    if (error) throw error;
  },

  async stats() {
    const { data, error } = await sb.from('reviews').select('status, rating');
    if (error) throw error;
    const total = data.length;
    const pending = data.filter(r => r.status === 'pending').length;
    const approved = data.filter(r => r.status === 'approved').length;
    const rejected = data.filter(r => r.status === 'rejected').length;
    const approvedRatings = data.filter(r => r.status === 'approved').map(r => r.rating);
    const avg = approvedRatings.length
      ? approvedRatings.reduce((s, x) => s + x, 0) / approvedRatings.length
      : 0;
    return { total, pending, approved, rejected, avg };
  }
};


// ==================================================
// ORDERS API
// ==================================================
const ORDER_FLOW = ['received', 'preparing', 'baking', 'out_for_delivery', 'delivered'];
const ORDER_LABELS = {
  received:         'Order received',
  preparing:        'Preparing',
  baking:           'In the oven',
  out_for_delivery: 'Out for delivery',
  delivered:        'Delivered',
  cancelled:        'Cancelled'
};

const OrdersAPI = {
  // ---------- Public: place a new order ----------
  async place({ name, phone, altPhone, email, address, notes, items, couponCode, paymentMethod }) {
    // items = [{ id, qty }] — server recomputes name/price/total from menu_items.
    const { data, error } = await sb.rpc('place_order', {
      p_name: name, p_phone: phone,
      p_alt_phone: altPhone || null, p_email: email || null,
      p_address: address, p_notes: notes || null,
      p_items: items,
      p_coupon_code: couponCode || null,
      p_payment_method: paymentMethod || 'cod'
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('No order returned from server');
    return row;
  },

  // Prepay: upload the screenshot AFTER placing (the wallet number is revealed
  // post-order), then attach it to the order via a SECURITY DEFINER RPC.
  async attachPaymentProof(orderId, file) {
    const url = await this.uploadPaymentProof(file);
    const { error } = await sb.rpc('attach_payment_proof', { p_order_id: orderId, p_url: url });
    if (error) throw error;
    return url;
  },

  // ---------- Public: upload payment proof screenshot ----------
  async uploadPaymentProof(file) {
    if (!file) throw new Error('No file');
    // Unguessable object name (Finding 2): crypto UUID, not Date.now()+Math.random().
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${crypto.randomUUID()}.${ext || 'jpg'}`;
    const { error } = await sb.storage
      .from('payment-proofs')
      .upload(path, file, { cacheControl: '3600', upsert: false });
    if (error) throw error;
    const { data } = sb.storage.from('payment-proofs').getPublicUrl(path);
    return data.publicUrl;
  },

  // ---------- Admin: payment moderation ----------
  async setPaymentStatus(id, payment_status, payment_reference) {
    const patch = { payment_status };
    if (payment_reference !== undefined) patch.payment_reference = payment_reference;
    const { error } = await sb.from('orders').update(patch).eq('id', id);
    if (error) throw error;
  },

  // ---------- Public: poll status by id ----------
  async track(id) {
    const { data, error } = await sb.rpc('track_order', { order_id: id });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row || null;
  },

  // ---------- Admin ----------
  async listAll() {
    const { data, error } = await sb
      .from('orders').select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },
  async setStatus(id, status) {
    const { error } = await sb.from('orders').update({ status }).eq('id', id);
    if (error) throw error;
  },
  async acknowledgeAlert(id) {
    const { error } = await sb.from('orders')
      .update({ alert_acked: true, acked_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },
  async remove(id) {
    const { error } = await sb.from('orders').delete().eq('id', id);
    if (error) throw error;
  }
};


// ==================================================
// REWARDS API — coupons + loyalty
// ==================================================
const RewardsAPI = {
  // ----- Public -----
  async validateCoupon(code, total, phone = null) {
    const { data, error } = await sb.rpc('validate_coupon', {
      p_code: code, p_total: total, p_phone: phone
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row || null;
  },
  async getLoyalty(phone) {
    const { data, error } = await sb.rpc('get_loyalty', { p_phone: phone });
    if (error) throw error;
    return Array.isArray(data) ? data[0] : data;
  },

  // ----- Admin: coupons -----
  async listCoupons() {
    const { data, error } = await sb
      .from('coupons').select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },
  async createCoupon(payload) {
    const { error } = await sb.from('coupons').insert(payload);
    if (error) throw error;
  },
  async updateCoupon(code, patch) {
    const { error } = await sb.from('coupons').update(patch).eq('code', code);
    if (error) throw error;
  },
  async deleteCoupon(code) {
    const { error } = await sb.from('coupons').delete().eq('code', code);
    if (error) throw error;
  },

  // ----- Admin: loyalty list -----
  async listLoyalty() {
    const { data, error } = await sb
      .from('loyalty').select('*')
      .order('order_count', { ascending: false });
    if (error) throw error;
    return data || [];
  }
};


// ==================================================
// MENU API  (admin-managed menu items)
// ==================================================
const MenuAPI = {
  async listActive() {
    const { data, error } = await sb
      .from('menu_items').select('*')
      .eq('active', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return data || [];
  },
  async listAll() {
    const { data, error } = await sb
      .from('menu_items').select('*')
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return data || [];
  },
  async create(payload) {
    const { error } = await sb.from('menu_items').insert(payload);
    if (error) throw error;
  },
  async update(id, patch) {
    const { error } = await sb.from('menu_items').update(patch).eq('id', id);
    if (error) throw error;
  },
  async remove(id) {
    const { error } = await sb.from('menu_items').delete().eq('id', id);
    if (error) throw error;
  },
  async uploadImage(file, itemId) {
    if (!file) throw new Error('No file selected');
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const safeId = (itemId || 'item').replace(/[^a-z0-9_-]/gi, '');
    const path = `${safeId}-${Date.now()}.${ext}`;
    const { error } = await sb.storage
      .from('menu-images')
      .upload(path, file, { cacheControl: '3600', upsert: false });
    if (error) throw error;
    const { data: urlData } = sb.storage.from('menu-images').getPublicUrl(path);
    return urlData.publicUrl;
  }
};

// ==================================================
// SETTINGS API  (site-wide key/value bag)
// ==================================================
const SettingsAPI = {
  async getAll() {
    const { data, error } = await sb.from('site_settings').select('*');
    if (error) throw error;
    const map = {};
    (data || []).forEach(r => { map[r.key] = r.value; });
    return map;
  },
  async get(key) {
    const { data, error } = await sb
      .from('site_settings').select('value').eq('key', key).maybeSingle();
    if (error) throw error;
    return data?.value || null;
  },
  async set(key, value) {
    const { error } = await sb
      .from('site_settings')
      .upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw error;
  },
  async uploadSiteImage(file, prefix = 'hero') {
    if (!file) throw new Error('No file selected');
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${prefix}-${Date.now()}.${ext}`;
    const { error } = await sb.storage
      .from('site-images')
      .upload(path, file, { cacheControl: '3600', upsert: false });
    if (error) throw error;
    const { data: urlData } = sb.storage.from('site-images').getPublicUrl(path);
    return urlData.publicUrl;
  }
};


// ==================================================
// PUSH SUBSCRIPTIONS API  (admin PWA web-push order alerts)
// ==================================================
const PushAPI = {
  async saveSubscription(pushSub) {
    const j = pushSub.toJSON();
    if (!j.endpoint || !j.keys) throw new Error('Invalid push subscription');
    const { error } = await sb.from('push_subscriptions').upsert(
      { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth },
      { onConflict: 'endpoint' }
    );
    if (error) throw error;
  },
  async removeSubscription(endpoint) {
    const { error } = await sb.from('push_subscriptions').delete().eq('endpoint', endpoint);
    if (error) throw error;
  }
};


// ==================================================
// LAUNCH SIGNUPS API — pre-launch notify list
// ==================================================
const LaunchSignupsAPI = {
  // Public — submit a new signup
  async submit({ name, phone }) {
    const { error } = await sb.from('launch_signups').insert({
      name: (name || '').trim() || null,
      phone: phone.trim(),
      source: 'website'
    });
    if (error) throw error;
  },
  // Admin — list all signups
  async listAll() {
    const { data, error } = await sb
      .from('launch_signups').select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },
  // Admin — mark one as notified
  async markNotified(id, notified = true) {
    const patch = { notified, notified_at: notified ? new Date().toISOString() : null };
    const { error } = await sb.from('launch_signups').update(patch).eq('id', id);
    if (error) throw error;
  },
  // Admin — delete
  async remove(id) {
    const { error } = await sb.from('launch_signups').delete().eq('id', id);
    if (error) throw error;
  }
};


// ==================================================
// AUTH HELPERS (used by admin dashboard)
// ==================================================
const AuthAPI = {
  async signIn(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },
  async signOut() {
    await sb.auth.signOut();
  },
  async getSession() {
    const { data } = await sb.auth.getSession();
    return data.session;
  },
  onAuthChange(cb) {
    return sb.auth.onAuthStateChange((_event, session) => cb(session));
  }
};
