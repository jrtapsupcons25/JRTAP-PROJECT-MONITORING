export function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtMoney(n) {
  const v = Number(n) || 0;
  return (
    '₱' +
    v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

export function fmtDate(d) {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d + (d.length <= 10 ? 'T00:00:00' : '')) : new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
}

// Monday of the week containing the given ISO date string (yyyy-mm-dd).
export function mondayOf(isoDate) {
  const d = new Date(isoDate + 'T00:00:00');
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

export function addDaysISO(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekRangeLabel(mondayISO) {
  const sunday = addDaysISO(mondayISO, 6);
  return `${fmtDate(mondayISO)} – ${fmtDate(sunday)}`;
}

let toastRoot = null;
export function toast(message, kind = '') {
  if (!toastRoot) toastRoot = document.getElementById('toast-wrap');
  if (!toastRoot) return;
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = message;
  toastRoot.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 260);
  }, 3600);
}

export function pillClass(status) {
  return String(status || '').toLowerCase().replace(/\s+/g, '_');
}

export function label(map, key, fallback) {
  return map[key] || fallback || key || '—';
}

// ---------- modal helpers ----------
export function openModal(html) {
  const root = document.getElementById('modal-root');
  root.innerHTML = html;
  root.querySelectorAll('[data-close-modal]').forEach((el) => {
    el.addEventListener('click', closeModal);
  });
  const overlay = root.querySelector('.modal-overlay');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
  }
  document.addEventListener('keydown', escCloseHandler);
}

function escCloseHandler(e) {
  if (e.key === 'Escape') closeModal();
}

export function closeModal() {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
  document.removeEventListener('keydown', escCloseHandler);
}

// ---------- repeatable item-row helper (material line items) ----------
// columns: [{key,type,placeholder,step}] typically [item_name, quantity, unit]
export function repeaterRow(idx, values = {}) {
  return `
    <div class="rep-row" data-rep-row="${idx}">
      <input class="rep-input" type="text" data-rep="item_name" placeholder="Item" value="${esc(values.item_name || '')}">
      <input class="rep-input" type="number" min="0" step="0.01" data-rep="quantity" placeholder="Qty" value="${esc(values.quantity ?? '')}">
      <input class="rep-input" type="text" data-rep="unit" placeholder="Unit" value="${esc(values.unit || '')}">
      <button type="button" class="rep-remove" data-rep-remove="${idx}" title="Remove">&times;</button>
    </div>`;
}

export function readRepeaterRows(container) {
  const rows = [];
  container.querySelectorAll('[data-rep-row]').forEach((row) => {
    const item_name = row.querySelector('[data-rep="item_name"]').value.trim();
    const quantity = row.querySelector('[data-rep="quantity"]').value;
    const unit = row.querySelector('[data-rep="unit"]').value.trim();
    if (item_name) {
      rows.push({ item_name, quantity: quantity === '' ? null : Number(quantity), unit: unit || null });
    }
  });
  return rows;
}

export function wireRepeater(container, addBtn, initialCount = 1) {
  let idx = 0;
  function add(values) {
    const div = document.createElement('div');
    div.innerHTML = repeaterRow(idx, values);
    const row = div.firstElementChild;
    container.appendChild(row);
    row.querySelector('[data-rep-remove]').addEventListener('click', () => row.remove());
    idx++;
  }
  addBtn.addEventListener('click', () => add());
  for (let i = 0; i < initialCount; i++) add();
  return { add };
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
