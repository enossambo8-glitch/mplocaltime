const test = require('node:test');
const assert = require('node:assert/strict');
const { init } = require('../db');
const { initializeDatabase } = require('../server');
const app = require('../server');
const { SITE_URL } = require('../seo');

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

const INTERNAL_NOTE_MARKER = 'INTERNAL EDITORIAL NOTE: do not expose this to SEO surfaces';
const DANGEROUS_TITLE = 'Breaking </script><script>alert(1)</script> & "quotes" \'apostrophes\'';
const DANGEROUS_EXCERPT = 'Excerpt with </script> tags, & ampersands, "quotes" and <b>markup</b>.';

// Wipes stories and inserts a deterministic fixture set covering every
// visibility state plus content designed to exercise HTML/XML/JSON-LD
// escaping, so SEO surfaces can be tested in isolation.
async function seedSeoStories(db, authorId) {
  await db.run('DELETE FROM revision_history');
  await db.run('DELETE FROM comments');
  await db.run('DELETE FROM stories');

  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const future = iso(now + 60 * 60 * 1000);
  const recentPast = iso(now - 2 * 60 * 60 * 1000); // 2 hours ago: inside the news sitemap window
  const oldPast = iso(now - 7 * 24 * 60 * 60 * 1000); // 7 days ago: outside the news sitemap window
  const nowIso = iso(now);

  const rows = [
    { title: 'Draft story never public', status: 'draft', category: 'News', slug: 'seo-draft-story' },
    { title: 'Submitted story awaiting review', status: 'submitted', category: 'News', slug: 'seo-submitted-story' },
    { title: 'Scheduled future story', status: 'scheduled', category: 'News', slug: 'seo-scheduled-future-story', scheduledAt: future },
    { title: 'Archived story about tenders', status: 'archived', category: 'Business', slug: 'seo-archived-story', publishedAt: oldPast, archivedAt: nowIso },
    { title: 'Older published eligible story', status: 'published', category: 'Community', slug: 'seo-published-old-story', publishedAt: oldPast },
    { title: 'Recent published eligible story', status: 'published', category: 'Sports', slug: 'seo-published-recent-story', publishedAt: recentPast },
    { title: DANGEROUS_TITLE, status: 'published', category: 'News', slug: 'seo-published-dangerous-story', publishedAt: recentPast, excerpt: DANGEROUS_EXCERPT },
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
        row.excerpt || `${row.title} excerpt.`,
        authorId,
        row.status,
        row.slug,
        nowIso,
        nowIso,
        row.publishedAt || null,
        row.scheduledAt || null,
        row.archivedAt || null,
        0,
        0,
        INTERNAL_NOTE_MARKER,
        authorId,
        row.status === 'published' ? authorId : null,
      ]
    );
    ids[row.slug] = result.lastID;
  }
  return ids;
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

function extractJsonLdBlocks(html) {
  const blocks = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let match;
  while ((match = re.exec(html))) {
    blocks.push(JSON.parse(match[1]));
  }
  return blocks;
}

// A. Sitemap -------------------------------------------------------------

test('sitemap.xml exposes only legitimately public URLs using the configured SITE_URL', async () => {
  const { baseUrl, close } = await startServer();
  try {
    await withTestDb(async (db, authorId) => {
      await seedSeoStories(db, authorId);
    });

    const res = await fetch(`${baseUrl}/sitemap.xml`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /application\/xml/);
    const xml = await res.text();

    assert.match(xml, /<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);

    // Homepage present, using configured SITE_URL.
    assert.ok(xml.includes(`<loc>${SITE_URL}/</loc>`), 'homepage missing');

    // Eligible published stories present.
    assert.ok(xml.includes(`${SITE_URL}/story/seo-published-old-story`), 'old published story missing');
    assert.ok(xml.includes(`${SITE_URL}/story/seo-published-recent-story`), 'recent published story missing');

    // Ineligible content absent.
    assert.ok(!xml.includes('seo-draft-story'), 'draft story leaked into sitemap');
    assert.ok(!xml.includes('seo-submitted-story'), 'submitted story leaked into sitemap');
    assert.ok(!xml.includes('seo-scheduled-future-story'), 'future scheduled story leaked into sitemap');
    assert.ok(!xml.includes('seo-archived-story'), 'archived story leaked into sitemap');

    // No newsroom/admin/auth surfaces.
    assert.ok(!xml.includes('/dashboard'), 'dashboard URL leaked into sitemap');
    assert.ok(!xml.includes('/admin'), 'admin URL leaked into sitemap');
    assert.ok(!xml.includes('/login'), 'login URL leaked into sitemap');
    assert.ok(!xml.includes('/api/'), 'API URL leaked into sitemap');

    // No duplicate <loc> entries.
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.equal(new Set(locs).size, locs.length, 'sitemap contains duplicate URLs');
  } finally {
    await close();
  }
});

