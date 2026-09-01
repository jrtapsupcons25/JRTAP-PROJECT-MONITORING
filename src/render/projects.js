import { state, isApprover, currentUserId } from '../state.js';
import { setPageTitle, setTopbarActions } from './shell.js';
import { esc, fmtDate, pillClass, toast, openModal, closeModal } from '../utils.js';
import { fetchProjects, createProject, updateProject } from '../data.js';
import { navigate, projectHash } from '../router.js';
import { ICONS } from '../icons.js';

const STATUS_LABEL = { planning: 'Planning', active: 'Active', on_hold: 'On hold', completed: 'Completed' };

export async function renderProjects() {
  setPageTitle('All sites', 'Projects');
  const approver = isApprover();
  setTopbarActions(approver ? `<button class="btn primary" id="new-project-btn">${ICONS.plus}New project</button>` : '');
  const content = document.getElementById('content');
  content.innerHTML = `<div class="loading-row">Loading…</div>`;

  const projects = await fetchProjects();
  state.projects = projects;

  content.innerHTML = projects.length === 0
    ? `<div class="card empty">${ICONS.projects}<div class="lead">No projects yet</div>${approver ? 'Create one with "New project" above.' : "You haven't been assigned to a project yet — ask the Owner or Admin to assign you to one."}</div>`
    : `<div class="grid-cards">
        ${projects
          .map(
            (p) => `<a class="card proj-card" href="#${projectHash(p.id)}">
              <div class="top">
                <h3>${esc(p.name)}</h3>
                <span class="pill ${pillClass(p.status)}">${esc(STATUS_LABEL[p.status] || p.status)}</span>
              </div>
              ${p.client_name ? `<div class="meta">${esc(p.client_name)}</div>` : ''}
              ${p.site_address ? `<div class="meta">${esc(p.site_address)}</div>` : ''}
              <div class="dates">${p.start_date ? fmtDate(p.start_date) : '—'} &rarr; ${p.target_end_date ? fmtDate(p.target_end_date) : '—'}</div>
            </a>`
          )
          .join('')}
      </div>`;

  if (approver) {
    document.getElementById('new-project-btn').addEventListener('click', () => openProjectModal());
  }
}

export function openProjectModal(project, onSaved) {
  const isEdit = !!project;
  openModal(`
    <div class="modal-overlay" id="modal-project">
      <div class="modal">
        <div class="modal-head"><h2>${isEdit ? 'Edit project' : 'New project'}</h2><button class="btn ghost" data-close-modal>${ICONS.close}</button></div>
        <form id="form-project">
          <div class="modal-body">
            <div class="field"><label for="p-name">Project name</label><input type="text" id="p-name" required maxlength="100" value="${esc(project?.name || '')}" placeholder="e.g. Villanueva Residence &ndash; Phase 2"></div>
            <div class="field-row c2">
              <div class="field"><label for="p-client">Client</label><input type="text" id="p-client" maxlength="80" value="${esc(project?.client_name || '')}"></div>
              <div class="field"><label for="p-location">Site address</label><input type="text" id="p-location" maxlength="150" value="${esc(project?.site_address || '')}"></div>
            </div>
            <div class="field-row c2">
              <div class="field"><label for="p-start">Start date</label><input type="date" id="p-start" value="${project?.start_date || ''}"></div>
              <div class="field"><label for="p-target">Target completion</label><input type="date" id="p-target" value="${project?.target_end_date || ''}"></div>
            </div>
            <div class="field-row c2">
              <div class="field"><label for="p-status">Status</label>
                <select id="p-status">
                  ${Object.entries(STATUS_LABEL).map(([v, l]) => `<option value="${v}" ${project?.status === v ? 'selected' : ''}>${l}</option>`).join('')}
                </select>
              </div>
              <div class="field"><label for="p-budget">Budget (&#8369;)</label><input type="number" id="p-budget" min="0" step="0.01" value="${project?.budget ?? ''}"></div>
            </div>
            <div class="field"><label for="p-notes">Notes</label><textarea id="p-notes" maxlength="1000">${esc(project?.notes || '')}</textarea></div>
          </div>
          <div class="modal-foot"><button type="button" class="btn" data-close-modal>Cancel</button><button type="submit" class="btn primary">${isEdit ? 'Save changes' : 'Create project'}</button></div>
        </form>
      </div>
    </div>
  `);

  document.getElementById('form-project').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fields = {
      name: document.getElementById('p-name').value.trim(),
      client_name: document.getElementById('p-client').value.trim() || null,
      site_address: document.getElementById('p-location').value.trim() || null,
      start_date: document.getElementById('p-start').value || null,
      target_end_date: document.getElementById('p-target').value || null,
      status: document.getElementById('p-status').value,
      budget: document.getElementById('p-budget').value === '' ? null : Number(document.getElementById('p-budget').value),
      notes: document.getElementById('p-notes').value.trim() || null,
    };
    try {
      if (isEdit) {
        const updated = await updateProject(project.id, fields);
        toast('Project updated.', 'ok');
        closeModal();
        if (onSaved) await onSaved(updated);
        else navigate('projects');
      } else {
        const created = await createProject({ ...fields, created_by: currentUserId() });
        toast('Project created.', 'ok');
        closeModal();
        if (onSaved) await onSaved(created);
        else navigate(projectHash(created.id));
      }
    } catch (err) {
      toast(err.message || 'Could not save project.', 'error');
    }
  });
}
