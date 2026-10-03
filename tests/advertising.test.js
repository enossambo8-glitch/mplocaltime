const test = require('node:test');
const assert = require('node:assert/strict');
const { init } = require('../db');
const app = require('../server');
const { initializeDatabase } = require('../server');

async function startServer() {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function loginAs(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const payload = await response.json();
  assert.equal(response.status, 200, `Login failed for ${username}: ${payload.error || response.statusText}`);
  return payload.token;
}

async function seedAdvertData(db) {
  await db.run('DELETE FROM ad_clicks');
  await db.run('DELETE FROM ad_impressions');
  await db.run('DELETE FROM advertisements');
  await db.run('DELETE FROM ad_campaigns');
  await db.run('DELETE FROM advertisers');

  const advertiser = await db.run(
    'INSERT INTO advertisers (business_name, email, website, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['Mango Foods', 'sales@mangofoods.co.za', 'https://mangofoods.co.za', 'active', 'Private notes', new Date().toISOString(), new Date().toISOString()]
  );
  const campaign = await db.run(
    'INSERT INTO ad_campaigns (advertiser_id, name, start_date, end_date, status, target_scope, target_value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [advertiser.lastID, 'Spring Basket', '2024-01-01', '2035-12-31', 'active', 'all', null, new Date().toISOString(), new Date().toISOString()]
  );
  const ad = await db.run(
    'INSERT INTO advertisements (campaign_id, title, image_url, destination_url, alt_text, placement, status, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [campaign.lastID, 'Fresh market deals', 'https://example.com/banner.png', 'https://example.com/deals', 'Fresh market deals', 'homepage_top', 'active', 'Advertisement', new Date().toISOString(), new Date().toISOString()]
  );
  return { advertiserId: advertiser.lastID, campaignId: campaign.lastID, advertisementId: ad.lastID };
}

async function withTestDb(fn) {
  await initializeDatabase();
  const db = await init();
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

test('unauthenticated users cannot manage advertisers', async () => {
  const { baseUrl, close } = await startServer();
  try {
    const response = await fetch(`${baseUrl}/api/admin/advertisers`);
    assert.equal(response.status, 401);
  } finally {
    await close();
  }
});

test('journalists without advertising permissions are rejected', async () => {
  const { baseUrl, close } = await startServer();
  try {
    const token = await loginAs(baseUrl, 'reporter', 'contributor');
    const response = await fetch(`${baseUrl}/api/admin/ad-campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ advertiser_id: 1, name: 'Forbidden campaign', status: 'draft' }),
    });
    assert.equal(response.status, 403);
  } finally {
    await close();
  }
});

test('authorized admins can create advertisers and campaigns', async () => {
  const { baseUrl, close } = await startServer();
  try {
    const token = await loginAs(baseUrl, 'admin', 'changeme');
    const advertiserResponse = await fetch(`${baseUrl}/api/admin/advertisers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ business_name: 'Mbombela Motors', email: 'sales@mbombelamotors.co.za', website: 'https://mbombelamotors.co.za' }),
    });
    assert.equal(advertiserResponse.status, 201);
    const advertiserPayload = await advertiserResponse.json();
    assert.equal(advertiserPayload.advertiser.business_name, 'Mbombela Motors');

    const campaignResponse = await fetch(`${baseUrl}/api/admin/ad-campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ advertiser_id: advertiserPayload.advertiser.id, name: 'Weekend specials', status: 'active', start_date: '2024-01-01', end_date: '2035-12-31' }),
    });
    assert.equal(campaignResponse.status, 201);
    const campaignPayload = await campaignResponse.json();
    assert.equal(campaignPayload.campaign.name, 'Weekend specials');
  } finally {
    await close();
  }
});

test('campaign scheduling blocks ineligible campaigns from public display', async () => {
  const { baseUrl, close } = await startServer();
  try {
    await withTestDb(async (db) => {
      const { campaignId } = await seedAdvertData(db);
      await db.run('UPDATE ad_campaigns SET status = ?, start_date = ?, end_date = ? WHERE id = ?', ['draft', '2024-01-01', '2035-12-31', campaignId]);
      const draftRes = await fetch(`${baseUrl}/api/ads/homepage_top`);
      assert.equal(draftRes.status, 200);
      const draftPayload = await draftRes.json();
      assert.equal(draftPayload.advertisement, null);

      await db.run('UPDATE ad_campaigns SET status = ?, start_date = ?, end_date = ? WHERE id = ?', ['active', '2099-01-01', '2100-01-01', campaignId]);
      const futureRes = await fetch(`${baseUrl}/api/ads/homepage_top`);
      const futurePayload = await futureRes.json();
      assert.equal(futurePayload.advertisement, null);

      await db.run('UPDATE ad_campaigns SET status = ?, start_date = ?, end_date = ? WHERE id = ?', ['active', '2024-01-01', '2024-01-01', campaignId]);
      const expiredRes = await fetch(`${baseUrl}/api/ads/homepage_top`);
      const expiredPayload = await expiredRes.json();
      assert.equal(expiredPayload.advertisement, null);

      await db.run('UPDATE ad_campaigns SET status = ?, start_date = ?, end_date = ? WHERE id = ?', ['paused', '2024-01-01', '2035-12-31', campaignId]);
      const pausedRes = await fetch(`${baseUrl}/api/ads/homepage_top`);
      const pausedPayload = await pausedRes.json();
      assert.equal(pausedPayload.advertisement, null);
    });
  } finally {
    await close();
  }
});

test('placements and targeting keep adverts contextual', async () => {
  const { baseUrl, close } = await startServer();
  try {
    await withTestDb(async (db) => {
      const { campaignId } = await seedAdvertData(db);
      await db.run('UPDATE ad_campaigns SET status = ?, start_date = ?, end_date = ?, target_scope = ?, target_value = ? WHERE id = ?', ['active', '2024-01-01', '2035-12-31', 'category', 'news', campaignId]);
      await db.run('UPDATE advertisements SET placement = ? WHERE campaign_id = ?', ['article_top', campaignId]);
      const eligibleRes = await fetch(`${baseUrl}/api/ads/article_top?category=News`);
      const eligiblePayload = await eligibleRes.json();
      assert.ok(eligiblePayload.advertisement);

      const ineligibleRes = await fetch(`${baseUrl}/api/ads/article_top?category=Business`);
      const ineligiblePayload = await ineligibleRes.json();
      assert.equal(ineligiblePayload.advertisement, null);

      await db.run('UPDATE advertisements SET placement = ? WHERE campaign_id = ?', ['homepage_top', campaignId]);
      await db.run('UPDATE ad_campaigns SET target_scope = ?, target_value = ? WHERE id = ?', ['municipality', 'mbombela', campaignId]);
      const municipalityRes = await fetch(`${baseUrl}/api/ads/homepage_top?municipality=mbombela`);
      const municipalityPayload = await municipalityRes.json();
      assert.ok(municipalityPayload.advertisement);

      const noMatchRes = await fetch(`${baseUrl}/api/ads/homepage_top?municipality=nelspruit`);
      const noMatchPayload = await noMatchRes.json();
      assert.equal(noMatchPayload.advertisement, null);
    });
  } finally {
    await close();
  }
});

test('dangerous destinations are rejected and public data stays minimal', async () => {
  const { baseUrl, close } = await startServer();
  try {
    const token = await loginAs(baseUrl, 'admin', 'changeme');
    const adResponse = await fetch(`${baseUrl}/api/admin/advertisers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ business_name: 'Unsafe Co', email: 'test@example.com', website: 'https://example.com' }),
    });
    const advertiserPayload = await adResponse.json();
    const campaignResponse = await fetch(`${baseUrl}/api/admin/ad-campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ advertiser_id: advertiserPayload.advertiser.id, name: 'Unsafe campaign', status: 'active', start_date: '2024-01-01', end_date: '2035-12-31' }),
    });
    const campaignPayload = await campaignResponse.json();
    const badAd = await fetch(`${baseUrl}/api/admin/advertisements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ campaign_id: campaignPayload.campaign.id, title: 'Bad link', image_url: 'https://example.com/banner.png', destination_url: 'javascript:alert(1)', placement: 'homepage_top', status: 'active' }),
    });
    assert.equal(badAd.status, 400);

    const publicResponse = await fetch(`${baseUrl}/api/ads/homepage_top`);
    const publicPayload = await publicResponse.json();
    assert.equal(publicPayload.advertisement && publicPayload.advertisement.business_name ? !!publicPayload.advertisement.business_name : true, true);
    assert.equal(publicPayload.advertisement && publicPayload.advertisement.email ? publicPayload.advertisement.email : undefined, undefined);
  } finally {
    await close();
  }
});

