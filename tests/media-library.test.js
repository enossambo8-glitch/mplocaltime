const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const app = require('../server');
const { initializeDatabase } = require('../server');

function cleanupMediaUploads() {
  const dir = path.join(__dirname, '..', 'public', 'uploads', 'news');
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const target = path.join(dir, entry);
    try {
      if (fs.statSync(target).isFile()) {
        fs.unlinkSync(target);
      }
    } catch (error) {
      // Ignore cleanup failures for runtime artifacts.
    }
  }
}

function makePngBuffer() {
  const width = 1;
  const height = 1;
  const color = Buffer.from([0, 0, 0]);
  const rawData = Buffer.alloc(1 + (width * 3 + 1) * height);
  let offset = 0;
  for (let row = 0; row < height; row += 1) {
    rawData[offset++] = 0;
    for (let col = 0; col < width; col += 1) {
      rawData[offset++] = color[0];
      rawData[offset++] = color[1];
      rawData[offset++] = color[2];
    }
  }
  const deflated = zlib.deflateSync(rawData);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        const mask = -(crc & 1);
        crc = (crc >>> 1) ^ (0xedb88320 & mask);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const payload = Buffer.concat([typeBuf, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(payload), 0);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    return Buffer.concat([len, payload, crc]);
  }

  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflated), chunk('IEND', Buffer.alloc(0))]);
}

function makeJpegBuffer() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB4L+JQAAAC0lEQVR42mP8z8AARQAB6wH6' +
    'AAAABJRU5ErkJggg==',
    'base64',
  );
}

async function loginAs(server, username, password) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const payload = await response.json();
  assert.equal(response.status, 200, payload.error || 'login failed');
  return payload.token;
}

async function uploadMedia(server, token, fileName, mimeType, fileBuffer, extra = {}) {
  const form = new FormData();
  form.append('file', new Blob([fileBuffer], { type: mimeType }), fileName);
  Object.entries(extra).forEach(([key, value]) => form.append(key, String(value)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/media/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const payload = await response.json();
  return { response, payload };
}

test('unauthenticated upload is rejected', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const form = new FormData();
    form.append('file', new Blob([makePngBuffer()], { type: 'image/png' }), 'unauth.png');
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/media/upload`, {
      method: 'POST',
      body: form,
    });
    assert.notEqual(response.status, 200);
  } finally {
    cleanupMediaUploads();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('authenticated upload accepts valid PNG and stores safe public metadata', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const token = await loginAs(server, 'admin', 'changeme');
    const { response, payload } = await uploadMedia(server, token, 'news-photo.png', 'image/png', makePngBuffer(), {
      alt_text: 'A local rainstorm on the highway',
      caption: 'Road users navigating the storm.',
      credit: 'Staff photographer',
    });
    assert.equal(response.status, 200, payload.error || 'upload failed');
    assert.ok(payload.media && payload.media.id);
    assert.match(payload.media.public_url || '', /^\/uploads\/news\//);
    assert.ok(!(payload.media.public_url || '').includes('/workspace') && !(payload.media.public_url || '').includes('public'));
    assert.equal(payload.media.alt_text, 'A local rainstorm on the highway');
    assert.equal(payload.media.caption, 'Road users navigating the storm.');
    assert.equal(payload.media.credit, 'Staff photographer');
  } finally {
    cleanupMediaUploads();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('fake or malicious files are rejected before storing metadata', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const token = await loginAs(server, 'admin', 'changeme');
    const badPayloads = [
      ['not-a-real-image.php', 'image/png', Buffer.from('<?php echo "hello"; ?>')],
      ['script.js', 'application/javascript', Buffer.from('alert(1)')],
      ['fake.jpg', 'image/jpeg', Buffer.from('<script>alert(1)</script>')],
      ['traversal.jpg', 'image/jpeg', Buffer.from('fake jpeg content')],
    ];
    for (const [name, mime, bytes] of badPayloads) {
      const { response, payload } = await uploadMedia(server, token, name, mime, bytes);
      assert.notEqual(response.status, 200, `${name} should be rejected`);
      assert.ok(!payload.media || !payload.media.id);
    }
  } finally {
    cleanupMediaUploads();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('media search and pagination return relevant results', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const token = await loginAs(server, 'admin', 'changeme');
    await uploadMedia(server, token, 'bridge.png', 'image/png', makePngBuffer(), { alt_text: 'Bridge downtown', caption: 'Community bridge', credit: 'News desk' });
    await uploadMedia(server, token, 'school.png', 'image/png', makePngBuffer(), { alt_text: 'School children', caption: 'Youth learning', credit: 'Field reporter' });

    const listResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/media?q=bridge&page=1&limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listPayload = await listResponse.json();
    assert.equal(listResponse.status, 200, listPayload.error || 'media list failed');
    assert.ok(Array.isArray(listPayload.media));
    assert.ok(listPayload.media.length >= 1);
    assert.ok(listPayload.total >= 1);
    assert.ok(listPayload.page >= 1);
  } finally {
    cleanupMediaUploads();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('metadata updates work for owners but are rejected for unauthorized writers', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const adminToken = await loginAs(server, 'admin', 'changeme');
    const reporterToken = await loginAs(server, 'reporter', 'contributor');
    const uploaded = await uploadMedia(server, adminToken, 'owner-upload.png', 'image/png', makePngBuffer(), {
      alt_text: 'Original alt',
      caption: 'Original caption',
      credit: 'Original credit',
    });
    assert.equal(uploaded.response.status, 200, uploaded.payload.error || 'upload failed');
    const mediaId = uploaded.payload.media.id;

    const updateResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/media/${mediaId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${reporterToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ alt_text: 'Hacked alt', caption: 'Hacked caption', credit: 'Hacked credit' }),
    });
    assert.equal(updateResponse.status, 403);

    const ownerUpdate = await fetch(`http://127.0.0.1:${server.address().port}/api/media/${mediaId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ alt_text: 'Updated alt', caption: 'Updated caption', credit: 'Updated credit' }),
    });
    assert.equal(ownerUpdate.status, 200);
    const updatedPayload = await ownerUpdate.json();
    assert.equal(updatedPayload.media.alt_text, 'Updated alt');
    assert.equal(updatedPayload.media.caption, 'Updated caption');
    assert.equal(updatedPayload.media.credit, 'Updated credit');
  } finally {
    cleanupMediaUploads();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('featured image metadata persists across unrelated story edits', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const token = await loginAs(server, 'admin', 'changeme');
    const uploaded = await uploadMedia(server, token, 'story-cover.png', 'image/png', makePngBuffer(), {
      alt_text: 'Cover image',
      caption: 'Cover caption',
      credit: 'Staff photographer',
    });
    assert.equal(uploaded.response.status, 200, uploaded.payload.error || 'upload failed');
    const storyCreate = await fetch(`http://127.0.0.1:${server.address().port}/api/stories`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'Local growth story', category: 'Business', content: 'This is a draft story.', featured_image: uploaded.payload.media.public_url, image_alt: 'Cover image', image_caption: 'Cover caption', image_credit: 'Staff photographer', status: 'draft' }),
    });
    const created = await storyCreate.json();
    assert.equal(storyCreate.status, 200, created.error || 'story create failed');
    const updateResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/stories/${created.story.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'Updated local growth story', content: 'This is still a draft story with the same image.', status: 'draft' }),
    });
    const updated = await updateResponse.json();
    assert.equal(updateResponse.status, 200, updated.error || 'story update failed');
    assert.equal(updated.story.featured_image, uploaded.payload.media.public_url);
    assert.equal(updated.story.image_alt, 'Cover image');
    assert.equal(updated.story.image_caption, 'Cover caption');
    assert.equal(updated.story.image_credit, 'Staff photographer');
  } finally {
    cleanupMediaUploads();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});


