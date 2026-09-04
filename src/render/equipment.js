// Power tools & equipment inventory and tracking. Visible to everyone (Admin
// AND Site Supervisor/Engineer both need to see what's on hand and where it
// is), unlike Manpower/Team which are Owner/Admin-only pages. Three moving
// pieces:
//  1. `equipment` — the company-wide registry (Owner/Admin manage it; the
//     shop's own current_project_id/holder/condition only ever change via
//     the two flows below, never edited directly).
//  2. `equipment_requests` — a project asking for a specific tool out of
//     storage (or from wherever it currently sits); Owner/Admin approve or
//     reject, then whoever receives it on site confirms and notes the
//     condition it arrived in.
//  3. `equipment_transfers` — moving an already-deployed tool from one
//     project straight to another, no Admin approval needed (mirrors how
//     the app already lets already-allocated resources move freely): the
//     current holder's project starts it, the destination project accepts.
import { state, isApprover, currentUserId } from '../state.js';
import { setPageTitle, setTopbarActions } from './shell.js';
import { esc, fmtDate, fmtDateTime, pillClass, toast, openModal, closeModal } from '../utils.js';
import {
  fetchProjects,
  fetchTeamMembers,
  fetchEquipment,
  createEquipment,
  updateEquipment,
  fetchEquipmentRequests,
  createEquipmentRequest,
  decideEquipmentRequest,
  receiveEquipmentRequest,
  fetchEquipmentTransfers,
  createEquipmentTransfer,
  acceptEquipmentTransfer,
  cancelEquipmentTransfer,
  uploadEquipmentPhoto,
  getEquipmentPhotoSignedUrl,
  deleteEquipmentPhoto,
} from '../data.js';
import { ICONS } from '../icons.js';

const CONDITION_LABEL = { functional: 'Functional', for_repair: 'For repair', for_disposal: 'For disposal' };

let cache = { equipment: [], requests: [], transfers: [], photoUrls: new Map() };

// Resolves every equipment item's photo (if any) to a fresh signed URL, all
// at once — the registry is small enough that batch-resolving up front (vs.
// logs.js's lazy-per-row approach) keeps the table simple with no
// "Loading…" flicker per row.
async function resolvePhotoUrls(equipment) {
  const withPhotos = equipment.filter((e) => e.photo_path);
  const entries = await Promise.all(
    withPhotos.map(async (e) => [e.id, await getEquipmentPhotoSignedUrl(e.photo_path)])
  );
  return new Map(entries.filter(([, url]) => url));
}

function eqThumbHTML(eq, extraClass) {
  const url = cache.photoUrls.get(eq?.id);
  return url
    ? `<img class="eq-thumb${extraClass ? ' ' + extraClass : ''}" src="${url}" alt="${esc(eq.name)}">`
    : `<div class="eq-thumb-placeholder${extraClass ? ' ' + extraClass : ''}" title="No photo"></div>`;
}

export async function renderEquipment() {
  setPageTitle('Inventory', 'Power Tools & Equipment');
  const approver = isApprover();
  setTopbarActions(`
    ${approver ? `<button class="btn" id="new-equipment-btn">${ICONS.plus}Register equipment</button>` : ''}
    <button class="btn primary" id="request-equipment-btn">${ICONS.plus}Request equipment</button>
  `);
  const content = document.getElementById('content');
  content.innerHTML = `<div class="loading-row">Loading…</div>`;

  const [projects, members] = await Promise.all([fetchProjects(), fetchTeamMembers()]);
  state.projects = projects;
  state.teamMembers = members;

  await paintAll();

  document.getElementById('request-equipment-btn').addEventListener('click', () => openRequestModal());
  const regBtn = document.getElementById('new-equipment-btn');
  if (regBtn) regBtn.addEventListener('click', () => openEquipmentModal());
}

