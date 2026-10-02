const test = require('node:test');
const assert = require('node:assert/strict');
const { init } = require('../db');
const { initializeDatabase } = require('../server');
const app = require('../server');

// Shared helpers -------------------------------------------------------

async function startServer() {
  await initializeDatabase();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

// Wipes stories/revision history and inserts a deterministic fixture set
// covering every workflow status so tests have full, isolated control.
async function seedStories(db, authorId) {
  await db.run('DELETE FROM revision_history');
  await db.run('DELETE FROM comments');
  await db.run('DELETE FROM stories');

  const now = new Date();
  const past = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const future = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();

  const rows = [
    { title: 'Draft story about clinics', status: 'draft', category: 'News', slug: 'draft-story-about-clinics' },
    { title: 'Submitted story about roads', status: 'submitted', category: 'News', slug: 'submitted-story-about-roads' },
    { title: 'In review story about schools', status: 'in_review', category: 'News', slug: 'in-review-story-about-schools' },
    { title: 'Changes requested story about water', status: 'changes_requested', category: 'News', slug: 'changes-requested-story-about-water' },
    { title: 'Approved story about electricity', status: 'approved', category: 'News', slug: 'approved-story-about-electricity' },
    { title: 'Scheduled future story about markets', status: 'scheduled', category: 'News', slug: 'scheduled-future-story-about-markets', scheduledAt: future },
    { title: 'Scheduled due story not yet transitioned', status: 'scheduled', category: 'News', slug: 'scheduled-due-story-not-yet-transitioned', scheduledAt: past },
    { title: 'Published eligible story about sport', status: 'published', category: 'Sport', slug: 'published-eligible-story-about-sport', publishedAt: past, isBreaking: 1, featured: 1 },
    { title: 'Published eligible story about business', status: 'published', category: 'Business', slug: 'published-eligible-story-about-business', publishedAt: past },
    { title: 'Published breaking but draft duplicate', status: 'draft', category: 'Sport', slug: 'published-breaking-but-draft-duplicate', isBreaking: 1 },
    { title: 'Archived story about tenders', status: 'archived', category: 'Business', slug: 'archived-story-about-tenders', publishedAt: past, archivedAt: nowIso },
  ];

  const ids = {};
  for (const row of rows) {
    const content = `${row.title} — full published article body for public readers to review in detail.`;
    const result = await db.run(
      `INSERT INTO stories (title, category, content, excerpt, author_id, status, slug, submittedAt, updatedAt, published_at, scheduled_at, archived_at, is_breaking, featured, editorial_notes, submitted_by, published_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.title,
        row.category,
        content,
        `${row.title} excerpt.`,
        authorId,
        row.status,
        row.slug,
        nowIso,
        nowIso,
        row.publishedAt || null,
        row.scheduledAt || null,
        row.archivedAt || null,
        row.isBreaking || 0,
        row.featured || 0,
        'INTERNAL EDITORIAL NOTE: do not expose this to readers',
        authorId,
        row.status === 'published' ? authorId : null,
      ]
    );
    ids[row.slug] = result.lastID;
  }
  return { ids, now, past, future };
}

async function withTestDb(fn) {
  await initializeDatabase();
  const db = await init();
  const admin = await db.get('SELECT id FROM users WHERE username = ?', ['admin']);
  try {
    await fn(db, admin.id);
  } finally {
    await db.close();
  }
}

// A. Public visibility rule --------------------------------------------

test('public visibility: only a legitimately published story is publicly visible', async () => {
  await withTestDb(async (db, authorId) => {
    const { ids } = await seedStories(db, authorId);
    const { baseUrl, close } = await startServer();
    try {
      const hiddenSlugs = [
        'draft-story-about-clinics',
        'submitted-story-about-roads',
        'in-review-story-about-schools',
        'changes-requested-story-about-water',
        'approved-story-about-electricity',
        'scheduled-future-story-about-markets',
        'scheduled-due-story-not-yet-transitioned',
        'archived-story-about-tenders',
      ];
      for (const slug of hiddenSlugs) {
        const res = await fetch(`${baseUrl}/api/stories/${ids[slug]}`);
        assert.equal(res.status, 404, `expected ${slug} to be hidden`);
      }

      const visibleRes = await fetch(`${baseUrl}/api/stories/${ids['published-eligible-story-about-sport']}`);
      assert.equal(visibleRes.status, 200);
      const visiblePayload = await visibleRes.json();
      assert.equal(visiblePayload.story.title, 'Published eligible story about sport');
    } finally {
      await close();
    }
  });
});

// B. Article access ------------------------------------------------------

test('article access: published article retrievable by slug and id, unpublished/archived/invalid are not', async () => {
  await withTestDb(async (db, authorId) => {
    const { ids } = await seedStories(db, authorId);
    const { baseUrl, close } = await startServer();
    try {
      const publishedId = ids['published-eligible-story-about-sport'];
      const bySlug = await fetch(`${baseUrl}/story/published-eligible-story-about-sport`);
      assert.equal(bySlug.status, 200);
      const bodyText = await bySlug.text();
      assert.ok(bodyText.includes('Published eligible story about sport'));

      const byId = await fetch(`${baseUrl}/story/${publishedId}`);
      assert.equal(byId.status, 200);

      const draftRes = await fetch(`${baseUrl}/story/draft-story-about-clinics`);
      assert.equal(draftRes.status, 404);

      const archivedRes = await fetch(`${baseUrl}/story/archived-story-about-tenders`);
      assert.equal(archivedRes.status, 404);
      const archivedText = await archivedRes.text();
      assert.ok(!archivedText.includes('full published article body'));

      const invalidSlugRes = await fetch(`${baseUrl}/story/this-slug-does-not-exist`);
      assert.equal(invalidSlugRes.status, 404);
    } finally {
      await close();
    }
  });
});

// C. Latest/public feed ----------------------------------------------------

test('latest-stories feed only contains published stories, ordered newest published first', async () => {
  await withTestDb(async (db, authorId) => {
    const { ids } = await seedStories(db, authorId);
    // Clear the "featured" flag for this check since the Latest News feed is
    // intentionally separate from the Featured section by existing design.
    await db.run('UPDATE stories SET featured = 0 WHERE id = ?', [ids['published-eligible-story-about-sport']]);
    // Make the business story published more recently than the sport story.
    const recent = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const older = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    await db.run('UPDATE stories SET published_at = ? WHERE id = ?', [recent, ids['published-eligible-story-about-business']]);
    await db.run('UPDATE stories SET published_at = ? WHERE id = ?', [older, ids['published-eligible-story-about-sport']]);

    const { baseUrl, close } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/api/latest-stories?limit=10`);
      assert.equal(res.status, 200);
      const payload = await res.json();
      const titles = payload.stories.map((s) => s.title);
      assert.ok(titles.includes('Published eligible story about business'));
      assert.ok(titles.includes('Published eligible story about sport'));
      assert.ok(!titles.includes('Draft story about clinics'));
      assert.ok(!titles.includes('Archived story about tenders'));
      assert.ok(!titles.includes('Scheduled future story about markets'));
      const businessIndex = titles.indexOf('Published eligible story about business');
      const sportIndex = titles.indexOf('Published eligible story about sport');
      assert.ok(businessIndex < sportIndex, 'newest published_at should sort first');
    } finally {
      await close();
    }
  });
});

