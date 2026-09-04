// Company-wide manpower registry — Owner/Admin only. This is separate from
// "Team" (which is app login accounts) and separate from each project's own
// worker roster: this is the master list of laborers/tradesmen the company
// works with, kept once, so a Site Supervisor can pick an already-registered
// person into a project's roster instead of re-typing their details every time.
import { setPageTitle, setTopbarActions } from './shell.js';
import { esc, fmtMoney, toast, openModal, closeModal } from '../utils.js';
import { fetchManpower, createManpower, updateManpower } from '../data.js';
import { currentUserId } from '../state.js';
import { ICONS } from '../icons.js';
import { openSettleStartingBaleModal } from './bale.js';

// Remaining on a person's pre-registration ("starting") bale -- see the
// column comment on siteops.manpower.starting_bale for why this exists
// separately from siteops.advances.
function startingBaleRemaining(m) {
  return Math.max(0, (Number(m.starting_bale) || 0) - (Number(m.starting_bale_settled) || 0));
}

// Filter state, kept in module scope rather than re-fetched per keystroke --
// with 50+ people in the registry, typing into a filter shouldn't cost a
// network round trip each time. `allRows` is the last fetch from the
// server; every filter change just re-slices and re-renders that in-memory
// copy (`applyFiltersAndRender`). `loadAndPaint` (an actual re-fetch) only
// runs after something changes the underlying data -- register, edit,
// toggle active/inactive, or settle a starting bale.
let allRows = [];
let searchQuery = '';
let positionFilter = '';
let statusFilter = ''; // '' = all, 'active', 'inactive'

export async function renderManpower() {
  setPageTitle('People', 'Manpower');
  const content = document.getElementById('content');
  content.innerHTML = `<div class="loading-row">Loading…</div>`;

  await loadAndPaint();
}

async function loadAndPaint() {
  allRows = await fetchManpower();
  paintTopbar();
  applyFiltersAndRender();
}

