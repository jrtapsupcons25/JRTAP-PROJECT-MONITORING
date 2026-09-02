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

export async function renderManpower() {
  setPageTitle('People', 'Manpower');
  setTopbarActions(`<button class="btn primary" id="new-manpower-btn">${ICONS.plus}Register manpower</button>`);
  const content = document.getElementById('content');
  content.innerHTML = `<div class="loading-row">Loading…</div>`;

  await paintList();

  document.getElementById('new-manpower-btn').addEventListener('click', () => openManpowerModal());
}

async function paintList() {
  const content = document.getElementById('content');
  const rows = await fetchManpower();

  content.innerHTML = rows.length === 0
    ? `<div class="card empty">${ICONS.team}<div class="lead">No manpower registered yet</div>Register workers here so Site Supervisors can pick them into a project's roster by name &mdash; no re-typing position or rate per project.</div>`
    : `<div class="table-wrap card"><table><thead><tr>
        <th>Name</th><th>Address</th><th>Position</th><th>Rate</th><th>Contact no.</th><th>Contact person</th><th>Status</th><th></th>
      </tr></thead><tbody>
        ${rows
          .map(
            (m) => `<tr>
              <td>${esc(m.full_name)}</td>
              <td>${esc(m.address || '—')}</td>
              <td>${esc(m.job_position || '—')}</td>
              <td class="num">${m.daily_rate ? fmtMoney(m.daily_rate) : '—'}</td>
              <td>${esc(m.contact_no || '—')}</td>
              <td>${esc(m.contact_person || '—')}</td>
              <td><span class="pill ${m.active === false ? 'inactive' : 'approved'}">${m.active === false ? 'Inactive' : 'Active'}</span></td>
              <td>
                <div class="row-actions">
                  <button class="btn sm" data-edit-manpower="${m.id}">Edit</button>
                  <button class="btn sm" data-toggle-manpower="${m.id}" data-next="${m.active === false ? 'true' : 'false'}">${m.active === false ? 'Reactivate' : 'Deactivate'}</button>
                </div>
              </td>
            </tr>`
          )
          .join('')}
      </tbody></table></div>`;

  content.querySelectorAll('[data-edit-manpower]').forEach((btn) => {
    btn.addEventListener('click', () => openManpowerModal(rows.find((m) => String(m.id) === btn.dataset.editManpower)));
  });
  content.querySelectorAll('[data-toggle-manpower]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await updateManpower(btn.dataset.toggleManpower, { active: btn.dataset.next === 'true' });
        toast(btn.dataset.next === 'true' ? 'Manpower reactivated.' : 'Manpower deactivated.', 'ok');
        await paintList();
      } catch (err) {
        toast(err.message || 'Could not update manpower.', 'error');
      }
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
    };
    if (isEdit) fields.active = document.getElementById('mp-active').value === 'true';
    else fields.created_by = currentUserId();
    try {
      if (isEdit) await updateManpower(entry.id, fields);
      else await createManpower(fields);
      toast(isEdit ? 'Manpower updated.' : 'Manpower registered.', 'ok');
      closeModal();
      await paintList();
    } catch (err) {
      toast(err.message || 'Could not save manpower.', 'error');
    }
  });
}
