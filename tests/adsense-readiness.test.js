const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server');
const { init } = require('../db');

async function startServer() {
  await app.initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function withAdsenseEnv(overrides, fn) {
  const priorValues = {};
  for (const [key, value] of Object.entries(overrides)) {
    priorValues[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }

  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(priorValues)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('AdSense remains disabled by default and does not claim a fake seller relationship', async () => {
  const { baseUrl, close } = await startServer();
  try {
    const homeResponse = await fetch(`${baseUrl}/`);
    assert.equal(homeResponse.status, 200);
    const homeHtml = await homeResponse.text();
    assert.ok(!homeHtml.includes('googlesyndication.com'));
    assert.ok(!homeHtml.includes('adsbygoogle'));

    const adsTxtResponse = await fetch(`${baseUrl}/ads.txt`);
    const adsTxtText = await adsTxtResponse.text();
    assert.equal(adsTxtResponse.status, 200);
    assert.ok(!adsTxtText.includes('google.com, pub-0000000000000000'));
    assert.ok(!adsTxtText.includes('pub-0000000000000000'));
    assert.ok(!adsTxtText.includes('google.com, ca-pub-'));
  } finally {
    await close();
  }
});

test('Configured publisher IDs are validated before the AdSense script is injected', async () => {
  const { baseUrl, close } = await startServer();
  try {
    await withAdsenseEnv({ ADSENSE_ENABLED: 'true', ADSENSE_PUBLISHER_ID: 'javascript:alert(1)' }, async () => {
      const response = await fetch(`${baseUrl}/news.html`);
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.ok(!html.includes('googlesyndication.com'));
      assert.ok(!html.includes('alert(1)'));
    });

    await withAdsenseEnv({ ADSENSE_ENABLED: 'true', ADSENSE_PUBLISHER_ID: 'ca-pub-1234567890123456' }, async () => {
      const response = await fetch(`${baseUrl}/news.html`);
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.ok(html.includes('googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456'));
      assert.ok(!html.includes('<script>alert'));
    });
  } finally {
    await close();
  }
});

test('ads.txt serves a public unconfigured message and accepts a real configured entry when supplied', async () => {
  const { baseUrl, close } = await startServer();
  try {
    const unconfiguredResponse = await fetch(`${baseUrl}/ads.txt`);
    const unconfiguredText = await unconfiguredResponse.text();
    assert.equal(unconfiguredResponse.status, 200);
    assert.ok(unconfiguredText.includes('intentionally unconfigured'));
    assert.ok(!unconfiguredText.includes('pub-0000000000000000'));

    await withAdsenseEnv({ ADSENSE_ADS_TXT_ENTRY: 'google.com, ca-pub-1234567890123456, DIRECT, f08c47fec0942fa0' }, async () => {
      const configuredResponse = await fetch(`${baseUrl}/ads.txt`);
      const configuredText = await configuredResponse.text();
      assert.equal(configuredResponse.status, 200);
      assert.ok(configuredText.includes('google.com, ca-pub-1234567890123456, DIRECT, f08c47fec0942fa0'));
    });
  } finally {
    await close();
  }
});

test('direct advertising remains eligible and retains priority over future AdSense integration', async () => {
  const { baseUrl, close } = await startServer();
  try {
    const db = await init();
    try {
      await db.run('DELETE FROM ad_clicks');
      await db.run('DELETE FROM ad_impressions');
      await db.run('DELETE FROM advertisements');
      await db.run('DELETE FROM ad_campaigns');
      await db.run('DELETE FROM advertisers');

      const advertiser = await db.run(
        'INSERT INTO advertisers (business_name, email, website, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['Mango Foods', 'sales@mangofoods.co.za', 'https://mangofoods.co.za', 'active', 'Direct ad test', new Date().toISOString(), new Date().toISOString()]
      );
      const campaign = await db.run(
        'INSERT INTO ad_campaigns (advertiser_id, name, start_date, end_date, status, target_scope, target_value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [advertiser.lastID, 'Spring Basket', '2024-01-01', '2035-12-31', 'active', 'all', null, new Date().toISOString(), new Date().toISOString()]
      );
      await db.run(
        'INSERT INTO advertisements (campaign_id, title, image_url, destination_url, alt_text, placement, status, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [campaign.lastID, 'Fresh market deals', 'https://example.com/banner.png', 'https://example.com/deals', 'Fresh market deals', 'homepage_top', 'active', 'Advertisement', new Date().toISOString(), new Date().toISOString()]
      );

      const response = await fetch(`${baseUrl}/api/ads/homepage_top`);
      const payload = await response.json();
      assert.equal(response.status, 200);
      assert.ok(payload.advertisement);
      assert.equal(payload.advertisement.title, 'Fresh market deals');
    } finally {
      await db.close();
    }
  } finally {
    await close();
  }
});
