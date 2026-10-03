// MLT-006: shared SEO helpers (canonical URL generation, escaping, feed/sitemap
// builders). Centralising this logic avoids each route reinventing slightly
// different, possibly unsafe, escaping/URL rules.

const SITE_NAME = 'Mpumalanga Local Time';
const DEFAULT_SITE_URL = 'https://mplocaltime.co.za';

// The production base URL must come from configuration, never from an
// incoming request's Host header (which an attacker can spoof). A documented
// development fallback is used when SITE_URL is not set.
function normalizeSiteUrl(value) {
  const raw = String(value || '').trim() || DEFAULT_SITE_URL;
  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}`;
  } catch (error) {
    return DEFAULT_SITE_URL;
  }
}

const SITE_URL = normalizeSiteUrl(process.env.SITE_URL);

// Builds an absolute URL under SITE_URL, collapsing accidental duplicate
// slashes between the base and the supplied path.
function buildUrl(pathname = '/') {
  const base = SITE_URL.replace(/\/+$/, '');
  const trimmedPath = String(pathname || '/').replace(/^\/+/, '');
  return trimmedPath ? `${base}/${trimmedPath}` : `${base}/`;
}

// Resolves an asset reference (relative path or absolute URL) to an absolute
// URL, or returns null when no real asset value is available. Never invents
// an asset that doesn't exist.
function resolveAssetUrl(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return buildUrl(trimmed);
}

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(value) {
  return escapeHtml(value);
}

// Serializes a plain JS value as JSON, then neutralizes sequences that could
// break out of a surrounding <script> element (</script>, raw &, line/
// paragraph separators) so untrusted story fields can never become
// executable HTML/JavaScript via JSON-LD.
function escapeJsonLd(data) {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function jsonLdScript(data) {
  return `<script type="application/ld+json">${escapeJsonLd(data)}</script>`;
}

// Safely embeds a JS value as a literal inside an inline <script> block.
// JSON.stringify alone is not enough: the HTML parser looks for a literal
// "</script" sequence regardless of JS string-quoting context, so untrusted
// values (e.g. a story title containing "</script><script>...") could still
// break out of the script element. This neutralizes that sequence.
function safeScriptLiteral(value) {
  return escapeJsonLd(value);
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ');
}

// Derives a search-snippet-sized description from arbitrary story content:
// strips markup, collapses whitespace and truncates on a word boundary.
// Never mutates the source story.
function buildDescription(value, { fallback = '', maxLength = 160 } = {}) {
  const text = stripHtml(value || fallback).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  const safeCut = lastSpace > 40 ? truncated.slice(0, lastSpace) : truncated;
  return `${safeCut.trim()}…`;
}

function buildUrlsetXml(urls = []) {
  const body = urls
    .map(({ loc, lastmod }) => {
      const lastmodTag = lastmod ? `<lastmod>${escapeXml(lastmod)}</lastmod>` : '';
      return `  <url><loc>${escapeXml(buildUrl(loc))}</loc>${lastmodTag}</url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

// Google News sitemaps only include recent news articles, not an archive of
// every published story ever. stories should already be filtered to the
// publicly-eligible, recent window before calling this.
function buildNewsSitemapXml(stories = []) {
  const body = stories
    .map((story) => {
      const loc = buildUrl(`/story/${encodeURIComponent(story.slug || story.id)}`);
      const publicationDate = story.published_at ? new Date(story.published_at).toISOString() : '';
      return `  <url>
    <loc>${escapeXml(loc)}</loc>
    <news:news>
      <news:publication>
        <news:name>${escapeXml(SITE_NAME)}</news:name>
        <news:language>en</news:language>
      </news:publication>
      <news:publication_date>${escapeXml(publicationDate)}</news:publication_date>
      <news:title>${escapeXml(story.title || '')}</news:title>
    </news:news>
  </url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n${body}\n</urlset>\n`;
}

function buildRssXml(stories = [], { title = SITE_NAME, link = buildUrl('/'), description = '', language = 'en-za' } = {}) {
  const lastBuildDate = new Date().toUTCString();
  const items = stories
    .map((story) => {
      const url = buildUrl(`/story/${encodeURIComponent(story.slug || story.id)}`);
      const desc = buildDescription(story.meta_description || story.excerpt || story.content, { maxLength: 300 });
      const pubDate = story.published_at ? new Date(story.published_at).toUTCString() : lastBuildDate;
      const categoryTag = story.category ? `\n      <category>${escapeXml(story.category)}</category>` : '';
      const authorTag = story.author ? `\n      <dc:creator>${escapeXml(story.author)}</dc:creator>` : '';
      return `    <item>
      <title>${escapeXml(story.title || '')}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escapeXml(desc)}</description>${categoryTag}${authorTag}
    </item>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">\n  <channel>\n    <title>${escapeXml(title)}</title>\n    <link>${escapeXml(link)}</link>\n    <description>${escapeXml(description)}</description>\n    <language>${escapeXml(language)}</language>\n    <lastBuildDate>${lastBuildDate}</lastBuildDate>\n${items}\n  </channel>\n</rss>\n`;
}

module.exports = {
  SITE_NAME,
  SITE_URL,
  buildUrl,
  resolveAssetUrl,
  escapeHtml,
  escapeXml,
  escapeJsonLd,
  jsonLdScript,
  safeScriptLiteral,
  stripHtml,
  buildDescription,
  buildUrlsetXml,
  buildNewsSitemapXml,
  buildRssXml,
};
