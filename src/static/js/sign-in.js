// Sign-in form. The error is the same for every failure, so it never reveals whether an email is registered.
import { t, url, api, mountTurnstile, validateForm } from './core.js';

const form = document.querySelector('[data-sign-in]');
const error = form.querySelector('[data-form-error]');
const submit = form.querySelector('button[type="submit"]');
const widget = mountTurnstile(form.querySelector('[data-turnstile]'));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.hidden = true;
  if (!validateForm(form)) return;
  submit.disabled = true;
  try {
    const out = await api('/api/auth/sign-in', { method: 'POST', body: { email: form.elements.email.value.trim(), password: form.elements.password.value, turnstile: (await widget).token() } });
    const next = new URLSearchParams(location.search).get('next');
    // Only same-site paths are followed after sign-in.
    location.href = next && /^\/[a-z0-9/_-]*$/i.test(next) ? next : url(out.admin ? '/admin/' : '/');
  } catch (err) {
    error.hidden = false;
    error.querySelector('span').textContent = t(err.status === 429 ? 'auth.rate' : err.status === 401 ? 'auth.invalid' : err.code === 'turnstile_failed' ? 'form.turnstile' : 'auth.error');
    (await widget).reset();
    form.elements.password.value = '';
    form.elements.password.focus();
  } finally {
    submit.disabled = false;
  }
});