// B. Google News sitemap --------------------------------------------------

test('news-sitemap.xml uses the Google News namespace and only recent eligible stories', async () => {
  const { baseUrl, close } = await startServer();
  try {
    await withTestDb(async (db, authorId) => {
      await seedSeoStories(db, authorId);
    });

    const res = await fetch(`${baseUrl}/news-sitemap.xml`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /application\/xml/);
    const xml = await res.text();

    assert.match(xml, /xmlns:news="http:\/\/www\.google\.com\/schemas\/sitemap-news\/0\.9"/);
    assert.match(xml, /<news:publication>/);
    assert.match(xml, /<news:name>Mpumalanga Local Time<\/news:name>/);
    assert.match(xml, /<news:language>en<\/news:language>/);

    // Recent eligible story present with its publication date and title.
    assert.ok(xml.includes(`${SITE_URL}/story/seo-published-recent-story`), 'recent eligible story missing');
    assert.match(xml, /<news:publication_date>/);

    // The old published story (7 days ago) falls outside the recency window.
    assert.ok(!xml.includes('seo-published-old-story'), 'stale story should not appear in the news sitemap');

    // Ineligible content absent.
    assert.ok(!xml.includes('seo-draft-story'), 'draft leaked into news sitemap');
    assert.ok(!xml.includes('seo-scheduled-future-story'), 'future scheduled story leaked into news sitemap');
    assert.ok(!xml.includes('seo-archived-story'), 'archived story leaked into news sitemap');
  } finally {
    await close();
  }
});

// C. RSS feed --------------------------------------------------------------

test('rss.xml is a valid RSS 2.0 feed containing only eligible published stories, newest first', async () => {
  const { baseUrl, close } = await startServer();
  try {
    await withTestDb(async (db, authorId) => {
      await seedSeoStories(db, authorId);
    });

    const res = await fetch(`${baseUrl}/rss.xml`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /application\/rss\+xml/);
    const xml = await res.text();

    assert.match(xml, /<rss version="2\.0"/);
    assert.match(xml, /<channel>/);
    assert.match(xml, /<title>Mpumalanga Local Time<\/title>/);

    const recentIndex = xml.indexOf('seo-published-recent-story');
    const oldIndex = xml.indexOf('seo-published-old-story');
    assert.ok(recentIndex !== -1 && oldIndex !== -1, 'expected eligible stories missing from feed');
    assert.ok(recentIndex < oldIndex, 'feed items are not ordered newest-first');

    // Ineligible content absent.
    assert.ok(!xml.includes('seo-draft-story'), 'draft leaked into RSS');
    assert.ok(!xml.includes('seo-submitted-story'), 'submitted story leaked into RSS');
    assert.ok(!xml.includes('seo-scheduled-future-story'), 'future scheduled story leaked into RSS');
    assert.ok(!xml.includes('seo-archived-story'), 'archived story leaked into RSS');

    // Internal editorial information never appears.
    assert.ok(!xml.includes(INTERNAL_NOTE_MARKER), 'editorial note leaked into RSS');

    // Permanent story URLs used for link/guid.
    assert.ok(xml.includes(`<link>${SITE_URL}/story/seo-published-recent-story</link>`), 'RSS item link should use the permanent story URL');
    assert.ok(xml.includes(`<guid isPermaLink="true">${SITE_URL}/story/seo-published-recent-story</guid>`), 'RSS item guid should use the permanent story URL');
  } finally {
    await close();
  }
});