test('oversized upload is rejected without leaving a file behind', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const token = await loginAs(server, 'admin', 'changeme');
    const largeFile = Buffer.concat([makePngBuffer(), Buffer.alloc(11 * 1024 * 1024, 0x41)]);
    const form = new FormData();
    form.append('file', new Blob([largeFile], { type: 'image/png' }), 'oversized.png');
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/media/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const payload = await response.json();
    assert.notEqual(response.status, 200, payload.error || 'oversized upload unexpectedly succeeded');
    assert.ok(!payload.media || !payload.media.id);
    const dir = path.join(__dirname, '..', 'public', 'uploads', 'news');
    const matching = fs.readdirSync(dir).filter((entry) => entry.includes('oversized'));
    assert.deepEqual(matching, []);
  } finally {
    cleanupMediaUploads();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('generated filenames stay safe even when the original name looks unsafe', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const token = await loginAs(server, 'admin', 'changeme');
    const uploaded = await uploadMedia(server, token, '../../../../../tmp/escape.png', 'image/png', makePngBuffer(), {
      alt_text: 'Safe alt text',
      caption: 'Safe caption',
      credit: 'Safe credit',
    });
    assert.equal(uploaded.response.status, 200, uploaded.payload.error || 'upload with suspicious original filename should still be safe');
    const storedName = uploaded.payload.media.public_url.split('/').pop();
    assert.match(uploaded.payload.media.public_url || '', /^\/uploads\/news\//);
    assert.ok(storedName && !storedName.includes('..'));
    assert.ok(storedName !== 'escape.png');
    assert.ok(!storedName.includes('tmp'));
  } finally {
    cleanupMediaUploads();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('media searches and metadata stay safe against SQL injection and XSS payloads', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const token = await loginAs(server, 'admin', 'changeme');
    const uploaded = await uploadMedia(server, token, 'safe-image.png', 'image/png', makePngBuffer(), {
      alt_text: '<script>alert(1)</script>Public alt text',
      caption: 'Story caption',
      credit: 'Field reporter',
    });
    assert.equal(uploaded.response.status, 200, uploaded.payload.error || 'upload failed');

    const injectionResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/media?q=${encodeURIComponent("' OR 1=1 --")}&page=1&limit=10`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const injectionPayload = await injectionResponse.json();
    assert.equal(injectionResponse.status, 200, injectionPayload.error || 'injection-style query should not break media search');
    assert.ok(Array.isArray(injectionPayload.media));
    assert.ok(!injectionPayload.media.some((entry) => (entry.public_url || '').includes('/workspace')));

    const safeSearchResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/media?q=Public%20alt%20text&page=1&limit=10`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const safeSearchPayload = await safeSearchResponse.json();
    assert.equal(safeSearchResponse.status, 200, safeSearchPayload.error || 'safe search should work');
    const saved = safeSearchPayload.media.find((entry) => entry.id === uploaded.payload.media.id);
    assert.ok(saved, 'safe search should return the uploaded media');
    assert.equal(saved.alt_text, 'alert(1) Public alt text');
    assert.equal(saved.caption, 'Story caption');
    assert.equal(saved.credit, 'Field reporter');
  } finally {
    cleanupMediaUploads();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