function projectName(id) {
  return state.projects.find((p) => String(p.id) === String(id))?.name || (id == null ? null : `#${id}`);
}
function memberName(id) {
  return state.teamMembers.find((m) => String(m.id) === String(id))?.full_name || '—';
}
function canAccess(projectId) {
  // The frontend never sees a project it isn't RLS-allowed to read, so
  // "is this project in my already-fetched list" is a reliable proxy for
  // "do I have access to it" (Owner/Admin's fetchProjects() returns every
  // project; a Site account's returns only their assigned ones).
  return projectId != null && state.projects.some((p) => String(p.id) === String(projectId));
}

async function paintAll() {
  const content = document.getElementById('content');
  const [equipment, requests, transfers] = await Promise.all([
    fetchEquipment(),
    fetchEquipmentRequests(),
    fetchEquipmentTransfers(),
  ]);
  const photoUrls = await resolvePhotoUrls(equipment);
  cache = { equipment, requests, transfers, photoUrls };
  const pendingTransfers = transfers.filter((t) => t.status === 'pending');

  content.innerHTML = `
    <div class="card" style="margin-bottom:18px;">
      <h3 style="margin:0 0 10px;">Inventory</h3>
      ${equipmentTableHTML(equipment, pendingTransfers)}
    </div>
    <div class="card" style="margin-bottom:18px;">
      <h3 style="margin:0 0 10px;">Requests</h3>
      ${requestsTableHTML(requests, equipment)}
    </div>
    <div class="card">
      <h3 style="margin:0 0 10px;">Transfers between projects</h3>
      ${transfersTableHTML(transfers, equipment)}
    </div>
  `;

  wireEquipmentTable(equipment, pendingTransfers);
  wireRequestsTable(requests, equipment);
  wireTransfersTable(transfers, equipment);
}

function equipmentTableHTML(equipment, pendingTransfers) {
  if (equipment.length === 0) {
    return `<div class="empty">${ICONS.empty}<div class="lead">No equipment registered yet</div>${isApprover() ? 'Use "Register equipment" above to add your first power tool or piece of equipment.' : 'Ask an Admin to register your power tools and equipment here.'}</div>`;
  }
  return `<div class="table-wrap"><table><thead><tr>
      <th>Name</th><th>Category / Tag</th><th>Condition</th><th>Deployed at</th><th>Held by</th><th></th>
    </tr></thead><tbody>
      ${equipment
        .map((eq) => {
          const pending = pendingTransfers.find((t) => String(t.equipment_id) === String(eq.id));
          const deployedLabel = eq.current_project_id == null ? 'In company storage' : esc(projectName(eq.current_project_id));
          const transferHint = pending
            ? `<div class="hint">Transfer pending &rarr; ${esc(projectName(pending.to_project_id))}</div>`
            : '';
          const canTransfer = !pending && eq.active !== false && canAccess(eq.current_project_id);
          return `<tr>
            <td><div class="eq-name-cell">${eqThumbHTML(eq)}<div>${esc(eq.name)}${eq.location_note ? `<div class="hint">${esc(eq.location_note)}</div>` : ''}${eq.active === false ? '<div class="hint">Inactive</div>' : ''}</div></div></td>
            <td>${esc(eq.category || '—')}${eq.asset_tag ? `<div class="hint">${esc(eq.asset_tag)}</div>` : ''}</td>
            <td><span class="pill ${pillClass(eq.condition)}">${CONDITION_LABEL[eq.condition] || eq.condition}</span></td>
            <td>${deployedLabel}${transferHint}</td>
            <td>${eq.current_holder_id ? esc(memberName(eq.current_holder_id)) : '—'}</td>
            <td>
              <div class="row-actions">
                ${canTransfer ? `<button class="btn sm" data-transfer="${eq.id}">${ICONS.swap}Transfer</button>` : ''}
                ${isApprover() ? `<button class="btn sm" data-edit-equipment="${eq.id}">Edit</button>` : ''}
              </div>
            </td>
          </tr>`;
        })
        .join('')}
    </tbody></table></div>`;
}