test('feed.xml redirects to the canonical rss.xml feed', async () => {
  const { baseUrl, close } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/feed.xml`, { redirect: 'manual' });
    assert.ok([301, 302].includes(res.status));
    assert.match(res.headers.get('location') || '', /\/rss\.xml$/);
  } finally {
    await close();
  }
});

// D. robots.txt -------------------------------------------------------------

test('robots.txt allows public crawling and references both sitemaps with absolute SITE_URL', async () => {
  const { baseUrl, close } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/robots.txt`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/plain/);
    const body = await res.text();
    assert.match(body, /User-agent: \*/);
    assert.match(body, /Allow: \//);
    assert.ok(body.includes(`Sitemap: ${SITE_URL}/sitemap.xml`));
    assert.ok(body.includes(`Sitemap: ${SITE_URL}/news-sitemap.xml`));
  } finally {
    await close();
  }
});

// E. Story page SEO ----------------------------------------------------------

test('a published story page exposes unique SEO metadata, Open Graph tags, NewsArticle JSON-LD and RSS discovery', async () => {
  const { baseUrl, close } = await startServer();
  try {
    await withTestDb(async (db, authorId) => {
      await seedSeoStories(db, authorId);
    });

    const res = await fetch(`${baseUrl}/story/seo-published-recent-story`);
    assert.equal(res.status, 200);
    const html = await res.text();

    // Title/description/canonical.
    assert.match(html, /<title>Recent published eligible story - Mpumalanga Local Time<\/title>/);
    assert.match(html, /<meta name="description" content="[^"]+"/);
    const canonical = `${SITE_URL}/story/seo-published-recent-story`;
    assert.ok(html.includes(`<link rel="canonical" href="${canonical}" />`), 'canonical URL missing or incorrect');

    // Open Graph.
    assert.ok(html.includes('property="og:type" content="article"'));
    assert.ok(html.includes(`property="og:url" content="${canonical}"`));
    assert.match(html, /property="og:title" content="[^"]+"/);
    assert.match(html, /property="article:published_time" content="[^"]+"/);

    // X/Twitter card.
    assert.match(html, /name="twitter:card" content="(summary|summary_large_image)"/);
    assert.match(html, /name="twitter:title" content="[^"]+"/);

    // RSS autodiscovery.
    assert.ok(html.includes(`<link rel="alternate" type="application/rss+xml" title="Mpumalanga Local Time RSS" href="${SITE_URL}/rss.xml" />`));

    // NewsArticle JSON-LD.
    const jsonLdBlocks = extractJsonLdBlocks(html);
    const newsArticle = jsonLdBlocks.find((block) => block['@type'] === 'NewsArticle');
    assert.ok(newsArticle, 'NewsArticle JSON-LD missing');
    assert.equal(newsArticle['@context'], 'https://schema.org');
    assert.equal(newsArticle.headline, 'Recent published eligible story');
    assert.ok(newsArticle.datePublished, 'datePublished missing');
    assert.ok(newsArticle.author && newsArticle.author.name, 'author missing');
    assert.ok(newsArticle.publisher && newsArticle.publisher.name === 'Mpumalanga Local Time', 'publisher missing');
    assert.equal(newsArticle.url, canonical);
    assert.equal(newsArticle.mainEntityOfPage['@id'], canonical);

    // Internal editorial information never appears.
    assert.ok(!html.includes(INTERNAL_NOTE_MARKER), 'editorial note leaked into story page');
  } finally {
    await close();
  }
});

// F. Escaping / security -----------------------------------------------------

