import './styles.css';
import { supabase } from './supabase.js';
import { state } from './state.js';
import { loadProfile, signOut } from './auth.js';
import { initRouter } from './router.js';
import { mountAuthScreen, hideAuthScreen, showAuthError } from './render/auth.js';
import { shellHTML, renderNav, renderUserChip, wireMobileNav } from './render/shell.js';
import { debounce } from './utils.js';

import { renderDashboard } from './render/dashboard.js';
import { renderProjects } from './render/projects.js';
import { renderProjectDetail } from './render/projectDetail.js';
import { renderMaterials } from './render/materials.js';
import { renderPettyCash } from './render/pettycash.js';
import { renderLogs } from './render/logs.js';
import { renderTeam } from './render/team.js';
import { isApprover } from './state.js';

document.getElementById('app').innerHTML = `
  <div id="auth-screen" hidden></div>
  <div id="app-shell" hidden></div>
  <div id="modal-root"></div>
  <div id="toast-wrap"></div>
`;

let routerStarted = false;

async function boot() {
  const { data } = await supabase.auth.getSession();
  if (data?.session) {
    await enterApp(data.session);
  } else {
    await mountAuthScreen(onSignedIn);
  }

  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      window.location.hash = '';
      window.location.reload();
    }
  });
}

async function onSignedIn(session) {
  await enterApp(session);
}

async function enterApp(session) {
  const profile = await loadProfile(session.user.id);
  if (!profile) {
    await signOut();
    showAuthError("Your account isn't set up — contact the Owner.");
    return;
  }
  state.session = session;
  state.profile = profile;
  hideAuthScreen();

  const shell = document.getElementById('app-shell');
  shell.hidden = false;
  shell.innerHTML = shellHTML();
  wireMobileNav();
  renderUserChip();

  if (!routerStarted) {
    routerStarted = true;
    initRouter(renderRoute);
    setupRealtime();
  } else {
    renderNav();
  }
}

async function renderRoute(route) {
  renderNav();
  const approver = isApprover();
  try {
    if (route.name === 'projects') await renderProjects();
    else if (route.name === 'project' && route.params.id) await renderProjectDetail(route.params);
    else if (route.name === 'materials') await renderMaterials();
    else if (route.name === 'pettycash') await renderPettyCash();
    else if (route.name === 'logs') await renderLogs();
    else if (route.name === 'team') {
      if (!approver) {
        window.location.hash = 'dashboard';
        return;
      }
      await renderTeam();
    } else await renderDashboard();
  } catch (err) {
    console.error('Route render failed', err);
    const content = document.getElementById('content');
    if (content) {
      content.innerHTML = `<div class="card empty"><div class="lead">Something went wrong loading this page</div>${(err && err.message) || ''}</div>`;
    }
  }
}

function setupRealtime() {
  const rerender = debounce(() => {
    if (state.route) renderRoute(state.route);
  }, 900);

  const tables = [
    'projects',
    'material_requests',
    'petty_cash_requests',
    'daily_logs',
    'daily_log_materials',
    'team_members',
    'project_assignments',
    'workers',
    'attendance',
    'advances',
    'direct_materials',
    'direct_expenses',
  ];
  let channel = supabase.channel('siteops-live');
  tables.forEach((table) => {
    channel = channel.on('postgres_changes', { schema: 'siteops', table, event: '*' }, rerender);
  });
  channel.subscribe();
}

boot();
