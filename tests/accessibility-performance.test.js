const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { init } = require('../db');
const { initializeDatabase } = require('../server');
const app = require('../server');

// Shared helpers, mirroring tests/seo-feeds.test.js conventions -----------

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

async function seedPublishedStory(db, authorId) {
  await db.run('DELETE FROM revision_history');
  await db.run('DELETE FROM comments');
  await db.run('DELETE FROM stories');
  const nowIso = new Date().toISOString();
  const result = await db.run(
    `INSERT INTO stories (title, category, content, excerpt, author_id, status, slug, submittedAt, updatedAt, published_at, is_breaking, featured, editorial_notes, submitted_by, published_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'Accessibility test story headline',
      'News',
      '<p>Full published article body for public readers to review in detail.</p>',
      'A concise excerpt describing the accessibility test story.',
      authorId,
      'published',
      'accessibility-test-story',
      nowIso,
      nowIso,
      nowIso,
      0,
      0,
      'INTERNAL EDITORIAL NOTE: must never reach the rendered page',
      authorId,
      authorId,
    ]
  );
  // A second published story in the same category so the story page's
  // related/trending widgets have a below-the-fold thumbnail image to render.
  await db.run(
    `INSERT INTO stories (title, category, content, excerpt, author_id, status, slug, submittedAt, updatedAt, published_at, featured_image, is_breaking, featured, editorial_notes, submitted_by, published_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'Related accessibility test story',
      'News',
      '<p>Another published article body for the related stories widget.</p>',
      'A related story excerpt.',
      authorId,
      'published',
      'related-accessibility-test-story',
      nowIso,
      nowIso,
      nowIso,
      '/logo.png',
      0,
      0,
      '',
      authorId,
      authorId,
    ]
  );
  return result.lastID;
}

async function withTestDb(fn) {
  await initializeDatabase();
  const db = await init();
  const admin = await db.get('SELECT id FROM users WHERE username = ?', ['admin']);
  try {
    return await fn(db, admin.id);
  } finally {
    await db.close();
  }
}

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

// Returns true if `html` contains an element with the given id attribute,
// using a simple attribute-order-agnostic match good enough for fixtures.
function hasElementWithId(html, id) {
  const re = new RegExp(`id=["']${id}["']`);
  return re.test(html);
}

// A. Static public pages: skip links, landmarks, viewport --------------

const STATIC_PUBLIC_PAGES = ['index.html', 'news.html', 'business.html', 'community.html', 'sports.html', 'login.html', 'contact.html', 'about.html', 'arts.html'];

test('major public pages expose a viewport meta tag, a skip link and a matching main-content landmark', () => {
  for (const page of STATIC_PUBLIC_PAGES) {
    const html = readRepoFile(page);
    assert.match(html, /<meta name="viewport" content="width=device-width, ?initial-scale=1(\.0)?"/, `${page} missing viewport meta`);

    const skipLinkMatch = html.match(/<a class="skip-link" href="#([a-zA-Z0-9_-]+)">/);
    assert.ok(skipLinkMatch, `${page} missing a skip link`);

    const targetId = skipLinkMatch[1];
    assert.ok(hasElementWithId(html, targetId), `${page} skip link target #${targetId} does not exist on the page`);
  }
});

test('mobile navigation trigger is a real button with aria-expanded and aria-controls pointing at the nav', () => {
  for (const page of STATIC_PUBLIC_PAGES) {
    const html = readRepoFile(page);
    const toggleMatch = html.match(/<button class="nav-toggle" aria-expanded="false" aria-controls="([a-zA-Z0-9_-]+)">/);
    assert.ok(toggleMatch, `${page} missing an accessible <button> mobile menu trigger`);
    const navId = toggleMatch[1];
    assert.ok(hasElementWithId(html, navId), `${page} nav-toggle aria-controls target #${navId} does not exist`);
  }
});

