// ==================================================
// PASTO ACCOUNTS — personal income/expense/profit tracker
// ==================================================
// 100% on-device (localStorage). No backend, no Supabase — works
// offline and is unaffected by the website's hosting/quota. Back up
// with the Backup button (downloads a JSON you can Restore later).
// ==================================================

const LS_ACCOUNTS = 'pastoAccounts';   // array of transactions
const CURRENCY = 'Rs.';

const INCOME_CATEGORIES = [
  'Website order', 'Foodpanda', 'Cash order', 'Catering', 'Other income'
];
const EXPENSE_CATEGORIES = [
  'Ingredients', 'Packaging', 'Rider / delivery', 'Utilities (gas/elec)',
  'Marketing / ads', 'Foodpanda commission', 'Rent', 'Other expense'
];

// ---- State ----
let _txns = load();
let _viewYM = currentYM();          // 'YYYY-MM' currently being viewed
let _formType = 'income';           // current form type
let _editingId = null;              // id when editing (null = adding)

// ---- Storage ----
function load() {
  try { return JSON.parse(localStorage.getItem(LS_ACCOUNTS)) || []; }
  catch { return []; }
}
function persist() {
  localStorage.setItem(LS_ACCOUNTS, JSON.stringify(_txns));
}

// ---- Date helpers (local time) ----
function pad2(n) { return String(n).padStart(2, '0'); }
function currentYM() {
  const d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
}
function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function ymOf(dateStr) { return (dateStr || '').slice(0, 7); }
function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${names[m - 1]} ${y}`;
}
function fmt(n) {
  return CURRENCY + ' ' + Math.round(n).toLocaleString('en-PK');
}
function escapeHTML(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function uid() {
  return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---- Toast ----
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

// ==================================================
// RENDER
// ==================================================
function render() {
  document.getElementById('accMonthLabel').textContent = monthLabel(_viewYM);

  const monthTxns = _txns.filter(t => ymOf(t.date) === _viewYM)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.id > a.id ? 1 : -1));

  const income = monthTxns.filter(t => t.type === 'income').reduce((s, t) => s + (+t.amount || 0), 0);
  const expense = monthTxns.filter(t => t.type === 'expense').reduce((s, t) => s + (+t.amount || 0), 0);
  const profit = income - expense;

  document.getElementById('sumIncome').textContent = fmt(income);
  document.getElementById('sumExpense').textContent = fmt(expense);
  const profitEl = document.getElementById('sumProfit');
  profitEl.textContent = fmt(profit);
  profitEl.classList.toggle('neg', profit < 0);

  // All-time profit across every month
  const allIncome = _txns.filter(t => t.type === 'income').reduce((s, t) => s + (+t.amount || 0), 0);
  const allExpense = _txns.filter(t => t.type === 'expense').reduce((s, t) => s + (+t.amount || 0), 0);
  const allProfit = allIncome - allExpense;
  const atEl = document.getElementById('accAllTime');
  atEl.textContent = `All-time profit: ${fmt(allProfit)}`;
  atEl.classList.toggle('neg', allProfit < 0);

  // List
  const list = document.getElementById('accList');
  if (monthTxns.length === 0) {
    list.innerHTML = `<div class="acc-empty">No transactions this month yet.</div>`;
    return;
  }
  list.innerHTML = monthTxns.map(t => {
    const sign = t.type === 'income' ? '+' : '−';
    const d = (t.date || '').slice(8, 10) + ' ' + monthLabel(ymOf(t.date)).split(' ')[0].slice(0, 3);
    return `
      <div class="acc-txn ${t.type}">
        <div class="acc-txn-main" onclick="editTxn('${t.id}')">
          <div class="acc-txn-cat">${escapeHTML(t.category || (t.type === 'income' ? 'Income' : 'Expense'))}</div>
          ${t.note ? `<div class="acc-txn-note">${escapeHTML(t.note)}</div>` : ''}
          <div class="acc-txn-date">${escapeHTML(d)}</div>
        </div>
        <div class="acc-txn-amt ${t.type}">${sign} ${fmt(+t.amount)}</div>
        <button class="acc-txn-del" onclick="deleteTxn('${t.id}')" aria-label="Delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
        </button>
      </div>`;
  }).join('');
}

function shiftMonth(delta) {
  let [y, m] = _viewYM.split('-').map(Number);
  m += delta;
  if (m < 1) { m = 12; y -= 1; }
  if (m > 12) { m = 1; y += 1; }
  _viewYM = y + '-' + pad2(m);
  render();
}

// ==================================================
// ADD / EDIT
// ==================================================
function fillCategoryOptions(type) {
  const sel = document.getElementById('txnCategory');
  const cats = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  sel.innerHTML = cats.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
}

function setTxnType(type) {
  _formType = type;
  document.getElementById('typeIncomeBtn').classList.toggle('active', type === 'income');
  document.getElementById('typeExpenseBtn').classList.toggle('active', type === 'expense');
  fillCategoryOptions(type);
  const modal = document.getElementById('txnModal');
  modal.classList.toggle('is-income', type === 'income');
  modal.classList.toggle('is-expense', type === 'expense');
  const title = document.getElementById('txnModalTitle');
  if (!_editingId) title.textContent = type === 'income' ? 'Add income' : 'Add expense';
}

function openTxnForm(type) {
  _editingId = null;
  document.getElementById('txnAmount').value = '';
  document.getElementById('txnNote').value = '';
  document.getElementById('txnDate').value = todayISO();
  document.getElementById('txnSaveBtn').textContent = 'Save';
  setTxnType(type);
  openModal();
}

function editTxn(id) {
  const t = _txns.find(x => x.id === id);
  if (!t) return;
  _editingId = id;
  setTxnType(t.type);
  document.getElementById('txnAmount').value = t.amount;
  document.getElementById('txnCategory').value = t.category || '';
  document.getElementById('txnNote').value = t.note || '';
  document.getElementById('txnDate').value = t.date || todayISO();
  document.getElementById('txnModalTitle').textContent = 'Edit transaction';
  document.getElementById('txnSaveBtn').textContent = 'Update';
  openModal();
}

function saveTxn() {
  const amount = Math.round(Number(document.getElementById('txnAmount').value));
  const category = document.getElementById('txnCategory').value;
  const note = document.getElementById('txnNote').value.trim();
  const date = document.getElementById('txnDate').value || todayISO();

  if (!amount || amount <= 0) { showToast('Enter a valid amount'); return; }

  if (_editingId) {
    const t = _txns.find(x => x.id === _editingId);
    if (t) Object.assign(t, { type: _formType, amount, category, note, date });
    showToast('Updated');
  } else {
    _txns.push({ id: uid(), type: _formType, amount, category, note, date });
    showToast(_formType === 'income' ? 'Income added' : 'Expense added');
  }
  persist();
  // Jump the view to the month of the saved transaction
  _viewYM = ymOf(date);
  closeTxnForm();
  render();
}

function deleteTxn(id) {
  if (!confirm('Delete this transaction?')) return;
  _txns = _txns.filter(t => t.id !== id);
  persist();
  render();
  showToast('Deleted');
}

// ---- Modal open/close ----
function openModal() {
  document.getElementById('txnModal').classList.add('open');
  document.getElementById('accOverlay').classList.add('show');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('txnAmount').focus(), 100);
}
function closeTxnForm() {
  document.getElementById('txnModal').classList.remove('open');
  document.getElementById('accOverlay').classList.remove('show');
  document.body.style.overflow = '';
  _editingId = null;
}

// ==================================================
// EXPORT / BACKUP / RESTORE
// ==================================================
function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportCSV() {
  if (_txns.length === 0) { showToast('Nothing to export yet'); return; }
  const rows = [['Date', 'Type', 'Category', 'Note', 'Amount']];
  _txns.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .forEach(t => rows.push([t.date, t.type, t.category || '', t.note || '', t.amount]));
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  download(`pasto-accounts-${todayISO()}.csv`, csv, 'text/csv;charset=utf-8');
  showToast('CSV downloaded');
}

function backupJSON() {
  download(`pasto-accounts-backup-${todayISO()}.json`, JSON.stringify(_txns, null, 2), 'application/json');
  showToast('Backup downloaded');
}

function restoreJSON(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data)) throw new Error('Not a valid backup');
      if (!confirm(`Restore ${data.length} transactions? This REPLACES your current data on this device.`)) return;
      _txns = data.map(t => ({
        id: t.id || uid(),
        type: t.type === 'expense' ? 'expense' : 'income',
        amount: Math.round(Number(t.amount) || 0),
        category: t.category || '',
        note: t.note || '',
        date: t.date || todayISO()
      }));
      persist();
      render();
      showToast('Restored ' + _txns.length + ' transactions');
    } catch (err) {
      showToast('Could not read that backup file');
    } finally {
      e.target.value = '';
    }
  };
  reader.readAsText(file);
}

// ==================================================
// INIT
// ==================================================
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTxnForm(); });
render();