function paintTopbar() {
  // Position options come from whatever's actually in the registry right
  // now, not a fixed list -- since Position is free-typed (see the same
  // caveat on the Overview tab's Total Salary by Position), two workers
  // typed as "Welder" and "welder" would show as two separate options here
  // too, rather than being combined.
  const positions = [...new Set(allRows.map((m) => (m.job_position || '').trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
  setTopbarActions(`
    <input type="text" class="filter-search" id="mp-search" placeholder="Search name, position, contact…" value="${esc(searchQuery)}">
    <select class="filter-select" id="mp-position-filter">
      <option value="">All positions</option>
      ${positions.map((p) => `<option value="${esc(p)}" ${p === positionFilter ? 'selected' : ''}>${esc(p)}</option>`).join('')}
    </select>
    <select class="filter-select" id="mp-status-filter">
      <option value="" ${statusFilter === '' ? 'selected' : ''}>All statuses</option>
      <option value="active" ${statusFilter === 'active' ? 'selected' : ''}>Active only</option>
      <option value="inactive" ${statusFilter === 'inactive' ? 'selected' : ''}>Inactive only</option>
    </select>
    <button class="btn primary" id="new-manpower-btn">${ICONS.plus}Register manpower</button>
  `);
  document.getElementById('new-manpower-btn').addEventListener('click', () => openManpowerModal());
  document.getElementById('mp-search').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    applyFiltersAndRender();
  });
  document.getElementById('mp-position-filter').addEventListener('change', (e) => {
    positionFilter = e.target.value;
    applyFiltersAndRender();
  });
  document.getElementById('mp-status-filter').addEventListener('change', (e) => {
    statusFilter = e.target.value;
    applyFiltersAndRender();
  });
}

function applyFiltersAndRender() {
  const content = document.getElementById('content');
  const q = searchQuery.trim().toLowerCase();
  const rows = allRows.filter((m) => {
    if (statusFilter === 'active' && m.active === false) return false;
    if (statusFilter === 'inactive' && m.active !== false) return false;
    if (positionFilter && (m.job_position || '').trim() !== positionFilter) return false;
    if (q) {
      const haystack = [m.full_name, m.job_position, m.contact_no, m.contact_person, m.address]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
  const filtersActive = q || positionFilter || statusFilter;

  if (allRows.length === 0) {
    content.innerHTML = `<div class="card empty">${ICONS.team}<div class="lead">No manpower registered yet</div>Register workers here so Site Supervisors can pick them into a project's roster by name &mdash; no re-typing position or rate per project.</div>`;
    return;
  }

  content.innerHTML = `
    <div class="hint" style="margin-bottom:10px;">
      Showing ${rows.length} of ${allRows.length}${filtersActive ? ` &mdash; <a href="#" id="mp-clear-filters">Clear filters</a>` : ''}
    </div>
    ${
      rows.length === 0
        ? `<div class="card empty">${ICONS.team}<div class="lead">No matches</div>Nobody in the registry matches this filter. <a href="#" id="mp-clear-filters-2">Clear filters</a> to see everyone.</div>`
        : `<div class="table-wrap card"><table><thead><tr>
            <th>Name</th><th>Address</th><th>Position</th><th>Rate</th><th>Contact no.</th><th>Contact person</th><th>Starting bale</th><th>Status</th><th></th>
          </tr></thead><tbody>
            ${rows
              .map((m) => {
                const remaining = startingBaleRemaining(m);
                return `<tr>
                  <td>${esc(m.full_name)}</td>
                  <td>${esc(m.address || '—')}</td>
                  <td>${esc(m.job_position || '—')}</td>
                  <td class="num">${m.daily_rate ? fmtMoney(m.daily_rate) : '—'}</td>
                  <td>${esc(m.contact_no || '—')}</td>
                  <td>${esc(m.contact_person || '—')}</td>
                  <td class="num">
                    ${
                      Number(m.starting_bale) > 0
                        ? `<b>${fmtMoney(remaining)}</b>${remaining > 0 ? ` of ${fmtMoney(m.starting_bale)}` : ' (settled)'}${
                            remaining > 0 ? `<br><button class="btn sm" data-settle-starting-bale="${m.id}">Settle</button>` : ''
                          }`
                        : '—'
                    }
                  </td>
                  <td><span class="pill ${m.active === false ? 'inactive' : 'approved'}">${m.active === false ? 'Inactive' : 'Active'}</span></td>
                  <td>
                    <div class="row-actions">
                      <button class="btn sm" data-edit-manpower="${m.id}">Edit</button>
                      <button class="btn sm" data-toggle-manpower="${m.id}" data-next="${m.active === false ? 'true' : 'false'}">${m.active === false ? 'Reactivate' : 'Deactivate'}</button>
                    </div>
                  </td>
                </tr>`;
              })
              .join('')}
          </tbody></table></div>`
    }
  `;

  const clearFilters = () => {
    searchQuery = '';
    positionFilter = '';
    statusFilter = '';
    paintTopbar();
    applyFiltersAndRender();
  };
  const clearBtn1 = document.getElementById('mp-clear-filters');
  if (clearBtn1) clearBtn1.addEventListener('click', (e) => { e.preventDefault(); clearFilters(); });
  const clearBtn2 = document.getElementById('mp-clear-filters-2');
  if (clearBtn2) clearBtn2.addEventListener('click', (e) => { e.preventDefault(); clearFilters(); });

  content.querySelectorAll('[data-edit-manpower]').forEach((btn) => {
    btn.addEventListener('click', () => openManpowerModal(allRows.find((m) => String(m.id) === btn.dataset.editManpower)));
  });
  content.querySelectorAll('[data-toggle-manpower]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await updateManpower(btn.dataset.toggleManpower, { active: btn.dataset.next === 'true' });
        toast(btn.dataset.next === 'true' ? 'Manpower reactivated.' : 'Manpower deactivated.', 'ok');
        await loadAndPaint();
      } catch (err) {
        toast(err.message || 'Could not update manpower.', 'error');
      }
    });
  });
  content.querySelectorAll('[data-settle-starting-bale]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = allRows.find((row) => String(row.id) === btn.dataset.settleStartingBale);
      if (!m) return;
      openSettleStartingBaleModal(m, () => loadAndPaint());
    });
  });
}