// D. Category pages --------------------------------------------------------

test('category endpoint returns only published stories in the requested category', async () => {
  await withTestDb(async (db, authorId) => {
    await seedStories(db, authorId);
    const { baseUrl, close } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/api/category/Sport`);
      assert.equal(res.status, 200);
      const payload = await res.json();
      assert.equal(payload.stories.length, 1);
      assert.equal(payload.stories[0].title, 'Published eligible story about sport');

      const emptyRes = await fetch(`${baseUrl}/api/category/Entertainment`);
      const emptyPayload = await emptyRes.json();
      assert.deepEqual(emptyPayload.stories, []);
    } finally {
      await close();
    }
  });
});

// E. Search -----------------------------------------------------------------

test('search finds eligible published stories, never finds unpublished ones, and hides internal fields', async () => {
  await withTestDb(async (db, authorId) => {
    await seedStories(db, authorId);
    const { baseUrl, close } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/api/search?q=sport`);
      assert.equal(res.status, 200);
      const payload = await res.json();
      assert.ok(payload.results.some((s) => s.title === 'Published eligible story about sport'));

      const result = payload.results.find((s) => s.title === 'Published eligible story about sport');
      assert.equal(result.editorial_notes, undefined);
      assert.equal(result.author_id, undefined);
      assert.equal(result.submitted_by, undefined);
      assert.equal(result.published_by, undefined);
      assert.equal(result.scheduled_at, undefined);
      assert.equal(result.archived_at, undefined);

      const draftSearch = await fetch(`${baseUrl}/api/search?q=clinics`);
      const draftPayload = await draftSearch.json();
      assert.ok(!draftPayload.results.some((s) => s.title === 'Draft story about clinics'));

      const injectionRes = await fetch(`${baseUrl}/api/search?${new URLSearchParams({ q: "sport' OR '1'='1" })}`);
      assert.equal(injectionRes.status, 200);
      const injectionPayload = await injectionRes.json();
      assert.ok(!injectionPayload.results.some((s) => s.status && s.status !== 'published'));
      assert.ok(!injectionPayload.results.some((s) => s.title === 'Draft story about clinics'));

      const emptyRes = await fetch(`${baseUrl}/api/search?q=`);
      const emptyPayload = await emptyRes.json();
      assert.deepEqual(emptyPayload.results, []);
    } finally {
      await close();
    }
  });
});

