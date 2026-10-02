const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const app = require('../server');
const { initializeDatabase } = require('../server');

function tokenFor(username, role, id) {
  return jwt.sign({ id, username, role }, process.env.JWT_SECRET || 'testsecret', { expiresIn: '7d' });
}

test('dashboard overview exposes role-aware newsroom counts', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const reporterToken = tokenFor('reporter', 'journalist', 2);
    const storyRes = await fetch(`http://127.0.0.1:${server.address().port}/api/stories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${reporterToken}`,
      },
      body: JSON.stringify({
        title: 'Dashboard overview draft',
        category: 'Community',
        content: 'A reporter-only draft for dashboard validation.',
        status: 'draft',
      }),
    });
    assert.equal(storyRes.status, 200);

    const overviewResp = await fetch(`http://127.0.0.1:${server.address().port}/api/dashboard/overview`, {
      headers: { Authorization: `Bearer ${reporterToken}` },
    });
    const overview = await overviewResp.json();
    assert.equal(overviewResp.status, 200);
    assert.equal(typeof overview.overview.drafts, 'number');
    assert.equal(typeof overview.overview.submitted, 'number');
    assert.equal(overview.role, 'journalist');
    assert.ok(overview.overview.drafts >= 1);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('stories endpoint supports newsroom filters, search and pagination', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const adminToken = tokenFor('admin', 'admin', 1);
    const create = await fetch(`http://127.0.0.1:${server.address().port}/api/stories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        title: 'Community filter story',
        category: 'Community',
        content: 'A searchable story for the newsroom dashboard filter tests.',
        status: 'draft',
      }),
    });
    assert.equal(create.status, 200);

    const filtered = await fetch(`http://127.0.0.1:${server.address().port}/api/stories?status=draft&category=community&q=filter&limit=5&page=1`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const payload = await filtered.json();

    assert.equal(filtered.status, 200);
    assert.equal(typeof payload.total, 'number');
    assert.ok(payload.total >= 1);
    assert.ok(Array.isArray(payload.stories));
    assert.ok(payload.stories.some((story) => String(story.title).toLowerCase().includes('community filter story')));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('dashboard API rejects unauthenticated newsroom access', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const overview = await fetch(`http://127.0.0.1:${server.address().port}/api/dashboard/overview`);
    assert.equal(overview.status, 401);

    const stories = await fetch(`http://127.0.0.1:${server.address().port}/api/stories`);
    assert.equal(stories.status, 401);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('role-aware newsroom access behaves according to the server role source of truth', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const adminToken = tokenFor('admin', 'admin', 1);
    const reporterToken = tokenFor('reporter', 'journalist', 2);

    const reporterCreate = await fetch(`http://127.0.0.1:${server.address().port}/api/stories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${reporterToken}`,
      },
      body: JSON.stringify({ title: 'Reporter-only draft', category: 'Community', content: 'Visible only to the reporter while in draft', status: 'draft' }),
    });
    assert.equal(reporterCreate.status, 200);

    const reporterOverview = await fetch(`http://127.0.0.1:${server.address().port}/api/dashboard/overview`, {
      headers: { Authorization: `Bearer ${reporterToken}` },
    });
    const reporterPayload = await reporterOverview.json();
    assert.equal(reporterOverview.status, 200);
    assert.equal(reporterPayload.role, 'journalist');
    assert.ok(reporterPayload.overview.drafts >= 1);

    const promote = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/users/2/role`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ role: 'editor' }),
    });
    assert.equal(promote.status, 200);

    const editorToken = tokenFor('reporter', 'editor', 2);
    const editorOverview = await fetch(`http://127.0.0.1:${server.address().port}/api/dashboard/overview`, {
      headers: { Authorization: `Bearer ${editorToken}` },
    });
    const editorPayload = await editorOverview.json();
    assert.equal(editorOverview.status, 200);
    assert.equal(editorPayload.role, 'editor');

    const adminOverview = await fetch(`http://127.0.0.1:${server.address().port}/api/dashboard/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const adminPayload = await adminOverview.json();
    assert.equal(adminOverview.status, 200);
    assert.equal(adminPayload.role, 'admin');
    assert.equal(typeof adminPayload.overview.newsroom?.draft, 'number');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('workflow lifecycle transitions and invalid moves are server-validated', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const reporterToken = tokenFor('reporter', 'journalist', 2);
    const adminToken = tokenFor('admin', 'admin', 1);
    const created = await fetch(`http://127.0.0.1:${server.address().port}/api/stories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${reporterToken}`,
      },
      body: JSON.stringify({ title: 'Lifecycle story', category: 'News', content: 'Draft content for workflow validation', status: 'draft' }),
    });
    const createdJson = await created.json();
    assert.equal(created.status, 200);
    const storyId = createdJson.story.id;

    const illegalDirectStatus = await fetch(`http://127.0.0.1:${server.address().port}/api/stories/${storyId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${reporterToken}`,
      },
      body: JSON.stringify({ title: 'Updated draft', content: 'Updated content', status: 'published' }),
    });
    assert.equal(illegalDirectStatus.status, 409);

    const submit = await fetch(`http://127.0.0.1:${server.address().port}/api/stories/${storyId}/submit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${reporterToken}` },
    });
    assert.equal(submit.status, 200);

    const invalidApproveBeforeReview = await fetch(`http://127.0.0.1:${server.address().port}/api/editorial/stories/${storyId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ notes: 'This should fail before review.' }),
    });
    assert.equal(invalidApproveBeforeReview.status, 409);

    const beginReview = await fetch(`http://127.0.0.1:${server.address().port}/api/editorial/stories/${storyId}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: 'in_review', notes: 'Please fact-check the quote.' }),
    });
    assert.equal(beginReview.status, 200);

    const requestChanges = await fetch(`http://127.0.0.1:${server.address().port}/api/editorial/stories/${storyId}/request-changes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ notes: 'Please tighten the headline and add a source.' }),
    });
    assert.equal(requestChanges.status, 200);

    const resubmit = await fetch(`http://127.0.0.1:${server.address().port}/api/stories/${storyId}/submit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${reporterToken}` },
    });
    assert.equal(resubmit.status, 200);

    const reviewAgain = await fetch(`http://127.0.0.1:${server.address().port}/api/editorial/stories/${storyId}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: 'in_review', notes: 'Second review pass.' }),
    });
    assert.equal(reviewAgain.status, 200);

    const approve = await fetch(`http://127.0.0.1:${server.address().port}/api/editorial/stories/${storyId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ notes: 'Approved after review.' }),
    });
    assert.equal(approve.status, 200);

    const schedule = await fetch(`http://127.0.0.1:${server.address().port}/api/editorial/stories/${storyId}/schedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ scheduled_at: new Date(Date.now() + 60000).toISOString() }),
    });
    assert.equal(schedule.status, 200);

    const publish = await fetch(`http://127.0.0.1:${server.address().port}/api/editorial/stories/${storyId}/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: 'published' }),
    });
    assert.equal(publish.status, 200);

    const archive = await fetch(`http://127.0.0.1:${server.address().port}/api/editorial/stories/${storyId}/archive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ reason: 'Archived after publication review' }),
    });
    assert.equal(archive.status, 200);

    const invalidPublishFromArchive = await fetch(`http://127.0.0.1:${server.address().port}/api/editorial/stories/${storyId}/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: 'published' }),
    });
    assert.equal(invalidPublishFromArchive.status, 409);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('cross-user draft access and reporter-only editorial actions are rejected', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const reporterToken = tokenFor('reporter', 'journalist', 2);
    const adminToken = tokenFor('admin', 'admin', 1);
    const otherRegister = await fetch(`http://127.0.0.1:${server.address().port}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'other-reporter', password: 'password123' }),
    });
    const otherPayload = await otherRegister.json();
    assert.equal(otherRegister.status, 200);
    const otherReporterToken = otherPayload.token;

    const storyCreate = await fetch(`http://127.0.0.1:${server.address().port}/api/stories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${reporterToken}`,
      },
      body: JSON.stringify({ title: 'Owned draft', category: 'News', content: 'A reporter-owned draft', status: 'draft' }),
    });
    const storyJson = await storyCreate.json();
    assert.equal(storyCreate.status, 200);

    const crossUserListing = await fetch(`http://127.0.0.1:${server.address().port}/api/stories?author=reporter`, {
      headers: { Authorization: `Bearer ${otherReporterToken}` },
    });
    assert.equal(crossUserListing.status, 403);

    const crossUserEdit = await fetch(`http://127.0.0.1:${server.address().port}/api/stories/${storyJson.story.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${otherReporterToken}`,
      },
      body: JSON.stringify({ title: 'Cross-user edit', content: 'Nope' }),
    });
    assert.equal(crossUserEdit.status, 403);

    const publishAttempt = await fetch(`http://127.0.0.1:${server.address().port}/api/editorial/stories/${storyJson.story.id}/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${reporterToken}`,
      },
      body: JSON.stringify({ status: 'published' }),
    });
    assert.equal(publishAttempt.status, 403);

    const approveAttempt = await fetch(`http://127.0.0.1:${server.address().port}/api/editorial/stories/${storyJson.story.id}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${reporterToken}`,
      },
      body: JSON.stringify({ notes: 'Should not work' }),
    });
    assert.equal(approveAttempt.status, 403);

    const adminView = await fetch(`http://127.0.0.1:${server.address().port}/api/stories/${storyJson.story.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(adminView.status, 404);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('breaking and featured toggles enforce published-only visibility and authorization', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const adminToken = tokenFor('admin', 'admin', 1);
    const reporterToken = tokenFor('reporter', 'journalist', 2);

    const storyCreate = await fetch(`http://127.0.0.1:${server.address().port}/api/stories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${reporterToken}`,
      },
      body: JSON.stringify({ title: 'Published toggled story', category: 'News', content: 'Ready for breaking and featured toggles', status: 'draft' }),
    });
    const storyJson = await storyCreate.json();
    assert.equal(storyCreate.status, 200);

    const submit = await fetch(`http://127.0.0.1:${server.address().port}/api/stories/${storyJson.story.id}/submit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${reporterToken}` },
    });
    assert.equal(submit.status, 200);

    const review = await fetch(`http://127.0.0.1:${server.address().port}/api/editorial/stories/${storyJson.story.id}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: 'in_review', notes: 'Editorial fact-checking' }),
    });
    assert.equal(review.status, 200);

    const approve = await fetch(`http://127.0.0.1:${server.address().port}/api/editorial/stories/${storyJson.story.id}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ notes: 'Approve for public toggles' }),
    });
    assert.equal(approve.status, 200);

    const publish = await fetch(`http://127.0.0.1:${server.address().port}/api/editorial/stories/${storyJson.story.id}/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: 'published' }),
    });
    assert.equal(publish.status, 200);

    const breakingDenied = await fetch(`http://127.0.0.1:${server.address().port}/api/editorial/stories/${storyJson.story.id}/breaking`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${reporterToken}`,
      },
      body: JSON.stringify({ is_breaking: true }),
    });
    assert.equal(breakingDenied.status, 403);

    const breakingOk = await fetch(`http://127.0.0.1:${server.address().port}/api/editorial/stories/${storyJson.story.id}/breaking`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ is_breaking: true }),
    });
    assert.equal(breakingOk.status, 200);

    const featuredDenied = await fetch(`http://127.0.0.1:${server.address().port}/api/editorial/stories/${storyJson.story.id}/feature`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${reporterToken}`,
      },
      body: JSON.stringify({ featured: true }),
    });
    assert.equal(featuredDenied.status, 403);

    const featuredOk = await fetch(`http://127.0.0.1:${server.address().port}/api/editorial/stories/${storyJson.story.id}/feature`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ featured: true }),
    });
    assert.equal(featuredOk.status, 200);

    const breakingFeed = await fetch(`http://127.0.0.1:${server.address().port}/api/breaking-news`);
    assert.equal(breakingFeed.status, 200);
    const breakingPayload = await breakingFeed.json();
    assert.ok(breakingPayload.stories.some((story) => story.title === 'Published toggled story'));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('scheduled publication and archive visibility stay aligned with server rules', async () => {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const reporterToken = tokenFor('reporter', 'journalist', 2);
    const adminToken = tokenFor('admin', 'admin', 1);

    const created = await fetch(`http://127.0.0.1:${server.address().port}/api/stories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${reporterToken}`,
      },
      body: JSON.stringify({ title: 'Future scheduled story', category: 'News', content: 'Published after its scheduled time', status: 'draft' }),
    });
    const storyJson = await created.json();
    assert.equal(created.status, 200);

    const submit = await fetch(`http://127.0.0.1:${server.address().port}/api/stories/${storyJson.story.id}/submit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${reporterToken}` },
    });
    assert.equal(submit.status, 200);

    const review = await fetch(`http://127.0.0.1:${server.address().port}/api/editorial/stories/${storyJson.story.id}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: 'in_review', notes: 'Ready for scheduling.' }),
    });
    assert.equal(review.status, 200);

    const approve = await fetch(`http://127.0.0.1:${server.address().port}/api/editorial/stories/${storyJson.story.id}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ notes: 'Ready for scheduling' }),
    });
    assert.equal(approve.status, 200);

    const schedule = await fetch(`http://127.0.0.1:${server.address().port}/api/editorial/stories/${storyJson.story.id}/schedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ scheduled_at: new Date(Date.now() + 3600000).toISOString() }),
    });
    assert.equal(schedule.status, 200);

    const publicLookup = await fetch(`http://127.0.0.1:${server.address().port}/api/stories/${storyJson.story.id}`);
    assert.equal(publicLookup.status, 404);

    const scheduledStory = await fetch(`http://127.0.0.1:${server.address().port}/api/stories?status=scheduled`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const scheduledPayload = await scheduledStory.json();
    assert.equal(scheduledStory.status, 200);
    assert.ok(scheduledPayload.stories.some((story) => story.id === storyJson.story.id));

    await app.processScheduledStories({ now: new Date(Date.now() + 3600001), actorId: 1 });

    const archive = await fetch(`http://127.0.0.1:${server.address().port}/api/editorial/stories/${storyJson.story.id}/archive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ reason: 'Archive after publication' }),
    });
    assert.equal(archive.status, 200);

    const archivedLookup = await fetch(`http://127.0.0.1:${server.address().port}/api/stories/${storyJson.story.id}`);
    assert.equal(archivedLookup.status, 404);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