function requestsTableHTML(requests, equipment) {
  if (requests.length === 0) {
    return `<div class="empty">${ICONS.empty}<div class="lead">No equipment requests</div>Use "Request equipment" above to ask for a tool from a project.</div>`;
  }
  const eqName = (id) => equipment.find((e) => String(e.id) === String(id))?.name || `#${id}`;
  const approver = isApprover();
  return `<div class="table-wrap"><table><thead><tr>
      <th>Project</th><th>Equipment</th><th>Requested by</th><th>Status</th><th>Date</th><th></th>
    </tr></thead><tbody>
      ${requests
        .map(
          (r) => `<tr>
            <td>${esc(projectName(r.project_id))}</td>
            <td>${esc(eqName(r.equipment_id))}${r.notes ? `<div class="hint">${esc(r.notes)}</div>` : ''}</td>
            <td>${esc(memberName(r.requested_by))}</td>
            <td><span class="pill ${pillClass(r.status)}">${r.status}</span>${r.decision_comment ? `<div class="hint">${esc(r.decision_comment)}</div>` : ''}${r.status === 'received' && r.received_at ? `<div class="hint">Received by ${esc(memberName(r.received_by))} on ${fmtDate(r.received_at)} &mdash; ${esc(CONDITION_LABEL[r.received_condition] || r.received_condition || '')}</div>` : ''}</td>
            <td>${fmtDate(r.created_at)}</td>
            <td>
              ${approver && r.status === 'pending' ? `<button class="btn sm" data-decide-eq="${r.id}">Review</button>` : ''}
              ${r.status === 'approved' ? `<button class="btn sm good" data-receive-eq="${r.id}">${ICONS.check}Received</button>` : ''}
            </td>
          </tr>`
        )
        .join('')}
    </tbody></table></div>`;
}

function transfersTableHTML(transfers, equipment) {
  if (transfers.length === 0) {
    return `<div class="empty">${ICONS.empty}<div class="lead">No transfers yet</div>Use "Transfer" on an item in Inventory above to move it straight to another project.</div>`;
  }
  const eqName = (id) => equipment.find((e) => String(e.id) === String(id))?.name || `#${id}`;
  return `<div class="table-wrap"><table><thead><tr>
      <th>Equipment</th><th>From</th><th>To</th><th>Initiated by</th><th>Status</th><th></th>
    </tr></thead><tbody>
      ${transfers
        .map((t) => {
          const canAccept = t.status === 'pending' && canAccess(t.to_project_id);
          const canCancel = t.status === 'pending' && (isApprover() || String(t.initiated_by) === String(currentUserId()));
          return `<tr>
            <td>${esc(eqName(t.equipment_id))}${t.note ? `<div class="hint">${esc(t.note)}</div>` : ''}</td>
            <td>${esc(projectName(t.from_project_id))}</td>
            <td>${esc(projectName(t.to_project_id))}</td>
            <td>${esc(memberName(t.initiated_by))}<div class="hint">${fmtDateTime(t.initiated_at)}</div></td>
            <td><span class="pill ${pillClass(t.status)}">${t.status}</span>${t.status === 'accepted' && t.accepted_at ? `<div class="hint">By ${esc(memberName(t.accepted_by))} on ${fmtDate(t.accepted_at)}</div>` : ''}</td>
            <td>
              <div class="row-actions">
                ${canAccept ? `<button class="btn sm good" data-accept-transfer="${t.id}">${ICONS.check}Accept</button>` : ''}
                ${canCancel ? `<button class="btn sm bad" data-cancel-transfer="${t.id}">Cancel</button>` : ''}
              </div>
            </td>
          </tr>`;
        })
        .join('')}
    </tbody></table></div>`;
}

function wireEquipmentTable(equipment, pendingTransfers) {
  document.querySelectorAll('[data-edit-equipment]').forEach((btn) => {
    btn.addEventListener('click', () => openEquipmentModal(equipment.find((e) => String(e.id) === btn.dataset.editEquipment)));
  });
  document.querySelectorAll('[data-transfer]').forEach((btn) => {
    btn.addEventListener('click', () => openTransferModal(equipment.find((e) => String(e.id) === btn.dataset.transfer)));
  });
}

