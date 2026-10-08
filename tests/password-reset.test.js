const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-local';
process.env.INITIAL_PASSWORD = process.env.INITIAL_PASSWORD || 'test-admin-secret';
process.env.INITIAL_USER_PASSWORD = process.env.INITIAL_USER_PASSWORD || 'test-contributor-secret';

delete require.cache[require.resolve('../server')];
delete require.cache[require.resolve('../db')];
const app = require('../server');
const dbModule = require('../db');

function loadResetPasswordPage({ fetchResponse }) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'reset-password.html'), 'utf8');
  const script = html.match(/<script>\s*(const token[\s\S]*?)\s*<\/script>/)[1];
  const button = { disabled: false };
  const message = { textContent: '' };
  const form = {
    addEventListener(event, handler) {
      assert.equal(event, 'submit');
      this.submitHandler = handler;
    },
    querySelector(selector) {
      assert.equal(selector, 'button');
      return button;
    },
  };
  const password = { value: 'new-password-123' };
  const confirmPassword = { value: 'new-password-123' };
  const timers = [];
  const location = { href: '' };

  vm.runInNewContext(script, {
    URLSearchParams,
    fetch: async () => fetchResponse,
    document: {
      getElementById(id) {
        return {
          resetPasswordForm: form,
          resetPasswordMessage: message,
          newPassword: password,
          confirmPassword,
        }[id];
      },
    },
    window: {
      location,
      setTimeout(callback, delay) {
        timers.push({ callback, delay });
      },
    },
  });

  return { button, form, location, message, timers };
}

test('password reset schema and public responses do not reveal account existence', async () => {
  await app.initializeDatabase();
  const db = await dbModule.init();
  try {
    const userColumns = await db.all('PRAGMA table_info(users)');
    assert.ok(userColumns.some((column) => column.name === 'email'));
    const tokenColumns = await db.all('PRAGMA table_info(password_reset_tokens)');
    assert.ok(tokenColumns.some((column) => column.name === 'token_hash'));
    assert.ok(tokenColumns.some((column) => column.name === 'expires_at'));

    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const unknownResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/password-reset/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'not-registered@example.com' }),
      });
      const unknownBody = await unknownResponse.json();
      assert.equal(unknownResponse.status, 200);
      assert.equal(unknownBody.message, 'If an account exists for that email, a password reset link has been sent.');

      const invalidResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/password-reset/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'invalid', password: 'new-password-123', confirmPassword: 'new-password-123' }),
      });
      assert.equal(invalidResponse.status, 400);
    } finally {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  } finally {
    await db.close();
  }
});

test('successful password resets redirect to login after two seconds only', async () => {
  const success = loadResetPasswordPage({
    fetchResponse: {
      ok: true,
      json: async () => ({ message: 'Password has been reset.' }),
    },
  });

  await success.form.submitHandler({ preventDefault() {} });
  assert.equal(success.message.textContent, 'Password reset successful! Redirecting you to login...');
  assert.equal(success.button.disabled, true);
  assert.equal(success.timers.length, 1);
  assert.equal(success.timers[0].delay, 2000);
  assert.equal(success.location.href, '');

  success.timers[0].callback();
  assert.equal(success.location.href, '/login.html');

  const invalidToken = loadResetPasswordPage({
    fetchResponse: {
      ok: false,
      json: async () => ({ error: 'This password reset link is invalid or has expired.' }),
    },
  });

  await invalidToken.form.submitHandler({ preventDefault() {} });
  assert.equal(invalidToken.message.textContent, 'This password reset link is invalid or has expired.');
  assert.equal(invalidToken.button.disabled, false);
  assert.equal(invalidToken.timers.length, 0);
  assert.equal(invalidToken.location.href, '');
});
