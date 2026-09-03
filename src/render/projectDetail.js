import { state, isApprover, currentUserId, findProject } from '../state.js';
import { setPageTitle, setTopbarActions } from './shell.js';
import {
  esc,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  pillClass,
  toast,
  openModal,
  closeModal,
  todayISO,
  mondayOf,
  weekRangeLabel,
} from '../utils.js';
import {
  fetchProjects,
  updateProject,
  fetchDailyLogs,
  fetchDailyLogMaterials,
  fetchMaterialRequests,
  fetchPettyCashRequests,
  fetchWorkers,
  createWorker,
  updateWorker,
  fetchAttendance,
  upsertAttendance,
  fetchAdvances,
  createAdvance,
  updateAdvance,
  fetchDirectMaterials,
  createDirectMaterial,
  fetchDirectExpenses,
  createDirectExpense,
  fetchTeamMembers,
  getPhotoSignedUrl,
  fetchProjectAssignments,
  assignMemberToProject,
  unassignMemberFromProject,
  fetchProgressUpdates,
  createProgressUpdate,
  deleteProgressUpdate,
  fetchManpower,
  fetchManpowerBaleTotals,
  fetchBaleSettlements,
  fetchPayrollRun,
  createPayrollRun,
  updatePayrollRun,
  deletePayrollRun,
} from '../data.js';
import { weeklyPayrollForWorkers, remainingBale, settledThisWeek } from '../payroll.js';
import { scheduleStatus } from '../progress.js';
import { buildProgressChart } from './progressChart.js';
import { navigate, projectHash } from '../router.js';
import { openProjectModal } from './projects.js';
import { openLogModal } from './logs.js';
import { openSettleAdvanceModal, settleManpowerBaleAmount } from './bale.js';
import { printPayrollRun } from './payrollPrint.js';
import { ICONS } from '../icons.js';

const STATUS_LABEL = { planning: 'Planning', active: 'Active', on_hold: 'On hold', completed: 'Completed' };

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'activities', label: 'Daily Activities' },
  { id: 'materials', label: 'Materials' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'manpower', label: 'Manpower & Payroll' },
];

// module-scoped UI state for the manpower tab
let attendanceDate = todayISO();
let payrollMonday = mondayOf(todayISO());

export async function renderProjectDetail({ id, tab, week }) {
  const content = document.getElementById('content');
  content.innerHTML = `<div class="loading-row">Loading project…</div>`;

  if (!state.projects.length) state.projects = await fetchProjects();
  let project = findProject(id);
  if (!project) {
    state.projects = await fetchProjects();
    project = findProject(id);
  }
  if (!state.teamMembers.length) state.teamMembers = await fetchTeamMembers();

  if (!project) {
    setPageTitle('Projects', 'Not found');
    setTopbarActions('');
    content.innerHTML = `<div class="card empty"><div class="lead">Project not found</div><a class="btn sm" href="#projects" style="margin-top:10px;">&larr; Back to projects</a></div>`;
    return;
  }

  const approver = isApprover();
  const activeTab = TABS.some((t) => t.id === tab) ? tab : 'overview';

  setPageTitle('Project', project.name);
  setTopbarActions(`
    <a class="btn ghost" href="#projects">${ICONS.back}Projects</a>
    ${approver ? `<button class="btn" id="edit-project-btn">Edit</button>` : ''}
  `);
  if (approver) {
    document.getElementById('edit-project-btn').addEventListener('click', () =>
      openProjectModal(project, () => renderProjectDetail({ id: project.id, tab: activeTab }))
    );
  }

  content.innerHTML = `
    <div class="tabs-row">
      ${TABS.map((t) => `<button type="button" class="pd-tab${t.id === activeTab ? ' active' : ''}" data-pd-tab="${t.id}">${t.label}</button>`).join('')}
    </div>
    <div id="pd-tab-content"><div class="loading-row">Loading…</div></div>
  `;
  content.querySelectorAll('[data-pd-tab]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(projectHash(project.id, btn.dataset.pdTab)));
  });

  const tabContent = document.getElementById('pd-tab-content');
  if (activeTab === 'overview') await paintOverview(tabContent, project);
  else if (activeTab === 'activities') await paintActivities(tabContent, project);
  else if (activeTab === 'materials') await paintMaterials(tabContent, project);
  else if (activeTab === 'expenses') await paintExpenses(tabContent, project);
  else if (activeTab === 'manpower') await paintManpower(tabContent, project, week);
}

function memberName(id) {
  return state.teamMembers.find((m) => m.id === id)?.full_name || '—';
}

/* ==================== PETTY CASH (received vs expenses) ==================== */
// "Received" = approved petty cash requests actually released to the project.
// "Expenses" = site expenses logged against the project (the Expenses tab).
// Remaining = received - expenses; can go negative if the site overspent
// what was released, which is flagged in red so it's easy to spot.
function pettyCashTotals(pettycash, expenses) {
  const received = pettycash.filter((p) => p.status === 'approved').reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const spent = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  return { received, spent, remaining: received - spent };
}

function pettyCashSummaryHTML(totals) {
  const remClass = totals.remaining < 0 ? 'bad' : 'good';
  return `
    <div class="section-head"><h2>Petty Cash &mdash; Received vs Expenses</h2></div>
    <div class="stat-grid cols-3 section">
      <div class="stat good"><div class="v num">${fmtMoney(totals.received)}</div><div class="l">Petty cash received</div></div>
      <div class="stat"><div class="v num">${fmtMoney(totals.spent)}</div><div class="l">Expenses logged</div></div>
      <div class="stat ${remClass}"><div class="v num">${fmtMoney(Math.abs(totals.remaining))}</div><div class="l">${totals.remaining < 0 ? 'Overspent by' : 'Remaining petty cash'}</div></div>
    </div>
  `;
}