test('dangerous HTML/JSON-LD characters in story fields are safely encoded everywhere they are rendered', async () => {
  const { baseUrl, close } = await startServer();
  try {
    await withTestDb(async (db, authorId) => {
      await seedSeoStories(db, authorId);
    });

    const res = await fetch(`${baseUrl}/story/seo-published-dangerous-story`);
    assert.equal(res.status, 200);
    const html = await res.text();

    // The raw dangerous sequence must never appear unescaped in the page.
    assert.ok(!html.includes('<script>alert(1)</script>'), 'unescaped script payload found in story page');

    // JSON-LD blocks must remain valid, parseable JSON (would throw otherwise)
    // and must not allow a literal </script> to terminate the element early.
    const jsonLdBlocks = extractJsonLdBlocks(html);
    const newsArticle = jsonLdBlocks.find((block) => block['@type'] === 'NewsArticle');
    assert.ok(newsArticle, 'NewsArticle JSON-LD missing for dangerous story');
    assert.ok(newsArticle.headline.includes('</script>'), 'JSON-LD should preserve the original text once safely decoded');

    // RSS/sitemaps must also safely encode the same dangerous title.
    const rssRes = await fetch(`${baseUrl}/rss.xml`);
    const rssXml = await rssRes.text();
    assert.ok(!rssXml.includes('<script>alert(1)</script>'), 'unescaped script payload found in RSS feed');
    assert.ok(rssXml.includes('&lt;/script&gt;') || rssXml.includes('seo-published-dangerous-story'), 'dangerous story should be present but encoded in RSS');

    const sitemapRes = await fetch(`${baseUrl}/news-sitemap.xml`);
    const sitemapXml = await sitemapRes.text();
    assert.ok(!sitemapXml.includes('<script>alert(1)</script>'), 'unescaped script payload found in news sitemap');
  } finally {
    await close();
  }
});

// G. Canonical host header protection ---------------------------------------

test('canonical URLs ignore a spoofed Host header and always use the configured SITE_URL', async () => {
  const { baseUrl, close } = await startServer();
  try {
    await withTestDb(async (db, authorId) => {
      await seedSeoStories(db, authorId);
    });

    const res = await fetch(`${baseUrl}/story/seo-published-recent-story`, {
      headers: { Host: 'evil-attacker.example' },
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes(`${SITE_URL}/story/seo-published-recent-story`), 'canonical URL should use SITE_URL');
    assert.ok(!html.includes('evil-attacker.example'), 'canonical URL leaked the spoofed Host header');

    const sitemapRes = await fetch(`${baseUrl}/sitemap.xml`, { headers: { Host: 'evil-attacker.example' } });
    const sitemapXml = await sitemapRes.text();
    assert.ok(!sitemapXml.includes('evil-attacker.example'), 'sitemap leaked the spoofed Host header');

    const robotsRes = await fetch(`${baseUrl}/robots.txt`, { headers: { Host: 'evil-attacker.example' } });
    const robotsBody = await robotsRes.text();
    assert.ok(!robotsBody.includes('evil-attacker.example'), 'robots.txt leaked the spoofed Host header');
  } finally {
    await close();
  }
});

// H. Municipality SEO ---------------------------------------------------------

test('a municipality page exposes unique SEO metadata using the configured SITE_URL', async () => {
  const { baseUrl, close } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/municipality/mbombela`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<title>Mbombela Municipality News \| Mpumalanga Local Time<\/title>/);
    assert.ok(html.includes(`<link rel="canonical" href="${SITE_URL}/municipality/mbombela" />`));
    assert.ok(html.includes('property="og:site_name" content="Mpumalanga Local Time"'));
    assert.ok(html.includes(`<link rel="alternate" type="application/rss+xml" title="Mpumalanga Local Time RSS" href="${SITE_URL}/rss.xml" />`));

    const jsonLdBlocks = extractJsonLdBlocks(html);
    assert.ok(jsonLdBlocks.length >= 1, 'municipality page should expose JSON-LD');
  } finally {
    await close();
  }
});

// I. Non-public pages are marked noindex --------------------------------------

test('admin, dashboard and login pages are marked noindex while public pages are not', async () => {
  const { baseUrl, close } = await startServer();
  try {
    const admin = await (await fetch(`${baseUrl}/admin.html`)).text();
    const dashboard = await (await fetch(`${baseUrl}/dashboard.html`)).text();
    const login = await (await fetch(`${baseUrl}/login.html`)).text();
    const home = await (await fetch(`${baseUrl}/`)).text();

    assert.match(admin, /<meta name="robots" content="noindex, nofollow" \/>/);
    assert.match(dashboard, /<meta name="robots" content="noindex, nofollow" \/>/);
    assert.match(login, /<meta name="robots" content="noindex, nofollow">/);
    assert.ok(!home.includes('noindex'), 'homepage should not be noindexed');
  } finally {
    await close();
  }
});
