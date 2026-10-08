const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-local';
process.env.INITIAL_PASSWORD = process.env.INITIAL_PASSWORD || 'test-admin-secret';
process.env.INITIAL_USER_PASSWORD = process.env.INITIAL_USER_PASSWORD || 'test-contributor-secret';

delete require.cache[require.resolve('../server')];
delete require.cache[require.resolve('../db')];
const app = require('../server');
const dbModule = require('../db');

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