/* ==================== OVERVIEW ==================== */
async function paintOverview(el, project) {
  const approver = isApprover();
  const [materials, pettycash, workers, attendance, advances, assignments, progressUpdates, expenses] = await Promise.all([
    fetchMaterialRequests({ projectId: project.id }),
    fetchPettyCashRequests({ projectId: project.id }),
    fetchWorkers(project.id),
    fetchAttendance(project.id),
    fetchAdvances(project.id),
    approver ? fetchProjectAssignments(project.id) : Promise.resolve([]),
    fetchProgressUpdates(project.id),
    fetchDirectExpenses(project.id),
  ]);
  const pendingCount = materials.filter((m) => m.status === 'pending').length + pettycash.filter((p) => p.status === 'pending').length;
  const monday = mondayOf(todayISO());
  const { totals } = weeklyPayrollForWorkers(workers.filter((w) => w.active !== false), attendance, advances, monday);
  const pcTotals = pettyCashTotals(pettycash, expenses);

  el.innerHTML = `
    <div class="stat-grid section">
      <div class="stat"><div class="v num">${pendingCount}</div><div class="l">Pending approvals</div></div>
      <div class="stat"><div class="v num">${workers.filter((w) => w.active !== false).length}</div><div class="l">Active workers</div></div>
      <div class="stat accent"><div class="v num">${fmtMoney(totals.net)}</div><div class="l">This week's payroll</div></div>
      <div class="stat"><div class="v num">${project.budget ? fmtMoney(project.budget) : '—'}</div><div class="l">Budget</div></div>
    </div>
    <div class="section-head"><h2>Project details</h2></div>
    <div class="card card-pad">
      <div class="kv-list">
        <div class="row"><span>Status</span><b><span class="pill ${pillClass(project.status)}">${esc(STATUS_LABEL[project.status] || project.status)}</span></b></div>
        <div class="row"><span>Client</span><b>${esc(project.client_name || '—')}</b></div>
        <div class="row"><span>Site address</span><b>${esc(project.site_address || '—')}</b></div>
        <div class="row"><span>Start date</span><b>${project.start_date ? fmtDate(project.start_date) : '—'}</b></div>
        <div class="row"><span>Target completion</span><b>${project.target_end_date ? fmtDate(project.target_end_date) : '—'}</b></div>
        <div class="row"><span>Budget</span><b>${project.budget ? fmtMoney(project.budget) : '—'}</b></div>
      </div>
      ${project.notes ? `<div class="sub-h" style="margin-top:14px; font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--ink-dim); font-weight:700;">Notes</div><div>${esc(project.notes)}</div>` : ''}
    </div>
    ${pettyCashSummaryHTML(pcTotals)}
    ${accomplishmentSectionHTML(project, progressUpdates)}
    ${approver ? assignedTeamSectionHTML(assignments) : ''}
  `;

  wireAccomplishmentSection(el, project, progressUpdates);

  if (approver) {
    document.getElementById('pd-assign-team').addEventListener('click', () =>
      openAssignTeamModal(project, assignments, () => paintOverview(el, project))
    );
  }
}

/* ==================== ACCOMPLISHMENT (planned vs actual S-curve) ==================== */
const SCHED_LABEL = {
  ahead: 'Ahead of schedule',
  on_track: 'On schedule',
  behind: 'Behind schedule',
  no_data: 'No accomplishment logged yet',
  no_plan: 'Set start & target dates first',
};
const SCHED_CLASS = {
  ahead: 'sched-ahead',
  on_track: 'sched-on_track',
  behind: 'sched-behind',
  no_data: 'sched-no_data',
  no_plan: 'sched-no_plan',
};

function scheduleBadgeHTML(sched) {
  const cls = SCHED_CLASS[sched.status] || 'sched-no_data';
  let label = SCHED_LABEL[sched.status] || sched.status;
  if ((sched.status === 'ahead' || sched.status === 'behind') && sched.diff !== null) {
    label += ` — ${Math.abs(Math.round(sched.diff))}%`;
  }
  return `<span class="pill ${cls}">${esc(label)}</span>`;
}

function accomplishmentSectionHTML(project, updates) {
  const sched = scheduleStatus(project, updates);
  const chart = buildProgressChart(project, updates);
  const sorted = [...updates].sort((a, b) => (a.update_date < b.update_date ? 1 : -1));
  return `
    <div class="section-head">
      <h2>Accomplishment &mdash; Planned vs Actual</h2>
      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
        ${scheduleBadgeHTML(sched)}
        <button class="btn primary sm" id="pd-log-progress">${ICONS.plus}Log accomplishment</button>
      </div>
    </div>
    ${chart.html}
    ${
      sorted.length
        ? `<div class="table-wrap card" style="margin-top:12px;"><table><thead><tr><th>Date</th><th>% complete</th><th>Note</th><th>Logged by</th><th></th></tr></thead><tbody>
            ${sorted
              .map(
                (u) => `<tr>
                  <td>${fmtDate(u.update_date)}</td>
                  <td class="num"><b>${Math.round(Number(u.percent_complete))}%</b></td>
                  <td>${esc(u.note || '')}</td>
                  <td>${esc(memberName(u.logged_by))}</td>
                  <td><button class="btn sm bad" data-del-progress="${u.id}">Delete</button></td>
                </tr>`
              )
              .join('')}
          </tbody></table></div>`
        : ''
    }
  `;
}

function wireAccomplishmentSection(el, project, updates) {
  const chart = buildProgressChart(project, updates);
  chart.wire(el);

  const btn = document.getElementById('pd-log-progress');
  if (btn) btn.addEventListener('click', () => openLogProgressModal(project, updates, () => paintOverview(el, project)));

  el.querySelectorAll('[data-del-progress]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('Delete this accomplishment entry?')) return;
      try {
        await deleteProgressUpdate(b.dataset.delProgress);
        toast('Entry deleted.', 'ok');
        await paintOverview(el, project);
      } catch (err) {
        toast(err.message || 'Could not delete entry.', 'error');
      }
    });
  });
}

function openLogProgressModal(project, updates, onSaved) {
  const latest = [...updates].sort((a, b) => (a.update_date < b.update_date ? 1 : -1))[0];
  openModal(`
    <div class="modal-overlay" id="modal-progress">
      <div class="modal">
        <div class="modal-head"><h2>Log accomplishment</h2><button class="btn ghost" data-close-modal>${ICONS.close}</button></div>
        <form id="form-progress">
          <div class="modal-body">
            <div class="hint" style="margin-bottom:10px;">Enter the actual % complete as computed on site as of the date below.</div>
            <div class="field-row c2">
              <div class="field"><label for="pg-date">Date</label><input type="date" id="pg-date" required value="${todayISO()}"></div>
              <div class="field"><label for="pg-pct">% complete</label><input type="number" id="pg-pct" min="0" max="100" step="0.1" required value="${latest ? latest.percent_complete : ''}"></div>
            </div>
            <div class="field"><label for="pg-note">Note (optional)</label><textarea id="pg-note" maxlength="300" placeholder="e.g. Foundation and columns done, roofing next"></textarea></div>
          </div>
          <div class="modal-foot"><button type="button" class="btn" data-close-modal>Cancel</button><button type="submit" class="btn primary">Save</button></div>
        </form>
      </div>
    </div>
  `);
  document.getElementById('form-progress').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pct = Number(document.getElementById('pg-pct').value);
    if (pct < 0 || pct > 100) return toast('% complete must be between 0 and 100.', 'error');
    try {
      await createProgressUpdate({
        project_id: project.id,
        update_date: document.getElementById('pg-date').value,
        percent_complete: pct,
        note: document.getElementById('pg-note').value.trim() || null,
        logged_by: currentUserId(),
      });
      toast('Accomplishment logged.', 'ok');
      closeModal();
      await onSaved();
    } catch (err) {
      toast(err.message || 'Could not log accomplishment.', 'error');
    }
  });
}

