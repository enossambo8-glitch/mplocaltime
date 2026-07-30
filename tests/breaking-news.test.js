const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeDatabase } = require('../server');
const app = require('../server');
const { buildLatestUpdatesMarkup } = require('../main');

test('buildLatestUpdatesMarkup renders story cards', () => {
  const markup = buildLatestUpdatesMarkup([
    { id: 1, title: 'Local road upgrades continue', excerpt: 'Residents welcome the new work.', category: 'Community', submittedAt: '2026-07-21T08:00:00Z', reading_time: 3, featured_image: '/logo.png' },
    { id: 2, title: 'Business forum expands next month', excerpt: 'Entrepreneurs prepare for fresh opportunities.', category: 'Business', submittedAt: '2026-07-21T09:00:00Z', reading_time: 4, featured_image: '/logo.png' },
  ]);

  assert.match(markup, /latest-update-card/);
  assert.ok(markup.includes('Local road upgrades continue'));
  assert.ok(markup.includes('Business forum expands next month'));
});

test('breaking news endpoint returns stories', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/breaking-news`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(Array.isArray(payload.stories));
    assert.ok(payload.stories.length > 0);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('story update endpoint persists workflow changes', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const address = server.address();
    const loginResponse = await fetch(`http://127.0.0.1:${address.port}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'changeme' }),
    });
    const loginPayload = await loginResponse.json();

    const createResponse = await fetch(`http://127.0.0.1:${address.port}/api/stories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginPayload.token}`,
      },
      body: JSON.stringify({ title: 'Editorial workflow test', category: 'News', content: 'Draft content', status: 'draft' }),
    });
    const created = await createResponse.json();

    const updateResponse = await fetch(`http://127.0.0.1:${address.port}/api/stories/${created.story.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginPayload.token}`,
      },
      body: JSON.stringify({ status: 'pending-review', editorial_notes: 'Needs fact-check' }),
    });
    const updated = await updateResponse.json();

    assert.equal(updateResponse.status, 200);
    assert.equal(updated.story.status, 'pending-review');
    assert.match(updated.story.editorial_notes || '', /fact-check/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('search endpoint returns story matches', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/search?q=health`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(Array.isArray(payload.results));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('analytics endpoint returns overview and analytics payloads', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/analytics/overview`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(payload.overview);
    assert.ok(payload.analytics);
    assert.equal(typeof payload.analytics.pageViews, 'number');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('municipality route renders a dedicated SEO page', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/municipality/mbombela`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Mbombela/);
    assert.match(html, /application\/ld\+json/);
    assert.match(html, /BreadcrumbList/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('article page surfaces contributor and municipality recommendations', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/story/1`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /More by this contributor/);
    assert.match(html, /From this municipality/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('creatives landing page renders the creative portal experience', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/creatives`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Discover Mpumalanga's Creative Talent/);
    assert.match(html, /Featured Artists/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('creative marketplace landing page highlights the new product categories', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/creative-marketplace`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Creative Marketplace/);
    assert.match(html, /Digital Products/);
    assert.match(html, /Made in Mpumalanga/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('creative marketplace listing page renders storefront-style cards and filters', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/creative-marketplace/listings`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Filter by/);
    assert.match(html, /Digital/);
    assert.match(html, /Artist storefront/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('artist booking endpoint stores a booking', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const address = server.address();
    const loginResponse = await fetch(`http://127.0.0.1:${address.port}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'reporter', password: 'contributor' }),
    });
    const loginPayload = await loginResponse.json();

    const response = await fetch(`http://127.0.0.1:${address.port}/api/artists/1/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginPayload.token}`,
      },
      body: JSON.stringify({ clientName: 'Nokwanda Mokoena', organisation: 'River House', email: 'nokwanda@example.com', phone: '0710000000', eventDate: '2026-09-12', venue: 'Mbombela Hall', budget: 'R12 000', message: 'Please perform at our community launch.' }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(payload.booking && payload.booking.id);
    assert.equal(payload.booking.artist_id, 1);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('creative organisations and opportunities pages render', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const address = server.address();
    const organisationsResponse = await fetch(`http://127.0.0.1:${address.port}/creatives/organisations`);
    assert.equal(organisationsResponse.status, 200);
    const organisationsHtml = await organisationsResponse.text();
    assert.match(organisationsHtml, /Creative organisations/i);

    const opportunitiesResponse = await fetch(`http://127.0.0.1:${address.port}/creatives/opportunities`);
    assert.equal(opportunitiesResponse.status, 200);
    const opportunitiesHtml = await opportunitiesResponse.text();
    assert.match(opportunitiesHtml, /Creative opportunities/i);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('message endpoint stores a new creative enquiry', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientId: 1, senderName: 'Nokwanda', senderEmail: 'nokwanda@example.com', subject: 'Booking enquiry', message: 'Would you be available for a launch event?' }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(payload.message && payload.message.id);
    assert.equal(payload.message.recipient_id, 1);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('creative overview endpoint returns organisation and venue counts', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/creatives/overview`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(payload.overview);
    assert.equal(typeof payload.overview.organisations, 'number');
    assert.equal(typeof payload.overview.venues, 'number');
    assert.ok(Array.isArray(payload.organisations));
    assert.ok(Array.isArray(payload.venues));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('creative search returns artists, organisations and venues', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/creatives/search?q=mbombela`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(Array.isArray(payload.artists));
    assert.ok(Array.isArray(payload.organisations));
    assert.ok(Array.isArray(payload.venues));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('breaking news admin endpoint creates a pinned item', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const address = server.address();
    const loginResponse = await fetch(`http://127.0.0.1:${address.port}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'changeme' }),
    });
    const loginPayload = await loginResponse.json();

    const response = await fetch(`http://127.0.0.1:${address.port}/api/admin/breaking-news`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginPayload.token}`,
      },
      body: JSON.stringify({ headline: 'Council approves new service delivery plan', slug: 'council-approves-new-service-delivery-plan', priority: 1, status: 'active', articleId: 1 }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(payload.item && payload.item.id);
    assert.equal(payload.item.headline, 'Council approves new service delivery plan');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('comments endpoint stores and returns comments', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const address = server.address();
    const loginResponse = await fetch(`http://127.0.0.1:${address.port}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'reporter', password: 'contributor' }),
    });
    const loginPayload = await loginResponse.json();

    const createResponse = await fetch(`http://127.0.0.1:${address.port}/api/stories/1/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginPayload.token}`,
      },
      body: JSON.stringify({ text: 'This is a useful update for our region.' }),
    });

    assert.equal(createResponse.status, 200);
    const payload = await createResponse.json();
    assert.ok(Array.isArray(payload.comments));
    assert.match(payload.comments[0].text || '', /useful update/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('newsletter subscribe endpoint stores a subscriber', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/newsletter/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Anele', surname: 'Mkhize', email: 'anele@example.com', province: 'Mpumalanga', preferences: ['Breaking News Alerts', 'Sports'] }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.subscriber.email, 'anele@example.com');
    assert.equal(payload.subscriber.province, 'Mpumalanga');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('media upload endpoint stores a file', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const address = server.address();
    const loginResponse = await fetch(`http://127.0.0.1:${address.port}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'changeme' }),
    });
    const loginPayload = await loginResponse.json();

    const form = new FormData();
    form.append('file', new Blob(['hello world'], { type: 'text/plain' }), 'sample.txt');
    form.append('caption', 'Sample upload');

    const response = await fetch(`http://127.0.0.1:${address.port}/api/media/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${loginPayload.token}` },
      body: form,
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(payload.media && payload.media.id);
    assert.match(payload.media.original_name || '', /sample\.txt/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('admin notification endpoints create and list notifications', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const address = server.address();
    const loginResponse = await fetch(`http://127.0.0.1:${address.port}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'changeme' }),
    });
    const loginPayload = await loginResponse.json();

    const createResponse = await fetch(`http://127.0.0.1:${address.port}/api/admin/notifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginPayload.token}`,
      },
      body: JSON.stringify({ title: 'Service update', body: 'Road works will resume at dawn.', category: 'Community', province: 'Mpumalanga' }),
    });

    assert.equal(createResponse.status, 200);
    const created = await createResponse.json();
    assert.ok(created.notification && created.notification.id);

    const listResponse = await fetch(`http://127.0.0.1:${address.port}/api/admin/notifications`, {
      headers: { Authorization: `Bearer ${loginPayload.token}` },
    });
    assert.equal(listResponse.status, 200);
    const listPayload = await listResponse.json();
    assert.ok(Array.isArray(listPayload.notifications));
    assert.ok(listPayload.notifications.some((item) => item.title === 'Service update'));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('contributor performance endpoint returns editorial metrics', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const address = server.address();
    const loginResponse = await fetch(`http://127.0.0.1:${address.port}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'changeme' }),
    });
    const loginPayload = await loginResponse.json();

    const response = await fetch(`http://127.0.0.1:${address.port}/api/contributors/performance`, {
      headers: { Authorization: `Bearer ${loginPayload.token}` },
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(payload.summary);
    assert.ok(Array.isArray(payload.contributors));
    assert.equal(typeof payload.summary.totalContributors, 'number');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('editorial analysis and review endpoints provide advisory workflow data', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const address = server.address();
    const loginResponse = await fetch(`http://127.0.0.1:${address.port}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'changeme' }),
    });
    const loginPayload = await loginResponse.json();

    const createResponse = await fetch(`http://127.0.0.1:${address.port}/api/stories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginPayload.token}`,
      },
      body: JSON.stringify({ title: 'Editorial review workflow test', category: 'News', content: 'A local clinic in Mbombela has opened a new service desk for residents who need urgent care and follow-up support after the recent rollout.', status: 'pending-review' }),
    });
    assert.equal(createResponse.status, 200);
    const created = await createResponse.json();
    const storyId = created.story.id;

    const analysisResponse = await fetch(`http://127.0.0.1:${address.port}/api/stories/${storyId}/editorial-analysis`, {
      headers: { Authorization: `Bearer ${loginPayload.token}` },
    });
    assert.equal(analysisResponse.status, 200);
    const analysisPayload = await analysisResponse.json();
    assert.ok(analysisPayload.review);
    assert.ok(typeof analysisPayload.review.quality_score === 'number');
    assert.match(analysisPayload.review.recommendations || '', /editorial review/i);

    const reviewResponse = await fetch(`http://127.0.0.1:${address.port}/api/stories/${storyId}/editorial-review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginPayload.token}`,
      },
      body: JSON.stringify({ action: 'request-changes', notes: 'Please add a second source.' }),
    });
    assert.equal(reviewResponse.status, 200);
    const reviewPayload = await reviewResponse.json();
    assert.equal(reviewPayload.story.status, 'needs-changes');
    assert.match(reviewPayload.review.notes || '', /second source/i);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
