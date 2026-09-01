import { state, isApprover, currentUserId } from '../state.js';
import { setPageTitle, setTopbarActions } from './shell.js';
import { esc, fmtDate, fmtDateTime, fmtMoney, pillClass, toast, openModal, closeModal } from '../utils.js';
import { fetchProjects, fetchPettyCashRequests, createPettyCashRequest, decidePettyCashRequest, fetchTeamMembers } from '../data.js';
import { ICONS } from '../icons.js';

let selectedProjectId = '';

export async function renderPettyCash() {
  setPageTitle('Requests & approvals', 'Petty Cash');
  const content = document.getElementById('content');
  content.innerHTML = `<div class="loading-row">Loading…</div>`;

  const [projects, members] = await Promise.all([fetchProjects(), fetchTeamMembers()]);
  state.projects = projects;
  state.teamMembers = members;

  setTopbarActions(`
    <select class="filter-select" id="pettycash-project-filter">
      <option value="">All projects</option>
      ${projects.map((p) => `<option value="${p.id}" ${String(p.id) === String(selectedProjectId) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
    </select>
    <button class="btn primary" id="new-pettycash-btn">${ICONS.plus}New request</button>
  `);

  await paintList();

  document.getElementById('pettycash-project-filter').addEventListener('change', async (e) => {
    selectedProjectId = e.target.value;
    await paintList();
  });
  document.getElementById('new-pettycash-btn').addEventListener('click', () => openPettyCashModal());
}

async function paintList() {
  const content = document.getElementById('content');
  const requests = await fetchPettyCashRequests(selectedProjectId ? { projectId: selectedProjectId } : {});
  const approver = isApprover();
  const projectName = (id) => state.projects.find((p) => p.id === id)?.name || `#${id}`;
  const memberName = (id) => state.teamMembers.find((m) => m.id === id)?.full_name || '—';

  content.innerHTML = requests.length === 0
    ? `<div class="card empty">${ICONS.empty}<div class="lead">No petty cash requests</div>Submit one with "New request" above.</div>`
    : `<div class="table-wrap card"><table><thead><tr>
        <th>Project</th><th>Purpose</th><th>Amount</th><th>Requested by</th><th>Status</th><th>Date</th><th></th>
      </tr></thead><tbody>
        ${requests
          .map(
            (r) => `<tr>
              <td>${esc(projectName(r.project_id))}</td>
              <td>${esc(r.purpose)}${r.notes ? `<div class="hint">${esc(r.notes)}</div>` : ''}</td>
              <td class="num">${fmtMoney(r.amount)}</td>
              <td>${esc(memberName(r.requested_by))}</td>
              <td><span class="pill ${pillClass(r.status)}">${r.status}</span>${r.decision_comment ? `<div class="hint">${esc(r.decision_comment)}</div>` : ''}</td>
              <td>${fmtDate(r.created_at)}</td>
              <td>${approver && r.status === 'pending' ? `<button class="btn sm" data-decide="${r.id}">Review</button>` : ''}</td>
            </tr>`
          )
          .join('')}
      </tbody></table></div>`;

  content.querySelectorAll('[data-decide]').forEach((btn) => {
    btn.addEventListener('click', () => openDecisionModal(requests.find((r) => String(r.id) === btn.dataset.decide)));
  });
}

export function openPettyCashModal(defaultProjectId, onSaved) {
  const projects = state.projects;
  openModal(`
    <div class="modal-overlay" id="modal-pettycash">
      <div class="modal">
        <div class="modal-head"><h2>New petty cash request</h2><button class="btn ghost" data-close-modal>${ICONS.close}</button></div>
        <form id="form-pettycash">
          <div class="modal-body">
            <div class="field"><label for="pc-project">Project</label>
              <select id="pc-project" required>
                <option value="">Select project&hellip;</option>
                ${projects.map((p) => `<option value="${p.id}" ${String(p.id) === String(defaultProjectId) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
              </select>
            </div>
            <div class="field"><label for="pc-amount">Amount (&#8369;)</label><input type="number" id="pc-amount" min="0" step="0.01" required></div>
            <div class="field"><label for="pc-purpose">Purpose</label><input type="text" id="pc-purpose" required maxlength="150" placeholder="e.g. Fuel for backhoe, misc. hardware"></div>
            <div class="field"><label for="pc-notes">Notes</label><textarea id="pc-notes" maxlength="500"></textarea></div>
          </div>
          <div class="modal-foot"><button type="button" class="btn" data-close-modal>Cancel</button><button type="submit" class="btn primary">Submit request</button></div>
        </form>
      </div>
    </div>
  `);

  document.getElementById('form-pettycash').addEventListener('submit', async (e) => {
    e.preventDefault();
    const project_id = document.getElementById('pc-project').value;
    const amount = Number(document.getElementById('pc-amount').value);
    const purpose = document.getElementById('pc-purpose').value.trim();
    const notes = document.getElementById('pc-notes').value.trim() || null;
    if (!project_id) return toast('Select a project.', 'error');
    try {
      await createPettyCashRequest({ project_id, requested_by: currentUserId(), amount, purpose, notes });
      toast('Petty cash request submitted.', 'ok');
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
        <div class="modal-head"><h2>Review petty cash request</h2><button class="btn ghost" data-close-modal>${ICONS.close}</button></div>
        <div class="modal-body">
          <div class="info-panel" style="margin-bottom:14px;">
            <h3>${esc(req.purpose)}</h3>
            <div>Amount: <b>${fmtMoney(req.amount)}</b></div>
            <div>Project: <b>${esc(projectName)}</b></div>
            <div>Requested by: <b>${esc(memberName)}</b> on ${fmtDateTime(req.created_at)}</div>
            ${req.notes ? `<div>Notes: ${esc(req.notes)}</div>` : ''}
          </div>
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
    try {
      await decidePettyCashRequest(req.id, {
        status,
        decided_by: currentUserId(),
        decided_at: new Date().toISOString(),
        decision_comment,
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
