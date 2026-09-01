import { state, currentUserId } from '../state.js';
import { setPageTitle, setTopbarActions } from './shell.js';
import { esc, fmtDate, toast, openModal, closeModal, wireRepeater, readRepeaterRows, todayISO } from '../utils.js';
import {
  fetchProjects,
  fetchDailyLogs,
  fetchDailyLogMaterials,
  createDailyLog,
  createDailyLogMaterials,
  uploadLogPhoto,
  getPhotoSignedUrl,
  fetchTeamMembers,
} from '../data.js';
import { ICONS } from '../icons.js';

const CONDITIONS = [
  { value: 'Clear / workable', label: 'Clear / workable' },
  { value: 'Rain / wet', label: 'Rain / wet' },
  { value: 'Muddy / flooded', label: 'Muddy / flooded' },
  { value: 'Work stoppage', label: 'Work stoppage' },
  { value: 'Other', label: 'Other' },
];

let selectedProjectId = '';

export async function renderLogs() {
  setPageTitle('Field reports', 'Daily Logs');
  const content = document.getElementById('content');
  content.innerHTML = `<div class="loading-row">Loading…</div>`;

  const [projects, members] = await Promise.all([fetchProjects(), fetchTeamMembers()]);
  state.projects = projects;
  state.teamMembers = members;

  setTopbarActions(`
    <select class="filter-select" id="logs-project-filter">
      <option value="">All projects</option>
      ${projects.map((p) => `<option value="${p.id}" ${String(p.id) === String(selectedProjectId) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
    </select>
    <button class="btn primary" id="new-log-btn">${ICONS.plus}New daily log</button>
  `);

  await paintList();

  document.getElementById('logs-project-filter').addEventListener('change', async (e) => {
    selectedProjectId = e.target.value;
    await paintList();
  });
  document.getElementById('new-log-btn').addEventListener('click', () => openLogModal());
}

async function paintList() {
  const content = document.getElementById('content');
  const logs = await fetchDailyLogs(selectedProjectId ? { projectId: selectedProjectId } : {});
  const materials = await fetchDailyLogMaterials(logs.map((l) => l.id));

  if (logs.length === 0) {
    content.innerHTML = `<div class="card empty">${ICONS.empty}<div class="lead">No daily logs</div>Log today's activity with "New daily log" above.</div>`;
    return;
  }

  const projectName = (id) => state.projects.find((p) => p.id === id)?.name || `#${id}`;
  const memberName = (id) => state.teamMembers.find((m) => m.id === id)?.full_name || '—';

  content.innerHTML = logs
    .map((l) => {
      const mats = materials.filter((m) => m.log_id === l.id);
      return `
      <details class="logcard" data-log="${l.id}">
        <summary>
          <div><b>${fmtDate(l.log_date)}</b></div>
          <div class="hint">${esc(projectName(l.project_id))}</div>
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

  content.querySelectorAll('details.logcard').forEach((det) => {
    det.addEventListener(
      'toggle',
      async () => {
        if (!det.open) return;
        const logId = det.dataset.log;
        const log = logs.find((l) => String(l.id) === logId);
        const container = det.querySelector(`[data-photo-container="${logId}"]`);
        if (!container || container.dataset.loaded) return;
        container.dataset.loaded = '1';
        const urls = await Promise.all((log.photo_urls || []).map((p) => getPhotoSignedUrl(p)));
        container.innerHTML = urls
          .filter(Boolean)
          .map((u) => `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="Site photo"></a>`)
          .join('');
      },
      { once: false }
    );
  });
}

export function openLogModal(defaultProjectId, onSaved) {
  const projects = state.projects;
  openModal(`
    <div class="modal-overlay" id="modal-log">
      <div class="modal wide">
        <div class="modal-head"><h2>New daily site log</h2><button class="btn ghost" data-close-modal>${ICONS.close}</button></div>
        <form id="form-log">
          <div class="modal-body">
            <div class="field-row c2">
              <div class="field"><label for="l-project">Project</label>
                <select id="l-project" required>
                  <option value="">Select project&hellip;</option>
                  ${projects.map((p) => `<option value="${p.id}" ${String(p.id) === String(defaultProjectId) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
                </select>
              </div>
              <div class="field"><label for="l-date">Date</label><input type="date" id="l-date" required value="${todayISO()}"></div>
            </div>
            <div class="field"><label for="l-activities">Activities today</label><textarea id="l-activities" placeholder="What work was done" maxlength="1500"></textarea></div>
            <div class="field"><label for="l-conditions">Site conditions</label>
              <select id="l-conditions">
                <option value="">&mdash;</option>
                ${CONDITIONS.map((c) => `<option value="${esc(c.value)}">${esc(c.label)}</option>`).join('')}
              </select>
            </div>
            <div class="field"><label>Materials used during this activity</label>
              <div class="rep-block"><div id="l-materials"></div>
                <button type="button" class="btn sm ghost" id="l-materials-add" style="margin-top:6px;">+ Add item</button>
              </div>
            </div>
            <div class="field"><label for="l-photos">Site photos</label><input type="file" id="l-photos" accept="image/*" multiple></div>
          </div>
          <div class="modal-foot"><button type="button" class="btn" data-close-modal>Cancel</button><button type="submit" class="btn primary" id="l-submit">Save log</button></div>
        </form>
      </div>
    </div>
  `);
  const materialsContainer = document.getElementById('l-materials');
  wireRepeater(materialsContainer, document.getElementById('l-materials-add'), 0);

  document.getElementById('form-log').addEventListener('submit', async (e) => {
    e.preventDefault();
    const project_id = document.getElementById('l-project').value;
    const log_date = document.getElementById('l-date').value;
    const activities = document.getElementById('l-activities').value.trim() || null;
    const site_conditions = document.getElementById('l-conditions').value || null;
    const materialsRows = readRepeaterRows(materialsContainer);
    const files = Array.from(document.getElementById('l-photos').files || []);
    if (!project_id) return toast('Select a project.', 'error');

    const submitBtn = document.getElementById('l-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';
    try {
      let photo_urls = [];
      if (files.length) {
        photo_urls = await Promise.all(files.map((f) => uploadLogPhoto(project_id, f)));
      }
      const log = await createDailyLog({
        project_id,
        log_date,
        submitted_by: currentUserId(),
        activities,
        site_conditions,
        photo_urls,
      });
      if (materialsRows.length) await createDailyLogMaterials(log.id, materialsRows);
      toast('Daily log saved.', 'ok');
      closeModal();
      await (onSaved || paintList)();
    } catch (err) {
      toast(err.message || 'Could not save log.', 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save log';
    }
  });
}