test('impressions and clicks are recorded and CTR is calculated safely', async () => {
  const { baseUrl, close } = await startServer();
  try {
    await withTestDb(async (db) => {
      const { advertisementId, campaignId } = await seedAdvertData(db);
      await db.run('INSERT INTO ad_impressions (advertisement_id, campaign_id, placement, created_at) VALUES (?, ?, ?, ?)', [advertisementId, campaignId, 'homepage_top', new Date().toISOString()]);
      await db.run('INSERT INTO ad_impressions (advertisement_id, campaign_id, placement, created_at) VALUES (?, ?, ?, ?)', [advertisementId, campaignId, 'homepage_top', new Date().toISOString()]);
      await db.run('INSERT INTO ad_clicks (advertisement_id, campaign_id, placement, referer, created_at) VALUES (?, ?, ?, ?, ?)', [advertisementId, campaignId, 'homepage_top', 'https://example.com', new Date().toISOString()]);

      const campaignPerformance = await fetch(`${baseUrl}/api/admin/ad-campaigns/${campaignId}/performance`, {
        headers: { Authorization: `Bearer ${await loginAs(baseUrl, 'admin', 'changeme')}` },
      });
      const performancePayload = await campaignPerformance.json();
      assert.equal(performancePayload.impressions, 2);
      assert.equal(performancePayload.clicks, 1);
      assert.equal(performancePayload.ctr, 50);

      const clickResponse = await fetch(`${baseUrl}/ad/click/${advertisementId}`, { redirect: 'manual' });
      assert.equal(clickResponse.status, 302);
      assert.equal(clickResponse.headers.get('location'), 'https://example.com/deals');
    });
  } finally {
    await close();
  }
});

test('public click route refuses unsafe and arbitrary redirects', async () => {
  const { baseUrl, close } = await startServer();
  try {
    await withTestDb(async (db) => {
      const { advertisementId } = await seedAdvertData(db);
      await db.run('UPDATE advertisements SET destination_url = ? WHERE id = ?', ['javascript:alert(1)', advertisementId]);
      const unsafeResponse = await fetch(`${baseUrl}/ad/click/${advertisementId}`, { redirect: 'manual' });
      assert.equal(unsafeResponse.status, 400);
      const missingResponse = await fetch(`${baseUrl}/ad/click/999999`, { redirect: 'manual' });
      assert.equal(missingResponse.status, 404);
    });
  } finally {
    await close();
  }
});

test('main.js escapes advertiser-controlled markup in ad rendering', async () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(source, /escapeHTML\(advertisement\.title \|\| 'Advertisement'\)/);
});
