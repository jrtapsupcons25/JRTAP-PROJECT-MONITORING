import { state, isApprover, currentUserId } from '../state.js';
import { setPageTitle, setTopbarActions } from './shell.js';
import { esc, fmtDate, fmtDateTime, fmtMoney, pillClass, toast, openModal, closeModal, wireRepeater, readRepeaterRows } from '../utils.js';
import {
  fetchProjects,
  fetchMaterialRequests,
  createMaterialRequest,
  decideMaterialRequest,
  receiveMaterialRequest,
  fetchTeamMembers,
} from '../data.js';
import { ICONS } from '../icons.js';

let selectedProjectId = '';

export async function renderMaterials() {
  setPageTitle('Requests & approvals', 'Material Requests');
  const content = document.getElementById('content');
  content.innerHTML = `<div class="loading-row">Loading…</div>`;

  const [projects, members] = await Promise.all([fetchProjects(), fetchTeamMembers()]);
  state.projects = projects;
  state.teamMembers = members;

  setTopbarActions(`
    <select class="filter-select" id="materials-project-filter">
      <option value="">All projects</option>
      ${projects.map((p) => `<option value="${p.id}" ${String(p.id) === String(selectedProjectId) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
    </select>
    <button class="btn primary" id="new-material-btn">${ICONS.plus}New request</button>
  `);

  await paintList();

  document.getElementById('materials-project-filter').addEventListener('change', async (e) => {
    selectedProjectId = e.target.value;
    await paintList();
  });
  document.getElementById('new-material-btn').addEventListener('click', () => openMaterialModal());
}

async function paintList() {
  const content = document.getElementById('content');
  const requests = await fetchMaterialRequests(selectedProjectId ? { projectId: selectedProjectId } : {});
  const approver = isApprover();
  const projectName = (id) => state.projects.find((p) => p.id === id)?.name || `#${id}`;
  const memberName = (id) => state.teamMembers.find((m) => m.id === id)?.full_name || '—';

  content.innerHTML = requests.length === 0
    ? `<div class="card empty">${ICONS.empty}<div class="lead">No material requests</div>Submit one with "New request" above.</div>`
    : `<div class="table-wrap card"><table><thead><tr>
        <th>Project</th><th>Item</th><th>Qty</th><th>Cost</th><th>Requested by</th><th>Status</th><th>Date</th><th></th>
      </tr></thead><tbody>
        ${requests
          .map(
            (r) => `<tr>
              <td>${esc(projectName(r.project_id))}</td>
              <td>${esc(r.item_name)}${r.notes ? `<div class="hint">${esc(r.notes)}</div>` : ''}</td>
              <td class="num">${esc(r.quantity ?? '—')} ${esc(r.unit || '')}</td>
              <td class="num">${r.unit_cost != null ? `${fmtMoney(r.unit_cost)}<div class="hint">Total: ${fmtMoney((Number(r.quantity) || 0) * Number(r.unit_cost))}</div>` : '—'}</td>
              <td>${esc(memberName(r.requested_by))}</td>
              <td><span class="pill ${pillClass(r.status)}">${r.status}</span>${r.decision_comment ? `<div class="hint">${esc(r.decision_comment)}</div>` : ''}${r.status === 'received' && r.received_at ? `<div class="hint">Received by ${esc(memberName(r.received_by))} on ${fmtDate(r.received_at)}</div>` : ''}</td>
              <td>${fmtDate(r.created_at)}</td>
              <td>
                ${approver && r.status === 'pending' ? `<button class="btn sm" data-decide="${r.id}">Review</button>` : ''}
                ${r.status === 'approved' ? `<button class="btn sm good" data-receive="${r.id}">${ICONS.check}Received</button>` : ''}
              </td>
            </tr>`
          )
          .join('')}
      </tbody></table></div>`;

  content.querySelectorAll('[data-decide]').forEach((btn) => {
    btn.addEventListener('click', () => openDecisionModal(requests.find((r) => String(r.id) === btn.dataset.decide)));
  });
  content.querySelectorAll('[data-receive]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const req = requests.find((r) => String(r.id) === btn.dataset.receive);
      if (!req) return;
      if (!confirm(`Confirm that ${req.quantity ?? ''} ${req.unit || ''} of "${req.item_name}" was received?`)) return;
      btn.disabled = true;
      try {
        await receiveMaterialRequest(req.id, currentUserId());
        toast('Marked as received.', 'ok');
        await paintList();
      } catch (err) {
        toast(err.message || 'Could not confirm receipt.', 'error');
        btn.disabled = false;
      }
    });
  });
}

