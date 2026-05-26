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
  async place({ name, phone, address, notes, items, total, couponCode, useCredit }) {
    const { data, error } = await sb.rpc('place_order', {
      p_name: name, p_phone: phone, p_address: address,
      p_notes: notes || null,
      p_items: items, p_total: total,
      p_coupon_code: couponCode || null,
      p_use_credit: !!useCredit
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('No order returned from server');
    return row; // { id, short_code, referral_code, discount, free_used }
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
  async validateCoupon(code, total) {
    const { data, error } = await sb.rpc('validate_coupon', {
      p_code: code, p_total: total
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