function wireRequestsTable(requests, equipment) {
  document.querySelectorAll('[data-decide-eq]').forEach((btn) => {
    btn.addEventListener('click', () => openDecisionModal(requests.find((r) => String(r.id) === btn.dataset.decideEq), equipment));
  });
  document.querySelectorAll('[data-receive-eq]').forEach((btn) => {
    btn.addEventListener('click', () => openReceiveModal(requests.find((r) => String(r.id) === btn.dataset.receiveEq), equipment));
  });
}

function wireTransfersTable(transfers) {
  document.querySelectorAll('[data-accept-transfer]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await acceptEquipmentTransfer(btn.dataset.acceptTransfer, currentUserId());
        toast('Transfer accepted — equipment moved to your project.', 'ok');
        await paintAll();
      } catch (err) {
        toast(err.message || 'Could not accept transfer.', 'error');
        btn.disabled = false;
      }
    });
  });
  document.querySelectorAll('[data-cancel-transfer]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Cancel this transfer?')) return;
      btn.disabled = true;
      try {
        await cancelEquipmentTransfer(btn.dataset.cancelTransfer);
        toast('Transfer cancelled.', 'ok');
        await paintAll();
      } catch (err) {
        toast(err.message || 'Could not cancel transfer.', 'error');
        btn.disabled = false;
      }
    });
  });
}

/* ---------------- Register / edit equipment (Owner/Admin) ---------------- */
function openEquipmentModal(entry) {
  const isEdit = !!entry;
  openModal(`
    <div class="modal-overlay" id="modal-equipment">
      <div class="modal">
        <div class="modal-head"><h2>${isEdit ? 'Edit equipment' : 'Register equipment'}</h2><button class="btn ghost" data-close-modal>${ICONS.close}</button></div>
        <form id="form-equipment">
          <div class="modal-body">
            <div class="field"><label for="eq-name">Name</label><input type="text" id="eq-name" required maxlength="100" value="${esc(entry?.name || '')}" placeholder="e.g. Bosch Angle Grinder"></div>
            <div class="field-row c2">
              <div class="field"><label for="eq-category">Category</label><input type="text" id="eq-category" maxlength="60" value="${esc(entry?.category || '')}" placeholder="Power Tool, Heavy Equipment, Hand Tool…"></div>
              <div class="field"><label for="eq-tag">Asset tag / serial no.</label><input type="text" id="eq-tag" maxlength="60" value="${esc(entry?.asset_tag || '')}"></div>
            </div>
            <div class="field-row c2">
              <div class="field"><label for="eq-condition">Condition</label>
                <select id="eq-condition">
                  ${Object.entries(CONDITION_LABEL).map(([v, l]) => `<option value="${v}" ${(entry?.condition || 'functional') === v ? 'selected' : ''}>${l}</option>`).join('')}
                </select>
              </div>
              <div class="field"><label for="eq-location">Location note</label><input type="text" id="eq-location" maxlength="120" value="${esc(entry?.location_note || '')}" placeholder="e.g. Warehouse — shelf 3"></div>
            </div>
            <div class="field"><label for="eq-notes">Notes</label><textarea id="eq-notes" maxlength="300">${esc(entry?.notes || '')}</textarea></div>
            <div class="field">
              <label for="eq-photo">Photo${isEdit && entry.photo_path ? ' (choose a file to replace it)' : ' (optional — helps everyone identify it)'}</label>
              ${isEdit && entry.photo_path ? `<div>${eqThumbHTML(entry, 'eq-photo-preview')}</div>` : ''}
              <input type="file" id="eq-photo" accept="image/*">
              ${isEdit && entry.photo_path ? `<label style="display:flex; align-items:center; gap:6px; margin-top:6px; font-size:13px;"><input type="checkbox" id="eq-photo-remove"> Remove photo</label>` : ''}
            </div>
            ${isEdit ? `<div class="field"><label for="eq-active">Status</label><select id="eq-active"><option value="true" ${entry.active !== false ? 'selected' : ''}>Active</option><option value="false" ${entry.active === false ? 'selected' : ''}>Inactive</option></select></div>` : ''}
            ${isEdit ? `<div class="hint">Deployment (currently ${entry.current_project_id ? esc(projectName(entry.current_project_id)) : 'in company storage'}) is changed through Requests/Transfers below, not here.</div>` : ''}
          </div>
          <div class="modal-foot"><button type="button" class="btn" data-close-modal>Cancel</button><button type="submit" class="btn primary" id="eq-submit-btn">${isEdit ? 'Save changes' : 'Register'}</button></div>
        </form>
      </div>
    </div>
  `);
  document.getElementById('form-equipment').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fields = {
      name: document.getElementById('eq-name').value.trim(),
      category: document.getElementById('eq-category').value.trim() || null,
      asset_tag: document.getElementById('eq-tag').value.trim() || null,
      condition: document.getElementById('eq-condition').value,
      location_note: document.getElementById('eq-location').value.trim() || null,
      notes: document.getElementById('eq-notes').value.trim() || null,
    };
    if (isEdit) fields.active = document.getElementById('eq-active').value === 'true';
    else fields.created_by = currentUserId();

    const photoFile = document.getElementById('eq-photo').files?.[0] || null;
    const removeCheckbox = document.getElementById('eq-photo-remove');
    const removePhoto = removeCheckbox ? removeCheckbox.checked : false;
    const oldPhotoPath = entry?.photo_path || null;

    const submitBtn = document.getElementById('eq-submit-btn');
    submitBtn.disabled = true;
    try {
      if (photoFile) {
        fields.photo_path = await uploadEquipmentPhoto(photoFile);
      } else if (removePhoto) {
        fields.photo_path = null;
      }
      if (isEdit) await updateEquipment(entry.id, fields);
      else await createEquipment(fields);
      // Clean up the old file only after the DB row no longer references it.
      if ((photoFile || removePhoto) && oldPhotoPath) await deleteEquipmentPhoto(oldPhotoPath);
      toast(isEdit ? 'Equipment updated.' : 'Equipment registered.', 'ok');
      closeModal();
      await paintAll();
    } catch (err) {
      toast(err.message || 'Could not save equipment.', 'error');
      submitBtn.disabled = false;
    }
  });
}