export function openMaterialModal(defaultProjectId, onSaved) {
  const projects = state.projects;
  openModal(`
    <div class="modal-overlay" id="modal-material">
      <div class="modal wide">
        <div class="modal-head"><h2>New material request</h2><button class="btn ghost" data-close-modal>${ICONS.close}</button></div>
        <form id="form-material">
          <div class="modal-body">
            <div class="field"><label for="m-project">Project</label>
              <select id="m-project" required>
                <option value="">Select project&hellip;</option>
                ${projects.map((p) => `<option value="${p.id}" ${String(p.id) === String(defaultProjectId) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>Items needed</label>
              <div class="rep-block"><div id="m-items"></div>
                <button type="button" class="btn sm ghost" id="m-items-add" style="margin-top:6px;">+ Add item</button>
              </div>
            </div>
            <div class="field"><label for="m-notes">Notes</label><textarea id="m-notes" maxlength="500" placeholder="Supplier preference, delivery instructions, etc."></textarea></div>
          </div>
          <div class="modal-foot"><button type="button" class="btn" data-close-modal>Cancel</button><button type="submit" class="btn primary">Submit request</button></div>
        </form>
      </div>
    </div>
  `);
  const itemsContainer = document.getElementById('m-items');
  wireRepeater(itemsContainer, document.getElementById('m-items-add'), 1);

  document.getElementById('form-material').addEventListener('submit', async (e) => {
    e.preventDefault();
    const project_id = document.getElementById('m-project').value;
    const notes = document.getElementById('m-notes').value.trim() || null;
    const items = readRepeaterRows(itemsContainer);
    if (!project_id) return toast('Select a project.', 'error');
    if (items.length === 0) return toast('Add at least one item.', 'error');
    const uid = currentUserId();
    const payload = items.map((it) => ({
      project_id,
      requested_by: uid,
      item_name: it.item_name,
      quantity: it.quantity,
      unit: it.unit,
      notes,
    }));
    try {
      for (const row of payload) await createMaterialRequest(row);
      toast('Material request submitted.', 'ok');
      closeModal();
      await (onSaved || paintList)();
    } catch (err) {
      toast(err.message || 'Could not submit request.', 'error');
    }
  });
}

function openDecisionModal(req) {
  if (!req) return;
  const projectName = state.projects.find((p) => p.id === req.project_id)?.name || `#${req.project_id}`;
  const memberName = state.teamMembers.find((m) => m.id === req.requested_by)?.full_name || '—';
  openModal(`
    <div class="modal-overlay" id="modal-decision">
      <div class="modal">
        <div class="modal-head"><h2>Review material request</h2><button class="btn ghost" data-close-modal>${ICONS.close}</button></div>
        <div class="modal-body">
          <div class="info-panel" style="margin-bottom:14px;">
            <h3>${esc(req.item_name)}</h3>
            <div>Qty: <b>${esc(req.quantity ?? '—')} ${esc(req.unit || '')}</b></div>
            <div>Project: <b>${esc(projectName)}</b></div>
            <div>Requested by: <b>${esc(memberName)}</b> on ${fmtDateTime(req.created_at)}</div>
            ${req.notes ? `<div>Notes: ${esc(req.notes)}</div>` : ''}
          </div>
          <div class="field"><label for="decision-unit-cost">Unit cost (&#8369;, optional)</label><input type="number" id="decision-unit-cost" min="0" step="0.01" value="${req.unit_cost ?? ''}" placeholder="Price agreed with supplier"></div>
          <div class="field"><label for="decision-comment">Comment (optional)</label><textarea id="decision-comment" maxlength="300"></textarea></div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" data-close-modal>Cancel</button>
          <button type="button" class="btn bad" id="decision-reject">Reject</button>
          <button type="button" class="btn good" id="decision-approve">Approve</button>
        </div>
      </div>
    </div>
  `);
  const decide = async (status) => {
    const decision_comment = document.getElementById('decision-comment').value.trim() || null;
    const unitCostRaw = document.getElementById('decision-unit-cost').value;
    const unit_cost = unitCostRaw === '' ? null : Number(unitCostRaw);
    try {
      await decideMaterialRequest(req.id, {
        status,
        decided_by: currentUserId(),
        decided_at: new Date().toISOString(),
        decision_comment,
        unit_cost,
      });
      toast(`Request ${status}.`, 'ok');
      closeModal();
      await paintList();
    } catch (err) {
      toast(err.message || 'Could not save decision.', 'error');
    }
  };
  document.getElementById('decision-approve').addEventListener('click', () => decide('approved'));
  document.getElementById('decision-reject').addEventListener('click', () => decide('rejected'));
}