function assignedTeamSectionHTML(assignments) {
  const siteMembers = state.teamMembers.filter((m) => m.role === 'site' && m.active !== false);
  const assignedIds = new Set(assignments.map((a) => a.member_id));
  const assignedMembers = siteMembers.filter((m) => assignedIds.has(m.id));
  return `
    <div class="section-head"><h2>Assigned site team</h2><button class="btn sm" id="pd-assign-team">${ICONS.plus}Assign / unassign</button></div>
    <div class="card card-pad ${assignedMembers.length ? '' : 'empty'}">
      ${
        assignedMembers.length
          ? assignedMembers.map((m) => `<span class="pill role" style="margin:0 6px 6px 0; display:inline-block;">${esc(m.full_name)}</span>`).join('')
          : `${ICONS.team}<div class="lead">No one assigned yet</div>Only Owner/Admin and assigned Site Team members can open this project.`
      }
    </div>
  `;
}

function openAssignTeamModal(project, assignments, onSaved) {
  const siteMembers = state.teamMembers.filter((m) => m.role === 'site' && m.active !== false);
  const assignedIds = new Set(assignments.map((a) => a.member_id));
  openModal(`
    <div class="modal-overlay" id="modal-assign-team">
      <div class="modal">
        <div class="modal-head"><h2>Assign site team &mdash; ${esc(project.name)}</h2><button class="btn ghost" data-close-modal>${ICONS.close}</button></div>
        <form id="form-assign-team">
          <div class="modal-body">
            ${
              siteMembers.length === 0
                ? `<div class="hint">No Site Team accounts yet. Add one from the Team page first.</div>`
                : `<div style="display:flex; flex-direction:column; gap:8px;">
                    ${siteMembers
                      .map(
                        (m) => `<label class="att-worker-row">
                          <input type="checkbox" data-assign-member="${m.id}" ${assignedIds.has(m.id) ? 'checked' : ''}>
                          <span>${esc(m.full_name)}</span>
                        </label>`
                      )
                      .join('')}
                  </div>`
            }
          </div>
          <div class="modal-foot"><button type="button" class="btn" data-close-modal>Cancel</button><button type="submit" class="btn primary">Save</button></div>
        </form>
      </div>
    </div>
  `);
  document.getElementById('form-assign-team').addEventListener('submit', async (e) => {
    e.preventDefault();
    const checkboxes = Array.from(document.querySelectorAll('[data-assign-member]'));
    const nowChecked = new Set(checkboxes.filter((cb) => cb.checked).map((cb) => cb.dataset.assignMember));
    const toAssign = [...nowChecked].filter((id) => !assignedIds.has(id));
    const toUnassign = [...assignedIds].filter((id) => !nowChecked.has(id));
    try {
      await Promise.all([
        ...toAssign.map((id) => assignMemberToProject(project.id, id, currentUserId())),
        ...toUnassign.map((id) => unassignMemberFromProject(project.id, id)),
      ]);
      toast('Assignments updated.', 'ok');
      closeModal();
      await onSaved();
    } catch (err) {
      toast(err.message || 'Could not update assignments.', 'error');
    }
  });
}

/* ==================== DAILY ACTIVITIES ==================== */
async function paintActivities(el, project) {
  el.innerHTML = `
    <div class="section-head"><h2>Daily activity logs</h2><button class="btn primary sm" id="pd-new-log">${ICONS.plus}New daily log</button></div>
    <div id="pd-logs-list"><div class="loading-row">Loading…</div></div>
  `;
  document.getElementById('pd-new-log').addEventListener('click', () => openLogModal(project.id, () => paintActivities(el, project)));
  await paintLogsList(project);
}

async function paintLogsList(project) {
  const listEl = document.getElementById('pd-logs-list');
  if (!listEl) return;
  const logs = await fetchDailyLogs({ projectId: project.id });
  const materials = await fetchDailyLogMaterials(logs.map((l) => l.id));

  if (logs.length === 0) {
    listEl.innerHTML = `<div class="card empty">${ICONS.empty}<div class="lead">No daily logs yet</div>Log today's activity with "New daily log" above.</div>`;
    return;
  }

  listEl.innerHTML = logs
    .map((l) => {
      const mats = materials.filter((m) => m.log_id === l.id);
      return `
      <details class="logcard" data-log="${l.id}">
        <summary>
          <div><b>${fmtDate(l.log_date)}</b></div>
          <div class="hint">by ${esc(memberName(l.submitted_by))}</div>
          <span class="chev">${ICONS.chev}</span>
        </summary>
        <div class="body">
          ${l.activities ? `<div class="sub-h">Activities</div><div>${esc(l.activities)}</div>` : ''}
          ${l.site_conditions ? `<div class="sub-h">Site conditions</div><div>${esc(l.site_conditions)}</div>` : ''}
          ${
            mats.length
              ? `<div class="sub-h">Materials used</div><div class="kv-list">${mats
                  .map((m) => `<div class="row"><span>${esc(m.item_name)}</span><b>${esc(m.quantity ?? '')} ${esc(m.unit || '')}</b></div>`)
                  .join('')}</div>`
              : ''
          }
          ${l.photo_urls && l.photo_urls.length ? `<div class="sub-h">Photos</div><div class="photo-thumbs" data-photo-container="${l.id}">Loading photos&hellip;</div>` : ''}
        </div>
      </details>`;
    })
    .join('');

  listEl.querySelectorAll('details.logcard').forEach((det) => {
    det.addEventListener('toggle', async () => {
      if (!det.open) return;
      const logId = det.dataset.log;
      const log = logs.find((l) => String(l.id) === logId);
      const container = det.querySelector(`[data-photo-container="${logId}"]`);
      if (!container || container.dataset.loaded) return;
      container.dataset.loaded = '1';
      const urls = await Promise.all((log.photo_urls || []).map((p) => getPhotoSignedUrl(p)));
      container.innerHTML = urls.filter(Boolean).map((u) => `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="Site photo"></a>`).join('');
    });
  });
}

/* ==================== MATERIALS (direct in/out) ==================== */
async function paintMaterials(el, project) {
  el.innerHTML = `
    <div class="section-head"><h2>Materials in / out</h2><button class="btn primary sm" id="pd-new-material">${ICONS.plus}Log movement</button></div>
    <div id="pd-materials-list"><div class="loading-row">Loading…</div></div>
  `;
  document.getElementById('pd-new-material').addEventListener('click', () => openDirectMaterialModal(project, () => paintMaterialsList(project)));
  await paintMaterialsList(project);
}