// F. Breaking / Featured -----------------------------------------------------

test('breaking news and featured story only ever surface published content', async () => {
  await withTestDb(async (db, authorId) => {
    await seedStories(db, authorId);
    const { baseUrl, close } = await startServer();
    try {
      const breakingRes = await fetch(`${baseUrl}/api/breaking-news`);
      assert.equal(breakingRes.status, 200);
      const breakingPayload = await breakingRes.json();
      const breakingTitles = breakingPayload.stories.map((s) => s.title);
      assert.ok(breakingTitles.includes('Published eligible story about sport'));
      assert.ok(!breakingTitles.includes('Published breaking but draft duplicate'));

      const featuredRes = await fetch(`${baseUrl}/api/featured-story`);
      assert.equal(featuredRes.status, 200);
      const featuredPayload = await featuredRes.json();
      assert.ok(featuredPayload.story);
      assert.equal(featuredPayload.story.title, 'Published eligible story about sport');
      assert.notEqual(featuredPayload.story.status, 'draft');
    } finally {
      await close();
    }
  });
});

// G. Related stories ----------------------------------------------------------

test('related stories on an article page only include published stories and exclude the current story', async () => {
  await withTestDb(async (db, authorId) => {
    const { ids } = await seedStories(db, authorId);
    // Give the archived "Business" story the same category as a published one
    // so it would appear as "related" if visibility were not enforced.
    await db.run('UPDATE stories SET category = ? WHERE id = ?', ['Business', ids['archived-story-about-tenders']]);
    const { baseUrl, close } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/story/published-eligible-story-about-business`);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.ok(!html.includes('Archived story about tenders'));
      assert.ok(!html.includes('/story/published-eligible-story-about-business">Published eligible story about business<'));
    } finally {
      await close();
    }
  });
});

// H. Scheduled publishing integration -----------------------------------------

test('scheduled stories only become public after the scheduler transitions them to published', async () => {
  await withTestDb(async (db, authorId) => {
    const { ids, now } = await seedStories(db, authorId);
    const { baseUrl, close } = await startServer();
    try {
      const futureId = ids['scheduled-future-story-about-markets'];
      const dueId = ids['scheduled-due-story-not-yet-transitioned'];

      let res = await fetch(`${baseUrl}/api/stories/${futureId}`);
      assert.equal(res.status, 404);
      res = await fetch(`${baseUrl}/api/stories/${dueId}`);
      assert.equal(res.status, 404, 'due-but-not-yet-transitioned scheduled story must remain hidden');

      await app.processScheduledStories({ db, now, actorId: authorId });

      res = await fetch(`${baseUrl}/api/stories/${dueId}`);
      assert.equal(res.status, 200, 'story becomes public only after the scheduler publishes it');
      const payload = await res.json();
      assert.equal(payload.story.status, 'published');

      res = await fetch(`${baseUrl}/api/stories/${futureId}`);
      assert.equal(res.status, 404, 'future scheduled story is still hidden after running the scheduler');
    } finally {
      await close();
    }
  });
});

// I. Security -----------------------------------------------------------------

test('public responses never leak internal workflow metadata or editorial notes', async () => {
  await withTestDb(async (db, authorId) => {
    const { ids } = await seedStories(db, authorId);
    const { baseUrl, close } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/api/stories/${ids['published-eligible-story-about-sport']}`);
      const payload = await res.json();
      const serialized = JSON.stringify(payload);
      assert.ok(!serialized.includes('INTERNAL EDITORIAL NOTE'));
      assert.equal(payload.story.editorial_notes, undefined);
      assert.equal(payload.story.author_id, undefined);

      const articleRes = await fetch(`${baseUrl}/story/published-eligible-story-about-sport`);
      const articleHtml = await articleRes.text();
      assert.ok(!articleHtml.includes('INTERNAL EDITORIAL NOTE'));
    } finally {
      await close();
    }
  });
});
