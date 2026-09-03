import { state, isApprover, currentUserId } from '../state.js';
import { setPageTitle, setTopbarActions } from './shell.js';
import { esc, fmtMoney, fmtDate, pillClass, mondayOf, todayISO, weekRangeLabel } from '../utils.js';
import {
  fetchProjects,
  fetchMaterialRequests,
  fetchPettyCashRequests,
  fetchDailyLogs,
  fetchWorkers,
  fetchAttendance,
  fetchAdvances,
  fetchManpower,
  fetchManpowerBaleTotals,
  fetchPendingPayrollRuns,
} from '../data.js';
import { companyWidePayroll, centralizedBaleRows } from '../payroll.js';
import { navigate, projectHash } from '../router.js';
import { openMaterialModal } from './materials.js';
import { openPettyCashModal } from './pettycash.js';
import { openLogModal } from './logs.js';
import { openManpowerBaleModal } from './bale.js';

const STATUS_LABEL = { planning: 'Planning', active: 'Active', on_hold: 'On hold', completed: 'Completed' };

export async function renderDashboard() {
  setPageTitle('Overview', 'Dashboard');
  setTopbarActions(`
    <button class="btn" id="qa-log">+ Daily log</button>
    <button class="btn" id="qa-material">+ Materials</button>
    <button class="btn primary" id="qa-pettycash">+ Petty cash</button>
  `);
  const content = document.getElementById('content');
  content.innerHTML = `<div class="loading-row">Loading dashboard…</div>`;

  const projects = await fetchProjects();
  state.projects = projects;
  const approver = isApprover();
  const uid = currentUserId();

  const [materials, pettycash, logs] = await Promise.all([
    fetchMaterialRequests(),
    fetchPettyCashRequests(),
    fetchDailyLogs(),
  ]);

  const projectName = (id) => projects.find((p) => p.id === id)?.name || `#${id}`;
  const activeCount = projects.filter((p) => p.status === 'active').length;

  // Workers + advances are fetched for everyone (RLS already scopes a Site
  // account to its assigned projects) so the "remaining bale" list below can
  // show for both Owner/Admin and Site. Attendance/payroll math stays
  // Owner/Admin-only, same as before. Bale itself is centralized per person
  // (manpower_bale_totals RPC + the manpower registry), so it reflects a
  // person's latest balance across every project they've worked, not just
  // this one — workers/advances are still needed for the legacy fallback.
  const [workers, advances, manpowerList, manpowerTotals] = await Promise.all([
    fetchWorkers(),
    fetchAdvances(),
    fetchManpower(),
    fetchManpowerBaleTotals(),
  ]);

  let payrollBlock = '';
  let statThird = '';
  let pendingPayrollRuns = [];
  if (approver) {
    pendingPayrollRuns = await fetchPendingPayrollRuns();
    const attendance = await fetchAttendance();
    const monday = mondayOf(todayISO());
    const { byProject, grand } = companyWidePayroll(projects, workers, attendance, advances, monday);
    statThird = `<div class="stat accent"><div class="v num">${fmtMoney(grand.net)}</div><div class="l">This week's payroll</div></div>`;
    payrollBlock = `
      <div class="section">
        <div class="section-head"><h2>Payroll this week &mdash; ${weekRangeLabel(monday)}</h2>
          <a class="btn sm" href="#projects">All projects &rarr;</a>
        </div>
        ${
          byProject.length === 0
            ? emptyBlock('No manpower logged this week yet.')
            : `<div class="table-wrap card"><table><thead><tr><th>Project</th><th>Workers paid</th><th>Gross</th><th>Advances</th><th>Net</th></tr></thead><tbody>
                ${byProject
                  .map(
                    (pp) => `<tr>
                      <td><a href="#${projectHash(pp.project.id, 'manpower')}">${esc(pp.project.name)}</a></td>
                      <td>${pp.rows.length}</td>
                      <td class="num">${fmtMoney(pp.totals.gross)}</td>
                      <td class="num">${fmtMoney(pp.totals.advancesTotal)}</td>
                      <td class="num"><b>${fmtMoney(pp.totals.net)}</b></td>
                    </tr>`
                  )
                  .join('')}
              </tbody></table></div>`
        }
      </div>`;
  }

  // One row per manpower PERSON (centralized), regardless of which project
  // they're currently deployed on; a handful of legacy rows (advances logged
  // before the manpower registry existed) fall back to a per-project link.
  const baleRows = centralizedBaleRows(manpowerTotals, manpowerList, workers, advances);
  const baleBlock = `
    <div class="section">
      <div class="section-head"><h2>Manpower with remaining bale</h2></div>
      ${
        baleRows.length === 0
          ? emptyBlock('No manpower currently has an outstanding bale.')
          : `<div class="table-wrap card"><table><thead><tr><th>Name</th><th>Position</th><th>Remaining</th><th></th></tr></thead><tbody>
              ${baleRows
                .map((r, i) =>
                  r.manpowerId != null
                    ? `<tr>
                        <td>${esc(r.name)}</td>
                        <td>${esc(r.position)}</td>
                        <td class="num"><b>${fmtMoney(r.remaining)}</b></td>
                        <td><button class="btn sm" data-settle-manpower-row="${i}">Settle</button></td>
                      </tr>`
                    : `<tr>
                        <td>${esc(r.name)}</td>
                        <td>${esc(r.position)}</td>
                        <td class="num"><b>${fmtMoney(r.remaining)}</b></td>
                        <td><a class="btn sm" href="#${projectHash(r.projectId, 'manpower')}">Settle &rarr;</a></td>
                      </tr>`
                )
                .join('')}
            </tbody></table></div>`
      }
    </div>`;

  const pendingMaterials = materials.filter((m) => m.status === 'pending');
  const pendingPettycash = pettycash.filter((p) => p.status === 'pending');
  const pendingCount = pendingMaterials.length + pendingPettycash.length + pendingPayrollRuns.length;

  const myMaterials = materials.filter((m) => m.requested_by === uid);
  const myPettycash = pettycash.filter((p) => p.requested_by === uid);
  const myLogs = logs.filter((l) => l.submitted_by === uid);

  const statGrid = `
    <div class="stat-grid section">
      <div class="stat"><div class="v num">${activeCount}</div><div class="l">Active projects</div></div>
      <div class="stat${approver ? ' accent' : ''}"><div class="v num">${approver ? pendingCount : myMaterials.length + myPettycash.length}</div><div class="l">${approver ? 'Pending approvals' : 'My requests'}</div></div>
      <div class="stat"><div class="v num">${logs.filter((l) => isThisWeek(l.log_date)).length}</div><div class="l">Logs this week</div></div>
      ${statThird || `<div class="stat"><div class="v num">${myLogs.length}</div><div class="l">My logs total</div></div>`}
    </div>`;

  let queueBlock;
  if (approver) {
    queueBlock = `
      <div class="section">
        <div class="section-head"><h2>Needs your approval</h2></div>
        ${
          pendingCount === 0
            ? emptyBlock('Nothing pending. All caught up.')
            : `<div class="table-wrap card"><table><thead><tr><th>Type</th><th>Project</th><th>Requested by</th><th>Detail</th><th>Date</th></tr></thead><tbody>
                ${pendingMaterials
                  .map(
                    (m) => `<tr class="clickable-row" data-open-material="${m.id}" style="cursor:pointer;">
                      <td>Materials</td><td>${esc(projectName(m.project_id))}</td><td>${memberName(m.requested_by)}</td>
                      <td>${esc(m.item_name)} &times; ${esc(m.quantity ?? '')} ${esc(m.unit || '')}</td><td>${fmtDate(m.created_at)}</td>
                    </tr>`
                  )
                  .join('')}
                ${pendingPettycash
                  .map(
                    (p) => `<tr class="clickable-row" data-open-pettycash="${p.id}" style="cursor:pointer;">
                      <td>Petty cash</td><td>${esc(projectName(p.project_id))}</td><td>${memberName(p.requested_by)}</td>
                      <td>${esc(p.purpose)} &mdash; ${fmtMoney(p.amount)}</td><td>${fmtDate(p.created_at)}</td>
                    </tr>`
                  )
                  .join('')}
                ${pendingPayrollRuns
                  .map(
                    (r) => `<tr class="clickable-row" data-open-payroll="${projectHash(r.project_id, 'manpower', r.week_start)}" style="cursor:pointer;">
                      <td>Payroll</td><td>${esc(projectName(r.project_id))}</td><td>${memberName(r.submitted_by)}</td>
                      <td>Week of ${fmtDate(r.week_start)}</td><td>${fmtDate(r.created_at)}</td>
                    </tr>`
                  )
                  .join('')}
              </tbody></table></div>`
        }
      </div>`;
  } else {
    queueBlock = `
      <div class="section">
        <div class="section-head"><h2>My recent submissions</h2></div>
        ${
          myMaterials.length + myPettycash.length + myLogs.length === 0
            ? emptyBlock("You haven't submitted anything yet. Use the buttons above to get started.")
            : `<div class="table-wrap card"><table><thead><tr><th>Type</th><th>Project</th><th>Detail</th><th>Status</th><th>Date</th></tr></thead><tbody>
                ${myMaterials
                  .slice(0, 8)
                  .map(
                    (m) => `<tr>
                      <td>Materials</td><td>${esc(projectName(m.project_id))}</td>
                      <td>${esc(m.item_name)} &times; ${esc(m.quantity ?? '')} ${esc(m.unit || '')}</td>
                      <td><span class="pill ${pillClass(m.status)}">${m.status}</span></td><td>${fmtDate(m.created_at)}</td>
                    </tr>`
                  )
                  .join('')}
                ${myPettycash
                  .slice(0, 8)
                  .map(
                    (p) => `<tr>
                      <td>Petty cash</td><td>${esc(projectName(p.project_id))}</td>
                      <td>${esc(p.purpose)} &mdash; ${fmtMoney(p.amount)}</td>
                      <td><span class="pill ${pillClass(p.status)}">${p.status}</span></td><td>${fmtDate(p.created_at)}</td>
                    </tr>`
                  )
                  .join('')}
                ${myLogs
                  .slice(0, 8)
                  .map(
                    (l) => `<tr>
                      <td>Daily log</td><td>${esc(projectName(l.project_id))}</td>
                      <td>${esc((l.activities || '').slice(0, 60))}${(l.activities || '').length > 60 ? '…' : ''}</td>
                      <td>&mdash;</td><td>${fmtDate(l.log_date)}</td>
                    </tr>`
                  )
                  .join('')}
              </tbody></table></div>`
        }
      </div>`;
  }

  content.innerHTML = statGrid + queueBlock + payrollBlock + baleBlock;

  function memberName(id) {
    return esc(state.teamMembers.find((t) => t.id === id)?.full_name || '—');
  }

  content.querySelectorAll('[data-open-material]').forEach((row) => {
    row.addEventListener('click', () => navigate('materials'));
  });
  content.querySelectorAll('[data-open-pettycash]').forEach((row) => {
    row.addEventListener('click', () => navigate('pettycash'));
  });
  content.querySelectorAll('[data-open-payroll]').forEach((row) => {
    row.addEventListener('click', () => navigate(row.dataset.openPayroll));
  });
  content.querySelectorAll('[data-settle-manpower-row]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = baleRows[Number(btn.dataset.settleManpowerRow)];
      if (!row || row.manpowerId == null) return;
      openManpowerBaleModal(row.manpowerId, row.name, () => renderDashboard());
    });
  });

  document.getElementById('qa-log').addEventListener('click', () => openLogModal(undefined, renderDashboard));
  document.getElementById('qa-material').addEventListener('click', () => openMaterialModal(undefined, renderDashboard));
  document.getElementById('qa-pettycash').addEventListener('click', () => openPettyCashModal(undefined, renderDashboard));
}

function isThisWeek(dateStr) {
  if (!dateStr) return false;
  const monday = mondayOf(todayISO());
  const sunday = new Date(monday + 'T00:00:00');
  sunday.setDate(sunday.getDate() + 6);
  return dateStr >= monday && dateStr <= sunday.toISOString().slice(0, 10);
}

function emptyBlock(msg) {
  return `<div class="card empty"><div class="lead">Nothing here yet</div>${esc(msg)}</div>`;
}