async function paintMaterialsList(project) {
  const listEl = document.getElementById('pd-materials-list');
  if (!listEl) return;
  const rows = await fetchDirectMaterials(project.id);
  listEl.innerHTML = rows.length === 0
    ? `<div class="card empty">${ICONS.empty}<div class="lead">No materials logged yet</div></div>`
    : `<div class="table-wrap card"><table><thead><tr><th>Date</th><th>Direction</th><th>Item</th><th>Qty</th><th>Unit cost</th><th>Total cost</th><th>Logged by</th><th>Note</th></tr></thead><tbody>
        ${rows
          .map(
            (r) => `<tr>
              <td>${fmtDate(r.logged_at)}</td>
              <td><span class="pill ${r.direction === 'in' ? 'in' : 'out'}">${r.direction === 'in' ? 'In' : 'Out'}</span></td>
              <td>${esc(r.item_name)}</td>
              <td class="num">${esc(r.quantity ?? '—')} ${esc(r.unit || '')}</td>
              <td class="num">${r.unit_cost ? fmtMoney(r.unit_cost) : '—'}</td>
              <td class="num">${r.unit_cost && r.quantity != null ? fmtMoney(Number(r.quantity) * Number(r.unit_cost)) : '—'}</td>
              <td>${esc(memberName(r.logged_by))}</td>
              <td>${esc(r.note || '')}</td>
            </tr>`
          )
          .join('')}
      </tbody></table></div>`;
}

function openDirectMaterialModal(project, onSaved) {
  openModal(`
    <div class="modal-overlay" id="modal-material-direct">
      <div class="modal">
        <div class="modal-head"><h2>Log material movement</h2><button class="btn ghost" data-close-modal>${ICONS.close}</button></div>
        <form id="form-material-direct">
          <div class="modal-body">
            <div class="field-row c2">
              <div class="field"><label for="md-direction">Direction</label><select id="md-direction"><option value="in">Incoming (received)</option><option value="out">Outgoing (used / issued)</option></select></div>
              <div class="field"><label for="md-item">Item</label><input type="text" id="md-item" required maxlength="120"></div>
            </div>
            <div class="field-row c2">
              <div class="field"><label for="md-qty">Quantity</label><input type="number" id="md-qty" min="0" step="0.01"></div>
              <div class="field"><label for="md-unit">Unit</label><input type="text" id="md-unit" maxlength="30" placeholder="e.g. bags, pcs, cu.m"></div>
            </div>
            <div class="field"><label for="md-cost">Unit cost (&#8369;, optional)</label><input type="number" id="md-cost" min="0" step="0.01"></div>
            <div class="field"><label for="md-note">Note</label><textarea id="md-note" maxlength="300"></textarea></div>
          </div>
          <div class="modal-foot"><button type="button" class="btn" data-close-modal>Cancel</button><button type="submit" class="btn primary">Log movement</button></div>
        </form>
      </div>
    </div>
  `);
  document.getElementById('form-material-direct').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await createDirectMaterial({
        project_id: project.id,
        direction: document.getElementById('md-direction').value,
        item_name: document.getElementById('md-item').value.trim(),
        quantity: document.getElementById('md-qty').value === '' ? null : Number(document.getElementById('md-qty').value),
        unit: document.getElementById('md-unit').value.trim() || null,
        unit_cost: document.getElementById('md-cost').value === '' ? null : Number(document.getElementById('md-cost').value),
        note: document.getElementById('md-note').value.trim() || null,
        logged_by: currentUserId(),
      });
      toast('Material movement logged.', 'ok');
      closeModal();
      await onSaved();
    } catch (err) {
      toast(err.message || 'Could not log movement.', 'error');
    }
  });
}

/* ==================== EXPENSES (direct) ==================== */
async function paintExpenses(el, project) {
  el.innerHTML = `
    <div class="section-head"><h2>Site expenses</h2><button class="btn primary sm" id="pd-new-expense">${ICONS.plus}Log expense</button></div>
    <div id="pd-expenses-list"><div class="loading-row">Loading…</div></div>
  `;
  document.getElementById('pd-new-expense').addEventListener('click', () => openDirectExpenseModal(project, () => paintExpensesList(project)));
  await paintExpensesList(project);
}

async function paintExpensesList(project) {
  const listEl = document.getElementById('pd-expenses-list');
  if (!listEl) return;
  const [rows, pettycash] = await Promise.all([fetchDirectExpenses(project.id), fetchPettyCashRequests({ projectId: project.id })]);
  const pcTotals = pettyCashTotals(pettycash, rows);
  listEl.innerHTML =
    pettyCashSummaryHTML(pcTotals) +
    (rows.length === 0
      ? `<div class="card empty">${ICONS.empty}<div class="lead">No expenses logged yet</div></div>`
      : `<div class="table-wrap card"><table><thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Amount</th><th>Logged by</th></tr></thead><tbody>
          ${rows
            .map(
              (r) => `<tr>
                <td>${fmtDate(r.logged_at)}</td>
                <td>${esc(r.description)}</td>
                <td>${esc(r.category || '—')}</td>
                <td class="num">${fmtMoney(r.amount)}</td>
                <td>${esc(memberName(r.logged_by))}</td>
              </tr>`
            )
            .join('')}
        </tbody></table></div>`);
}

function openDirectExpenseModal(project, onSaved) {
  openModal(`
    <div class="modal-overlay" id="modal-expense-direct">
      <div class="modal">
        <div class="modal-head"><h2>Log expense</h2><button class="btn ghost" data-close-modal>${ICONS.close}</button></div>
        <form id="form-expense-direct">
          <div class="modal-body">
            <div class="field-row c2">
              <div class="field"><label for="ed-desc">Description</label><input type="text" id="ed-desc" required maxlength="150"></div>
              <div class="field"><label for="ed-amount">Amount (&#8369;)</label><input type="number" id="ed-amount" min="0" step="0.01" required></div>
            </div>
            <div class="field"><label for="ed-category">Category</label><input type="text" id="ed-category" maxlength="60" placeholder="e.g. Fuel, Tools, Permits"></div>
            <div class="field"><label for="ed-notes">Notes</label><textarea id="ed-notes" maxlength="300"></textarea></div>
          </div>
          <div class="modal-foot"><button type="button" class="btn" data-close-modal>Cancel</button><button type="submit" class="btn primary">Log expense</button></div>
        </form>
      </div>
    </div>
  `);
  document.getElementById('form-expense-direct').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await createDirectExpense({
        project_id: project.id,
        description: document.getElementById('ed-desc').value.trim(),
        amount: Number(document.getElementById('ed-amount').value),
        category: document.getElementById('ed-category').value.trim() || null,
        logged_by: currentUserId(),
      });
      toast('Expense logged.', 'ok');
      closeModal();
      await onSaved();
    } catch (err) {
      toast(err.message || 'Could not log expense.', 'error');
    }
  });
}