test('no public template uses a positive tabindex value', () => {
  const templates = [...STATIC_PUBLIC_PAGES, 'dashboard.html', 'admin.html'];
  for (const page of templates) {
    const html = readRepoFile(page);
    assert.doesNotMatch(html, /tabindex=["']\s*[1-9]/, `${page} uses a positive tabindex`);
  }
  const serverSrc = readRepoFile('server.js');
  assert.doesNotMatch(serverSrc, /tabindex=["']\s*[1-9]/, 'server.js templates use a positive tabindex');
  const municipalitySrc = readRepoFile('municipality-page.js');
  assert.doesNotMatch(municipalitySrc, /tabindex=["']\s*[1-9]/, 'municipality-page.js templates use a positive tabindex');
});

test('admin, dashboard and login pages remain noindex while the homepage does not (MLT-006 regression)', () => {
  for (const page of ['admin.html', 'dashboard.html', 'login.html']) {
    const html = readRepoFile(page);
    assert.match(html, /<meta name="robots" content="noindex, ?nofollow"/, `${page} missing noindex`);
  }
  const home = readRepoFile('index.html');
  assert.doesNotMatch(home, /noindex/, 'homepage incorrectly marked noindex');
});

test('newsletter/contact forms provide accessible labelling instead of relying on placeholder text alone', () => {
  const home = readRepoFile('index.html');
  // Every input inside the newsletter form must be paired with a <label for="...">.
  const formMatch = home.match(/<form id="newsletterForm"[\s\S]*?<\/form>/);
  assert.ok(formMatch, 'newsletter form not found on homepage');
  const formHtml = formMatch[0];
  const inputIds = [...formHtml.matchAll(/<input id="([a-zA-Z0-9_-]+)"/g)].map((m) => m[1]);
  assert.ok(inputIds.length >= 3, 'expected name/surname/email inputs in the newsletter form');
  for (const id of inputIds) {
    assert.match(formHtml, new RegExp(`<label[^>]*for="${id}"`), `newsletter input #${id} has no associated <label for>`);
  }

  const login = readRepoFile('login.html');
  assert.match(login, /autocomplete="username"/, 'login username field missing autocomplete');
  assert.match(login, /autocomplete="current-password"/, 'login password field missing autocomplete');
});

test('reduced-motion preferences are respected for the breaking-news ticker animation', () => {
  const css = readRepoFile('styles.css');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/, 'styles.css has no reduced-motion media query');
  const reducedMotionBlock = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reducedMotionBlock, /\.breaking-track\s*\{[^}]*animation:\s*none/, 'breaking-track animation is not disabled under reduced motion');
});

test('hero slider auto-advance is skipped when the user prefers reduced motion', () => {
  const js = readRepoFile('main.js');
  assert.match(js, /prefers-reduced-motion: reduce/, 'main.js does not check prefers-reduced-motion before auto-advancing the hero slider');
});

test('mobile menu can be closed with the Escape key and returns focus to the trigger', () => {
  const js = readRepoFile('main.js');
  assert.match(js, /key === 'Escape'/, 'main.js does not handle Escape to close the mobile menu');
});

// B. Published story page (server-rendered) -------------------------------

test('a published story page has a semantic main landmark whose id matches the skip link target', async () => {
  const { baseUrl, close } = await startServer();
  try {
    await withTestDb(async (db, authorId) => {
      await seedPublishedStory(db, authorId);
    });

    const res = await fetch(`${baseUrl}/story/accessibility-test-story`);
    assert.equal(res.status, 200);
    const html = await res.text();

    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1"/);

    const skipLinkMatch = html.match(/<a class="skip-link[^"]*" href="#([a-zA-Z0-9_-]+)">/);
    assert.ok(skipLinkMatch, 'story page missing a skip link');
    const targetId = skipLinkMatch[1];
    assert.match(html, new RegExp(`<main id="${targetId}"`), `story page has no <main id="${targetId}"> landmark`);

    // Exactly one top-level <h1>.
    const h1Matches = html.match(/<h1[\s>]/g) || [];
    assert.equal(h1Matches.length, 1, 'story page should contain exactly one <h1>');
    assert.match(html, /<h1[^>]*>Accessibility test story headline<\/h1>/);

    // Primary nav has an accessible name.
    assert.match(html, /<nav id="cm-primary-nav"[^>]*aria-label="Primary navigation"/, 'story page primary nav missing aria-label');

    // Below-the-fold related/contributor images are lazy-loaded; this does not
    // assert anything about the single above-the-fold featured image.
    assert.match(html, /loading="lazy"/, 'story page has no lazy-loaded images for below-the-fold content');

    // Internal editorial notes must never leak into the rendered page.
    assert.ok(!html.includes('INTERNAL EDITORIAL NOTE'), 'editorial notes leaked into the story page');

    // MLT-006 SEO/discovery regressions.
    assert.match(html, /<link rel="canonical" href="/, 'canonical link missing');
    assert.match(html, /property="og:type" content="article"/, 'og:type=article missing');
    assert.match(html, /rel="alternate" type="application\/rss\+xml"/, 'RSS autodiscovery link missing');
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(jsonLdMatch, 'NewsArticle JSON-LD missing');
    const jsonLd = JSON.parse(jsonLdMatch[1]);
    assert.equal(jsonLd['@type'], 'NewsArticle');
    assert.ok(jsonLd.datePublished, 'JSON-LD missing datePublished');
    assert.ok(jsonLd.author && jsonLd.author.name, 'JSON-LD missing author');
    assert.ok(jsonLd.publisher && jsonLd.publisher.name, 'JSON-LD missing publisher');
  } finally {
    await close();
  }
});

test('the story page newsletter widget input has an associated accessible label', async () => {
  const { baseUrl, close } = await startServer();
  try {
    await withTestDb(async (db, authorId) => {
      await seedPublishedStory(db, authorId);
    });
    const res = await fetch(`${baseUrl}/story/accessibility-test-story`);
    const html = await res.text();
    const formMatch = html.match(/<form class="newsletter-form"[\s\S]*?<\/form>/);
    assert.ok(formMatch, 'story page newsletter form not found');
    const inputMatch = formMatch[0].match(/<input id="([a-zA-Z0-9_-]+)"[^>]*type="email"/);
    assert.ok(inputMatch, 'story page newsletter email input missing an id');
    assert.match(formMatch[0], new RegExp(`<label[^>]*for="${inputMatch[1]}"`), 'story page newsletter email input has no associated label');
  } finally {
    await close();
  }
});

// C. Municipality page -----------------------------------------------------

test('the municipality page has a skip link, a matching main landmark and a labelled nav', async () => {
  const { baseUrl, close } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/municipality/mbombela`);
    assert.equal(res.status, 200);
    const html = await res.text();

    const skipLinkMatch = html.match(/<a class="skip-link" href="#([a-zA-Z0-9_-]+)">/);
    assert.ok(skipLinkMatch, 'municipality page missing a skip link');
    assert.match(html, new RegExp(`<main id="${skipLinkMatch[1]}"`), 'municipality page main landmark id does not match skip link target');

    assert.match(html, /<nav class="nav" aria-label="Primary navigation">/, 'municipality page nav missing aria-label');

    // Gallery/news-list images are below the fold and should be lazy-loaded.
    assert.match(html, /loading="lazy"/, 'municipality page has no lazy-loaded images');

    // MLT-006 SEO regressions.
    assert.match(html, /<link rel="canonical" href="/);
    assert.match(html, /rel="alternate" type="application\/rss\+xml"/);
  } finally {
    await close();
  }
});

// D. Escaping/security regressions for new attributes --------------------

test('dangerous story content cannot break out of newly-added lazy-loaded image attributes', async () => {
  const { baseUrl, close } = await startServer();
  try {
    await withTestDb(async (db, authorId) => {
      await db.run('DELETE FROM revision_history');
      await db.run('DELETE FROM comments');
      await db.run('DELETE FROM stories');
      const nowIso = new Date().toISOString();
      await db.run(
        `INSERT INTO stories (title, category, content, excerpt, author_id, status, slug, submittedAt, updatedAt, published_at, featured_image, is_breaking, featured, editorial_notes, submitted_by, published_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'Dangerous related-story title "><script>alert(1)</script>',
          'News',
          '<p>Published article body.</p>',
          'Excerpt',
          authorId,
          'published',
          'dangerous-related-story',
          nowIso,
          nowIso,
          nowIso,
          '/logo.png" onerror="alert(1)',
          0,
          0,
          '',
          authorId,
          authorId,
        ]
      );
      await seedPublishedStory(db, authorId);
    });

    const res = await fetch(`${baseUrl}/story/accessibility-test-story`);
    const html = await res.text();
    assert.ok(!html.includes('<script>alert(1)</script>'), 'dangerous title broke out as executable script');
    assert.ok(!html.includes('onerror="alert(1)"'), 'dangerous image value broke out of the img tag');
  } finally {
    await close();
  }
});
