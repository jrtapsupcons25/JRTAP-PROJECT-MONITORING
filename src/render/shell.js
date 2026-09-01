import { ICONS } from '../icons.js';
import { LOGO_DATA_URI } from '../logo.js';
import { state, isApprover } from '../state.js';
import { navigate } from '../router.js';
import { signOut } from '../auth.js';

export const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'projects', label: 'Projects', icon: 'projects' },
  { id: 'materials', label: 'Material Requests', icon: 'materials' },
  { id: 'pettycash', label: 'Petty Cash', icon: 'cash' },
  { id: 'logs', label: 'Daily Logs', icon: 'logs' },
  { id: 'team', label: 'Team', icon: 'team', approverOnly: true },
];

export function shellHTML() {
  return `
    <aside id="sidebar">
      <div class="brand">
        <div class="logo-plate"><img src="${LOGO_DATA_URI}" alt="JR.TAP Supplies and Construction Services"></div>
        <div class="sub">Site Ops</div>
      </div>
      <nav class="mainnav" id="mainnav"></nav>
      <div class="sidebar-foot">
        <button class="user-chip" id="user-chip">
          <span class="avatar" id="user-avatar">?</span>
          <span class="who">
            <span class="n" id="user-name-label">&mdash;</span><br>
            <span class="r" id="user-role-label">&mdash;</span>
          </span>
        </button>
      </div>
    </aside>
    <div id="main">
      <div id="topbar">
        <div style="display:flex; align-items:center; gap:12px;">
          <button class="btn ghost mobile-toggle" id="mobile-nav-toggle" aria-label="Toggle menu">${ICONS.menu}</button>
          <div class="titlewrap">
            <div class="eyebrow" id="page-eyebrow">Overview</div>
            <h1 id="page-title">Dashboard</h1>
          </div>
        </div>
        <div class="topbar-actions" id="topbar-actions"></div>
      </div>
      <div id="content"></div>
    </div>
  `;
}

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin / Assistant', site: 'Site Team' };

export function renderNav() {
  const nav = document.getElementById('mainnav');
  if (!nav) return;
  const approver = isApprover();
  nav.innerHTML = NAV.filter((n) => !n.approverOnly || approver)
    .map(
      (n) => `
      <button class="navitem${state.route.name === n.id ? ' active' : ''}" data-nav="${n.id}">
        ${ICONS[n.icon] || ''}<span>${n.label}</span>
      </button>`
    )
    .join('');
  nav.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      navigate(btn.dataset.nav);
      closeMobileNav();
    });
  });
}

export function renderUserChip() {
  const p = state.profile;
  const nameEl = document.getElementById('user-name-label');
  const roleEl = document.getElementById('user-role-label');
  const avatarEl = document.getElementById('user-avatar');
  if (!p) return;
  nameEl.textContent = p.full_name || '—';
  roleEl.textContent = ROLE_LABEL[p.role] || p.role;
  avatarEl.textContent = (p.full_name || '?').trim().charAt(0).toUpperCase();
  const chip = document.getElementById('user-chip');
  chip.onclick = async () => {
    if (confirm('Sign out of JRTAP Site Ops?')) {
      await signOut();
      window.location.hash = '';
      window.location.reload();
    }
  };
}

export function setPageTitle(eyebrow, title) {
  document.getElementById('page-eyebrow').textContent = eyebrow;
  document.getElementById('page-title').textContent = title;
}

export function setTopbarActions(html) {
  document.getElementById('topbar-actions').innerHTML = html || '';
}

export function wireMobileNav() {
  const btn = document.getElementById('mobile-nav-toggle');
  if (btn) btn.addEventListener('click', toggleMobileNav);
}

function toggleMobileNav() {
  document.getElementById('sidebar').classList.toggle('open');
}
function closeMobileNav() {
  document.getElementById('sidebar').classList.remove('open');
}