/* ==================== MANPOWER & PAYROLL ==================== */
async function paintManpower(el, project, initialWeek) {
  // A dashboard "Payroll" approval-queue link passes the specific week that
  // submission is for, so the reviewer lands directly on it instead of
  // whatever week happened to be selected last.
  if (initialWeek) payrollMonday = mondayOf(initialWeek);
  el.innerHTML = `
    <div class="section">
      <div class="section-head"><h2>Worker roster</h2><button class="btn sm" id="pd-add-worker">${ICONS.plus}Add worker</button></div>
      <div id="pd-workers-list"><div class="loading-row">Loading…</div></div>
    </div>
    <div class="section">
      <div class="section-head"><h2>Attendance</h2></div>
      <div class="card card-pad">
        <div class="field" style="max-width:220px;"><label for="pd-att-date">Date</label><input type="date" id="pd-att-date" value="${attendanceDate}"></div>
        <div id="pd-att-grid"></div>
        <button class="btn primary sm" id="pd-att-save" style="margin-top:12px;">Save attendance</button>
      </div>
    </div>
    <div class="section">
      <div class="section-head"><h2>Cash advances (bale)</h2><button class="btn sm" id="pd-add-advance">${ICONS.plus}Log advance</button></div>
      <div id="pd-advances-list"><div class="loading-row">Loading…</div></div>
    </div>
    <div class="section">
      <div class="section-head"><h2>Weekly payroll</h2></div>
      <div class="card card-pad">
        <div class="field" style="max-width:220px;"><label for="pd-payroll-week">Week starting (Mon &ndash; pay Sat)</label><input type="date" id="pd-payroll-week" value="${payrollMonday}"></div>
        <div id="pd-payroll-table"></div>
      </div>
    </div>
  `;

  let workers = await fetchWorkers(project.id);

  async function refreshWorkers() {
    workers = await fetchWorkers(project.id);
    paintWorkersList();
    paintAttendanceGrid();
    refreshPayroll();
  }

  function paintWorkersList() {
    const listEl = document.getElementById('pd-workers-list');
    if (!listEl) return;
    listEl.innerHTML = workers.length === 0
      ? `<div class="card empty">${ICONS.team}<div class="lead">No workers registered</div>Add workers to start tracking attendance and payroll.</div>`
      : `<div class="table-wrap card"><table><thead><tr><th>Name</th><th>Position</th><th>Daily rate</th><th>Status</th><th></th></tr></thead><tbody>
          ${workers
            .map(
              (w) => `<tr>
                <td>${esc(w.full_name)}</td>
                <td>${esc(w.trade || '—')}</td>
                <td class="num">${fmtMoney(w.daily_rate)}</td>
                <td><span class="pill ${w.active === false ? 'inactive' : 'approved'}">${w.active === false ? 'Inactive' : 'Active'}</span></td>
                <td><button class="btn sm" data-edit-worker="${w.id}">Edit</button></td>
              </tr>`
            )
            .join('')}
        </tbody></table></div>`;
    listEl.querySelectorAll('[data-edit-worker]').forEach((btn) => {
      btn.addEventListener('click', () => openWorkerModal(project, workers.find((w) => String(w.id) === btn.dataset.editWorker), refreshWorkers));
    });
  }

  function paintAttendanceGrid() {
    const gridEl = document.getElementById('pd-att-grid');
    if (!gridEl) return;
    const activeWorkers = workers.filter((w) => w.active !== false);
    if (activeWorkers.length === 0) {
      gridEl.innerHTML = `<div class="hint">Add workers first.</div>`;
      return;
    }
    fetchAttendance(project.id).then((attendance) => {
      const presentSet = new Set(
        attendance.filter((a) => a.work_date === attendanceDate && a.present !== false).map((a) => a.worker_id)
      );
      gridEl.innerHTML = `<div style="display:flex; flex-direction:column; gap:8px; margin-top:10px;">${activeWorkers
        .map(
          (w) => `<label class="att-worker-row">
            <input type="checkbox" data-att-worker="${w.id}" ${presentSet.has(w.id) ? 'checked' : ''}>
            <span>${esc(w.full_name)}</span>
            <span class="hint" style="margin-left:auto;">${esc(w.trade || '')}</span>
          </label>`
        )
        .join('')}</div>`;
    });
  }

  async function refreshPayroll() {
    const tableEl = document.getElementById('pd-payroll-table');
    if (!tableEl) return;

    // A submitted-or-approved payroll for this project/week takes over the
    // whole card — the site engineer's live editable view only shows while
    // no such record exists yet ("draft").
    const existingRun = await fetchPayrollRun(project.id, payrollMonday);
    if (existingRun) {
      renderPayrollRunView(tableEl, existingRun);
      return;
    }

    const activeWorkers = workers.filter((w) => w.active !== false);
    const manpowerIds = activeWorkers.map((w) => w.manpower_id).filter((id) => id != null);
    const [attendance, advances, manpowerTotals, settlements] = await Promise.all([
      fetchAttendance(project.id),
      fetchAdvances(project.id),
      fetchManpowerBaleTotals(),
      manpowerIds.length ? fetchBaleSettlements(manpowerIds) : Promise.resolve([]),
    ]);
    const { rows, totals } = weeklyPayrollForWorkers(activeWorkers, attendance, advances, payrollMonday);
    // Outstanding bale is centralized per manpower person, not per project —
    // a worker only carries a figure here if they're linked to the manpower
    // registry (manpower_id); legacy roster rows show "—" and stay covered by
    // the Cash advances list above.
    const outstandingFor = (worker) => {
      if (worker.manpower_id == null) return null;
      const t = manpowerTotals.find((m) => m.manpower_id === worker.manpower_id);
      return t ? Number(t.outstanding) || 0 : 0;
    };
    tableEl.innerHTML = `
      <div class="hint" style="margin-bottom:8px;">${weekRangeLabel(payrollMonday)}</div>
      ${
        rows.length === 0
          ? `<div class="hint">No active workers to compute payroll for.</div>`
          : `<div class="table-wrap"><table><thead><tr><th>Worker</th><th>Days present</th><th>Gross</th><th>Advances (this wk)</th><th>Net</th><th>Outstanding bale (company-wide)</th><th>Deduct bale</th><th>Remaining bale this week</th></tr></thead><tbody>
              ${rows
                .map((r) => {
                  const outstanding = outstandingFor(r.worker);
                  const confirmed = r.worker.manpower_id != null ? settledThisWeek(r.worker.manpower_id, settlements, payrollMonday) : 0;
                  return `<tr data-worker-row="${r.worker.id}">
                    <td>${esc(r.worker.full_name)}</td>
                    <td class="num">${r.daysPresent}</td>
                    <td class="num" data-cell-gross>${fmtMoney(r.gross)}</td>
                    <td class="num">${fmtMoney(r.advancesTotal)}</td>
                    <td class="num" data-cell-net><b>${fmtMoney(r.net)}</b></td>
                    <td class="num" data-cell-outstanding>${outstanding === null ? `<span class="hint">&mdash;</span>` : `<b>${fmtMoney(outstanding)}</b>`}</td>
                    <td class="num">
                      ${
                        outstanding > 0
                          ? `<input type="number" data-deduct-bale data-gross="${r.gross}" data-advances="${r.advancesTotal}" data-outstanding="${outstanding}" min="0" max="${outstanding}" step="0.01" placeholder="0.00" style="width:100px;">`
                          : `<span class="hint">&mdash;</span>`
                      }
                      ${confirmed > 0 ? `<div class="hint" style="margin-top:4px;">Confirmed so far: <b>${fmtMoney(confirmed)}</b></div>` : ''}
                    </td>
                    <td class="num" data-cell-remaining>${outstanding === null ? `<span class="hint">&mdash;</span>` : outstanding > 0 ? fmtMoney(outstanding) : `<span class="hint">None</span>`}</td>
                  </tr>`;
                })
                .join('')}
              <tr><td colspan="2"><b>Total</b></td><td class="num"><b>${fmtMoney(totals.gross)}</b></td><td class="num"><b>${fmtMoney(totals.advancesTotal)}</b></td><td class="num"><b>${fmtMoney(totals.net)}</b></td><td></td><td></td><td></td></tr>
            </tbody></table></div>
            <button class="btn primary sm" id="pd-submit-payroll" style="margin-top:12px;">${ICONS.check}Submit for approval</button>`
      }
    `;

    // Typing a deduction previews, live, what it does to that row's Net and
    // to next week's starting "Outstanding bale" (shown here as "Remaining
    // bale this week") — nothing is written to the database yet. The bale
    // deduction only becomes real once Owner/Admin approves the submission.
    tableEl.querySelectorAll('[data-deduct-bale]').forEach((input) => {
      input.addEventListener('input', () => {
        const row = input.closest('tr');
        const outstanding = Number(input.dataset.outstanding) || 0;
        let val = Number(input.value) || 0;
        if (val < 0) val = 0;
        if (val > outstanding) val = outstanding;
        const gross = Number(input.dataset.gross) || 0;
        const advancesGiven = Number(input.dataset.advances) || 0;
        const remaining = Math.max(0, outstanding - val);
        const net = gross - advancesGiven - val;
        const remainingCell = row.querySelector('[data-cell-remaining]');
        const netCell = row.querySelector('[data-cell-net]');
        if (remainingCell) remainingCell.innerHTML = remaining > 0 ? fmtMoney(remaining) : `<span class="hint">None</span>`;
        if (netCell) netCell.innerHTML = `<b>${fmtMoney(net)}</b>`;
      });
    });

    const submitBtn = document.getElementById('pd-submit-payroll');
    if (submitBtn) {
      submitBtn.addEventListener('click', async () => {
        submitBtn.disabled = true;
        try {
          const snapshotRows = rows.map((r) => {
            const rowEl = tableEl.querySelector(`[data-worker-row="${r.worker.id}"]`);
            const input = rowEl ? rowEl.querySelector('[data-deduct-bale]') : null;
            const outstanding = outstandingFor(r.worker);
            let deducted = 0;
            if (input) {
              deducted = Number(input.value) || 0;
              if (deducted < 0) deducted = 0;
              if (outstanding != null && deducted > outstanding) deducted = outstanding;
            }
            return {
              worker_id: r.worker.id,
              manpower_id: r.worker.manpower_id ?? null,
              full_name: r.worker.full_name,
              days_present: r.daysPresent,
              daily_rate: Number(r.worker.daily_rate) || 0,
              gross: r.gross,
              advances_given: r.advancesTotal,
              outstanding_before: outstanding,
              bale_deducted: deducted,
              net: r.gross - r.advancesTotal - deducted,
            };
          });
          await createPayrollRun({
            project_id: project.id,
            week_start: payrollMonday,
            rows: snapshotRows,
            submitted_by: currentUserId(),
          });
          toast('Payroll submitted for approval.', 'ok');
          await refreshPayroll();
        } catch (err) {
          toast(err.message || 'Could not submit payroll.', 'error');
        } finally {
          submitBtn.disabled = false;
        }
      });
    }
  }

  // Renders a submitted-or-approved payroll snapshot in place of the live
  // editable view. Owner/Admin reviewing a "submitted" run can revise the
  // bale-deducted amounts (attendance/gross/advances stay as submitted —
  // if those need correcting, "Send back to draft" and have the site
  // engineer redo it) before Approve actually applies the deduction to the
  // centralized ledger. Once approved, the record is locked and printable.
  function renderPayrollRunView(tableEl, run) {
    const rows = run.rows || [];
    const approver = isApprover();
    const editable = run.status === 'submitted' && approver;
    const totals = rows.reduce(
      (acc, r) => ({
        gross: acc.gross + (Number(r.gross) || 0),
        advances: acc.advances + (Number(r.advances_given) || 0),
        deducted: acc.deducted + (Number(r.bale_deducted) || 0),
        net: acc.net + (Number(r.net) || 0),
      }),
      { gross: 0, advances: 0, deducted: 0, net: 0 }
    );
    const banner =
      run.status === 'submitted'
        ? `<div class="hint" style="margin-bottom:10px;">Submitted by ${esc(memberName(run.submitted_by))} on ${fmtDateTime(run.created_at)} &mdash; ${
            approver ? 'review the bale figures below, then approve.' : 'awaiting Owner/Admin approval.'
          }</div>`
        : `<div class="hint" style="margin-bottom:10px;">Approved by ${esc(memberName(run.decided_by))} on ${fmtDateTime(run.decided_at)}.</div>`;

    tableEl.innerHTML = `
      <div class="hint" style="margin-bottom:8px;">${weekRangeLabel(run.week_start)}</div>
      ${banner}
      <div class="table-wrap"><table><thead><tr><th>Worker</th><th>Days present</th><th>Gross</th><th>Advances (this wk)</th><th>Bale deducted</th><th>Net</th></tr></thead><tbody>
        ${rows
          .map(
            (r, i) => `<tr data-run-row="${i}">
              <td>${esc(r.full_name)}</td>
              <td class="num">${r.days_present}</td>
              <td class="num">${fmtMoney(r.gross)}</td>
              <td class="num">${fmtMoney(r.advances_given)}</td>
              <td class="num">
                ${
                  editable
                    ? `<input type="number" data-revise-deduct data-row-index="${i}" data-gross="${r.gross}" data-advances="${r.advances_given}" ${
                        r.outstanding_before != null ? `data-outstanding="${r.outstanding_before}" max="${r.outstanding_before}"` : ''
                      } min="0" step="0.01" value="${r.bale_deducted}" style="width:100px;">`
                    : fmtMoney(r.bale_deducted)
                }
              </td>
              <td class="num" data-cell-net><b>${fmtMoney(r.net)}</b></td>
            </tr>`
          )
          .join('')}
        <tr><td colspan="2"><b>Total</b></td><td class="num"><b>${fmtMoney(totals.gross)}</b></td><td class="num"><b>${fmtMoney(totals.advances)}</b></td><td class="num"><b>${fmtMoney(totals.deducted)}</b></td><td class="num"><b>${fmtMoney(totals.net)}</b></td></tr>
      </tbody></table></div>
      <div style="display:flex; gap:10px; margin-top:12px; flex-wrap:wrap;">
        ${editable ? `<button class="btn primary sm" id="pd-approve-payroll">${ICONS.check}Approve payroll</button><button class="btn ghost sm" id="pd-reopen-payroll">Send back to draft</button>` : ''}
        ${run.status === 'approved' ? `<button class="btn sm" id="pd-print-payroll">${ICONS.print}Print payroll</button>` : ''}
      </div>
    `;

    if (editable) {
      tableEl.querySelectorAll('[data-revise-deduct]').forEach((input) => {
        input.addEventListener('input', () => {
          const row = input.closest('tr');
          const outstandingRaw = input.dataset.outstanding;
          const outstanding = outstandingRaw === undefined ? Infinity : Number(outstandingRaw);
          let val = Number(input.value) || 0;
          if (val < 0) val = 0;
          if (val > outstanding) val = outstanding;
          const gross = Number(input.dataset.gross) || 0;
          const advancesGiven = Number(input.dataset.advances) || 0;
          const net = gross - advancesGiven - val;
          row.querySelector('[data-cell-net]').innerHTML = `<b>${fmtMoney(net)}</b>`;
        });
      });

      document.getElementById('pd-approve-payroll').addEventListener('click', async () => {
        const btn = document.getElementById('pd-approve-payroll');
        btn.disabled = true;
        try {
          const finalRows = rows.map((r, i) => {
            const input = tableEl.querySelector(`[data-revise-deduct][data-row-index="${i}"]`);
            const deducted = input ? Math.max(0, Number(input.value) || 0) : Number(r.bale_deducted) || 0;
            return { ...r, bale_deducted: deducted, net: r.gross - r.advances_given - deducted };
          });
          const shortfalls = [];
          for (const r of finalRows) {
            if (r.manpower_id != null && r.bale_deducted > 0) {
              const applied = await settleManpowerBaleAmount(r.manpower_id, r.bale_deducted, currentUserId());
              if (applied < r.bale_deducted - 0.005) shortfalls.push(`${r.full_name} (${fmtMoney(r.bale_deducted - applied)} short)`);
            }
          }
          await updatePayrollRun(run.id, {
            status: 'approved',
            rows: finalRows,
            decided_by: currentUserId(),
            decided_at: new Date().toISOString(),
          });
          toast(
            shortfalls.length ? `Approved, but not fully applied: ${shortfalls.join(', ')}.` : 'Payroll approved.',
            shortfalls.length ? 'error' : 'ok'
          );
          await refreshPayroll();
          await paintAdvancesList();
        } catch (err) {
          toast(err.message || 'Could not approve payroll.', 'error');
        } finally {
          btn.disabled = false;
        }
      });

      document.getElementById('pd-reopen-payroll').addEventListener('click', async () => {
        if (!confirm('Send this payroll back to draft? The site engineer will need to review and re-submit it.')) return;
        try {
          await deletePayrollRun(run.id);
          toast('Payroll sent back to draft.', 'ok');
          await refreshPayroll();
        } catch (err) {
          toast(err.message || 'Could not reopen payroll.', 'error');
        }
      });
    }

    if (run.status === 'approved') {
      const printBtn = document.getElementById('pd-print-payroll');
      if (printBtn) printBtn.addEventListener('click', () => printPayrollRun(run, project, memberName));
    }
  }

  async function paintAdvancesList() {
    const listEl = document.getElementById('pd-advances-list');
    if (!listEl) return;
    const advances = await fetchAdvances(project.id);
    const workerName = (id) => workers.find((w) => w.id === id)?.full_name || '—';
    listEl.innerHTML = advances.length === 0
      ? `<div class="card empty">${ICONS.empty}<div class="lead">No advances logged yet</div></div>`
      : `<div class="table-wrap card"><table><thead><tr><th>Date</th><th>Worker</th><th>Amount</th><th>Remaining</th><th>Note</th><th>Given by</th><th></th></tr></thead><tbody>
          ${advances
            .map((a) => {
              const remaining = remainingBale(a);
              return `<tr>
                <td>${fmtDate(a.given_at)}</td>
                <td>${esc(workerName(a.worker_id))}</td>
                <td class="num">${fmtMoney(a.amount)}</td>
                <td class="num">${remaining > 0 ? `<b>${fmtMoney(remaining)}</b>` : `<span class="hint">Settled</span>`}</td>
                <td>${esc(a.note || '')}</td>
                <td>${esc(memberName(a.given_by))}</td>
                <td>${remaining > 0 ? `<button class="btn sm" data-settle-advance="${a.id}">Settle</button>` : ''}</td>
              </tr>`;
            })
            .join('')}
        </tbody></table></div>`;

    listEl.querySelectorAll('[data-settle-advance]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const advance = advances.find((a) => String(a.id) === btn.dataset.settleAdvance);
        if (advance) openSettleAdvanceModal(advance, workerName(advance.worker_id), async () => {
          await paintAdvancesList();
          await refreshPayroll();
        });
      });
    });
  }

  paintWorkersList();
  paintAttendanceGrid();
  paintAdvancesList();
  refreshPayroll();

  document.getElementById('pd-add-worker').addEventListener('click', () => openWorkerModal(project, null, refreshWorkers));
  document.getElementById('pd-add-advance').addEventListener('click', () =>
    openAdvanceModal(project, workers, async () => {
      await paintAdvancesList();
      await refreshPayroll();
    })
  );
  document.getElementById('pd-att-date').addEventListener('change', (e) => {
    attendanceDate = e.target.value;
    paintAttendanceGrid();
  });
  document.getElementById('pd-payroll-week').addEventListener('change', (e) => {
    payrollMonday = mondayOf(e.target.value || todayISO());
    refreshPayroll();
  });
  document.getElementById('pd-att-save').addEventListener('click', async () => {
    const gridEl = document.getElementById('pd-att-grid');
    const rows = Array.from(gridEl.querySelectorAll('[data-att-worker]')).map((cb) => ({
      project_id: project.id,
      worker_id: cb.dataset.attWorker,
      work_date: attendanceDate,
      present: cb.checked,
      logged_by: currentUserId(),
    }));
    try {
      await upsertAttendance(rows);
      toast('Attendance saved.', 'ok');
      refreshPayroll();
    } catch (err) {
      toast(err.message || 'Could not save attendance.', 'error');
    }
  });
}