/* ---------------- Request equipment ---------------- */
function openRequestModal(defaultProjectId) {
  const projects = state.projects;
  const activeEquipment = cache.equipment.filter((e) => e.active !== false);
  openModal(`
    <div class="modal-overlay" id="modal-eq-request">
      <div class="modal">
        <div class="modal-head"><h2>Request equipment</h2><button class="btn ghost" data-close-modal>${ICONS.close}</button></div>
        <form id="form-eq-request">
          <div class="modal-body">
            <div class="field"><label for="eqr-project">Project</label>
              <select id="eqr-project" required>
                <option value="">Select project&hellip;</option>
                ${projects.map((p) => `<option value="${p.id}" ${String(p.id) === String(defaultProjectId) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
              </select>
            </div>
            <div class="field"><label for="eqr-equipment">Equipment</label>
              <select id="eqr-equipment" required>
                <option value="">Select equipment&hellip;</option>
                ${activeEquipment
                  .map((eq) => {
                    const where = eq.current_project_id == null ? 'in company storage' : `at ${projectName(eq.current_project_id)}`;
                    return `<option value="${eq.id}">${esc(eq.name)}${eq.asset_tag ? ` (${esc(eq.asset_tag)})` : ''} — ${esc(where)}</option>`;
                  })
                  .join('')}
              </select>
              ${activeEquipment.length === 0 ? '<div class="hint">No equipment registered yet — ask an Admin to register it first.</div>' : ''}
              <div id="eqr-preview"></div>
            </div>
            <div class="field"><label for="eqr-notes">Notes</label><textarea id="eqr-notes" maxlength="300" placeholder="What it's for, when it's needed, etc."></textarea></div>
          </div>
          <div class="modal-foot"><button type="button" class="btn" data-close-modal>Cancel</button><button type="submit" class="btn primary">Submit request</button></div>
        </form>
      </div>
    </div>
  `);
  const updatePreview = () => {
    const eq = activeEquipment.find((e) => String(e.id) === document.getElementById('eqr-equipment').value);
    document.getElementById('eqr-preview').innerHTML = eq ? eqThumbHTML(eq, 'eq-photo-preview') : '';
  };
  document.getElementById('eqr-equipment').addEventListener('change', updatePreview);
  updatePreview();
  document.getElementById('form-eq-request').addEventListener('submit', async (e) => {
    e.preventDefault();
    const project_id = document.getElementById('eqr-project').value;
    const equipment_id = document.getElementById('eqr-equipment').value;
    const notes = document.getElementById('eqr-notes').value.trim() || null;
    if (!project_id) return toast('Select a project.', 'error');
    if (!equipment_id) return toast('Select a piece of equipment.', 'error');
    try {
      await createEquipmentRequest({ project_id, equipment_id, requested_by: currentUserId(), notes });
      toast('Equipment request submitted.', 'ok');
      closeModal();
      await paintAll();
    } catch (err) {
      toast(err.message || 'Could not submit request.', 'error');
    }
  });
}

/* ---------------- Review (approve/reject) ---------------- */
function openDecisionModal(req, equipmentList) {
  if (!req) return;
  const eq = equipmentList.find((e) => String(e.id) === String(req.equipment_id));
  const deployedLabel = eq
    ? eq.current_project_id == null
      ? 'In company storage'
      : `Currently at ${esc(projectName(eq.current_project_id))}`
    : '';
  openModal(`
    <div class="modal-overlay" id="modal-eq-decision">
      <div class="modal">
        <div class="modal-head"><h2>Review equipment request</h2><button class="btn ghost" data-close-modal>${ICONS.close}</button></div>
        <div class="modal-body">
          <div class="info-panel" style="margin-bottom:14px; display:flex; gap:14px; align-items:flex-start;">
            ${eq ? eqThumbHTML(eq, 'eq-photo-preview') : ''}
            <div>
            <h3>${esc(eq?.name || `#${req.equipment_id}`)}</h3>
            ${eq ? `<div>Condition: <span class="pill ${pillClass(eq.condition)}">${CONDITION_LABEL[eq.condition] || eq.condition}</span></div>` : ''}
            <div>${deployedLabel}</div>
            <div>Requested for: <b>${esc(projectName(req.project_id))}</b></div>
            <div>Requested by: <b>${esc(memberName(req.requested_by))}</b> on ${fmtDateTime(req.created_at)}</div>
            ${req.notes ? `<div>Notes: ${esc(req.notes)}</div>` : ''}
            </div>
          </div>
          <div class="field"><label for="eqd-comment">Comment (optional)</label><textarea id="eqd-comment" maxlength="300"></textarea></div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" data-close-modal>Cancel</button>
          <button type="button" class="btn bad" id="eqd-reject">Reject</button>
          <button type="button" class="btn good" id="eqd-approve">Approve</button>
        </div>
      </div>
    </div>
  `);
  const decide = async (status) => {
    const decision_comment = document.getElementById('eqd-comment').value.trim() || null;
    try {
      await decideEquipmentRequest(req.id, {
        status,
        decided_by: currentUserId(),
        decided_at: new Date().toISOString(),
        decision_comment,
      });
      toast(`Request ${status}.`, 'ok');
      closeModal();
      await paintAll();
    } catch (err) {
      toast(err.message || 'Could not save decision.', 'error');
    }
  };
  document.getElementById('eqd-approve').addEventListener('click', () => decide('approved'));
  document.getElementById('eqd-reject').addEventListener('click', () => decide('rejected'));
}

/* ---------------- Receive (with condition) ---------------- */
function openReceiveModal(req, equipmentList) {
  if (!req) return;
  const eq = equipmentList.find((e) => String(e.id) === String(req.equipment_id));
  openModal(`
    <div class="modal-overlay" id="modal-eq-receive">
      <div class="modal">
        <div class="modal-head"><h2>Confirm equipment received</h2><button class="btn ghost" data-close-modal>${ICONS.close}</button></div>
        <div class="modal-body">
          <div class="info-panel" style="margin-bottom:14px; display:flex; gap:14px; align-items:flex-start;">
            ${eq ? eqThumbHTML(eq, 'eq-photo-preview') : ''}
            <div>
              <h3>${esc(eq?.name || `#${req.equipment_id}`)}</h3>
              <div>For: <b>${esc(projectName(req.project_id))}</b></div>
            </div>
          </div>
          <div class="field"><label for="eqrv-condition">Condition on arrival</label>
            <select id="eqrv-condition">
              ${Object.entries(CONDITION_LABEL).map(([v, l]) => `<option value="${v}" ${(eq?.condition || 'functional') === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" data-close-modal>Cancel</button>
          <button type="button" class="btn good" id="eqrv-confirm">${ICONS.check}Confirm received</button>
        </div>
      </div>
    </div>
  `);
  document.getElementById('eqrv-confirm').addEventListener('click', async () => {
    const condition = document.getElementById('eqrv-condition').value;
    try {
      await receiveEquipmentRequest(req.id, currentUserId(), condition);
      toast('Marked as received.', 'ok');
      closeModal();
      await paintAll();
    } catch (err) {
      toast(err.message || 'Could not confirm receipt.', 'error');
    }
  });
}

/* ---------------- Transfer to another project ---------------- */
function openTransferModal(eq) {
  if (!eq) return;
  const destinations = state.projects.filter((p) => String(p.id) !== String(eq.current_project_id));
  openModal(`
    <div class="modal-overlay" id="modal-eq-transfer">
      <div class="modal">
        <div class="modal-head"><h2>Transfer equipment</h2><button class="btn ghost" data-close-modal>${ICONS.close}</button></div>
        <form id="form-eq-transfer">
          <div class="modal-body">
            <div class="info-panel" style="margin-bottom:14px; display:flex; gap:14px; align-items:flex-start;">
              ${eqThumbHTML(eq, 'eq-photo-preview')}
              <div>
                <h3>${esc(eq.name)}</h3>
                <div>Currently at: <b>${esc(projectName(eq.current_project_id))}</b></div>
              </div>
            </div>
            <div class="field"><label for="eqt-to">Send to project</label>
              <select id="eqt-to" required>
                <option value="">Select destination project&hellip;</option>
                ${destinations.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
              </select>
              ${destinations.length === 0 ? '<div class="hint">No other projects available to transfer to.</div>' : ''}
            </div>
            <div class="field"><label for="eqt-note">Note (optional)</label><textarea id="eqt-note" maxlength="300" placeholder="Reason for the transfer, condition when it left, etc."></textarea></div>
            <div class="hint">The destination project's own team will need to confirm they've received it before it shows as transferred.</div>
          </div>
          <div class="modal-foot"><button type="button" class="btn" data-close-modal>Cancel</button><button type="submit" class="btn primary">${ICONS.swap}Start transfer</button></div>
        </form>
      </div>
    </div>
  `);
  document.getElementById('form-eq-transfer').addEventListener('submit', async (e) => {
    e.preventDefault();
    const to_project_id = document.getElementById('eqt-to').value;
    const note = document.getElementById('eqt-note').value.trim() || null;
    if (!to_project_id) return toast('Select a destination project.', 'error');
    try {
      await createEquipmentTransfer({
        equipment_id: eq.id,
        from_project_id: eq.current_project_id,
        to_project_id,
        initiated_by: currentUserId(),
        note,
      });
      toast('Transfer started — waiting for the destination project to confirm receipt.', 'ok');
      closeModal();
      await paintAll();
    } catch (err) {
      toast(err.message || 'Could not start transfer.', 'error');
    }
  });
}