function openManpowerModal(entry) {
  const isEdit = !!entry;
  openModal(`
    <div class="modal-overlay" id="modal-manpower">
      <div class="modal">
        <div class="modal-head"><h2>${isEdit ? 'Edit manpower' : 'Register manpower'}</h2><button class="btn ghost" data-close-modal>${ICONS.close}</button></div>
        <form id="form-manpower">
          <div class="modal-body">
            <div class="field"><label for="mp-name">Full name</label><input type="text" id="mp-name" required maxlength="80" value="${esc(entry?.full_name || '')}" placeholder="e.g. Ramon Buenaventura"></div>
            <div class="field"><label for="mp-address">Address</label><input type="text" id="mp-address" maxlength="200" value="${esc(entry?.address || '')}"></div>
            <div class="field-row c2">
              <div class="field"><label for="mp-position">Position</label><input type="text" id="mp-position" maxlength="60" value="${esc(entry?.job_position || '')}" placeholder="e.g. Mason, Carpenter, Laborer"></div>
              <div class="field"><label for="mp-rate">Daily rate (&#8369;)</label><input type="number" id="mp-rate" min="0" step="1" value="${entry?.daily_rate ?? ''}"></div>
            </div>
            <div class="field-row c2">
              <div class="field"><label for="mp-contact-no">Contact no.</label><input type="text" id="mp-contact-no" maxlength="40" value="${esc(entry?.contact_no || '')}"></div>
              <div class="field"><label for="mp-contact-person">Contact person</label><input type="text" id="mp-contact-person" maxlength="80" value="${esc(entry?.contact_person || '')}" placeholder="In case of emergency"></div>
            </div>
            <div class="field">
              <label for="mp-starting-bale">Starting bale (&#8369;) &mdash; existing bale from before registering, if any</label>
              <input type="number" id="mp-starting-bale" min="0" step="0.01" value="${entry?.starting_bale ?? 0}">
              ${
                isEdit && Number(entry?.starting_bale_settled) > 0
                  ? `<div class="hint">${fmtMoney(entry.starting_bale_settled)} of this has already been settled &mdash; lowering the amount below that won't undo a settlement, it only corrects the original figure.</div>`
                  : `<div class="hint">Only for a worker who already owed bale before you registered them here (not yet deployed to a project, so it can't be logged as a project advance). Leave at 0 if none.</div>`
              }
            </div>
            ${isEdit ? `<div class="field"><label for="mp-active">Status</label><select id="mp-active"><option value="true" ${entry.active !== false ? 'selected' : ''}>Active</option><option value="false" ${entry.active === false ? 'selected' : ''}>Inactive</option></select></div>` : ''}
          </div>
          <div class="modal-foot"><button type="button" class="btn" data-close-modal>Cancel</button><button type="submit" class="btn primary">${isEdit ? 'Save changes' : 'Register'}</button></div>
        </form>
      </div>
    </div>
  `);
  document.getElementById('form-manpower').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fields = {
      full_name: document.getElementById('mp-name').value.trim(),
      address: document.getElementById('mp-address').value.trim() || null,
      job_position: document.getElementById('mp-position').value.trim() || null,
      daily_rate: document.getElementById('mp-rate').value === '' ? null : Number(document.getElementById('mp-rate').value),
      contact_no: document.getElementById('mp-contact-no').value.trim() || null,
      contact_person: document.getElementById('mp-contact-person').value.trim() || null,
      starting_bale: document.getElementById('mp-starting-bale').value === '' ? 0 : Number(document.getElementById('mp-starting-bale').value),
    };
    if (isEdit) fields.active = document.getElementById('mp-active').value === 'true';
    else fields.created_by = currentUserId();
    try {
      if (isEdit) await updateManpower(entry.id, fields);
      else await createManpower(fields);
      toast(isEdit ? 'Manpower updated.' : 'Manpower registered.', 'ok');
      closeModal();
      await loadAndPaint();
    } catch (err) {
      toast(err.message || 'Could not save manpower.', 'error');
    }
  });
}
