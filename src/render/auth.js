import { LOGO_DATA_URI } from '../logo.js';
import { signIn, bootstrapCreateOwner } from '../auth.js';
import { esc } from '../utils.js';

let mode = 'login'; // 'login' | 'bootstrap'
let error = '';
let busy = false;
let onSignedIn = null; // callback(session)

export async function mountAuthScreen(cb) {
  onSignedIn = cb;
  // Default to the sign-in form — most visits are to an already-set-up
  // team. First-run owner setup is one click away via the link below.
  mode = 'login';
  error = '';
  render();
}

function render() {
  const root = document.getElementById('auth-screen');
  root.hidden = false;
  root.innerHTML = `
    <div class="auth-card">
      <div class="logo-plate"><img src="${LOGO_DATA_URI}" alt="JR.TAP Supplies and Construction Services"></div>
      <div class="tag">Site Ops</div>
      ${error ? `<div class="form-error">${esc(error)}</div>` : ''}
      ${mode === 'bootstrap' ? bootstrapHTML() : loginHTML()}
      <div class="auth-switch">
        ${
          mode === 'login'
            ? `First time here? <button type="button" id="to-bootstrap">Set up the Owner account</button>`
            : `Already have an account? <button type="button" id="to-login">Sign in</button>`
        }
      </div>
    </div>
  `;
  wire();
}

function loginHTML() {
  return `
    <form id="login-form">
      <div class="field">
        <label for="login-email">Email</label>
        <input type="email" id="login-email" required autocomplete="username" placeholder="name@jrtap.ph">
      </div>
      <div class="field">
        <label for="login-password">Password</label>
        <input type="password" id="login-password" required autocomplete="current-password" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;">
      </div>
      <button type="submit" class="btn primary" style="width:100%; padding:11px;" ${busy ? 'disabled' : ''}>${busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  `;
}

function bootstrapHTML() {
  return `
    <div class="hint" style="margin-bottom:14px;">No one's registered yet &mdash; set yourself up as the Owner to get started. Add your Admin and Site Team afterwards from the Team tab.</div>
    <form id="bootstrap-form">
      <div class="field">
        <label for="bs-name">Your name</label>
        <input type="text" id="bs-name" required maxlength="60" placeholder="e.g. Braulio Jr Piano">
      </div>
      <div class="field">
        <label for="bs-email">Email</label>
        <input type="email" id="bs-email" required autocomplete="username" placeholder="owner@jrtap.ph">
      </div>
      <div class="field">
        <label for="bs-password">Password</label>
        <input type="password" id="bs-password" required minlength="8" autocomplete="new-password" placeholder="At least 8 characters">
      </div>
      <button type="submit" class="btn primary" style="width:100%; padding:11px;" ${busy ? 'disabled' : ''}>${busy ? 'Setting up…' : 'Create Owner account'}</button>
    </form>
  `;
}

function wire() {
  const toBootstrap = document.getElementById('to-bootstrap');
  const toLogin = document.getElementById('to-login');
  if (toBootstrap) toBootstrap.addEventListener('click', () => { mode = 'bootstrap'; error = ''; render(); });
  if (toLogin) toLogin.addEventListener('click', () => { mode = 'login'; error = ''; render(); });

  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      busy = true; error = ''; render();
      try {
        const data = await signIn(email, password);
        onSignedIn && (await onSignedIn(data.session));
      } catch (err) {
        error = err.message || 'Sign in failed.';
        busy = false;
        render();
      }
    });
  }

  const bootstrapForm = document.getElementById('bootstrap-form');
  if (bootstrapForm) {
    bootstrapForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const full_name = document.getElementById('bs-name').value.trim();
      const email = document.getElementById('bs-email').value.trim();
      const password = document.getElementById('bs-password').value;
      busy = true; error = ''; render();
      try {
        await bootstrapCreateOwner({ email, password, full_name });
        const data = await signIn(email, password);
        onSignedIn && (await onSignedIn(data.session));
      } catch (err) {
        error = err.message || 'Could not set up the Owner account.';
        busy = false;
        render();
      }
    });
  }
}

export function hideAuthScreen() {
  const root = document.getElementById('auth-screen');
  if (root) root.hidden = true;
}

export function showAuthError(message) {
  mode = 'login';
  error = message;
  busy = false;
  render();
}
