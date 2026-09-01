import { state, currentUserId } from '../state.js';
import { setPageTitle, setTopbarActions } from './shell.js';
import { esc, toast, openModal, closeModal } from '../utils.js';
import { fetchTeamMembers } from '../data.js';
import { createTeamMember, resetMemberPassword, setMemberActive, deleteMember } from '../auth.js';
import { ICONS } from '../icons.js';

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin / Assistant', site: 'Site Team' };

export async function renderTeam() {
  setPageTitle('People', 'Team');
  setTopbarActions(`<button class="btn primary" id="new-member-btn">${ICONS.plus}Invite team member</button>`);
  const content = document.getElementById('content');
  content.innerHTML = `<div class="loading-row">Loading…</div>`;

  await paintList();

  document.getElementById('new-member-btn').addEventListener('click', () => openInviteModal());
}

async function paintList() {
  const content = document.getElementById('content');
  const members = await fetchTeamMembers();
  state.teamMembers = members;
  const myId = currentUserId();
  const activeOwners = members.filter((m) => m.role === 'owner' && m.active !== false).length;

  content.innerHTML = `<div class="table-wrap card"><table><thead><tr>
      <th>Name</th><th>Role</th><th>Status</th><th></th>
    </tr></thead><tbody>
      ${members
        .map((m) => {
          const isSelf = m.id === myId;
          const isLastActiveOwner = m.role === 'owner' && m.active !== false && activeOwners <= 1;
          return `<tr>
            <td>${esc(m.full_name)}${isSelf ? ' <span class="hint">(you)</span>' : ''}</td>
            <td><span class="pill role">${esc(ROLE_LABEL[m.role] || m.role)}</span></td>
            <td><span class="pill ${m.active === false ? 'inactive' : 'approved'}">${m.active === false ? 'Inactive' : 'Active'}</span></td>
            <td>
              <div class="row-actions">
                <button class="btn sm" data-reset="${m.id}">Reset password</button>
                ${
                  isSelf || isLastActiveOwner
                    ? ''
                    : `<button class="btn sm" data-toggle-active="${m.id}" data-next="${m.active === false ? 'true' : 'false'}">${m.active === false ? 'Reactivate' : 'Deactivate'}</button>`
                }
                ${isSelf || (m.role === 'owner' && activeOwners <= 1) ? '' : `<button class="btn sm bad" data-delete="${m.id}">Delete</button>`}
              </div>
            </td>
          </tr>`;
        })
        .join('')}
    </tbody></table></div>`;

  content.querySelectorAll('[data-reset]').forEach((btn) => {
    btn.addEventListener('click', () => openResetModal(members.find((m) => m.id === btn.dataset.reset)));
  });
  content.querySelectorAll('[data-toggle-active]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const active = btn.dataset.next === 'true';
      try {
        await setMemberActive(btn.dataset.toggleActive, active);
        toast(active ? 'Member reactivated.' : 'Member deactivated.', 'ok');
        await paintList();
      } catch (err) {
        toast(err.message || 'Could not update member.', 'error');
      }
    });
  });
  content.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const m = members.find((x) => x.id === btn.dataset.delete);
      if (!m) return;
      if (!confirm(`Permanently delete ${m.full_name}? This can't be undone.`)) return;
      try {
        await deleteMember(m.id);
        toast('Member deleted.', 'ok');
        await paintList();
      } catch (err) {
        toast(err.message || 'Could not delete member.', 'error');
      }
    });
  });
}

function openInviteModal() {
  const myRole = state.profile?.role;
  const canGrantOwnerAdmin = myRole === 'owner';
  openModal(`
    <div class="modal-overlay" id="modal-member">
      <div class="modal">
        <div class="modal-head"><h2>Invite team member</h2><button class="btn ghost" data-close-modal>${ICONS.close}</button></div>
        <form id="form-member">
          <div class="modal-body">
            <div class="field"><label for="tm-name">Full name</label><input type="text" id="tm-name" required maxlength="80"></div>
            <div class="field"><label for="tm-email">Email</label><input type="email" id="tm-email" required autocomplete="off"></div>
            <div class="field"><label for="tm-password">Temporary password</label><input type="password" id="tm-password" required minlength="8" placeholder="At least 8 characters"></div>
            <div class="field"><label for="tm-role">Role</label>
              <select id="tm-role">
                <option value="site">Site Team &mdash; logs activity, submits requests</option>
                ${canGrantOwnerAdmin ? '<option value="admin">Admin / Assistant &mdash; approves requests</option>' : ''}
                ${canGrantOwnerAdmin ? '<option value="owner">Owner &mdash; full access</option>' : ''}
              </select>
            </div>
          </div>
          <div class="modal-foot"><button type="button" class="btn" data-close-modal>Cancel</button><button type="submit" class="btn primary">Create account</button></div>
        </form>
      </div>
    </div>
  `);
  document.getElementById('form-member').addEventListener('submit', async (e) => {
    e.preventDefault();
    const full_name = document.getElementById('tm-name').value.trim();
    const email = document.getElementById('tm-email').value.trim();
    const password = document.getElementById('tm-password').value;
    const role = document.getElementById('tm-role').value;
    try {
      await createTeamMember({ email, password, full_name, role });
      toast('Team member created.', 'ok');
      closeModal();
      await paintList();
    } catch (err) {
      toast(err.message || 'Could not create team member.', 'error');
    }
  });
}

function openResetModal(member) {
  if (!member) return;
  openModal(`
    <div class="modal-overlay" id="modal-reset">
      <div class="modal">
        <div class="modal-head"><h2>Reset password &mdash; ${esc(member.full_name)}</h2><button class="btn ghost" data-close-modal>${ICONS.close}</button></div>
        <form id="form-reset">
          <div class="modal-body">
            <div class="field"><label for="rp-password">New password</label><input type="password" id="rp-password" required minlength="8" placeholder="At least 8 characters"></div>
          </div>
          <div class="modal-foot"><button type="button" class="btn" data-close-modal>Cancel</button><button type="submit" class="btn primary">Set new password</button></div>
        </form>
      </div>
    </div>
  `);
  document.getElementById('form-reset').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('rp-password').value;
    try {
      await resetMemberPassword(member.id, password);
      toast('Password updated.', 'ok');
      closeModal();
    } catch (err) {
      toast(err.message || 'Could not reset password.', 'error');
    }
  });
}