async function openWorkerModal(project, worker, onSaved) {
  const isEdit = !!worker;
  // Adding a worker pulls from the company-wide manpower registry (name,
  // position, rate auto-filled) instead of retyping their details per project.
  // Editing an existing project roster row keeps the direct fields, since that's
  // adjusting this person's status/rate on *this* project, not the registry.
  const manpower = isEdit ? [] : await fetchManpower({ activeOnly: true });

  openModal(`
    <div class="modal-overlay" id="modal-worker">
      <div class="modal">
        <div class="modal-head"><h2>${isEdit ? 'Edit worker' : 'Add worker'}</h2><button class="btn ghost" data-close-modal>${ICONS.close}</button></div>
        <form id="form-worker">
          <div class="modal-body">
            ${
              isEdit
                ? `<div class="field"><label for="w-name">Name</label><input type="text" id="w-name" required maxlength="80" value="${esc(worker.full_name || '')}"></div>`
                : manpower.length === 0
                  ? `<div class="hint">No manpower registered yet. Ask the Owner/Admin to register workers on the "Manpower" page first, then pick them here.</div>`
                  : `<div class="field"><label for="w-manpower">Select worker</label>
                      <select id="w-manpower" required>
                        <option value="">Select from registered manpower&hellip;</option>
                        ${manpower.map((m) => `<option value="${m.id}" data-position="${esc(m.job_position || '')}" data-rate="${m.daily_rate ?? ''}">${esc(m.full_name)}${m.job_position ? ` &mdash; ${esc(m.job_position)}` : ''}</option>`).join('')}
                      </select>
                    </div>`
            }
            <div class="field"><label for="w-trade">Position</label><input type="text" id="w-trade" maxlength="60" value="${esc(worker?.trade || '')}" placeholder="e.g. Mason, Carpenter, Laborer" ${isEdit ? '' : 'readonly'}></div>
            <div class="field"><label for="w-rate">Daily rate (&#8369;)</label><input type="number" id="w-rate" min="0" step="1" required value="${worker?.daily_rate ?? ''}"></div>
            ${isEdit ? `<div class="field"><label for="w-active">Status</label><select id="w-active"><option value="true" ${worker.active !== false ? 'selected' : ''}>Active</option><option value="false" ${worker.active === false ? 'selected' : ''}>Inactive</option></select></div>` : ''}
          </div>
          <div class="modal-foot"><button type="button" class="btn" data-close-modal>Cancel</button><button type="submit" class="btn primary" ${!isEdit && manpower.length === 0 ? 'disabled' : ''}>${isEdit ? 'Save changes' : 'Add worker'}</button></div>
        </form>
      </div>
    </div>
  `);

  const manpowerSelect = document.getElementById('w-manpower');
  if (manpowerSelect) {
    manpowerSelect.addEventListener('change', () => {
      const opt = manpowerSelect.selectedOptions[0];
      document.getElementById('w-trade').value = opt?.dataset.position || '';
      document.getElementById('w-rate').value = opt?.dataset.rate || '';
    });
  }

  document.getElementById('form-worker').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fields = {
      trade: document.getElementById('w-trade').value.trim() || null,
      daily_rate: Number(document.getElementById('w-rate').value),
    };
    if (isEdit) {
      fields.full_name = document.getElementById('w-name').value.trim();
      fields.active = document.getElementById('w-active').value === 'true';
    } else {
      const manpowerId = manpowerSelect.value;
      const picked = manpower.find((m) => String(m.id) === manpowerId);
      if (!picked) return toast('Select a worker from the list.', 'error');
      fields.full_name = picked.full_name;
      fields.manpower_id = picked.id;
    }
    try {
      if (isEdit) await updateWorker(worker.id, fields);
      else await createWorker({ ...fields, project_id: project.id });
      toast(isEdit ? 'Worker updated.' : 'Worker added.', 'ok');
      closeModal();
      await onSaved();
    } catch (err) {
      toast(err.message || 'Could not save worker.', 'error');
    }
  });
}

function openAdvanceModal(project, workers, onSaved) {
  const activeWorkers = workers.filter((w) => w.active !== false);
  openModal(`
    <div class="modal-overlay" id="modal-advance">
      <div class="modal">
        <div class="modal-head"><h2>Log cash advance (bale)</h2><button class="btn ghost" data-close-modal>${ICONS.close}</button></div>
        <form id="form-advance">
          <div class="modal-body">
            <div class="field"><label for="adv-worker">Worker</label>
              <select id="adv-worker" required>
                <option value="">Select worker&hellip;</option>
                ${activeWorkers.map((w) => `<option value="${w.id}">${esc(w.full_name)}</option>`).join('')}
              </select>
            </div>
            <div class="field-row c2">
              <div class="field"><label for="adv-amount">Amount (&#8369;)</label><input type="number" id="adv-amount" min="0" step="0.01" required></div>
              <div class="field"><label for="adv-date">Date</label><input type="date" id="adv-date" required value="${todayISO()}"></div>
            </div>
            <div class="field"><label for="adv-note">Note</label><textarea id="adv-note" maxlength="300"></textarea></div>
          </div>
          <div class="modal-foot"><button type="button" class="btn" data-close-modal>Cancel</button><button type="submit" class="btn primary">Log advance</button></div>
        </form>
      </div>
    </div>
  `);
  document.getElementById('form-advance').addEventListener('submit', async (e) => {
    e.preventDefault();
    const worker_id = document.getElementById('adv-worker').value;
    if (!worker_id) return toast('Select a worker.', 'error');
    const worker = workers.find((w) => String(w.id) === worker_id);
    try {
      await createAdvance({
        project_id: project.id,
        worker_id,
        manpower_id: worker?.manpower_id ?? null,
        amount: Number(document.getElementById('adv-amount').value),
        note: document.getElementById('adv-note').value.trim() || null,
        given_by: currentUserId(),
        given_at: new Date(document.getElementById('adv-date').value + 'T12:00:00').toISOString(),
      });
      toast('Advance logged.', 'ok');
      closeModal();
      await onSaved();
    } catch (err) {
      toast(err.message || 'Could not log advance.', 'error');
    }
  });
}

