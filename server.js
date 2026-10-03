require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sanitizeHtml = require('sanitize-html');
const { init, queueDatabaseOperation } = require('./db');
const {
  MUNICIPALITIES,
  getMunicipalityBySlug,
  getMunicipalityArticles,
  buildMunicipalityPageHtml,
  buildMunicipalityListHtml,
} = require('./municipality-page');
const {
  SITE_NAME,
  SITE_URL,
  buildUrl,
  resolveAssetUrl,
  jsonLdScript,
  safeScriptLiteral,
  buildDescription,
  buildUrlsetXml,
  buildNewsSitemapXml,
  buildRssXml,
} = require('./seo');

// Google News sitemaps are expected to cover only very recent articles, not a
// full archive. 48 hours matches Google's published-news recency guidance.
const NEWS_SITEMAP_WINDOW_HOURS = 48;
// Reasonable cap so the RSS feed never dumps the entire stories table.
const RSS_FEED_LIMIT = 50;

const JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const INITIAL_PASSWORD = process.env.INITIAL_PASSWORD || '';
const INITIAL_USER_PASSWORD = process.env.INITIAL_USER_PASSWORD || '';
const SEED_DEMO_USERS = Boolean(INITIAL_PASSWORD && INITIAL_USER_PASSWORD);
const CANONICAL_ROLES = ['admin', 'editor', 'journalist', 'contributor', 'user'];
const AD_PLACEMENTS = ['homepage_top', 'homepage_mid', 'homepage_sidebar', 'article_top', 'article_inline', 'article_sidebar', 'article_bottom', 'category_top', 'category_sidebar', 'municipality_top', 'municipality_sidebar'];

function normalizeAdsensePublisherId(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (!/^ca-pub-[0-9]+$/i.test(raw)) return '';
  return raw;
}

function normalizeAdsTxtEntry(value) {
  const raw = String(value ?? '').trim();
  if (!raw || /[<>]/.test(raw)) return '';
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (!/^google\.com,\s*(?:ca-pub-|pub-)[A-Za-z0-9-]+,\s*(?:DIRECT|RESELLER),\s*[A-Za-z0-9]+$/i.test(normalized)) {
    return '';
  }
  return normalized;
}

function getAdsenseConfig() {
  const enabled = String(process.env.ADSENSE_ENABLED || '').trim().toLowerCase() === 'true';
  const publisherId = normalizeAdsensePublisherId(process.env.ADSENSE_PUBLISHER_ID || '');
  const adsTxtEntry = normalizeAdsTxtEntry(process.env.ADSENSE_ADS_TXT_ENTRY || '');
  return {
    enabled,
    publisherId,
    adsTxtEntry,
    isReady: enabled && Boolean(publisherId),
  };
}

function getAdsenseScriptTag() {
  const { enabled, publisherId } = getAdsenseConfig();
  if (!enabled || !publisherId) return '';
  const safePublisherId = String(publisherId).replace(/[\"'<>\u0000-\u001F]/g, '');
  return `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(safePublisherId)}" crossorigin="anonymous"></script>`;
}

function injectAdsenseScriptIntoHtml(html) {
  if (typeof html !== 'string' || !html.includes('</head>')) return html;
  const scriptTag = getAdsenseScriptTag();
  if (!scriptTag) return html;
  return html.replace(/<\/head>/i, `${scriptTag}\n</head>`);
}

function sendHtmlFileWithAdsense(res, filePath) {
  try {
    const html = fs.readFileSync(filePath, 'utf8');
    return res.type('text/html; charset=utf-8').send(injectAdsenseScriptIntoHtml(html));
  } catch (error) {
    return res.status(500).send('Unable to read page template.');
  }
}

let hasResetTestDatabase = false;
const ROLE_ALIASES = {
  admin: 'admin',
  editor: 'editor',
  'sub-editor': 'editor',
  'managing-editor': 'editor',
  'assistant-editor': 'editor',
  journalist: 'journalist',
  reporter: 'journalist',
  author: 'contributor',
  contributor: 'contributor',
  writer: 'contributor',
  user: 'user',
  reader: 'user'
};

function normalizeRoleName(value, fallback = 'user') {
  const raw = String(value ?? fallback).trim().toLowerCase();
  if (!raw) return fallback;
  if (ROLE_ALIASES[raw]) return ROLE_ALIASES[raw];
  return CANONICAL_ROLES.includes(raw) ? raw : fallback;
}

function normalizeAdvertPlacement(value) {
  const raw = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return AD_PLACEMENTS.includes(raw) ? raw : 'homepage_top';
}

function parseAdvertDate(value, mode = 'start') {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const isEnd = mode === 'end';
    const suffix = isEnd ? 'T23:59:59.999Z' : 'T00:00:00.000Z';
    return new Date(`${raw}${suffix}`).getTime();
  }
  return parsed.getTime();
}

function isCampaignEligibleNow(campaign, referenceDate = new Date()) {
  if (!campaign) return false;
  const status = String(campaign.status || '').trim().toLowerCase();
  if (!['active', 'scheduled'].includes(status)) return false;
  const now = referenceDate.getTime();
  const startDate = parseAdvertDate(campaign.start_date, 'start');
  const endDate = parseAdvertDate(campaign.end_date, 'end');
  if (startDate !== null && startDate > now) return false;
  if (endDate !== null && endDate < now) return false;
  return true;
}

function normalizeAdvertStatus(value, fallback = 'draft') {
  const raw = String(value ?? fallback).trim().toLowerCase().replace(/\s+/g, '_');
  const statuses = ['draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled'];
  return statuses.includes(raw) ? raw : fallback;
}

function isSafeAdvertUrl(rawValue) {
  if (typeof rawValue !== 'string') return false;
  const value = rawValue.trim();
  if (!value) return false;
  const lower = value.toLowerCase();
  if (['javascript:', 'data:', 'vbscript:'].some((prefix) => lower.startsWith(prefix))) return false;
  try {
    const parsed = new URL(value, 'https://example.com');
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch (error) {
    return false;
  }
}

function parseAdvertContext(req) {
  const query = req?.query || {};
  return {
    category: String(query.category || '').trim(),
    municipality: String(query.municipality || '').trim(),
    district: String(query.district || '').trim(),
    town: String(query.town || '').trim(),
  };
}

function matchesAdvertTarget(ad, context) {
  if (!ad || !ad.target_scope || ad.target_scope === 'all') return true;
  const targetValue = String(ad.target_value || '').trim().toLowerCase();
  const category = String(context.category || '').trim().toLowerCase();
  const municipality = String(context.municipality || '').trim().toLowerCase();
  const district = String(context.district || '').trim().toLowerCase();
  const town = String(context.town || '').trim().toLowerCase();
  if (ad.target_scope === 'category') return targetValue === category;
  if (ad.target_scope === 'municipality') return targetValue === municipality;
  if (ad.target_scope === 'district') return targetValue === district;
  if (ad.target_scope === 'town') return targetValue === town;
  return true;
}

function parseNumericParam(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatParam(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCanonicalRole(value, { allowDefaultUser = true, fallback = 'user' } = {}) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return allowDefaultUser ? fallback : null;
  const candidate = ROLE_ALIASES[raw] ?? raw;
  if (!CANONICAL_ROLES.includes(candidate)) return null;
  return candidate;
}

function isActiveAccount(value) {
  const numeric = Number(value ?? 1);
  return String(value ?? '1') === '0' || numeric === 0 || value === false ? false : true;
}

function safeUserObject(user = {}) {
  return {
    id: Number(user.id),
    username: String(user.username || ''),
    role: normalizeRoleName(user.role, 'user'),
    bio: String(user.bio || ''),
    avatar: String(user.avatar || '/logo.png'),
    is_active: isActiveAccount(user.is_active),
  };
}

const DEFAULT_ADMIN = {
  username: 'admin',
  passwordEnv: INITIAL_PASSWORD || 'changeme',
  bio: 'Publisher and managing editor of Mpumalanga Local Time.',
  avatar: '/logo.png',
  role: 'admin'
};
const DEFAULT_USER = {
  username: 'reporter',
  passwordEnv: INITIAL_USER_PASSWORD || 'contributor',
  bio: 'Contributor covering local stories across Mpumalanga.',
  avatar: '/logo.png',
  role: 'journalist'
};

const MEDIA_UPLOAD_ROOT = process.env.MEDIA_UPLOAD_DIR ? path.resolve(process.env.MEDIA_UPLOAD_DIR) : path.join(__dirname, 'public', 'uploads', 'news');
const MAX_MEDIA_UPLOAD_BYTES = Number.parseInt(process.env.MEDIA_MAX_BYTES || String(10 * 1024 * 1024), 10) || 10 * 1024 * 1024;
const ALLOWED_MEDIA_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_MEDIA_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function sanitizePlainText(value, maxLength = 2000) {
  const raw = typeof value === 'string' ? value : String(value ?? '');
  const withoutTags = raw.replace(/<[^>]+>/g, ' ');
  return withoutTags.replace(/\0/g, '').replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeMediaUrl(storedName = '') {
  const safeName = String(storedName || '').trim();
  if (!safeName) return '';
  return `/uploads/news/${safeName}`;
}

function normalizeMediaRecord(item = {}) {
  const safeItem = { ...item };
  delete safeItem.author_id;
  delete safeItem.authorId;
  delete safeItem.author;
  delete safeItem.stored_name;
  delete safeItem.storedName;
  const storedName = String(item.stored_name || item.storedName || '');
  const publicUrl = String(item.public_url || item.url || normalizeMediaUrl(storedName) || '').trim();
  return {
    ...safeItem,
    id: Number(item.id || 0),
    original_name: item.original_name || item.originalName || '',
    mime_type: item.mime_type || item.mimeType || 'image/jpeg',
    size: Number(item.size || item.size_bytes || 0),
    size_bytes: Number(item.size || item.size_bytes || 0),
    caption: sanitizePlainText(item.caption || '', 255),
    alt_text: sanitizePlainText(item.alt_text || item.altText || '', 255),
    credit: sanitizePlainText(item.credit || '', 255),
    width: Number(item.width || 0),
    height: Number(item.height || 0),
    public_url: publicUrl,
    url: publicUrl,
    createdAt: item.createdAt || item.created_at || new Date().toISOString(),
    updatedAt: item.updatedAt || item.updated_at || item.createdAt || item.created_at || new Date().toISOString(),
  };
}

function getImageSignatureType(buffer) {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) return 'png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function readImageDimensions(buffer) {
  const signature = getImageSignatureType(buffer);
  if (!signature) return { width: 0, height: 0 };

  if (signature === 'png') {
    if (buffer.length < 24) return { width: 0, height: 0 };
    return { width: buffer.readUInt32BE(8), height: buffer.readUInt32BE(12) };
  }

  if (signature === 'jpeg') {
    let offset = 2;
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker >= 0xc0 && marker <= 0xdf) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        return { width, height };
      }
      const length = buffer.readUInt16BE(offset + 2);
      offset += 2 + length;
    }
    return { width: 0, height: 0 };
  }

  if (signature === 'webp') {
    return { width: 0, height: 0 };
  }

  return { width: 0, height: 0 };
}

async function validateUploadedMediaFile(filePath, originalName = '', mimeType = '') {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('uploaded file is missing');
  }
  const imageBuffer = fs.readFileSync(filePath);
  if (!imageBuffer || imageBuffer.length === 0) {
    throw new Error('uploaded file is empty');
  }
  if (imageBuffer.length > MAX_MEDIA_UPLOAD_BYTES) {
    throw new Error(`uploaded file exceeds the ${MAX_MEDIA_UPLOAD_BYTES} byte limit`);
  }

  const name = String(originalName || '');
  const ext = path.extname(name).toLowerCase();
  const normalizedMime = String(mimeType || '').toLowerCase();
  const expectedMime = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  }[ext];

  if (!ALLOWED_MEDIA_EXTENSIONS.has(ext) || !ALLOWED_MEDIA_MIME_TYPES.has(normalizedMime)) {
    throw new Error('unsupported image type');
  }
  if (expectedMime && normalizedMime && expectedMime !== normalizedMime) {
    throw new Error('image extension and mime type do not match');
  }

  const signature = getImageSignatureType(imageBuffer);
  if (!signature) {
    throw new Error('uploaded file is not a valid JPEG, PNG, or WebP image');
  }

  const mimeForSignature = {
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  }[signature];
  if (!mimeForSignature) {
    throw new Error('uploaded file is not a valid JPEG, PNG, or WebP image');
  }
  if (normalizedMime && normalizedMime !== mimeForSignature) {
    throw new Error('image content and declared mime type do not match');
  }
  if (expectedMime && expectedMime !== mimeForSignature) {
    throw new Error('image extension and file content do not match');
  }

  const dimensions = readImageDimensions(imageBuffer);
  return { width: Number(dimensions.width || 0), height: Number(dimensions.height || 0), mimeType: mimeForSignature };
}

function safeMediaStorageFilename(originalName = '', mimeType = '') {
  const ext = path.extname(String(originalName || '')).toLowerCase();
  const normalizedMime = String(mimeType || '').toLowerCase();
  const mapping = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
  };
  const chosenExt = mapping[normalizedMime] || ext || '.jpg';
  if (!ALLOWED_MEDIA_EXTENSIONS.has(chosenExt)) {
    throw new Error('unsupported image type');
  }
  return `${crypto.randomUUID()}${chosenExt}`;
}

function removeFileIfExists(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    // Ignore cleanup failures for runtime artifacts.
  }
}

async function ensureMediaColumns(db) {
  const columns = await db.all('PRAGMA table_info(media)');
  const names = columns.map((column) => column.name);
  const additions = [
    ['public_url', 'TEXT'],
    ['alt_text', 'TEXT'],
    ['credit', 'TEXT'],
    ['width', 'INTEGER DEFAULT 0'],
    ['height', 'INTEGER DEFAULT 0'],
    ['updatedAt', 'TEXT'],
    ['original_filename', 'TEXT'],
  ];
  for (const [column, definition] of additions) {
    if (!names.includes(column)) {
      await db.run(`ALTER TABLE media ADD COLUMN ${column} ${definition}`);
    }
  }
  if (!names.includes('stored_name')) {
    await db.run('ALTER TABLE media ADD COLUMN stored_name TEXT NOT NULL DEFAULT ""');
  }
}

async function initializeDatabase() {
  return queueDatabaseOperation(async () => {
    const db = await init();
    try {
      await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        bio TEXT,
        avatar TEXT,
        role TEXT NOT NULL DEFAULT 'user',
        is_active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS districts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        province TEXT NOT NULL DEFAULT 'Mpumalanga',
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS municipalities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        district_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        province TEXT NOT NULL DEFAULT 'Mpumalanga',
        created_at TEXT,
        updated_at TEXT,
        FOREIGN KEY(district_id) REFERENCES districts(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS towns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        municipality_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        province TEXT NOT NULL DEFAULT 'Mpumalanga',
        created_at TEXT,
        updated_at TEXT,
        FOREIGN KEY(municipality_id) REFERENCES municipalities(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS stories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        category TEXT,
        content TEXT,
        author_id INTEGER,
        submittedAt TEXT,
        views INTEGER DEFAULT 0,
        featured INTEGER DEFAULT 0,
        featured_image TEXT,
        excerpt TEXT,
        reading_time INTEGER DEFAULT 5,
        is_breaking INTEGER DEFAULT 0,
        status TEXT DEFAULT 'draft',
        editorial_notes TEXT,
        updatedAt TEXT,
        slug TEXT,
        seo_title TEXT,
        meta_description TEXT,
        tags TEXT,
        district TEXT,
        municipality TEXT,
        town TEXT,
        district_id INTEGER,
        municipality_id INTEGER,
        town_id INTEGER,
        subheadline TEXT,
        image_alt TEXT,
        image_caption TEXT,
        image_credit TEXT,
        submitted_by INTEGER,
        submitted_at TEXT,
        published_at TEXT,
        published_by INTEGER,
        scheduled_at TEXT,
        archived_at TEXT,
        FOREIGN KEY(author_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY(district_id) REFERENCES districts(id) ON DELETE SET NULL,
        FOREIGN KEY(municipality_id) REFERENCES municipalities(id) ON DELETE SET NULL,
        FOREIGN KEY(town_id) REFERENCES towns(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS editorial_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        story_id INTEGER NOT NULL UNIQUE,
        quality_score REAL DEFAULT 0,
        grammar_score REAL DEFAULT 0,
        readability_score REAL DEFAULT 0,
        seo_score REAL DEFAULT 0,
        originality_score REAL DEFAULT 0,
        headline_score REAL DEFAULT 0,
        human_writing_confidence REAL DEFAULT 0,
        ai_writing_probability REAL DEFAULT 0,
        confidence_level TEXT DEFAULT 'medium',
        fact_check_status TEXT DEFAULT 'needs-verification',
        sources_count INTEGER DEFAULT 0,
        quotes_count INTEGER DEFAULT 0,
        images_count INTEGER DEFAULT 0,
        reading_time INTEGER DEFAULT 0,
        recommendations TEXT,
        notes TEXT,
        created_at TEXT,
        updated_at TEXT,
        FOREIGN KEY(story_id) REFERENCES stories(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS revision_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        story_id INTEGER NOT NULL,
        action TEXT,
        notes TEXT,
        created_at TEXT,
        actor_id INTEGER,
        previous_status TEXT,
        new_status TEXT,
        FOREIGN KEY(story_id) REFERENCES stories(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS editorial_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        story_id INTEGER NOT NULL,
        user_id INTEGER,
        note TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(story_id) REFERENCES stories(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS story_corrections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        story_id INTEGER NOT NULL,
        user_id INTEGER,
        note TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(story_id) REFERENCES stories(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        story_id INTEGER NOT NULL,
        author TEXT,
        text TEXT,
        at TEXT,
        FOREIGN KEY(story_id) REFERENCES stories(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS advertisers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_name TEXT NOT NULL,
        contact_name TEXT,
        email TEXT,
        phone TEXT,
        website TEXT,
        status TEXT DEFAULT 'active',
        notes TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS ad_campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        advertiser_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        start_date TEXT,
        end_date TEXT,
        status TEXT DEFAULT 'draft',
        target_scope TEXT DEFAULT 'all',
        target_value TEXT,
        pricing_model TEXT DEFAULT 'fixed',
        agreed_amount REAL DEFAULT 0,
        currency TEXT DEFAULT 'ZAR',
        created_at TEXT,
        updated_at TEXT,
        FOREIGN KEY(advertiser_id) REFERENCES advertisers(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS advertisements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        image_url TEXT NOT NULL,
        destination_url TEXT NOT NULL,
        alt_text TEXT,
        placement TEXT NOT NULL DEFAULT 'homepage_top',
        status TEXT DEFAULT 'active',
        label TEXT DEFAULT 'Advertisement',
        created_at TEXT,
        updated_at TEXT,
        FOREIGN KEY(campaign_id) REFERENCES ad_campaigns(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS ad_impressions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        advertisement_id INTEGER NOT NULL,
        campaign_id INTEGER NOT NULL,
        placement TEXT NOT NULL,
        created_at TEXT,
        FOREIGN KEY(advertisement_id) REFERENCES advertisements(id) ON DELETE CASCADE,
        FOREIGN KEY(campaign_id) REFERENCES ad_campaigns(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS ad_clicks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        advertisement_id INTEGER NOT NULL,
        campaign_id INTEGER NOT NULL,
        placement TEXT NOT NULL,
        referer TEXT,
        created_at TEXT,
        FOREIGN KEY(advertisement_id) REFERENCES advertisements(id) ON DELETE CASCADE,
        FOREIGN KEY(campaign_id) REFERENCES ad_campaigns(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS correction_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT,
        article_url TEXT,
        issue_type TEXT,
        description TEXT,
        supporting_documents TEXT,
        status TEXT DEFAULT 'new',
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS media (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original_name TEXT NOT NULL,
        stored_name TEXT NOT NULL,
        mime_type TEXT,
        size INTEGER DEFAULT 0,
        caption TEXT,
        alt_text TEXT,
        credit TEXT,
        public_url TEXT,
        width INTEGER DEFAULT 0,
        height INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT,
        author_id INTEGER,
        FOREIGN KEY(author_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS breaking_news (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        headline TEXT NOT NULL,
        slug TEXT,
        article_id INTEGER,
        priority INTEGER DEFAULT 0,
        published_at TEXT,
        expires_at TEXT,
        status TEXT DEFAULT 'active',
        created_by INTEGER,
        created_at TEXT,
        FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        story_id INTEGER NOT NULL,
        author_id INTEGER,
        author_name TEXT,
        text TEXT NOT NULL,
        parent_id INTEGER DEFAULT 0,
        likes INTEGER DEFAULT 0,
        dislikes INTEGER DEFAULT 0,
        reported INTEGER DEFAULT 0,
        pinned INTEGER DEFAULT 0,
        status TEXT DEFAULT 'approved',
        created_at TEXT,
        updated_at TEXT,
        FOREIGN KEY(story_id) REFERENCES stories(id) ON DELETE CASCADE,
        FOREIGN KEY(author_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS newsletter_subscribers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        surname TEXT,
        email TEXT UNIQUE NOT NULL,
        province TEXT,
        preferences TEXT,
        frequency TEXT DEFAULT 'weekly',
        breaking_alerts INTEGER DEFAULT 0,
        created_at TEXT,
        status TEXT DEFAULT 'active'
      );
      CREATE TABLE IF NOT EXISTS push_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        email TEXT,
        province TEXT,
        categories TEXT,
        enabled INTEGER DEFAULT 1,
        created_at TEXT,
        updated_at TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS weather_locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        municipality TEXT NOT NULL,
        slug TEXT,
        temperature TEXT,
        condition TEXT,
        humidity TEXT,
        wind_speed TEXT,
        sunrise TEXT,
        sunset TEXT,
        rain_probability TEXT,
        forecast TEXT,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        body TEXT,
        category TEXT,
        province TEXT,
        sent_at TEXT,
        delivered INTEGER DEFAULT 0,
        clicks INTEGER DEFAULT 0,
        status TEXT DEFAULT 'queued'
      );
      CREATE TABLE IF NOT EXISTS artists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        slug TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        stage_name TEXT,
        bio TEXT,
        province TEXT,
        municipality TEXT,
        city TEXT,
        discipline TEXT,
        disciplines TEXT,
        languages TEXT,
        years_experience INTEGER DEFAULT 0,
        awards TEXT,
        education TEXT,
        gallery TEXT,
        videos TEXT,
        music TEXT,
        portfolio TEXT,
        social_links TEXT,
        website TEXT,
        email TEXT,
        availability TEXT DEFAULT 'Available',
        booking_status TEXT DEFAULT 'Open for bookings',
        verified INTEGER DEFAULT 0,
        followers_count INTEGER DEFAULT 0,
        reviews_count INTEGER DEFAULT 0,
        profile_photo TEXT,
        cover_image TEXT,
        featured INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS artist_bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        artist_id INTEGER NOT NULL,
        client_name TEXT NOT NULL,
        organisation TEXT,
        email TEXT,
        phone TEXT,
        event_date TEXT,
        venue TEXT,
        budget TEXT,
        message TEXT,
        status TEXT DEFAULT 'new',
        created_at TEXT,
        FOREIGN KEY(artist_id) REFERENCES artists(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS artist_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        artist_id INTEGER NOT NULL,
        reviewer_name TEXT NOT NULL,
        rating INTEGER DEFAULT 5,
        comment TEXT,
        verified_booking INTEGER DEFAULT 0,
        created_at TEXT,
        FOREIGN KEY(artist_id) REFERENCES artists(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS creative_organisations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        category TEXT,
        province TEXT,
        municipality TEXT,
        city TEXT,
        bio TEXT,
        website TEXT,
        email TEXT,
        phone TEXT,
        featured INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS venues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        category TEXT,
        province TEXT,
        municipality TEXT,
        city TEXT,
        address TEXT,
        capacity TEXT,
        website TEXT,
        featured INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        category TEXT,
        province TEXT,
        municipality TEXT,
        city TEXT,
        venue TEXT,
        start_date TEXT,
        end_date TEXT,
        description TEXT,
        featured INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS opportunities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        category TEXT,
        province TEXT,
        municipality TEXT,
        deadline TEXT,
        description TEXT,
        featured INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipient_id INTEGER,
        sender_name TEXT,
        sender_email TEXT,
        subject TEXT,
        message TEXT,
        status TEXT DEFAULT 'new',
        created_at TEXT,
        updated_at TEXT
      );
    `);

    const userColumns = await db.all(`PRAGMA table_info(users)`);
    const columnNames = userColumns.map((col) => col.name);
    if (!columnNames.includes('bio')) {
      await db.run(`ALTER TABLE users ADD COLUMN bio TEXT`);
    }
    if (!columnNames.includes('avatar')) {
      await db.run(`ALTER TABLE users ADD COLUMN avatar TEXT`);
    }
    if (!columnNames.includes('role')) {
      await db.run(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`);
      await db.run(`UPDATE users SET role = 'user' WHERE role IS NULL`);
    } else {
      await db.run(`UPDATE users SET role = 'user' WHERE role IS NULL`);
    }
    if (!columnNames.includes('is_active')) {
      await db.run(`ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`);
      await db.run(`UPDATE users SET is_active = 1 WHERE is_active IS NULL`);
    } else {
      await db.run(`UPDATE users SET is_active = 1 WHERE is_active IS NULL`);
    }

    const legacyUsers = await db.all(`SELECT id, role FROM users`);
    for (const user of legacyUsers) {
      const normalized = normalizeRoleName(user.role, 'user');
      if (normalized !== String(user.role || '').trim().toLowerCase()) {
        await db.run(`UPDATE users SET role = ? WHERE id = ?`, [normalized, user.id]);
      }
    }

    const storyColumns = await db.all('PRAGMA table_info(stories)');
    const storyColumnNames = storyColumns.map((column) => column.name);
    const mediaColumns = await db.all('PRAGMA table_info(media)');
    const mediaColumnNames = mediaColumns.map((column) => column.name);
    await ensureMediaColumns(db);
    const commentColumns = await db.all('PRAGMA table_info(comments)');
    const commentColumnNames = commentColumns.map((column) => column.name);
    const breakingNewsColumns = await db.all('PRAGMA table_info(breaking_news)');
    const breakingNewsColumnNames = breakingNewsColumns.map((column) => column.name);
    const newsletterColumns = await db.all('PRAGMA table_info(newsletter_subscribers)');
    const newsletterColumnNames = newsletterColumns.map((column) => column.name);
    if (!storyColumnNames.includes('is_breaking')) {
      await db.run('ALTER TABLE stories ADD COLUMN is_breaking INTEGER DEFAULT 0');
    }
    if (!storyColumnNames.includes('status')) {
      await db.run("ALTER TABLE stories ADD COLUMN status TEXT DEFAULT 'draft'");
    }
    if (!storyColumnNames.includes('published_at')) {
      await db.run('ALTER TABLE stories ADD COLUMN published_at TEXT');
    }
    if (!storyColumnNames.includes('archived_at')) {
      await db.run('ALTER TABLE stories ADD COLUMN archived_at TEXT');
    }
    if (!storyColumnNames.includes('published_at')) {
      await db.run('ALTER TABLE stories ADD COLUMN published_at TEXT');
    }
    if (!storyColumnNames.includes('archived_at')) {
      await db.run('ALTER TABLE stories ADD COLUMN archived_at TEXT');
    }
    if (!storyColumnNames.includes('editorial_notes')) {
      await db.run('ALTER TABLE stories ADD COLUMN editorial_notes TEXT');
    }
    if (!storyColumnNames.includes('updatedAt')) {
      await db.run('ALTER TABLE stories ADD COLUMN updatedAt TEXT');
    }
    if (!storyColumnNames.includes('slug')) {
      await db.run('ALTER TABLE stories ADD COLUMN slug TEXT');
    }
    if (!storyColumnNames.includes('seo_title')) {
      await db.run('ALTER TABLE stories ADD COLUMN seo_title TEXT');
    }
    if (!storyColumnNames.includes('meta_description')) {
      await db.run('ALTER TABLE stories ADD COLUMN meta_description TEXT');
    }
    if (!storyColumnNames.includes('tags')) {
      await db.run('ALTER TABLE stories ADD COLUMN tags TEXT');
    }
    if (!storyColumnNames.includes('district')) {
      await db.run('ALTER TABLE stories ADD COLUMN district TEXT');
    }
    if (!storyColumnNames.includes('municipality')) {
      await db.run('ALTER TABLE stories ADD COLUMN municipality TEXT');
    }
    if (!storyColumnNames.includes('town')) {
      await db.run('ALTER TABLE stories ADD COLUMN town TEXT');
    }
    if (!storyColumnNames.includes('district_id')) {
      await db.run('ALTER TABLE stories ADD COLUMN district_id INTEGER');
    }
    if (!storyColumnNames.includes('municipality_id')) {
      await db.run('ALTER TABLE stories ADD COLUMN municipality_id INTEGER');
    }
    if (!storyColumnNames.includes('town_id')) {
      await db.run('ALTER TABLE stories ADD COLUMN town_id INTEGER');
    }
    for (const [column, definition] of [
      ['subheadline', 'TEXT'],
      ['image_alt', 'TEXT'],
      ['image_caption', 'TEXT'],
      ['image_credit', 'TEXT'],
      ['submitted_by', 'INTEGER'],
      ['submitted_at', 'TEXT'],
      ['published_by', 'INTEGER'],
      ['scheduled_at', 'TEXT'],
    ]) {
      if (!storyColumnNames.includes(column)) {
        await db.run(`ALTER TABLE stories ADD COLUMN ${column} ${definition}`);
      }
    }
    if (!mediaColumnNames.includes('caption')) {
      await db.run('ALTER TABLE media ADD COLUMN caption TEXT');
    }
    if (!mediaColumnNames.includes('alt_text')) {
      await db.run('ALTER TABLE media ADD COLUMN alt_text TEXT');
    }
    if (!mediaColumnNames.includes('credit')) {
      await db.run('ALTER TABLE media ADD COLUMN credit TEXT');
    }
    if (!mediaColumnNames.includes('public_url')) {
      await db.run('ALTER TABLE media ADD COLUMN public_url TEXT');
    }
    if (!mediaColumnNames.includes('width')) {
      await db.run('ALTER TABLE media ADD COLUMN width INTEGER DEFAULT 0');
    }
    if (!mediaColumnNames.includes('height')) {
      await db.run('ALTER TABLE media ADD COLUMN height INTEGER DEFAULT 0');
    }
    if (!mediaColumnNames.includes('createdAt')) {
      await db.run('ALTER TABLE media ADD COLUMN createdAt TEXT');
    }
    if (!mediaColumnNames.includes('updatedAt')) {
      await db.run('ALTER TABLE media ADD COLUMN updatedAt TEXT');
    }
    if (!mediaColumnNames.includes('author_id')) {
      await db.run('ALTER TABLE media ADD COLUMN author_id INTEGER');
    }
    if (!commentColumnNames.includes('author_id')) {
      await db.run('ALTER TABLE comments ADD COLUMN author_id INTEGER');
    }
    if (!commentColumnNames.includes('author_name')) {
      await db.run('ALTER TABLE comments ADD COLUMN author_name TEXT');
    }
    if (!commentColumnNames.includes('parent_id')) {
      await db.run('ALTER TABLE comments ADD COLUMN parent_id INTEGER DEFAULT 0');
    }
    if (!commentColumnNames.includes('likes')) {
      await db.run('ALTER TABLE comments ADD COLUMN likes INTEGER DEFAULT 0');
    }
    if (!commentColumnNames.includes('dislikes')) {
      await db.run('ALTER TABLE comments ADD COLUMN dislikes INTEGER DEFAULT 0');
    }
    if (!commentColumnNames.includes('reported')) {
      await db.run('ALTER TABLE comments ADD COLUMN reported INTEGER DEFAULT 0');
    }
    if (!commentColumnNames.includes('pinned')) {
      await db.run('ALTER TABLE comments ADD COLUMN pinned INTEGER DEFAULT 0');
    }
    if (!commentColumnNames.includes('status')) {
      await db.run('ALTER TABLE comments ADD COLUMN status TEXT DEFAULT "approved"');
    }
    if (!commentColumnNames.includes('created_at')) {
      await db.run('ALTER TABLE comments ADD COLUMN created_at TEXT');
    }
    if (!commentColumnNames.includes('updated_at')) {
      await db.run('ALTER TABLE comments ADD COLUMN updated_at TEXT');
    }
    if (commentColumnNames.includes('author') && !commentColumnNames.includes('author_name')) {
      await db.run('UPDATE comments SET author_name = COALESCE(author_name, author) WHERE author_name IS NULL AND author IS NOT NULL');
    }
    if (commentColumnNames.includes('at') && !commentColumnNames.includes('created_at')) {
      await db.run('UPDATE comments SET created_at = COALESCE(created_at, at) WHERE created_at IS NULL AND at IS NOT NULL');
    }
    if (!breakingNewsColumnNames.includes('article_id')) {
      await db.run('ALTER TABLE breaking_news ADD COLUMN article_id INTEGER');
    }
    if (!breakingNewsColumnNames.includes('priority')) {
      await db.run('ALTER TABLE breaking_news ADD COLUMN priority INTEGER DEFAULT 0');
    }
    if (!breakingNewsColumnNames.includes('published_at')) {
      await db.run('ALTER TABLE breaking_news ADD COLUMN published_at TEXT');
    }
    if (!breakingNewsColumnNames.includes('expires_at')) {
      await db.run('ALTER TABLE breaking_news ADD COLUMN expires_at TEXT');
    }
    if (!breakingNewsColumnNames.includes('status')) {
      await db.run('ALTER TABLE breaking_news ADD COLUMN status TEXT DEFAULT "active"');
    }
    if (!breakingNewsColumnNames.includes('created_by')) {
      await db.run('ALTER TABLE breaking_news ADD COLUMN created_by INTEGER');
    }
    if (!breakingNewsColumnNames.includes('created_at')) {
      await db.run('ALTER TABLE breaking_news ADD COLUMN created_at TEXT');
    }
    if (!newsletterColumnNames.includes('breaking_alerts')) {
      await db.run('ALTER TABLE newsletter_subscribers ADD COLUMN breaking_alerts INTEGER DEFAULT 0');
    }
    if (!newsletterColumnNames.includes('frequency')) {
      await db.run('ALTER TABLE newsletter_subscribers ADD COLUMN frequency TEXT DEFAULT "weekly"');
    }
    if (!newsletterColumnNames.includes('status')) {
      await db.run('ALTER TABLE newsletter_subscribers ADD COLUMN status TEXT DEFAULT "active"');
    }

    const revisionColumns = await db.all('PRAGMA table_info(revision_history)');
    const revisionColumnNames = revisionColumns.map((column) => column.name);
    if (!revisionColumnNames.includes('actor_id')) {
      await db.run('ALTER TABLE revision_history ADD COLUMN actor_id INTEGER');
    }
    if (!revisionColumnNames.includes('previous_status')) {
      await db.run('ALTER TABLE revision_history ADD COLUMN previous_status TEXT');
    }
    if (!revisionColumnNames.includes('new_status')) {
      await db.run('ALTER TABLE revision_history ADD COLUMN new_status TEXT');
    }

    const isTestRun = process.env.NODE_ENV === 'test' || process.env.npm_lifecycle_event === 'test' || process.argv.includes('--test') || (Array.isArray(process.execArgv) && process.execArgv.includes('--test'));
    if (isTestRun && !hasResetTestDatabase) {
      await db.exec(`
        DELETE FROM comments;
        DELETE FROM editorial_notes;
        DELETE FROM story_corrections;
        DELETE FROM revision_history;
        DELETE FROM editorial_reviews;
        DELETE FROM breaking_news;
        DELETE FROM media;
        DELETE FROM stories;
        DELETE FROM notifications;
        DELETE FROM messages;
        DELETE FROM correction_requests;
        DELETE FROM newsletter_subscribers;
        DELETE FROM push_preferences;
        DELETE FROM weather_locations;
        DELETE FROM artist_reviews;
        DELETE FROM artist_bookings;
        DELETE FROM artists;
        DELETE FROM creative_organisations;
        DELETE FROM venues;
        DELETE FROM events;
        DELETE FROM opportunities;
        DELETE FROM users;
        DELETE FROM sqlite_sequence WHERE name IN ('stories', 'comments', 'revision_history', 'editorial_reviews', 'breaking_news', 'media', 'notifications', 'messages', 'correction_requests', 'newsletter_subscribers', 'push_preferences', 'weather_locations', 'artist_reviews', 'artist_bookings', 'artists', 'creative_organisations', 'venues', 'events', 'opportunities', 'users');
      `);
      hasResetTestDatabase = true;
    }

    if (process.env.NODE_ENV === 'production' && !SEED_DEMO_USERS) {
      throw new Error('Production startup requires INITIAL_PASSWORD and INITIAL_USER_PASSWORD to be configured.');
    }

    const shouldSeedDemoUsers = process.env.NODE_ENV !== 'production' || SEED_DEMO_USERS;
    if (shouldSeedDemoUsers) {
      const ensureUser = async (username, password, bio, avatar, role) => {
        const existingUser = await db.get(`SELECT id, role, is_active FROM users WHERE username = ?`, [username]);
        const passwordHash = await bcrypt.hash(password, 10);
        if (!existingUser) {
          await db.run(`INSERT INTO users (username, password, bio, avatar, role, is_active) VALUES (?, ?, ?, ?, ?, 1)`, [username, passwordHash, bio, avatar, role]);
          return;
        }
        const normalizedRole = normalizeRoleName(existingUser.role, role);
        await db.run(`UPDATE users SET password = ?, role = ?, bio = ?, avatar = ?, is_active = ? WHERE username = ?`, [passwordHash, normalizedRole, bio, avatar, Number(existingUser.is_active ?? 1), username]);
      };

      await ensureUser(DEFAULT_ADMIN.username, DEFAULT_ADMIN.passwordEnv, DEFAULT_ADMIN.bio, DEFAULT_ADMIN.avatar, DEFAULT_ADMIN.role);
      await ensureUser(DEFAULT_USER.username, DEFAULT_USER.passwordEnv, DEFAULT_USER.bio, DEFAULT_USER.avatar, DEFAULT_USER.role);
    } else if (process.env.NODE_ENV !== 'production') {
      console.warn('Skipping default demo user seeding because credentials are not configured.');
    }

    await seedMpumalangaLocationReferenceData(db);

    const existingArtists = await db.get(`SELECT id FROM artists LIMIT 1`);
    if (!existingArtists) {
      const now = new Date().toISOString();
      const sampleArtists = [
        {
          slug: 'thandi-mkhize',
          full_name: 'Thandi Mkhize',
          stage_name: 'Thandi Mzansi',
          bio: 'Singer and performer shaping soulful live experiences across Mpumalanga.',
          province: 'Mpumalanga',
          municipality: 'Mbombela',
          city: 'Mbombela',
          discipline: 'Music',
          disciplines: 'Music, Performance',
          languages: 'English, Siswati',
          years_experience: 8,
          awards: 'Best Emerging Artist 2024',
          education: 'B.Tech in Music',
          portfolio: 'https://example.com/thandi',
          social_links: 'https://instagram.com/thandi',
          website: 'https://thandimkhize.co.za',
          email: 'thandi@example.com',
          availability: 'Available for booking',
          booking_status: 'Open for bookings',
          verified: 1,
          followers_count: 3200,
          reviews_count: 24,
          profile_photo: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=800&q=80',
          cover_image: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=1400&q=80',
          featured: 1,
        },
        {
          slug: 'musa-ndlovu',
          full_name: 'Musa Ndlovu',
          stage_name: 'Musa Vibe',
          bio: 'Multidisciplinary creative specialising in spoken word, poetry and community storytelling.',
          province: 'Mpumalanga',
          municipality: 'Bushbuckridge',
          city: 'Bushbuckridge',
          discipline: 'Poetry',
          disciplines: 'Poetry, Creative Writing',
          languages: 'Xitsonga, English',
          years_experience: 6,
          awards: 'Arts for Change Award 2023',
          education: 'BA in Communications',
          portfolio: 'https://example.com/musa',
          social_links: 'https://instagram.com/musavibe',
          website: 'https://musavibe.co.za',
          email: 'musa@example.com',
          availability: 'Available for workshops',
          booking_status: 'Open for bookings',
          verified: 1,
          followers_count: 1400,
          reviews_count: 11,
          profile_photo: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=800&q=80',
          cover_image: 'https://images.unsplash.com/photo-1499364615650-ec38552f4f34?auto=format&fit=crop&w=1400&q=80',
          featured: 1,
        },
        {
          slug: 'sihle-mabaso',
          full_name: 'Sihle Mabaso',
          stage_name: 'Sihle Visuals',
          bio: 'Visual artist creating bold mural work and exhibition pieces for civic and cultural spaces.',
          province: 'Mpumalanga',
          municipality: 'Nkomazi',
          city: 'Komatipoort',
          discipline: 'Visual Arts',
          disciplines: 'Visual Arts, Photography',
          languages: 'English, Zulu',
          years_experience: 10,
          awards: 'Provincial Creative Excellence',
          education: 'Diploma in Fine Arts',
          portfolio: 'https://example.com/sihle',
          social_links: 'https://instagram.com/sihlevisuals',
          website: 'https://sihlevisuals.co.za',
          email: 'sihle@example.com',
          availability: 'Available for commissions',
          booking_status: 'Open for bookings',
          verified: 1,
          followers_count: 2200,
          reviews_count: 19,
          profile_photo: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=800&q=80',
          cover_image: 'https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=1400&q=80',
          featured: 1,
        }
      ];

      for (const artist of sampleArtists) {
        await db.run(`
          INSERT INTO artists (
            slug, full_name, stage_name, bio, province, municipality, city, discipline, disciplines, languages, years_experience, awards, education, gallery, videos, music, portfolio, social_links, website, email, availability, booking_status, verified, followers_count, reviews_count, profile_photo, cover_image, featured, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [artist.slug, artist.full_name, artist.stage_name, artist.bio, artist.province, artist.municipality, artist.city, artist.discipline, artist.disciplines, artist.languages, artist.years_experience, artist.awards, artist.education, '', '', '', artist.portfolio, artist.social_links, artist.website, artist.email, artist.availability, artist.booking_status, artist.verified, artist.followers_count, artist.reviews_count, artist.profile_photo, artist.cover_image, artist.featured, now, now]);
      }
    }

    const existingOrganisations = await db.get(`SELECT id FROM creative_organisations LIMIT 1`);
    if (!existingOrganisations) {
      const now = new Date().toISOString();
      const sampleOrganisations = [
        { slug: 'mpumalanga-arts-council', name: 'Mpumalanga Arts Council', category: 'Arts organisation', province: 'Mpumalanga', municipality: 'Mbombela', city: 'Mbombela', bio: 'Supporting artists through programmes, grants and community showcases.', website: 'https://example.com/mac', email: 'arts@example.com', phone: '013 000 0000', featured: 1 },
        { slug: 'lowveld-festival-network', name: 'Lowveld Festival Network', category: 'Festival', province: 'Mpumalanga', municipality: 'Nkomazi', city: 'Komatipoort', bio: 'Connecting cultural festivals and public programming across the region.', website: 'https://example.com/lfn', email: 'festivals@example.com', phone: '013 100 0000', featured: 1 }
      ];
      for (const organisation of sampleOrganisations) {
        await db.run(`INSERT INTO creative_organisations (slug, name, category, province, municipality, city, bio, website, email, phone, featured, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [organisation.slug, organisation.name, organisation.category, organisation.province, organisation.municipality, organisation.city, organisation.bio, organisation.website, organisation.email, organisation.phone, organisation.featured, now, now]);
      }
    }

    const existingVenues = await db.get(`SELECT id FROM venues LIMIT 1`);
    if (!existingVenues) {
      const now = new Date().toISOString();
      const sampleVenues = [
        { slug: 'mbombela-theatre', name: 'Mbombela Theatre', category: 'Theatre', province: 'Mpumalanga', municipality: 'Mbombela', city: 'Mbombela', address: '1 Main Road', capacity: '500', website: 'https://example.com/theatre', featured: 1 },
        { slug: 'bushbuckridge-community-hall', name: 'Bushbuckridge Community Hall', category: 'Community Hall', province: 'Mpumalanga', municipality: 'Bushbuckridge', city: 'Bushbuckridge', address: '14 Cultural Road', capacity: '250', website: 'https://example.com/hall', featured: 1 }
      ];
      for (const venue of sampleVenues) {
        await db.run(`INSERT INTO venues (slug, name, category, province, municipality, city, address, capacity, website, featured, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [venue.slug, venue.name, venue.category, venue.province, venue.municipality, venue.city, venue.address, venue.capacity, venue.website, venue.featured, now, now]);
      }
    }

    const existingEvents = await db.get(`SELECT id FROM events LIMIT 1`);
    if (!existingEvents) {
      const now = new Date().toISOString();
      const sampleEvents = [
        { slug: 'summer-arts-festival', title: 'Summer Arts Festival', category: 'Festival', province: 'Mpumalanga', municipality: 'Mbombela', city: 'Mbombela', venue: 'Mbombela Theatre', start_date: '2026-10-12', end_date: '2026-10-14', description: 'A weekend of music, dance and visual arts.', featured: 1 },
        { slug: 'poetry-on-the-river', title: 'Poetry on the River', category: 'Poetry', province: 'Mpumalanga', municipality: 'Bushbuckridge', city: 'Bushbuckridge', venue: 'Bushbuckridge Community Hall', start_date: '2026-08-05', end_date: '2026-08-05', description: 'An evening of spoken word and live performances.', featured: 1 }
      ];
      for (const event of sampleEvents) {
        await db.run(`INSERT INTO events (slug, title, category, province, municipality, city, venue, start_date, end_date, description, featured, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [event.slug, event.title, event.category, event.province, event.municipality, event.city, event.venue, event.start_date, event.end_date, event.description, event.featured, now, now]);
      }
    }

    const existingOpportunities = await db.get(`SELECT id FROM opportunities LIMIT 1`);
    if (!existingOpportunities) {
      const now = new Date().toISOString();
      const sampleOpportunities = [
        { slug: 'creative-residency-call', title: 'Creative Residency Call', category: 'Residency', province: 'Mpumalanga', municipality: 'Mbombela', deadline: '2026-09-01', description: 'Apply for a residency supporting new works and public engagement.', featured: 1 },
        { slug: 'youth-arts-grant', title: 'Youth Arts Grant', category: 'Funding', province: 'Mpumalanga', municipality: 'Bushbuckridge', deadline: '2026-08-15', description: 'Funding for youth-led arts and cultural projects.', featured: 1 }
      ];
      for (const opportunity of sampleOpportunities) {
        await db.run(`INSERT INTO opportunities (slug, title, category, province, municipality, deadline, description, featured, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [opportunity.slug, opportunity.title, opportunity.category, opportunity.province, opportunity.municipality, opportunity.deadline, opportunity.description, opportunity.featured, now, now]);
      }
    }

    const existingStory = await db.get(`SELECT id FROM stories LIMIT 1`);
    if (!existingStory) {
      const now = new Date().toISOString();
      const sampleStories = [
        {
          title: 'Mbombela clinics see faster access after mobile health rollout',
          category: 'Health',
          content: 'Residents in the Lowveld say the latest medical outreach programme is shrinking delays and bringing specialist care closer to home.',
          excerpt: 'Residents in the Lowveld say the new medical outreach programme is shrinking delays and bringing specialist care closer to home.',
          featured_image: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&w=1400&q=80',
          reading_time: 4,
          is_breaking: 1,
        },
        {
          title: 'Local roads and transport links gain momentum ahead of the busy season',
          category: 'Business',
          content: 'Business owners and commuters say the latest upgrades are cutting travel time and improving access to key growth corridors.',
          excerpt: 'Business owners and commuters say the latest upgrades are cutting travel time and improving access to key growth corridors.',
          featured_image: 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=1400&q=80',
          reading_time: 5,
          is_breaking: 1,
        },
        {
          title: 'School and youth programmes expand as community leaders back local learning',
          category: 'Education',
          content: 'New partnerships are helping young people stay engaged through mentorship, arts and practical learning opportunities.',
          excerpt: 'New partnerships are helping young people stay engaged through mentorship, arts and practical learning opportunities.',
          featured_image: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1400&q=80',
          reading_time: 3,
          is_breaking: 0,
        }
      ];

      const user = await db.get(`SELECT id FROM users WHERE username = 'admin' LIMIT 1`);
      for (const story of sampleStories) {
        await db.run(`
          INSERT INTO stories (title, category, content, author_id, submittedAt, views, featured, featured_image, excerpt, reading_time, is_breaking, status, updatedAt)
          VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)
        `, [story.title, story.category, story.content, user?.id || null, now, story.featured_image, story.excerpt, story.reading_time, story.is_breaking || 0, story.status || 'published', now]);
      }
    }

    // Backfill published_at for legacy "published" rows (including the demo
    // stories seeded above) so the public visibility rule (status +
    // published_at + archived_at) does not silently hide legitimate content
    // that predates MLT-004.
    await db.run(
      `UPDATE stories SET published_at = COALESCE(published_at, updatedAt, submittedAt, ?) WHERE status = 'published' AND (published_at IS NULL OR published_at = '')`,
      [new Date().toISOString()]
    );

    // Backfill slugs for stories that predate slug support (e.g. seeded demo stories)
    // so public slug-based article URLs work for every published story.
    const storiesMissingSlug = await db.all(`SELECT id, title FROM stories WHERE slug IS NULL OR slug = ''`);
    for (const storyMissingSlug of storiesMissingSlug) {
      const generatedSlug = await makeUniqueStorySlug(db, null, storyMissingSlug.title, storyMissingSlug.id);
      await db.run(`UPDATE stories SET slug = ? WHERE id = ?`, [generatedSlug, storyMissingSlug.id]);
    }
    } finally {
      await db.close();
    }
  });
}

const SECRET = JWT_SECRET;
const app = express();
const uploadsDir = path.join(__dirname, 'public', 'uploads');
const mediaUploadsDir = path.resolve(MEDIA_UPLOAD_ROOT);
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(mediaUploadsDir)) {
  fs.mkdirSync(mediaUploadsDir, { recursive: true });
}
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many login attempts. Please try again later.' } });
const publicFormLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 25, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please slow down and try again later.' } });
const allowedOrigins = new Set(['http://localhost:3000', 'http://127.0.0.1:3000', 'https://mplocaltime.co.za', 'https://www.mplocaltime.co.za']);
const upload = multer({
  storage: multer.diskStorage({
    destination: mediaUploadsDir,
    filename: (req, file, cb) => {
      const normalizedMime = String(file.mimetype || '').toLowerCase();
      const safeExt = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
      }[normalizedMime] || path.extname(String(file.originalname || '')).toLowerCase() || '.jpg';
      const safeBase = crypto.randomBytes(12).toString('hex');
      cb(null, `${safeBase}${safeExt}`);
    }
  }),
  limits: { fileSize: MAX_MEDIA_UPLOAD_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const rawOriginalName = String(file.originalname || '');
    const traversalPattern = /(^|[\\/])\.\.($|[\\/])|^[A-Za-z]:[\\/]|[\\/]/;
    if (traversalPattern.test(rawOriginalName)) {
      return cb(new Error('Invalid uploaded filename.'));
    }
    const mimeType = String(file.mimetype || '').toLowerCase();
    const ext = path.extname(rawOriginalName).toLowerCase();
    const expectedExtForMime = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
    }[mimeType];
    const hasAllowedMime = ALLOWED_MEDIA_MIME_TYPES.has(mimeType);
    const hasAllowedExt = ALLOWED_MEDIA_EXTENSIONS.has(ext);
    const extMatchesMime = expectedExtForMime && ext && expectedExtForMime === ext;

    if (hasAllowedMime && hasAllowedExt && extMatchesMime) {
      return cb(null, true);
    }
    if (hasAllowedMime && !hasAllowedExt) {
      return cb(new Error('Image file extension is missing or unsupported.'));
    }
    if (!hasAllowedMime && hasAllowedExt) {
      return cb(new Error('Image file type does not match the uploaded file.'));
    }
    cb(new Error('Only JPEG, PNG, and WebP image uploads are allowed.'));
  }
});
const ALLOWED_HTML_PAGES = new Set(fs.readdirSync(__dirname).filter((entry) => entry.endsWith('.html')).map((entry) => entry.toLowerCase()));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: []
    }
  },
  crossOriginResourcePolicy: { policy: 'same-site' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  frameguard: { action: 'deny' },
  noSniff: true,
  hsts: process.env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false
}));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));
app.use(express.json({ limit: '1mb' }));
app.use('/public', express.static(path.join(__dirname, 'public'), { index: false, redirect: false }));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads'), { index: false, redirect: false }));

app.use((req, res, next) => {
  const originalSend = res.send.bind(res);
  res.send = function sendWithAdsense(body, ...args) {
    if (typeof body === 'string' && /<!doctype html|<html/i.test(body) && /<\/head>/i.test(body)) {
      body = injectAdsenseScriptIntoHtml(body);
    }
    return originalSend(body, ...args);
  };
  next();
});

// Serve index.html for root
app.get('/', (req, res) => {
  sendHtmlFileWithAdsense(res, path.join(__dirname, 'index.html'));
});

app.get('/ads.txt', (req, res) => {
  const configuredEntry = normalizeAdsTxtEntry(process.env.ADSENSE_ADS_TXT_ENTRY || '');
  const body = configuredEntry
    ? `${configuredEntry}\n`
    : '# Google AdSense seller declaration is intentionally unconfigured.\n# Configure ADSENSE_ADS_TXT_ENTRY only after Google provides the authorised seller record for the MLT production domain.\n';
  res.type('text/plain; charset=utf-8').send(body);
});

app.get('/api/municipalities', async (req, res) => {
  return withDB(async (db) => {
    const districtSlug = sanitizeSlug(req.query.district || req.query.district_slug || req.query.districtSlug || '');
    let query = `SELECT m.*, d.name as district_name, d.slug as district_slug
      FROM municipalities m
      LEFT JOIN districts d ON d.id = m.district_id`;
    const params = [];
    if (districtSlug) {
      query += ' WHERE d.slug = ?';
      params.push(districtSlug);
    }
    query += ' ORDER BY m.name ASC';
    const rows = await db.all(query, params);
    res.json({
      municipalities: rows.map((municipality) => ({
        id: municipality.id,
        name: municipality.name,
        slug: municipality.slug,
        district: municipality.district_name,
        district_id: municipality.district_id,
        district_slug: municipality.district_slug,
        province: municipality.province,
      }))
    });
  });
});

app.get('/api/municipalities/:slug', async (req, res) => {
  const requestedSlug = sanitizeSlug(req.params.slug);
  if (!requestedSlug) return res.status(404).json({ error: 'municipality not found' });
  return withDB(async (db) => {
    const municipality = await db.get(`
      SELECT m.*, d.name as district_name, d.slug as district_slug
      FROM municipalities m
      LEFT JOIN districts d ON d.id = m.district_id
      WHERE LOWER(m.slug) = LOWER(?) OR LOWER(m.name) = LOWER(?)
      LIMIT 1
    `, [requestedSlug, requestedSlug]);
    if (!municipality) return res.status(404).json({ error: 'municipality not found' });
    const now = nowISO();
    const stories = await db.all(`
      SELECT s.*, u.username as author,
             (SELECT COUNT(*) FROM comments WHERE story_id = s.id) as comments
      FROM stories s
      LEFT JOIN users u ON u.id = s.author_id
      WHERE s.municipality_id = ? AND ${publicStoryWhereClause('s')}
      ORDER BY s.published_at DESC, s.id DESC LIMIT 12
    `, [municipality.id, now]);
    res.json({
      municipality: {
        id: municipality.id,
        name: municipality.name,
        slug: municipality.slug,
        district: municipality.district_name,
        district_id: municipality.district_id,
        district_slug: municipality.district_slug,
        province: municipality.province,
      },
      stories: stories.map((story) => sanitizePublicStory({ ...story, comments: Number(story.comments || 0) }))
    });
  });
});

app.get('/api/districts', async (req, res) => {
  return withDB(async (db) => {
    const districts = await db.all('SELECT * FROM districts ORDER BY name ASC');
    res.json({ districts: districts.map((district) => ({ id: district.id, name: district.name, slug: district.slug, province: district.province })) });
  });
});

app.get('/api/districts/:slug', async (req, res) => {
  const requestedSlug = sanitizeSlug(req.params.slug);
  if (!requestedSlug) return res.status(404).json({ error: 'district not found' });
  return withDB(async (db) => {
    const district = await db.get('SELECT * FROM districts WHERE slug = ? OR LOWER(name) = LOWER(?) LIMIT 1', [requestedSlug, requestedSlug]);
    if (!district) return res.status(404).json({ error: 'district not found' });
    const municipalities = await db.all('SELECT * FROM municipalities WHERE district_id = ? ORDER BY name ASC', [district.id]);
    res.json({ district: { id: district.id, name: district.name, slug: district.slug, province: district.province }, municipalities });
  });
});

app.get('/api/districts/:slug/municipalities', async (req, res) => {
  const requestedSlug = sanitizeSlug(req.params.slug);
  if (!requestedSlug) return res.status(404).json({ error: 'district not found' });
  return withDB(async (db) => {
    const district = await db.get('SELECT * FROM districts WHERE slug = ? OR LOWER(name) = LOWER(?) LIMIT 1', [requestedSlug, requestedSlug]);
    if (!district) return res.status(404).json({ error: 'district not found' });
    const municipalities = await db.all('SELECT * FROM municipalities WHERE district_id = ? ORDER BY name ASC', [district.id]);
    res.json({ district: { id: district.id, name: district.name, slug: district.slug }, municipalities });
  });
});

app.get('/api/municipalities/:slug/towns', async (req, res) => {
  const requestedSlug = sanitizeSlug(req.params.slug);
  if (!requestedSlug) return res.status(404).json({ error: 'municipality not found' });
  return withDB(async (db) => {
    const municipality = await db.get('SELECT * FROM municipalities WHERE slug = ? OR LOWER(name) = LOWER(?) LIMIT 1', [requestedSlug, requestedSlug]);
    if (!municipality) return res.status(404).json({ error: 'municipality not found' });
    const towns = await db.all('SELECT * FROM towns WHERE municipality_id = ? ORDER BY name ASC', [municipality.id]);
    res.json({ municipality: { id: municipality.id, name: municipality.name, slug: municipality.slug }, towns });
  });
});

app.get('/api/towns', async (req, res) => {
  const municipalitySlug = sanitizeSlug(req.query.municipality || req.query.municipality_slug || req.query.municipalitySlug || '');
  const districtSlug = sanitizeSlug(req.query.district || req.query.district_slug || req.query.districtSlug || '');
  return withDB(async (db) => {
    let query = 'SELECT t.*, m.name as municipality_name, m.slug as municipality_slug, d.name as district_name, d.slug as district_slug FROM towns t LEFT JOIN municipalities m ON m.id = t.municipality_id LEFT JOIN districts d ON d.id = m.district_id';
    const params = [];
    if (municipalitySlug) {
      query += ' WHERE m.slug = ?';
      params.push(municipalitySlug);
    } else if (districtSlug) {
      query += ' WHERE d.slug = ?';
      params.push(districtSlug);
    }
    query += ' ORDER BY t.name ASC';
    const rows = await db.all(query, params);
    res.json({ towns: rows.map((town) => ({
      id: town.id,
      name: town.name,
      slug: town.slug,
      municipality: town.municipality_name,
      municipality_slug: town.municipality_slug,
      district: town.district_name,
      district_slug: town.district_slug,
      province: town.province,
    })) });
  });
});

app.get('/api/towns/:slug', async (req, res) => {
  const requestedSlug = sanitizeSlug(req.params.slug);
  if (!requestedSlug) return res.status(404).json({ error: 'town not found' });
  return withDB(async (db) => {
    const town = await db.get(`
      SELECT t.*, m.name as municipality_name, m.slug as municipality_slug, d.name as district_name, d.slug as district_slug
      FROM towns t
      LEFT JOIN municipalities m ON m.id = t.municipality_id
      LEFT JOIN districts d ON d.id = m.district_id
      WHERE LOWER(t.slug) = LOWER(?) OR LOWER(t.name) = LOWER(?)
      LIMIT 1
    `, [requestedSlug, requestedSlug]);
    if (!town) return res.status(404).json({ error: 'town not found' });
    const now = nowISO();
    const stories = await db.all(`
      SELECT s.*, u.username as author,
             (SELECT COUNT(*) FROM comments WHERE story_id = s.id) as comments
      FROM stories s
      LEFT JOIN users u ON u.id = s.author_id
      WHERE s.town_id = ? AND ${publicStoryWhereClause('s')}
      ORDER BY s.published_at DESC, s.id DESC LIMIT 12
    `, [town.id, now]);
    res.json({
      town: {
        id: town.id,
        name: town.name,
        slug: town.slug,
        municipality: town.municipality_name,
        municipality_slug: town.municipality_slug,
        district: town.district_name,
        district_slug: town.district_slug,
        province: town.province,
      },
      stories: stories.map((story) => sanitizePublicStory({ ...story, comments: Number(story.comments || 0) }))
    });
  });
});

app.get('/municipalities', (req, res) => {
  res.send(buildMunicipalityListHtml(req));
});

app.get('/municipality/:slug', async (req, res) => {
  const requestedSlug = sanitizeSlug(req.params.slug);
  if (!requestedSlug) return res.status(404).send('Municipality not found');
  return withDB(async (db) => {
    const municipality = await db.get(`
      SELECT m.*, d.name as district_name, d.slug as district_slug
      FROM municipalities m
      LEFT JOIN districts d ON d.id = m.district_id
      WHERE LOWER(m.slug) = LOWER(?) OR LOWER(m.name) = LOWER(?)
      LIMIT 1
    `, [requestedSlug, requestedSlug]);
    if (!municipality) {
      const fallback = getMunicipalityBySlug(req.params.slug);
      if (!fallback) return res.status(404).send('Municipality not found');
      const articles = getMunicipalityArticles(fallback);
      return res.send(buildMunicipalityPageHtml(fallback, articles, req));
    }

    const now = nowISO();
    const rows = await db.all(`
      SELECT s.*, u.username as author
      FROM stories s
      LEFT JOIN users u ON u.id = s.author_id
      WHERE s.municipality_id = ? AND ${publicStoryWhereClause('s')}
      ORDER BY s.published_at DESC, s.id DESC LIMIT 12
    `, [municipality.id, now]);
    const articles = rows.map((story) => ({
      title: story.title,
      excerpt: story.excerpt || story.title,
      author: story.author || 'Mpumalanga Local Time',
      publishedAt: story.published_at || story.updatedAt || new Date().toISOString(),
      readingTime: Number(story.reading_time || 3),
      category: normalizeCategoryName(story.category || 'News'),
      image: story.featured_image || '/logo.png',
      featured: Boolean(story.featured),
      summary: story.excerpt || story.title,
      slug: story.slug,
      id: story.id,
      tags: story.tags ? story.tags.split(',') : []
    }));
    const location = {
      name: municipality.name,
      slug: municipality.slug,
      district: municipality.district_name,
      localMunicipality: municipality.name,
      population: 'Regional',
      area: 'Local area',
      heroImage: '/logo.png',
      description: `News and local reporting for ${municipality.name}, ${municipality.district_name}.`,
      tags: ['Local news', 'Community'],
      latestUpdate: rows[0]?.published_at || now,
    };
    res.send(buildMunicipalityPageHtml(location, articles, req));
  });
});

app.get('/district/:slug', async (req, res) => {
  const requestedSlug = sanitizeSlug(req.params.slug);
  if (!requestedSlug) return res.status(404).send('District not found');
  return withDB(async (db) => {
    const district = await db.get('SELECT * FROM districts WHERE slug = ? OR LOWER(name) = LOWER(?) LIMIT 1', [requestedSlug, requestedSlug]);
    if (!district) return res.status(404).send('District not found');
    const now = nowISO();
    const stories = await db.all(`
      SELECT s.*, u.username as author
      FROM stories s
      LEFT JOIN users u ON u.id = s.author_id
      WHERE s.district_id = ? AND ${publicStoryWhereClause('s')}
      ORDER BY s.published_at DESC, s.id DESC LIMIT 20
    `, [district.id, now]);
    const title = `${district.name} District News`;
    const body = stories.length ? stories.map((story) => `
      <article>
        <h3>${escapeHtml(story.title)}</h3>
        <p>${escapeHtml(story.excerpt || story.title)}</p>
        <a href="/story/${encodeURIComponent(story.slug || story.id)}">Read more</a>
      </article>
    `).join('') : `<p>No published stories are available for this area yet.</p>`;
    res.type('html').send(`<!doctype html><html><head><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`);
  });
});

app.get('/town/:slug', async (req, res) => {
  const requestedSlug = sanitizeSlug(req.params.slug);
  if (!requestedSlug) return res.status(404).send('Town not found');
  return withDB(async (db) => {
    const town = await db.get('SELECT * FROM towns WHERE slug = ? OR LOWER(name) = LOWER(?) LIMIT 1', [requestedSlug, requestedSlug]);
    if (!town) return res.status(404).send('Town not found');
    const now = nowISO();
    const stories = await db.all(`
      SELECT s.*, u.username as author
      FROM stories s
      LEFT JOIN users u ON u.id = s.author_id
      WHERE s.town_id = ? AND ${publicStoryWhereClause('s')}
      ORDER BY s.published_at DESC, s.id DESC LIMIT 20
    `, [town.id, now]);
    const title = `${town.name} Local News`;
    const body = stories.length ? stories.map((story) => `
      <article>
        <h3>${escapeHtml(story.title)}</h3>
        <p>${escapeHtml(story.excerpt || story.title)}</p>
        <a href="/story/${encodeURIComponent(story.slug || story.id)}">Read more</a>
      </article>
    `).join('') : `<p>No published stories are available for this area yet.</p>`;
    res.type('html').send(`<!doctype html><html><head><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`);
  });
});

// MLT-006: standard sitemap. Only legitimately public surfaces are listed —
// published stories (via the shared publicStoryWhereClause rule), valid
// categories and municipalities, and the homepage. Never drafts, submitted/
// review stories, future-scheduled stories, archived stories or newsroom/
// admin URLs.
app.get('/sitemap.xml', async (req, res) => {
  return withDB(async (db) => {
    const now = nowISO();
    const staticUrls = [
      { loc: '/' },
      { loc: '/news.html' },
      { loc: '/business.html' },
      { loc: '/community.html' },
      { loc: '/sports.html' },
      { loc: '/municipalities' },
    ];

    const dbMunicipalities = await db.all('SELECT slug FROM municipalities').catch(() => []);
    const municipalitySlugs = new Set(MUNICIPALITIES.map((m) => m.slug));
    for (const row of dbMunicipalities) {
      if (row && row.slug) municipalitySlugs.add(row.slug);
    }
    const municipalityUrls = Array.from(municipalitySlugs)
      .sort()
      .map((slug) => ({ loc: `/municipality/${encodeURIComponent(slug)}` }));

    const stories = await db.all(`
      SELECT s.slug, s.id, s.published_at, s.updatedAt
      FROM stories s
      WHERE ${publicStoryWhereClause('s')}
      ORDER BY s.published_at DESC
      LIMIT 5000
    `, [now]);
    const storyUrls = stories.map((story) => {
      const modified = story.updatedAt || story.published_at;
      return {
        loc: `/story/${encodeURIComponent(story.slug || story.id)}`,
        lastmod: modified ? new Date(modified).toISOString() : undefined,
      };
    });

    const seen = new Set();
    const urls = [...staticUrls, ...municipalityUrls, ...storyUrls].filter((entry) => {
      if (seen.has(entry.loc)) return false;
      seen.add(entry.loc);
      return true;
    });

    res.type('application/xml; charset=utf-8').send(buildUrlsetXml(urls));
  });
});

// MLT-006: Google News sitemap. This is a short, rolling window of recent
// published news, never a full archive, and follows the same public
// visibility rule as the rest of the site.
app.get('/news-sitemap.xml', async (req, res) => {
  return withDB(async (db) => {
    const now = nowISO();
    const windowStart = new Date(Date.now() - NEWS_SITEMAP_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    const stories = await db.all(`
      SELECT s.slug, s.id, s.title, s.published_at
      FROM stories s
      WHERE ${publicStoryWhereClause('s')} AND s.published_at >= ?
      ORDER BY s.published_at DESC
      LIMIT 1000
    `, [now, windowStart]);
    res.type('application/xml; charset=utf-8').send(buildNewsSitemapXml(stories));
  });
});

app.get('/robots.txt', (req, res) => {
  const lines = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /admin.html',
    'Disallow: /dashboard.html',
    'Disallow: /login.html',
    '',
    `Sitemap: ${buildUrl('/sitemap.xml')}`,
    `Sitemap: ${buildUrl('/news-sitemap.xml')}`,
  ];
  res.type('text/plain').send(`${lines.join('\n')}\n`);
});

// MLT-006: RSS 2.0 feed of recent published stories, newest first.
app.get('/rss.xml', async (req, res) => {
  return withDB(async (db) => {
    const now = nowISO();
    const stories = await db.all(`
      SELECT s.slug, s.id, s.title, s.excerpt, s.meta_description, s.category, s.published_at, u.username as author
      FROM stories s
      LEFT JOIN users u ON u.id = s.author_id
      WHERE ${publicStoryWhereClause('s')}
      ORDER BY s.published_at DESC, s.id DESC
      LIMIT ${RSS_FEED_LIMIT}
    `, [now]);
    const xml = buildRssXml(stories, {
      title: SITE_NAME,
      link: buildUrl('/'),
      description: 'Trusted local news, business, sport, arts and community coverage across Mpumalanga.',
    });
    res.type('application/rss+xml; charset=utf-8').send(xml);
  });
});

// Optional alias kept as a simple redirect so there is a single source of
// truth for feed generation.
app.get('/feed.xml', (req, res) => res.redirect(301, '/rss.xml'));

// For any non-API route, check if HTML file exists
function escapeInteger(value) {
  return Number(value || 0);
}

function buildMarketplaceLandingHtml(req) {
  return `<!doctype html>
<html lang="en-ZA">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Creative Marketplace | Mpumalanga Local Time</title>
  <meta name="description" content="Browse digital products, physical products, creative services and artist bookings from Mpumalanga creatives." />
  <link rel="canonical" href="${req.protocol}://${req.get('host')}/creative-marketplace" />
  <link rel="stylesheet" href="/styles.css" />
  <style>
    body { margin:0; font-family:Inter, Arial, sans-serif; background:#f7f1e8; color:#111; }
    .shell { max-width:1280px; margin:0 auto; padding:24px 20px 60px; }
    .hero-card { background:#111; color:#fff; padding:32px; border-radius:28px; display:grid; gap:20px; box-shadow:0 24px 60px rgba(0,0,0,.14); }
    .hero-grid { display:grid; gap:24px; grid-template-columns:1.2fr 0.8fr; align-items:center; }
    .market-grid { display:grid; gap:18px; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); margin-top:20px; }
    .market-card { background:#fff; border-radius:22px; padding:22px; box-shadow:0 12px 30px rgba(0,0,0,.06); display:grid; gap:10px; }
    .badge { display:inline-block; padding:7px 10px; border-radius:999px; background:#f3e8db; color:#6b2d07; font-size:.8rem; font-weight:700; width:max-content; }
    .pill-row { display:flex; flex-wrap:wrap; gap:8px; }
    .pill { padding:6px 10px; border-radius:999px; background:#f4ebdf; font-size:.8rem; }
    .link-row { display:flex; flex-wrap:wrap; gap:10px; margin-top:8px; }
    .link-row a { color:#c00; font-weight:600; text-decoration:none; }
    @media (max-width:760px) { .hero-grid { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <header class="site-header">
    <div class="container navbar">
      <div class="site-branding">
        <a href="/" aria-label="Mpumalanga Local Time home">
          <div style="display:flex;align-items:center;gap:12px">
            <img src="/logo.png" alt="Mpumalanga Local Time logo" />
            <div>
              <strong class="site-title">Mpumalanga Local Time</strong>
              <span class="site-tagline">Creative Marketplace</span>
            </div>
          </div>
        </a>
      </div>
      <nav class="nav-primary" aria-label="Primary navigation">
        <a href="/">Home</a>
        <a href="/creatives">Creatives</a>
        <a href="/creative-marketplace">Marketplace</a>
      </nav>
    </div>
  </header>
  <main class="shell">
    <section class="hero-card">
      <div class="hero-grid">
        <div>
          <span class="badge" style="background:#2b2b2b;color:#fff;">Creative Marketplace</span>
          <h1 style="margin:12px 0 10px;font-size:clamp(2rem, 3vw, 2.8rem);">Discover products, services and bookings from Mpumalanga creatives.</h1>
          <p style="margin:0;color:#e4d8ca;line-height:1.7;">From instant-download digital art to live performances, the marketplace brings together creators selling work, offering services and taking bookings in one place.</p>
        </div>
        <div style="background:#fff;color:#111;padding:20px;border-radius:20px;display:grid;gap:12px;">
          <div class="pill-row">
            <span class="pill">DIGITAL</span>
            <span class="pill">PHYSICAL</span>
            <span class="pill">SERVICE</span>
            <span class="pill">BOOKING</span>
          </div>
          <div><strong>Made in Mpumalanga</strong></div>
          <div>Local creators and verified artists can showcase work, accept bookings and reach new audiences.</div>
          <div class="link-row">
            <a href="/creative-marketplace/listings">Browse listings</a>
            <a href="/creatives">Explore artists</a>
            <a href="/creatives/opportunities">View opportunities</a>
          </div>
        </div>
      </div>
    </section>

    <section class="market-grid">
      <article class="market-card">
        <span class="badge">Digital Products</span>
        <h2 style="margin:0;">Download creative work instantly</h2>
        <p style="margin:0;">eBooks, music, beats, digital art, templates and online courses.</p>
        <div class="pill-row">
          <span class="pill">Instant download</span>
          <span class="pill">No shipping</span>
        </div>
      </article>
      <article class="market-card">
        <span class="badge">Physical Products</span>
        <h2 style="margin:0;">Original creations delivered to your door</h2>
        <p style="margin:0;">Paintings, crafts, jewellery, printed books, clothing and handmade gifts.</p>
        <div class="pill-row">
          <span class="pill">Stock and shipping</span>
          <span class="pill">Handmade</span>
        </div>
      </article>
      <article class="market-card">
        <span class="badge">Services</span>
        <h2 style="margin:0;">Hire local creative professionals</h2>
        <p style="margin:0;">Graphic design, photography, music production, copywriting, branding and more.</p>
        <div class="pill-row">
          <span class="pill">Quote-based</span>
          <span class="pill">Local expertise</span>
        </div>
      </article>
      <article class="market-card">
        <span class="badge">Book an Artist</span>
        <h2 style="margin:0;">Book talented creatives for your next event</h2>
        <p style="margin:0;">Musicians, poets, DJs, dancers, speakers and cultural groups.</p>
        <div class="pill-row">
          <span class="pill">Deposits</span>
          <span class="pill">Date-based bookings</span>
        </div>
      </article>
    </section>

    <section class="market-card" style="margin-top:20px;">
      <h2 style="margin:0 0 8px;">Why this marketplace works</h2>
      <p style="margin:0;">It supports a creative economy where artists can sell music, books and art, offer services, accept bookings and build a following from Mpumalanga and beyond.</p>
    </section>
  </main>
</body>
</html>`;
}

function buildCreativesLandingHtml(req, featuredArtists = [], trendingArtists = [], disciplines = []) {
  return `<!doctype html>
<html lang="en-ZA">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Creatives | Mpumalanga Local Time</title>
  <meta name="description" content="Discover Mpumalanga's creative talent, artists, venues, organisations and opportunities across every municipality." />
  <link rel="canonical" href="${req.protocol}://${req.get('host')}/creatives" />
  <link rel="stylesheet" href="/styles.css" />
  <style>
    body { margin:0; font-family:Inter, Arial, sans-serif; background:#f6f1eb; color:#111; }
    .creative-shell { max-width:1280px; margin:0 auto; padding:24px 20px 60px; }
    .hero-card { background:#111; color:#fff; padding:36px; border-radius:28px; display:grid; gap:24px; box-shadow:0 24px 60px rgba(0,0,0,.14); }
    .hero-grid { display:grid; gap:24px; grid-template-columns:1.3fr 0.7fr; align-items:center; }
    .hero-card h1 { font-size:clamp(2rem, 3vw, 3.1rem); margin:0 0 10px; }
    .hero-card p { font-size:1.04rem; color:#e5d9ce; margin:0; line-height:1.6; }
    .search-panel { background:#fff; padding:20px; border-radius:24px; color:#111; display:grid; gap:12px; }
    .search-grid { display:grid; gap:12px; grid-template-columns:repeat(auto-fit, minmax(180px,1fr)); }
    .search-panel input, .search-panel select, .search-panel button { width:100%; padding:13px 14px; border-radius:999px; border:1px solid #ddd; font:inherit; }
    .search-actions { display:flex; flex-wrap:wrap; gap:12px; }
    .btn { padding:12px 16px; border-radius:999px; border:none; cursor:pointer; font-weight:600; }
    .btn-primary { background:#c00; color:#fff; }
    .btn-secondary { background:#f1ece7; color:#111; }
    .section-card { background:#fff; border-radius:24px; padding:24px; box-shadow:0 12px 30px rgba(0,0,0,.06); }
    .cards { display:grid; gap:16px; grid-template-columns:repeat(auto-fit, minmax(220px,1fr)); }
    .portrait-card { background:#faf7f2; border:1px solid #eee; border-radius:20px; padding:16px; display:grid; gap:10px; }
    .portrait-card img { width:100%; height:190px; object-fit:cover; border-radius:16px; }
    .tag-row { display:flex; flex-wrap:wrap; gap:8px; }
    .pill { padding:6px 10px; border-radius:999px; background:#eee; font-size:.8rem; }
    .grid-two { display:grid; gap:18px; grid-template-columns:1.2fr 0.8fr; }
    .nav-links { display:flex; flex-wrap:wrap; gap:10px; margin:14px 0 30px; }
    .nav-links a { color:#111; text-decoration:none; background:#fff; padding:10px 14px; border-radius:999px; }
    @media (max-width: 760px) { .hero-grid, .grid-two { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <header class="site-header">
    <div class="container navbar">
      <div class="site-branding">
        <a href="/" aria-label="Mpumalanga Local Time home">
          <div style="display:flex;align-items:center;gap:12px">
            <img src="/logo.png" alt="Mpumalanga Local Time logo" />
            <div>
              <strong class="site-title">Mpumalanga Local Time</strong>
              <span class="site-tagline">Creative portal</span>
            </div>
          </div>
        </a>
      </div>
      <nav class="nav-primary" aria-label="Primary navigation">
        <a href="/">Home</a>
        <a href="/creatives">Creatives</a>
        <a href="/dashboard.html">Dashboard</a>
      </nav>
    </div>
  </header>
  <main class="creative-shell">
    <div class="nav-links">
      <a href="/creatives">All creatives</a>
      <a href="/creatives/music">Music</a>
      <a href="/creatives/poetry">Poetry</a>
      <a href="/creatives/visual-arts">Visual Arts</a>
      <a href="/creatives/opportunities">Opportunities</a>
      <a href="/creatives/mpumalanga">Mpumalanga</a>
    </div>
    <section class="hero-card">
      <div class="hero-grid">
        <div>
          <p class="pill" style="background:#2d2d2d;color:#fff;width:max-content">New creative economy hub for Mpumalanga</p>
          <h1>Discover Mpumalanga's Creative Talent</h1>
          <p>Find artists, performers, creatives, organisations, venues and opportunities from every municipality across Mpumalanga. This portal connects the newsroom with the creative economy through searchable profiles, bookings and events.</p>
        </div>
        <div class="search-panel">
          <div class="search-grid">
            <input type="text" placeholder="Artist name" />
            <input type="text" placeholder="Stage name" />
            <input type="text" placeholder="Discipline" />
            <input type="text" placeholder="Municipality" />
            <select><option>Province</option><option>Mpumalanga</option></select>
            <select><option>Availability</option><option>Available</option></select>
          </div>
          <div class="search-actions">
            <button class="btn btn-primary" type="button">Find Artists</button>
            <a class="btn btn-secondary" href="/dashboard.html">Register as an Artist</a>
          </div>
        </div>
      </div>
    </section>
    <section class="section-card" style="margin-top:24px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <h2 style="margin:0;">Featured Artists</h2>
        <a href="/creatives" style="color:#c00;">View all profiles</a>
      </div>
      <div class="cards" style="margin-top:16px;">
        ${featuredArtists.map((artist) => `
          <article class="portrait-card">
            <img src="${escapeHtml(artist.profile_photo || '/logo.png')}" alt="${escapeHtml(artist.stage_name || artist.full_name)}" />
            <div style="display:grid;gap:6px;">
              <strong>${escapeHtml(artist.stage_name || artist.full_name)}</strong>
              <div>${escapeHtml(artist.full_name)}</div>
              <div class="tag-row"><span class="pill">${escapeHtml(artist.discipline || 'Creative')}</span><span class="pill">${escapeHtml(artist.municipality || 'Mpumalanga')}</span></div>
              <a href="/creatives/artists/${escapeHtml(artist.slug)}" style="color:#c00;">View profile</a>
            </div>
          </article>
        `).join('')}
      </div>
    </section>
    <section class="section-card" style="margin-top:24px;">
      <h2 style="margin-top:0;">Trending Creatives</h2>
      <div class="cards">
        ${trendingArtists.map((artist) => `
          <article class="portrait-card">
            <strong>${escapeHtml(artist.stage_name || artist.full_name)}</strong>
            <div>${escapeHtml(artist.discipline || 'Creative')}</div>
            <div>${escapeHtml(artist.municipality || 'Mpumalanga')} • ${escapeHtml(artist.availability || 'Available')}</div>
            <a href="/creatives/artists/${escapeHtml(artist.slug)}" style="color:#c00;">Open profile</a>
          </article>
        `).join('')}
      </div>
    </section>
    <section class="section-card" style="margin-top:24px;">
      <div class="grid-two">
        <div>
          <h2 style="margin-top:0;">Explore the creative economy</h2>
          <p>Browse disciplines, featured organisations, venues and opportunities from the province’s creative network.</p>
          <div class="tag-row">
            ${disciplines.map((item) => `<a class="pill" href="/creatives/${escapeHtml(item.slug)}" style="text-decoration:none;color:#111;">${escapeHtml(item.label)}</a>`).join('')}
          </div>
        </div>
        <div>
          <h3 style="margin-top:0;">Top municipalities</h3>
          <ul>
            ${MUNICIPALITIES.slice(0, 6).map((municipality) => `<li><a href="/creatives/municipality/${escapeHtml(municipality.slug)}" style="color:#111;">${escapeHtml(municipality.name)}</a></li>`).join('')}
          </ul>
        </div>
      </div>
    </section>
  </main>
</body>
</html>`;
}

function buildArtistProfileHtml(artist, relatedNews, req) {
  const disciplineList = (artist.disciplines || artist.discipline || 'Creative').split(',').filter(Boolean).slice(0, 4);
  const socials = String(artist.social_links || '').split(',').filter(Boolean);
  return `<!doctype html>
<html lang="en-ZA">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(artist.stage_name || artist.full_name)} | Mpumalanga Creatives</title>
  <meta name="description" content="${escapeHtml((artist.bio || '').slice(0, 160))}" />
  <link rel="canonical" href="${req.protocol}://${req.get('host')}/creatives/artists/${escapeHtml(artist.slug)}" />
  <link rel="stylesheet" href="/styles.css" />
  <style>
    body { margin:0; background:#f7f3ee; color:#111; font-family:Inter, Arial, sans-serif; }
    .profile-shell { max-width:1200px; margin:0 auto; padding:24px 20px 60px; display:grid; gap:22px; }
    .hero-card { background:#111; color:#fff; padding:24px; border-radius:24px; display:grid; gap:20px; }
    .profile-grid { display:grid; gap:20px; grid-template-columns:1.1fr 0.9fr; } 
    .profile-card, .section-card { background:#fff; border-radius:24px; padding:24px; box-shadow:0 12px 35px rgba(0,0,0,.06); }
    .portrait { width:100%; height:280px; object-fit:cover; border-radius:20px; }
    .pill { padding:8px 12px; border-radius:999px; background:#f4ebdf; display:inline-block; font-size:.8rem; margin:4px 6px 0 0; }
    .meta-list { display:grid; gap:8px; }
    .tag-row { display:flex; flex-wrap:wrap; gap:8px; }
    .actions a, .actions button { display:inline-block; padding:12px 14px; border-radius:999px; background:#c00; color:#fff; text-decoration:none; margin-top:8px; margin-right:8px; }
    @media (max-width:760px) { .profile-grid { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <header class="site-header">
    <div class="container navbar">
      <div class="site-branding">
        <a href="/" aria-label="Mpumalanga Local Time home"><div style="display:flex;align-items:center;gap:12px"><img src="/logo.png" alt="Mpumalanga Local Time logo" /><div><strong class="site-title">Mpumalanga Local Time</strong><span class="site-tagline">Artist profile</span></div></div></a>
      </div>
      <nav class="nav-primary" aria-label="Primary navigation"><a href="/">Home</a><a href="/creatives">Creatives</a><a href="/dashboard.html">Dashboard</a></nav>
    </div>
  </header>
  <main class="profile-shell">
    <section class="hero-card">
      <div class="profile-grid">
        <div>
          <div class="tag-row">
            ${artist.verified ? '<span class="pill" style="background:#2f2f2f;color:#fff">Verified Artist</span>' : ''}
            <span class="pill" style="background:#2f2f2f;color:#fff">${escapeHtml(artist.availability || 'Available')}</span>
          </div>
          <h1 style="margin:10px 0 6px;">${escapeHtml(artist.stage_name || artist.full_name)}</h1>
          <p style="margin:0;color:#e3d2c0;">${escapeHtml(artist.full_name)} • ${escapeHtml(artist.municipality || 'Mpumalanga')}</p>
          <p style="margin-top:14px;color:#e3d2c0;line-height:1.6;">${escapeHtml(artist.bio || 'Creative profile now live on Mpumalanga Local Time.')}</p>
          <div class="actions">
            <a href="#booking">Book Artist</a>
            <a href="/creatives">Explore more creatives</a>
          </div>
        </div>
        <div>
          <img class="portrait" src="${escapeHtml(artist.profile_photo || artist.cover_image || '/logo.png')}" alt="${escapeHtml(artist.stage_name || artist.full_name)}" />
        </div>
      </div>
    </section>
    <section class="profile-grid">
      <div class="profile-card">
        <h2 style="margin-top:0;">About</h2>
        <p>${escapeHtml(artist.bio || 'A remarkable creative from Mpumalanga.')}</p>
        <div class="meta-list">
          <div><strong>Province:</strong> ${escapeHtml(artist.province || 'Mpumalanga')}</div>
          <div><strong>Municipality:</strong> ${escapeHtml(artist.municipality || 'Mpumalanga')}</div>
          <div><strong>City:</strong> ${escapeHtml(artist.city || 'N/A')}</div>
          <div><strong>Primary discipline:</strong> ${escapeHtml(artist.discipline || 'Creative')}</div>
          <div><strong>Secondary disciplines:</strong> ${escapeHtml(artist.disciplines || '—')}</div>
          <div><strong>Languages:</strong> ${escapeHtml(artist.languages || '—')}</div>
          <div><strong>Years of experience:</strong> ${escapeInteger(artist.years_experience)}</div>
          <div><strong>Awards:</strong> ${escapeHtml(artist.awards || '—')}</div>
          <div><strong>Education:</strong> ${escapeHtml(artist.education || '—')}</div>
        </div>
        <div class="tag-row" style="margin-top:12px;">
          ${disciplineList.map((item) => `<span class="pill">${escapeHtml(item)}</span>`).join('')}
        </div>
      </div>
      <div class="profile-card">
        <h2 style="margin-top:0;">Profile highlights</h2>
        <div class="meta-list">
          <div><strong>Availability:</strong> ${escapeHtml(artist.availability || 'Available')}</div>
          <div><strong>Booking status:</strong> ${escapeHtml(artist.booking_status || 'Open for bookings')}</div>
          <div><strong>Followers:</strong> ${escapeInteger(artist.followers_count)}</div>
          <div><strong>Reviews:</strong> ${escapeInteger(artist.reviews_count)}</div>
          <div><strong>Website:</strong> <a href="${escapeAttr(artist.website || '#')}" style="color:#c00;">${escapeHtml(artist.website || '—')}</a></div>
          <div><strong>Email:</strong> ${escapeHtml(artist.email || '—')}</div>
        </div>
        <div style="margin-top:14px;">
          ${socials.length ? socials.map((entry) => `<a href="${escapeAttr(entry)}" style="color:#c00;display:inline-block;margin-right:10px;">${escapeHtml(entry)}</a>`).join('') : '<span>No social media links yet.</span>'}
        </div>
      </div>
    </section>
    <section class="section-card" id="booking">
      <h2 style="margin-top:0;">Book this artist</h2>
      <form id="bookingForm" style="display:grid;gap:12px;">
        <input name="clientName" placeholder="Client name" required />
        <input name="organisation" placeholder="Organisation" />
        <input name="email" type="email" placeholder="Email" required />
        <input name="phone" placeholder="Phone" />
        <input name="eventDate" type="date" />
        <input name="venue" placeholder="Venue" />
        <input name="budget" placeholder="Budget" />
        <textarea name="message" rows="5" placeholder="Tell us about your event"></textarea>
        <button class="btn" type="submit">Send booking request</button>
        <div id="bookingMessage"></div>
      </form>
      <script>
        (function() {
          const form = document.getElementById('bookingForm');
          const message = document.getElementById('bookingMessage');
          form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const payload = Object.fromEntries(new FormData(form).entries());
            const response = await fetch('/api/artists/${escapeHtml(artist.id)}/bookings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
            const data = await response.json();
            message.textContent = response.ok ? 'Booking request sent successfully.' : (data.error || 'Unable to send booking.');
          });
        })();
      </script>
    </section>
    <section class="section-card">
      <h2 style="margin-top:0;">Latest news featuring this artist</h2>
      ${relatedNews.length ? relatedNews.map((item) => `<div style="margin-bottom:12px;"><a href="/story/${escapeHtml(item.id)}" style="color:#c00;font-weight:600;">${escapeHtml(item.title)}</a><div>${escapeHtml(item.excerpt || '')}</div></div>`).join('') : '<p>No newsroom mentions yet.</p>'}
    </section>
  </main>
</body>
</html>`;
}

function buildDisciplinePageHtml(discipline, artists, req) {
  const label = discipline[0].toUpperCase() + discipline.slice(1).replace(/-/g, ' ');
  return `<!doctype html>
<html lang="en-ZA">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(label)} | Mpumalanga Creatives</title>
  <meta name="description" content="Browse ${escapeHtml(label)} creatives and professionals across Mpumalanga." />
  <link rel="stylesheet" href="/styles.css" />
  <style>body{margin:0;font-family:Inter,Arial,sans-serif;background:#f7f2eb;color:#111;} .shell{max-width:1180px;margin:0 auto;padding:24px 20px 60px;} .card{background:#fff;border-radius:24px;padding:24px;box-shadow:0 10px 30px rgba(0,0,0,.06);} .cards{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));}</style>
</head>
<body>
  <header class="site-header"><div class="container navbar"><div class="site-branding"><a href="/" aria-label="Mpumalanga Local Time home"><div style="display:flex;align-items:center;gap:12px"><img src="/logo.png" alt="Mpumalanga Local Time logo" /><div><strong class="site-title">Mpumalanga Local Time</strong><span class="site-tagline">Discipline</span></div></div></a></div><nav class="nav-primary" aria-label="Primary navigation"><a href="/">Home</a><a href="/creatives">Creatives</a></nav></div></header>
  <main class="shell"><div class="card"><h1>${escapeHtml(label)}</h1><p>Discover ${escapeHtml(label)} professionals, performers and organisations across Mpumalanga.</p><div class="cards">${artists.length ? artists.map((artist) => `<article class="card" style="padding:16px;"><strong>${escapeHtml(artist.stage_name || artist.full_name)}</strong><div>${escapeHtml(artist.municipality || 'Mpumalanga')}</div><div>${escapeHtml(artist.discipline || label)}</div><a href="/creatives/artists/${escapeHtml(artist.slug)}" style="color:#c00;">View profile</a></article>`).join('') : '<p>No profiles for this discipline yet.</p>'}</div></div></main>
</body>
</html>`;
}

function buildMunicipalityCreativePageHtml(municipality, artists, req) {
  const label = municipality.name;
  return `<!doctype html>
<html lang="en-ZA">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(label)} Creatives | Mpumalanga Local Time</title>
  <meta name="description" content="Featured artists, events and creative organisations from ${escapeHtml(label)}." />
  <link rel="stylesheet" href="/styles.css" />
  <style>body{margin:0;font-family:Inter,Arial,sans-serif;background:#f7f1e8;color:#111;} .shell{max-width:1180px;margin:0 auto;padding:24px 20px 60px;} .card{background:#fff;border-radius:24px;padding:24px;box-shadow:0 10px 30px rgba(0,0,0,.06);} .cards{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));}</style>
</head>
<body>
  <header class="site-header"><div class="container navbar"><div class="site-branding"><a href="/" aria-label="Mpumalanga Local Time home"><div style="display:flex;align-items:center;gap:12px"><img src="/logo.png" alt="Mpumalanga Local Time logo" /><div><strong class="site-title">Mpumalanga Local Time</strong><span class="site-tagline">Municipality</span></div></div></a></div><nav class="nav-primary" aria-label="Primary navigation"><a href="/">Home</a><a href="/creatives">Creatives</a></nav></div></header>
  <main class="shell"><div class="card"><h1>${escapeHtml(label)} Creatives</h1><p>Find featured artists, latest profiles and creative opportunities from ${escapeHtml(label)}.</p><div class="cards">${artists.length ? artists.map((artist) => `<article class="card" style="padding:16px;"><strong>${escapeHtml(artist.stage_name || artist.full_name)}</strong><div>${escapeHtml(artist.discipline || 'Creative')}</div><div>${escapeHtml(artist.availability || 'Available')}</div><a href="/creatives/artists/${escapeHtml(artist.slug)}" style="color:#c00;">View profile</a></article>`).join('') : '<p>No profiles for this municipality yet.</p>'}</div></div></main>
</body>
</html>`;
}

function buildCreativeDirectoryHtml(title, items, req) {
  return `<!doctype html>
<html lang="en-ZA">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)} | Mpumalanga Creatives</title>
  <meta name="description" content="Browse ${escapeHtml(title.toLowerCase())} for the creative economy in Mpumalanga." />
  <link rel="stylesheet" href="/styles.css" />
  <style>body{margin:0;font-family:Inter,Arial,sans-serif;background:#f7f2eb;color:#111;} .shell{max-width:1180px;margin:0 auto;padding:24px 20px 60px;} .card{background:#fff;border-radius:24px;padding:24px;box-shadow:0 10px 30px rgba(0,0,0,.06);} .cards{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));}</style>
</head>
<body>
  <header class="site-header"><div class="container navbar"><div class="site-branding"><a href="/" aria-label="Mpumalanga Local Time home"><div style="display:flex;align-items:center;gap:12px"><img src="/logo.png" alt="Mpumalanga Local Time logo" /><div><strong class="site-title">Mpumalanga Local Time</strong><span class="site-tagline">Creative directory</span></div></div></a></div><nav class="nav-primary" aria-label="Primary navigation"><a href="/">Home</a><a href="/creatives">Creatives</a></nav></div></header>
  <main class="shell"><div class="card"><h1>${escapeHtml(title)}</h1><p>Discover the creative ecosystem that is shaping Mpumalanga’s cultural and commercial life.</p><div class="cards">${items.length ? items.map((item) => `<article class="card" style="padding:16px;"><strong>${escapeHtml(item.name || item.title)}</strong><div>${escapeHtml(item.category || item.municipality || 'Mpumalanga')}</div><div>${escapeHtml(item.city || item.province || '')}</div></article>`).join('') : '<p>No entries yet.</p>'}</div></div></main>
</body>
</html>`;
}

function buildMarketplaceListingsHtml(req, listings = []) {
  const cards = listings.length ? listings.map((listing) => `
    <article class="listing-card">
      <div class="listing-top">
        <span class="badge">${escapeHtml(listing.type || 'Listing')}</span>
        <span class="badge muted">${escapeHtml(listing.category || 'Creative')}</span>
      </div>
      <h3>${escapeHtml(listing.title || 'Creative listing')}</h3>
      <p>${escapeHtml(listing.description || 'A marketplace offering from Mpumalanga creatives.')}</p>
      <div class="meta">${escapeHtml(listing.municipality || 'Mpumalanga')} • ${escapeHtml(listing.price || 'Price on request')}</div>
      <div class="pill-row">
        ${listing.badges ? listing.badges.split(',').filter(Boolean).map((badge) => `<span class="pill">${escapeHtml(badge.trim())}</span>`).join('') : '<span class="pill">Made in Mpumalanga</span>'}
      </div>
      <div class="actions">
        <a href="/creative-marketplace/artist/${escapeHtml(listing.artistSlug || 'artist')}" class="btn">Artist storefront</a>
        <a href="#" class="btn secondary">View details</a>
      </div>
    </article>
  `).join('') : '<div class="empty-state">No listings yet. New creative offerings will appear here soon.</div>';

  return `<!doctype html>
<html lang="en-ZA">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Marketplace Listings | Mpumalanga Local Time</title>
  <meta name="description" content="Browse storefront-style listings for digital products, physical products, services and bookings across Mpumalanga." />
  <link rel="canonical" href="${req.protocol}://${req.get('host')}/creative-marketplace/listings" />
  <link rel="stylesheet" href="/styles.css" />
  <style>
    body { margin:0; font-family:Inter, Arial, sans-serif; background:#f7f1e8; color:#111; }
    .shell { max-width:1280px; margin:0 auto; padding:24px 20px 60px; }
    .filters { background:#fff; border-radius:24px; padding:20px; box-shadow:0 12px 30px rgba(0,0,0,.06); display:grid; gap:12px; margin-bottom:20px; }
    .filter-grid { display:grid; gap:12px; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); }
    .filter-grid select, .filter-grid input { width:100%; padding:12px 14px; border-radius:999px; border:1px solid #ddd; font:inherit; }
    .listing-grid { display:grid; gap:18px; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); }
    .listing-card { background:#fff; border-radius:24px; padding:20px; box-shadow:0 12px 30px rgba(0,0,0,.06); display:grid; gap:12px; }
    .listing-top { display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; }
    .badge { display:inline-block; padding:7px 10px; border-radius:999px; background:#f3e8db; color:#6b2d07; font-size:.8rem; font-weight:700; }
    .badge.muted { background:#f4ebdf; color:#111; }
    .pill-row { display:flex; flex-wrap:wrap; gap:8px; }
    .pill { padding:6px 10px; border-radius:999px; background:#f4ebdf; font-size:.8rem; }
    .meta { color:#686868; font-size:.95rem; }
    .actions { display:flex; flex-wrap:wrap; gap:10px; }
    .btn { display:inline-block; padding:10px 14px; border-radius:999px; background:#c00; color:#fff; text-decoration:none; font-weight:600; }
    .btn.secondary { background:#f3e8db; color:#111; }
    .empty-state { background:#fff; border-radius:24px; padding:24px; box-shadow:0 12px 30px rgba(0,0,0,.06); }
  </style>
</head>
<body>
  <header class="site-header">
    <div class="container navbar">
      <div class="site-branding">
        <a href="/" aria-label="Mpumalanga Local Time home">
          <div style="display:flex;align-items:center;gap:12px">
            <img src="/logo.png" alt="Mpumalanga Local Time logo" />
            <div>
              <strong class="site-title">Mpumalanga Local Time</strong>
              <span class="site-tagline">Marketplace listings</span>
            </div>
          </div>
        </a>
      </div>
      <nav class="nav-primary" aria-label="Primary navigation">
        <a href="/creative-marketplace">Marketplace</a>
        <a href="/creatives">Creatives</a>
      </nav>
    </div>
  </header>
  <main class="shell">
    <section class="filters">
      <h1 style="margin:0 0 8px;">Marketplace listings</h1>
      <p style="margin:0 0 12px;">Filter by product type, category, price, municipality or availability.</p>
      <div class="filter-grid">
        <select><option>Filter by product type</option><option>Digital</option><option>Physical</option><option>Service</option><option>Booking</option></select>
        <select><option>Filter by category</option><option>Music</option><option>Visual Arts</option><option>Design</option><option>Performance</option></select>
        <input type="text" placeholder="Price" />
        <input type="text" placeholder="Province" />
        <input type="text" placeholder="Municipality" />
      </div>
    </section>

    <section class="listing-grid">
      ${cards}
    </section>
  </main>
</body>
</html>`;
}

function buildArtistStorefrontHtml(req, artist) {
  return `<!doctype html>
<html lang="en-ZA">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(artist.stage_name || artist.full_name)} | Artist Storefront</title>
  <meta name="description" content="Visit ${escapeHtml(artist.stage_name || artist.full_name)}'s storefront on Mpumalanga Local Time." />
  <link rel="stylesheet" href="/styles.css" />
  <style>
    body { margin:0; font-family:Inter, Arial, sans-serif; background:#f7f1e8; color:#111; }
    .shell { max-width:1200px; margin:0 auto; padding:24px 20px 60px; }
    .hero-card { background:#111; color:#fff; border-radius:28px; padding:26px; display:grid; gap:16px; }
    .store-grid { display:grid; gap:18px; grid-template-columns:1.1fr 0.9fr; margin-top:20px; }
    .card { background:#fff; border-radius:24px; padding:20px; box-shadow:0 12px 30px rgba(0,0,0,.06); }
    .pill-row { display:flex; flex-wrap:wrap; gap:8px; }
    .pill { padding:6px 10px; border-radius:999px; background:#f4ebdf; font-size:.8rem; }
    .btn { display:inline-block; padding:10px 14px; border-radius:999px; background:#c00; color:#fff; text-decoration:none; font-weight:600; margin-top:10px; }
  </style>
</head>
<body>
  <header class="site-header">
    <div class="container navbar">
      <div class="site-branding">
        <a href="/" aria-label="Mpumalanga Local Time home"><div style="display:flex;align-items:center;gap:12px"><img src="/logo.png" alt="Mpumalanga Local Time logo" /><div><strong class="site-title">Mpumalanga Local Time</strong><span class="site-tagline">Artist storefront</span></div></div></a>
      </div>
      <nav class="nav-primary" aria-label="Primary navigation"><a href="/creative-marketplace">Marketplace</a><a href="/creatives">Creatives</a></nav>
    </div>
  </header>
  <main class="shell">
    <section class="hero-card">
      <div class="pill-row">
        <span class="pill" style="background:#2b2b2b;color:#fff;">Verified Artist</span>
        <span class="pill" style="background:#2b2b2b;color:#fff;">Made in Mpumalanga</span>
      </div>
      <h1 style="margin:0;">${escapeHtml(artist.stage_name || artist.full_name)}</h1>
      <p style="margin:0;color:#e4d8ca;">${escapeHtml(artist.bio || 'A creative entrepreneur sharing digital work, physical products, services and bookings on Mpumalanga Local Time.')}</p>
      <a class="btn" href="#book">Book this artist</a>
    </section>
    <section class="store-grid">
      <div class="card">
        <h2 style="margin-top:0;">About the studio</h2>
        <p>${escapeHtml(artist.bio || 'Creative studio profile live on the platform.')}</p>
        <div class="pill-row">
          <span class="pill">${escapeHtml(artist.discipline || 'Creative')}</span>
          <span class="pill">${escapeHtml(artist.municipality || 'Mpumalanga')}</span>
          <span class="pill">${escapeHtml(artist.availability || 'Available')}</span>
        </div>
      </div>
      <div class="card" id="book">
        <h2 style="margin-top:0;">Storefront highlights</h2>
        <ul>
          <li>Digital products and downloadable content</li>
          <li>Physical products and custom commissions</li>
          <li>Service enquiries and booking requests</li>
        </ul>
      </div>
    </section>
  </main>
</body>
</html>`;
}

app.get('/creative-marketplace', async (req, res) => {
  res.send(buildMarketplaceLandingHtml(req));
});

app.get('/creative-marketplace/listings', async (req, res) => {
  const listings = [
    { title: 'Soulful beats pack', description: 'A downloadable collection of original beats for creators and podcasts.', type: 'Digital', category: 'Music', municipality: 'Mbombela', price: 'R120', badges: 'Instant download, Made in Mpumalanga', artistSlug: 'thandi-mkhize' },
    { title: 'Ceramic wall art', description: 'Handmade ceramic work shaped for homes and galleries.', type: 'Physical', category: 'Visual Arts', municipality: 'Nkomazi', price: 'R450', badges: 'Handmade, Proudly South African', artistSlug: 'sihle-mabaso' },
    { title: 'Brand identity session', description: 'A collaborative branding package for new businesses and events.', type: 'Service', category: 'Design', municipality: 'Bushbuckridge', price: 'R2 500', badges: 'Quote-based, Verified Artist', artistSlug: 'musa-ndlovu' },
    { title: 'Live poetry performance', description: 'Book a spoken-word performance for schools, launches and cultural evenings.', type: 'Booking', category: 'Performance', municipality: 'Mbombela', price: 'R3 000', badges: 'Booking, Made in Mpumalanga', artistSlug: 'musa-ndlovu' }
  ];
  res.send(buildMarketplaceListingsHtml(req, listings));
});

app.get('/creative-marketplace/artist/:slug', async (req, res) => {
  return withDB(async (db) => {
    const artist = await db.get(`SELECT * FROM artists WHERE slug = ?`, [req.params.slug]);
    if (!artist) return res.status(404).send('Artist storefront not found');
    res.send(buildArtistStorefrontHtml(req, artist));
  });
});

app.get('/creatives', async (req, res) => {
  return withDB(async (db) => {
    const featuredArtists = await db.all(`SELECT * FROM artists WHERE featured = 1 ORDER BY followers_count DESC LIMIT 6`);
    const trendingArtists = await db.all(`SELECT * FROM artists ORDER BY followers_count DESC LIMIT 6`);
    const disciplines = [
      { slug: 'music', label: 'Music' },
      { slug: 'poetry', label: 'Poetry' },
      { slug: 'dance', label: 'Dance' },
      { slug: 'visual-arts', label: 'Visual Arts' },
      { slug: 'film', label: 'Film' },
      { slug: 'fashion-design', label: 'Fashion Design' },
      { slug: 'creative-writing', label: 'Creative Writing' },
      { slug: 'podcasting', label: 'Podcasting' }
    ];
    res.send(buildCreativesLandingHtml(req, featuredArtists, trendingArtists, disciplines));
  });
});

app.get('/creatives/artists/:slug', async (req, res) => {
  return withDB(async (db) => {
    const artist = await db.get(`SELECT * FROM artists WHERE slug = ?`, [req.params.slug]);
    if (!artist) return res.status(404).send('Artist profile not found');
    const relatedNews = await db.all(`SELECT id, title, excerpt FROM stories WHERE lower(title) LIKE ? OR lower(content) LIKE ? ORDER BY submittedAt DESC LIMIT 5`, [`%${String(artist.full_name || artist.stage_name || '').toLowerCase()}%`, `%${String(artist.full_name || artist.stage_name || '').toLowerCase()}%`]);
    res.send(buildArtistProfileHtml(artist, relatedNews, req));
  });
});

app.get('/creatives/organisations', async (req, res) => {
  return withDB(async (db) => {
    const organisations = await db.all(`SELECT * FROM creative_organisations ORDER BY featured DESC, created_at DESC LIMIT 20`);
    res.send(buildCreativeDirectoryHtml('Creative organisations', organisations, req));
  });
});

app.get('/creatives/venues', async (req, res) => {
  return withDB(async (db) => {
    const venues = await db.all(`SELECT * FROM venues ORDER BY featured DESC, created_at DESC LIMIT 20`);
    res.send(buildCreativeDirectoryHtml('Venues', venues, req));
  });
});

app.get('/creatives/events', async (req, res) => {
  return withDB(async (db) => {
    const events = await db.all(`SELECT * FROM events ORDER BY featured DESC, start_date DESC LIMIT 20`);
    res.send(buildCreativeDirectoryHtml('Events', events, req));
  });
});

app.get('/creatives/opportunities', async (req, res) => {
  return withDB(async (db) => {
    const opportunities = await db.all(`SELECT * FROM opportunities ORDER BY featured DESC, deadline ASC LIMIT 20`);
    res.send(buildCreativeDirectoryHtml('Creative opportunities', opportunities, req));
  });
});

app.get('/creatives/:discipline', async (req, res) => {
  const slug = String(req.params.discipline || '').toLowerCase();
  if (slug === 'artists' || slug === 'municipality' || slug === 'mpumalanga' || slug === 'opportunities') {
    return res.redirect('/creatives');
  }
  return withDB(async (db) => {
    const artists = await db.all(`SELECT * FROM artists WHERE lower(COALESCE(discipline, '')) = ? OR lower(COALESCE(disciplines, '')) LIKE ? ORDER BY followers_count DESC LIMIT 12`, [slug.replace(/-/g, ' '), `%${slug.replace(/-/g, ' ')}%`]);
    res.send(buildDisciplinePageHtml(slug, artists, req));
  });
});

app.get('/creatives/mpumalanga', async (req, res) => {
  return withDB(async (db) => {
    const artists = await db.all(`SELECT * FROM artists WHERE province = 'Mpumalanga' ORDER BY followers_count DESC LIMIT 12`);
    res.send(buildMunicipalityCreativePageHtml({ name: 'Mpumalanga' }, artists, req));
  });
});

app.get('/creatives/municipality/:slug', async (req, res) => {
  const municipality = MUNICIPALITIES.find((entry) => entry.slug === String(req.params.slug).toLowerCase());
  if (!municipality) return res.status(404).send('Municipality not found');
  return withDB(async (db) => {
    const artists = await db.all(`SELECT * FROM artists WHERE lower(COALESCE(municipality, '')) = ? ORDER BY followers_count DESC LIMIT 12`, [municipality.name.toLowerCase()]);
    res.send(buildMunicipalityCreativePageHtml(municipality, artists, req));
  });
});

app.get('/api/artists', async (req, res) => {
  return withDB(async (db) => {
    const artists = await db.all(`SELECT * FROM artists ORDER BY followers_count DESC LIMIT 24`);
    res.json({ artists });
  });
});

app.post('/api/artists/me', authMiddleware, async (req, res) => {
  const payload = req.body || {};
  return withDB(async (db) => {
    const existing = await db.get(`SELECT * FROM artists WHERE user_id = ?`, [req.user.id]);
    const values = [
      payload.slug || payload.stage_name || req.user.username,
      payload.full_name || req.user.username,
      payload.stage_name || '',
      payload.bio || '',
      payload.province || 'Mpumalanga',
      payload.municipality || '',
      payload.city || '',
      payload.discipline || 'Creative',
      payload.disciplines || '',
      payload.languages || '',
      Number(payload.years_experience || 0),
      payload.awards || '',
      payload.education || '',
      payload.portfolio || '',
      payload.social_links || '',
      payload.website || '',
      payload.email || '',
      payload.availability || 'Available for booking',
      payload.booking_status || 'Open for bookings',
      payload.verified ? 1 : 0,
      Number(payload.followers_count || 0),
      Number(payload.reviews_count || 0),
      payload.profile_photo || '',
      payload.cover_image || '',
      req.user.id,
      new Date().toISOString(),
      new Date().toISOString(),
    ];
    if (existing) {
      await db.run(`UPDATE artists SET slug = ?, full_name = ?, stage_name = ?, bio = ?, province = ?, municipality = ?, city = ?, discipline = ?, disciplines = ?, languages = ?, years_experience = ?, awards = ?, education = ?, portfolio = ?, social_links = ?, website = ?, email = ?, availability = ?, booking_status = ?, verified = ?, followers_count = ?, reviews_count = ?, profile_photo = ?, cover_image = ?, updated_at = ? WHERE user_id = ?`, [...values.slice(0, 25), values[25], values[26], values[27], values[28], values[29]]);
    } else {
      await db.run(`INSERT INTO artists (slug, full_name, stage_name, bio, province, municipality, city, discipline, disciplines, languages, years_experience, awards, education, portfolio, social_links, website, email, availability, booking_status, verified, followers_count, reviews_count, profile_photo, cover_image, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, values);
    }
    const artist = await db.get(`SELECT * FROM artists WHERE user_id = ?`, [req.user.id]);
    res.json({ artist });
  });
});

app.post('/api/artists/:id/bookings', publicFormLimiter, async (req, res) => {
  const artistId = Number(req.params.id);
  if (!artistId) return res.status(400).json({ error: 'artist id required' });
  const { clientName, organisation, email, phone, eventDate, venue, budget, message } = req.body || {};
  if (!clientName || !email) return res.status(400).json({ error: 'client name and email required' });
  return withDB(async (db) => {
    const artist = await db.get(`SELECT * FROM artists WHERE id = ?`, [artistId]);
    if (!artist) return res.status(404).json({ error: 'artist not found' });
    const createdAt = new Date().toISOString();
    const row = await db.run(`INSERT INTO artist_bookings (artist_id, client_name, organisation, email, phone, event_date, venue, budget, message, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`, [artistId, clientName, organisation || '', email, phone || '', eventDate || '', venue || '', budget || '', message || '', createdAt]);
    const booking = await db.get(`SELECT * FROM artist_bookings WHERE id = ?`, [row.lastID]);
    res.json({ booking });
  });
});

app.post('/api/messages', publicFormLimiter, async (req, res) => {
  const { recipientId, senderName, senderEmail, subject, message } = req.body || {};
  if (!recipientId || !senderName || !senderEmail || !message) return res.status(400).json({ error: 'recipient, sender name, sender email and message are required' });
  const safeName = String(senderName || '').trim().slice(0, 120);
  const safeEmail = String(senderEmail || '').trim().slice(0, 200);
  const safeSubject = String(subject || 'Creative enquiry').trim().slice(0, 200);
  const safeMessage = String(message || '').trim().slice(0, 4000);
  if (!safeName || !safeEmail || !safeMessage || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail)) {
    return res.status(400).json({ error: 'valid sender name, sender email and message are required' });
  }
  return withDB(async (db) => {
    const row = await db.run(`INSERT INTO messages (recipient_id, sender_name, sender_email, subject, message, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'new', ?, ?)`, [recipientId, safeName, safeEmail, safeSubject, safeMessage, new Date().toISOString(), new Date().toISOString()]);
    const item = await db.get(`SELECT * FROM messages WHERE id = ?`, [row.lastID]);
    res.json({ message: item });
  });
});

app.get('/api/messages', authMiddleware, requireRole('admin'), async (req, res) => {
  return withDB(async (db) => {
    const messages = await db.all(`SELECT id, recipient_id, subject, status, created_at, updated_at FROM messages ORDER BY created_at DESC LIMIT 20`);
    res.json({ messages });
  });
});

app.get('/api/admin/users', authMiddleware, requireRole('admin'), async (req, res) => {
  return withDB(async (db) => {
    const users = await db.all(`SELECT id, username, bio, avatar, role, is_active FROM users ORDER BY username ASC`);
    res.json({ users: users.map((user) => safeUserObject(user)) });
  });
});

app.get('/api/admin/users/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const userId = Number(req.params.id);
  if (!userId) return res.status(400).json({ error: 'user id required' });
  return withDB(async (db) => {
    const user = await db.get(`SELECT id, username, bio, avatar, role, is_active FROM users WHERE id = ?`, [userId]);
    if (!user) return res.status(404).json({ error: 'user not found' });
    const storyCount = await db.get(`SELECT COUNT(*) as cnt FROM stories WHERE author_id = ?`, [userId]);
    const views = await db.get(`SELECT COALESCE(SUM(views),0) as total FROM stories WHERE author_id = ?`, [userId]);
    res.json({ user: { ...safeUserObject(user), storyCount: Number(storyCount?.cnt || 0), totalViews: Number(views?.total || 0) } });
  });
});

app.patch('/api/admin/users/:id/role', authMiddleware, requireRole('admin'), async (req, res) => {
  const userId = Number(req.params.id);
  const requestedRole = parseCanonicalRole(req.body?.role, { allowDefaultUser: false, fallback: 'user' });
  if (!userId) return res.status(400).json({ error: 'user id required' });
  if (!requestedRole) return res.status(400).json({ error: 'invalid role' });

  return withDB(async (db) => {
    const user = await db.get(`SELECT id, username, role, is_active FROM users WHERE id = ?`, [userId]);
    if (!user) return res.status(404).json({ error: 'user not found' });
    const currentRole = normalizeRoleName(user.role, 'user');
    if (currentRole === 'admin' && Number(user.id) === Number(req.user.id) && requestedRole !== 'admin') {
      return res.status(403).json({ error: 'administrators cannot demote themselves' });
    }
    const adminCount = await db.get(`SELECT COUNT(*) as cnt FROM users WHERE role = ? AND is_active != 0`, ['admin']);
    if (currentRole === 'admin' && Number(adminCount?.cnt || 0) <= 1 && requestedRole !== 'admin') {
      return res.status(403).json({ error: 'at least one active administrator must remain' });
    }
    await db.run(`UPDATE users SET role = ? WHERE id = ?`, [requestedRole, userId]);
    const updatedUser = await db.get(`SELECT id, username, bio, avatar, role, is_active FROM users WHERE id = ?`, [userId]);
    res.json({ user: safeUserObject(updatedUser) });
  });
});

app.patch('/api/admin/users/:id/status', authMiddleware, requireRole('admin'), async (req, res) => {
  const userId = Number(req.params.id);
  const rawStatus = req.body?.is_active ?? req.body?.active;
  if (!userId) return res.status(400).json({ error: 'user id required' });
  const nextActive = rawStatus === undefined ? undefined : rawStatus === true || rawStatus === 1 || rawStatus === '1' || rawStatus === 'true';
  if (nextActive === undefined) return res.status(400).json({ error: 'active status required' });

  return withDB(async (db) => {
    const user = await db.get(`SELECT id, username, role, is_active FROM users WHERE id = ?`, [userId]);
    if (!user) return res.status(404).json({ error: 'user not found' });
    const currentRole = normalizeRoleName(user.role, 'user');
    const adminCount = await db.get(`SELECT COUNT(*) as cnt FROM users WHERE role = ? AND is_active != 0`, ['admin']);
    if (currentRole === 'admin' && Number(user.id) === Number(req.user.id) && !nextActive) {
      return res.status(403).json({ error: 'administrators cannot deactivate their own account' });
    }
    if (currentRole === 'admin' && Number(adminCount?.cnt || 0) <= 1 && !nextActive) {
      return res.status(403).json({ error: 'at least one active administrator must remain' });
    }
    await db.run(`UPDATE users SET is_active = ? WHERE id = ?`, [nextActive ? 1 : 0, userId]);
    const updatedUser = await db.get(`SELECT id, username, bio, avatar, role, is_active FROM users WHERE id = ?`, [userId]);
    res.json({ user: safeUserObject(updatedUser) });
  });
});

app.post('/api/artists/:id/reviews', publicFormLimiter, async (req, res) => {
  const artistId = Number(req.params.id);
  const { reviewerName, rating, comment, verifiedBooking } = req.body || {};
  if (!artistId || !reviewerName) return res.status(400).json({ error: 'reviewer name required' });
  return withDB(async (db) => {
    const artist = await db.get(`SELECT * FROM artists WHERE id = ?`, [artistId]);
    if (!artist) return res.status(404).json({ error: 'artist not found' });
    const row = await db.run(`INSERT INTO artist_reviews (artist_id, reviewer_name, rating, comment, verified_booking, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [artistId, reviewerName, Number(rating || 5), comment || '', verifiedBooking ? 1 : 0, new Date().toISOString()]);
    const review = await db.get(`SELECT * FROM artist_reviews WHERE id = ?`, [row.lastID]);
    await db.run(`UPDATE artists SET reviews_count = COALESCE(reviews_count, 0) + 1 WHERE id = ?`, [artistId]);
    res.json({ review });
  });
});

app.get('/api/creatives/search', async (req, res) => {
  const query = String(req.query.q || '').trim().toLowerCase();
  return withDB(async (db) => {
    const artists = await db.all(`SELECT * FROM artists WHERE lower(COALESCE(full_name, '')) LIKE ? OR lower(COALESCE(stage_name, '')) LIKE ? OR lower(COALESCE(discipline, '')) LIKE ? OR lower(COALESCE(municipality, '')) LIKE ? ORDER BY followers_count DESC LIMIT 12`, [`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`]);
    const organisations = await db.all(`SELECT * FROM creative_organisations WHERE lower(COALESCE(name, '')) LIKE ? OR lower(COALESCE(category, '')) LIKE ? OR lower(COALESCE(municipality, '')) LIKE ? ORDER BY featured DESC, created_at DESC LIMIT 12`, [`%${query}%`, `%${query}%`, `%${query}%`]);
    const venues = await db.all(`SELECT * FROM venues WHERE lower(COALESCE(name, '')) LIKE ? OR lower(COALESCE(category, '')) LIKE ? OR lower(COALESCE(municipality, '')) LIKE ? ORDER BY featured DESC, created_at DESC LIMIT 12`, [`%${query}%`, `%${query}%`, `%${query}%`]);
    res.json({ artists, organisations, venues });
  });
});

app.get('/api/creatives/overview', async (req, res) => {
  return withDB(async (db) => {
    const organisations = await db.all(`SELECT * FROM creative_organisations ORDER BY featured DESC, created_at DESC LIMIT 4`);
    const venues = await db.all(`SELECT * FROM venues ORDER BY featured DESC, created_at DESC LIMIT 4`);
    const events = await db.all(`SELECT * FROM events ORDER BY featured DESC, start_date DESC LIMIT 4`);
    const opportunities = await db.all(`SELECT * FROM opportunities ORDER BY featured DESC, deadline ASC LIMIT 4`);
    const overview = {
      organisations: organisations.length,
      venues: venues.length,
      events: events.length,
      opportunities: opportunities.length,
    };
    res.json({ overview, organisations, venues, events, opportunities });
  });
});

app.get('/:page', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  const page = req.params.page || '';
  if (!page || page.startsWith('.') || page.includes('/') || page.includes('\\')) {
    return next();
  }
  const cleanPage = page.toLowerCase();
  const safeFile = cleanPage.endsWith('.html') ? cleanPage : `${cleanPage}.html`;
  if (ALLOWED_HTML_PAGES.has(safeFile)) {
    return sendHtmlFileWithAdsense(res, path.join(__dirname, safeFile));
  }
  next();
});

async function withDB(fn) {
  return queueDatabaseOperation(async () => {
    const db = await init();
    try {
      return await fn(db);
    } finally {
      await db.close();
    }
  });
}

function sanitizeUsername(rawValue) {
  const value = String(rawValue || '').trim();
  if (!/^[a-zA-Z0-9._-]{3,80}$/.test(value)) return '';
  return value;
}

app.post('/api/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const safeUsername = sanitizeUsername(username);
  const safePassword = String(password).trim();
  if (!safeUsername || !safePassword || safePassword.length < 8) return res.status(400).json({ error: 'username and password required' });
  return withDB(async (db) => {
    const user = await db.get(`SELECT * FROM users WHERE username = ?`, [safeUsername]);
    if (!user) return res.status(401).json({ error: 'invalid credentials' });
    const ok = await bcrypt.compare(safePassword, user.password);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });
    if (!isActiveAccount(user.is_active)) return res.status(403).json({ error: 'account inactive' });
    const role = normalizeRoleName(user.role, 'user');
    const token = jwt.sign({ id: user.id, username: user.username, role }, SECRET, { expiresIn: '7d' });
    res.json({ token, username: user.username, role });
  });
});

app.post('/api/register', loginLimiter, async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const safeUsername = sanitizeUsername(username);
  const safePassword = String(password).trim();
  if (!safeUsername || !safePassword || safePassword.length < 8) return res.status(400).json({ error: 'username and password required' });
  if (role !== undefined && role !== null) {
    const requestedRole = parseCanonicalRole(role, { allowDefaultUser: true, fallback: 'user' });
    if (requestedRole !== 'user') {
      return res.status(400).json({ error: 'public registration only creates standard user accounts' });
    }
  }
  return withDB(async (db) => {
    const exists = await db.get(`SELECT id FROM users WHERE username = ?`, [safeUsername]);
    if (exists) return res.status(409).json({ error: 'username taken' });
    const hash = await bcrypt.hash(safePassword, 10);
    const r = await db.run(`INSERT INTO users (username, password, role, is_active) VALUES (?,?,?,1)`, [safeUsername, hash, 'user']);
    const user = await db.get(`SELECT id, username, role FROM users WHERE id = ?`, [r.lastID]);
    const roleName = normalizeRoleName(user.role, 'user');
    const token = jwt.sign({ id: user.id, username: user.username, role: roleName }, SECRET, { expiresIn: '7d' });
    res.json({ token, username: user.username, role: roleName });
  });
});

async function authMiddleware(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'missing token' });
  try {
    const data = jwt.verify(m[1], SECRET);
    const userId = Number(data?.id || 0);
    if (!userId) return res.status(401).json({ error: 'invalid token' });
    return withDB(async (db) => {
      const user = await db.get(`SELECT id, username, bio, avatar, role, is_active FROM users WHERE id = ?`, [userId]);
      if (!user) return res.status(401).json({ error: 'invalid token' });
      if (!isActiveAccount(user.is_active)) return res.status(403).json({ error: 'account inactive' });
      req.user = {
        id: Number(user.id),
        username: user.username,
        role: normalizeRoleName(data?.role || user.role, 'user'),
        bio: user.bio || '',
        avatar: user.avatar || '/logo.png',
        is_active: isActiveAccount(user.is_active),
      };
      next();
    });
  } catch (e) {
    return res.status(401).json({ error: 'invalid token' });
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const role = normalizeRoleName(req.user?.role || 'user', 'user');
    const permittedRoles = allowedRoles.map((entry) => normalizeRoleName(entry, 'user'));
    if (!permittedRoles.includes(role)) {
      return res.status(403).json({ error: 'insufficient permissions' });
    }
    next();
  };
}

function normalizeStoryPayload(payload = {}) {
  const text = (value, maxLength) => sanitizeTextInput(value || '', '').slice(0, maxLength);
  const content = sanitizeHtml(String(payload.content || ''), {
    allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'blockquote', 'a', 'h1', 'h2', 'h3', 'img', 'figure', 'figcaption', 'span', 'code', 'pre'],
    allowedAttributes: {
      a: ['href', 'target', 'rel', 'title'],
      img: ['src', 'alt', 'title'],
      '*': ['class']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow', target: '_blank' })
    }
  }).slice(0, 200000);
  const rawStatus = payload.status ?? payload.storyStatus ?? 'draft';
  return {
    title: text(payload.title, 180),
    subheadline: text(payload.subheadline, 240),
    category: normalizeCategoryName(payload.category || 'News'),
    content,
    excerpt: text(payload.excerpt, 260),
    featured_image: text(payload.featured_image || payload.featuredImage, 500),
    image_alt: text(payload.image_alt || payload.imageAlt, 300),
    image_caption: text(payload.image_caption || payload.imageCaption, 500),
    image_credit: text(payload.image_credit || payload.imageCredit, 300),
    reading_time: Math.max(1, Math.min(120, Number(payload.reading_time || payload.readingTime || 5) || 5)),
    slug: text(payload.slug, 180).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, ''),
    seo_title: text(payload.seo_title || payload.seoTitle, 180),
    meta_description: text(payload.meta_description || payload.metaDescription, 250),
    tags: text(Array.isArray(payload.tags) ? payload.tags.join(', ') : payload.tags, 500),
    district: text(payload.district || payload.district_name || payload.districtName || '', 120),
    municipality: text(payload.municipality || payload.municipality_name || payload.municipalityName || payload.location || '', 120),
    town: text(payload.town || payload.local_area || payload.localArea || payload.town_name || payload.townName || '', 120),
    district_id: parseIntegerField(payload.district_id ?? payload.districtId),
    municipality_id: parseIntegerField(payload.municipality_id ?? payload.municipalityId),
    town_id: parseIntegerField(payload.town_id ?? payload.townId),
    district_slug: sanitizeSlug(payload.district_slug || payload.districtSlug || payload.district || ''),
    municipality_slug: sanitizeSlug(payload.municipality_slug || payload.municipalitySlug || payload.municipality || ''),
    town_slug: sanitizeSlug(payload.town_slug || payload.townSlug || payload.town || ''),
    featured: Boolean(payload.featured ?? payload.is_featured ?? false),
    is_breaking: Boolean(payload.is_breaking ?? payload.isBreaking ?? false),
    status: rawStatus ? normalizeCanonicalStoryStatus(rawStatus) : 'draft',
    editorial_notes: text(payload.editorial_notes || payload.editorialNotes || payload.notes, 2000),
  };
}

function sanitizeSlug(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 120);
}

function parseIntegerField(value) {
  if (value === undefined || value === null || value === '') return null;
  const asNumber = Number.parseInt(String(value), 10);
  return Number.isFinite(asNumber) && asNumber > 0 ? asNumber : null;
}

const CANONICAL_STORY_CATEGORIES = [
  'News',
  'Community',
  'Business',
  'Sports',
  'Arts / Entertainment',
  'Politics',
  'Education',
  'Health',
  'Crime',
  'Municipal',
  'Opinion'
];

const CATEGORY_ALIASES = {
  news: 'News',
  community: 'Community',
  business: 'Business',
  sport: 'Sports',
  sports: 'Sports',
  arts: 'Arts / Entertainment',
  art: 'Arts / Entertainment',
  entertainment: 'Arts / Entertainment',
  'arts / entertainment': 'Arts / Entertainment',
  'arts and entertainment': 'Arts / Entertainment',
  politics: 'Politics',
  education: 'Education',
  health: 'Health',
  crime: 'Crime',
  municipal: 'Municipal',
  municipality: 'Municipal',
  opinion: 'Opinion'
};

function normalizeCategoryName(category = 'News') {
  const raw = String(category ?? '').trim();
  if (!raw) return 'News';
  const lookup = raw.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  if (CATEGORY_ALIASES[lookup]) return CATEGORY_ALIASES[lookup];
  if (lookup.includes('art')) return 'Arts / Entertainment';
  if (lookup.includes('sport')) return 'Sports';
  if (lookup.includes('municipal')) return 'Municipal';
  if (lookup.includes('opinion')) return 'Opinion';
  const match = CANONICAL_STORY_CATEGORIES.find((entry) => entry.toLowerCase() === lookup.toLowerCase());
  return match || raw;
}

function getCategorySearchAliases(categoryName) {
  const normalized = normalizeCategoryName(categoryName);
  const aliases = new Set([normalized, normalized.toLowerCase()]);
  if (normalized === 'Arts / Entertainment') {
    aliases.add('Arts');
    aliases.add('Art');
    aliases.add('Entertainment');
    aliases.add('arts');
    aliases.add('art');
  }
  if (normalized === 'Sports') {
    aliases.add('Sport');
    aliases.add('sport');
  }
  return Array.from(aliases).filter(Boolean);
}

const MPUMALANGA_LOCATION_DATA = {
  districts: [
    {
      name: 'Ehlanzeni',
      slug: 'ehlanzeni',
      municipalities: [
        { name: 'Mbombela', slug: 'mbombela', towns: ['Mbombela', 'Matsulu', 'White River', 'Hazyview'] },
        { name: 'Bushbuckridge', slug: 'bushbuckridge', towns: ['Bushbuckridge', 'Acornhoek', 'Dwarsloop'] },
        { name: 'Nkomazi', slug: 'nkomazi', towns: ['Malalane', 'Komatipoort', 'Marloth Park'] },
        { name: 'Thaba Chweu', slug: 'thaba-chweu', towns: ['Sabie', 'Graskop', 'Mashishing'] }
      ]
    },
    {
      name: 'Gert Sibande',
      slug: 'gert-sibande',
      municipalities: [
        { name: 'Mkhondo', slug: 'mkhondo', towns: ['Piet Retief', 'Mkhondo', 'Amsterdam'] },
        { name: 'Msukaligwa', slug: 'msukaligwa', towns: ['Ermelo', 'Empuluzi'] },
        { name: 'Govan Mbeki', slug: 'govan-mbeki', towns: ['Secunda', 'Trichardt'] },
        { name: 'Lekwa', slug: 'lekwa', towns: ['Standerton', 'Morgenzon'] },
        { name: 'Dipaleseng', slug: 'dipaleseng', towns: ['Balfour', 'Greylingstad'] }
      ]
    },
    {
      name: 'Nkangala',
      slug: 'nkangala',
      municipalities: [
        { name: 'Steve Tshwete', slug: 'steve-tshwete', towns: ['Middelburg', 'KwaMhlanga'] },
        { name: 'Emalahleni', slug: 'emalahleni', towns: ['Emalahleni', 'Witbank'] },
        { name: 'Victor Khanye', slug: 'victor-khanye', towns: ['Delmas', 'Leandra'] },
        { name: 'Dr JS Moroka', slug: 'dr-js-moroka', towns: ['Siyabuswa', 'Tshwane', 'KwaMhlanga'] },
        { name: 'Thembisile Hani', slug: 'thembisile-hani', towns: ['Kwaggafontein', 'Zithobeni'] }
      ]
    }
  ]
};

async function seedMpumalangaLocationReferenceData(db) {
  const districtCount = await db.get('SELECT COUNT(*) AS cnt FROM districts');
  if (Number(districtCount?.cnt || 0) === 0) {
    for (const district of MPUMALANGA_LOCATION_DATA.districts) {
      const existingDistrict = await db.get('SELECT id FROM districts WHERE slug = ? LIMIT 1', [district.slug]);
      let districtId = existingDistrict ? existingDistrict.id : null;
      if (!districtId) {
        const insertResult = await db.run(
          'INSERT INTO districts (name, slug, province, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          [district.name, district.slug, 'Mpumalanga', new Date().toISOString(), new Date().toISOString()]
        );
        districtId = insertResult.lastID;
      }

      for (const municipality of district.municipalities) {
        const existingMunicipality = await db.get('SELECT id FROM municipalities WHERE slug = ? LIMIT 1', [municipality.slug]);
        let municipalityId = existingMunicipality ? existingMunicipality.id : null;
        if (!municipalityId) {
          const municipalityResult = await db.run(
            'INSERT INTO municipalities (district_id, name, slug, province, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
            [districtId, municipality.name, municipality.slug, 'Mpumalanga', new Date().toISOString(), new Date().toISOString()]
          );
          municipalityId = municipalityResult.lastID;
        }

        for (const townName of municipality.towns) {
          const slug = sanitizeSlug(townName);
          const existingTown = await db.get('SELECT id FROM towns WHERE slug = ? LIMIT 1', [slug]);
          if (!existingTown) {
            await db.run(
              'INSERT INTO towns (municipality_id, name, slug, province, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
              [municipalityId, townName, slug, 'Mpumalanga', new Date().toISOString(), new Date().toISOString()]
            );
          }
        }
      }
    }
  }
}

async function getLocationRecordBySlug(db, tableName, slug) {
  if (!tableName || !slug) return null;
  const safeSlug = sanitizeSlug(slug);
  if (!safeSlug) return null;
  return db.get(`SELECT * FROM ${tableName} WHERE slug = ? LIMIT 1`, [safeSlug]);
}

async function getLocationNameById(db, tableName, id) {
  const numericId = parseIntegerField(id);
  if (!numericId) return null;
  const row = await db.get(`SELECT name FROM ${tableName} WHERE id = ? LIMIT 1`, [numericId]);
  return row ? row.name : null;
}

async function resolveStoryLocation(db, payload = {}, existing = {}) {
  const districtId = parseIntegerField(payload.district_id ?? payload.districtId ?? existing.district_id ?? null);
  const municipalityId = parseIntegerField(payload.municipality_id ?? payload.municipalityId ?? existing.municipality_id ?? null);
  const townId = parseIntegerField(payload.town_id ?? payload.townId ?? existing.town_id ?? null);

  let district = null;
  if (districtId) {
    district = await db.get('SELECT * FROM districts WHERE id = ? LIMIT 1', [districtId]);
  } else {
    const candidate = sanitizeSlug(payload.district_slug || payload.districtSlug || payload.district || existing.district || '');
    if (candidate) {
      district = await getLocationRecordBySlug(db, 'districts', candidate);
    }
  }

  let municipality = null;
  if (municipalityId) {
    municipality = await db.get('SELECT * FROM municipalities WHERE id = ? LIMIT 1', [municipalityId]);
  } else {
    const candidate = sanitizeSlug(payload.municipality_slug || payload.municipalitySlug || payload.municipality || existing.municipality || '');
    if (candidate) {
      municipality = await getLocationRecordBySlug(db, 'municipalities', candidate);
    }
  }

  let town = null;
  if (townId) {
    town = await db.get('SELECT * FROM towns WHERE id = ? LIMIT 1', [townId]);
  } else {
    const candidate = sanitizeSlug(payload.town_slug || payload.townSlug || payload.town || existing.town || '');
    if (candidate) {
      town = await getLocationRecordBySlug(db, 'towns', candidate);
    }
  }

  if (payload.district || payload.district_id || payload.districtId || payload.district_slug || payload.districtSlug || existing.district_id || existing.district) {
    if (!district) {
      throw new Error('invalid district');
    }
  }
  if (payload.municipality || payload.municipality_id || payload.municipalityId || payload.municipality_slug || payload.municipalitySlug || existing.municipality_id || existing.municipality) {
    if (!municipality) {
      throw new Error('invalid municipality');
    }
  }
  if (payload.town || payload.town_id || payload.townId || payload.town_slug || payload.townSlug || existing.town_id || existing.town) {
    if (!town) {
      throw new Error('invalid town');
    }
  }

  if (district && municipality && Number(municipality.district_id) !== Number(district.id)) {
    throw new Error('municipality and district do not match');
  }
  if (town && municipality && Number(town.municipality_id) !== Number(municipality.id)) {
    throw new Error('town and municipality do not match');
  }
  if (district && town && municipality && Number(town.municipality_id) !== Number(municipality.id)) {
    throw new Error('town is not part of the selected municipality');
  }

  return {
    district_id: district ? district.id : null,
    municipality_id: municipality ? municipality.id : null,
    town_id: town ? town.id : null,
    district: district ? district.name : normalizeTextValue(existing.district || payload.district || ''),
    municipality: municipality ? municipality.name : normalizeTextValue(existing.municipality || payload.municipality || ''),
    town: town ? town.name : normalizeTextValue(existing.town || payload.town || ''),
  };
}

function normalizeTextValue(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
}

function countWords(text = '') {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function estimateReadingTime(text = '') {
  return Math.max(1, Math.ceil(countWords(text) / 200));
}

const CANONICAL_STORY_STATES = new Set(['draft', 'submitted', 'in_review', 'changes_requested', 'approved', 'scheduled', 'published', 'archived']);
const STORY_STATUS_ALIASES = {
  draft: 'draft',
  submitted: 'submitted',
  'pending-review': 'submitted',
  pending_review: 'submitted',
  'fact-check': 'in_review',
  fact_check: 'in_review',
  in_review: 'in_review',
  'in-review': 'in_review',
  approved: 'approved',
  changes_requested: 'changes_requested',
  'changes-requested': 'changes_requested',
  'needs-changes': 'changes_requested',
  needs_changes: 'changes_requested',
  scheduled: 'scheduled',
  published: 'published',
  archived: 'archived',
  rejected: 'changes_requested',
  'revision-requested': 'changes_requested',
  revision_requested: 'changes_requested',
  'submitted-for-review': 'submitted',
  submitted_for_review: 'submitted'
};
const VALID_STORY_TRANSITIONS = {
  draft: ['submitted', 'in_review'],
  submitted: ['in_review', 'changes_requested', 'draft'],
  in_review: ['approved', 'changes_requested'],
  changes_requested: ['submitted', 'in_review'],
  approved: ['published', 'scheduled'],
  scheduled: ['published', 'approved'],
  published: ['archived'],
  archived: []
};

function normalizeCanonicalStoryStatus(status = 'draft') {
  const raw = String(status || 'draft').trim().toLowerCase().replace(/\s+/g, '_');
  const canonical = STORY_STATUS_ALIASES[raw] || raw;
  return CANONICAL_STORY_STATES.has(canonical) ? canonical : 'draft';
}

// MLT-004: single authoritative rule for whether a story may appear on any
// public surface (homepage, category pages, search, breaking/featured/latest,
// related stories, article page). A story is publicly visible only when it is
// published, its published_at timestamp exists and is not in the future, and
// it has not been archived. This must be enforced in SQL, never only client-side.
function publicStoryWhereClause(alias = 's') {
  return `${alias}.status = 'published' AND ${alias}.published_at IS NOT NULL AND ${alias}.published_at <= ? AND ${alias}.archived_at IS NULL`;
}

function nowISO() {
  return new Date().toISOString();
}

// Fields that carry internal newsroom/editorial metadata and must never be
// exposed through public-facing endpoints or rendered article pages.
const INTERNAL_STORY_FIELDS = ['author_id', 'submitted_by', 'published_by', 'editorial_notes', 'scheduled_at', 'archived_at'];

function sanitizePublicStory(row) {
  if (!row || typeof row !== 'object') return row;
  const safe = { ...row };
  for (const field of INTERNAL_STORY_FIELDS) delete safe[field];
  return safe;
}

function legacyStoryStatusLabel(status) {
  const normalized = normalizeCanonicalStoryStatus(status);
  if (normalized === 'submitted' || normalized === 'in_review') return 'pending-review';
  if (normalized === 'changes_requested') return 'needs-changes';
  if (normalized === 'draft') return 'draft';
  return normalized;
}

function getRoleNameForRequest(req) {
  return normalizeRoleName(String(req.user?.role || 'user'), 'user');
}

function canManageEditorialFields(req) {
  const role = getRoleNameForRequest(req);
  return ['admin', 'editor'].includes(role);
}

function ensureWorkflowTransition(currentStatus, desiredStatus) {
  const from = normalizeCanonicalStoryStatus(currentStatus);
  const to = normalizeCanonicalStoryStatus(desiredStatus);
  if (from === to) {
    return { valid: true, current: from, next: to };
  }
  const allowed = VALID_STORY_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    return {
      valid: false,
      reason: `invalid transition: ${from} -> ${to}`,
      current: from,
      next: to
    };
  }
  return { valid: true, current: from, next: to };
}

async function processScheduledStories({ db: providedDb, now = new Date(), actorId = null } = {}) {
  const activeDb = providedDb || await init();
  const shouldClose = !providedDb;
  const effectiveNow = now instanceof Date ? now : new Date(now);
  const processed = [];

  try {
    const rows = await activeDb.all(`
      SELECT s.*, u.username as author
      FROM stories s
      LEFT JOIN users u ON u.id = s.author_id
      WHERE s.status = 'scheduled' AND s.scheduled_at IS NOT NULL
      ORDER BY s.scheduled_at ASC
    `);

    for (const story of rows) {
      if (normalizeCanonicalStoryStatus(story.status) !== 'scheduled') {
        continue;
      }

      const scheduledAt = story.scheduled_at ? new Date(story.scheduled_at) : null;
      if (!scheduledAt || Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() > effectiveNow.getTime()) {
        continue;
      }

      const previousStatus = normalizeCanonicalStoryStatus(story.status || 'draft');
      const publishedAt = story.published_at || effectiveNow.toISOString();
      const updateResult = await activeDb.run(
        `UPDATE stories SET status = ?, published_at = COALESCE(published_at, ?), published_by = COALESCE(?, published_by), updatedAt = ? WHERE id = ? AND status = ?`,
        ['published', publishedAt, actorId || null, effectiveNow.toISOString(), story.id, 'scheduled']
      );

      if (!updateResult || Number(updateResult.changes || 0) === 0) {
        continue;
      }

      await recordWorkflowAudit(
        activeDb,
        story.id,
        'scheduled_publish',
        `Scheduled story published automatically at ${publishedAt}`,
        previousStatus,
        'published',
        actorId || story.published_by || null
      );

      processed.push({
        id: story.id,
        title: story.title,
        scheduled_at: story.scheduled_at,
        published_at: publishedAt,
      });
    }

    return { processed: processed.length, stories: processed };
  } finally {
    if (shouldClose) {
      await activeDb.close();
    }
  }
}

async function recordWorkflowAudit(db, storyId, action, notes = '', previousStatus = null, nextStatus = null, actorId = null) {
  const list = await db.all('PRAGMA table_info(revision_history)');
  const columnNames = list.map((column) => column.name);
  const values = [storyId, action, notes || '', new Date().toISOString()];
  const columns = ['story_id', 'action', 'notes', 'created_at'];
  if (columnNames.includes('actor_id')) {
    columns.push('actor_id');
    values.push(actorId || null);
  }
  if (columnNames.includes('previous_status')) {
    columns.push('previous_status');
    values.push(previousStatus || null);
  }
  if (columnNames.includes('new_status')) {
    columns.push('new_status');
    values.push(nextStatus || null);
  }
  const placeholders = columns.map(() => '?').join(', ');
  await db.run(`INSERT INTO revision_history (${columns.join(', ')}) VALUES (${placeholders})`, values);
}

async function makeUniqueStorySlug(db, requestedSlug, title, storyId = null) {
  const base = String(requestedSlug || title || 'story')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 160) || 'story';
  let candidate = base;
  let suffix = 2;
  while (await db.get('SELECT id FROM stories WHERE slug = ? AND id != COALESCE(?, 0)', [candidate, storyId])) {
    candidate = `${base}-${suffix++}`;
  }
  return candidate;
}

function parseCsvList(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => String(entry).trim())
    .filter(Boolean);
}

function parseBooleanQuery(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

async function buildDashboardOverview(db, user, roleName = null) {
  const role = normalizeRoleName(roleName || user?.role || 'user', 'user');
  const isEditorial = ['admin', 'editor'].includes(role);
  const scopeClause = isEditorial ? '1 = 1' : 's.author_id = ?';
  const scopeParams = isEditorial ? [] : [user.id];

  const countStoryStatus = async (statusValue) => {
    const row = await db.get(`SELECT COUNT(*) as cnt FROM stories s WHERE ${scopeClause} AND s.status = ?`, [...scopeParams, statusValue]);
    return Number(row?.cnt || 0);
  };

  const counts = {
    draft: await countStoryStatus('draft'),
    submitted: await countStoryStatus('submitted'),
    in_review: await countStoryStatus('in_review'),
    changes_requested: await countStoryStatus('changes_requested'),
    approved: await countStoryStatus('approved'),
    scheduled: await countStoryStatus('scheduled'),
    published: await countStoryStatus('published'),
    archived: await countStoryStatus('archived'),
  };

  const overview = {
    myDrafts: counts.draft,
    drafts: counts.draft,
    submittedForReview: counts.submitted,
    submitted: counts.submitted,
    inReview: counts.in_review,
    changesRequested: counts.changes_requested,
    changes_requested: counts.changes_requested,
    approved: counts.approved,
    scheduled: counts.scheduled,
    published: counts.published,
    archived: counts.archived,
    totalDrafts: counts.draft,
    totalSubmitted: counts.submitted,
    totalInReview: counts.in_review,
    totalChangesRequested: counts.changes_requested,
    totalApproved: counts.approved,
    totalScheduled: counts.scheduled,
    totalPublished: counts.published,
    totalArchived: counts.archived,
    role,
  };

  if (isEditorial) {
    const newsroomTotal = {
      draft: await db.get(`SELECT COUNT(*) as cnt FROM stories WHERE status = 'draft'`),
      submitted: await db.get(`SELECT COUNT(*) as cnt FROM stories WHERE status = 'submitted'`),
      in_review: await db.get(`SELECT COUNT(*) as cnt FROM stories WHERE status = 'in_review'`),
      changes_requested: await db.get(`SELECT COUNT(*) as cnt FROM stories WHERE status = 'changes_requested'`),
      approved: await db.get(`SELECT COUNT(*) as cnt FROM stories WHERE status = 'approved'`),
      scheduled: await db.get(`SELECT COUNT(*) as cnt FROM stories WHERE status = 'scheduled'`),
      published: await db.get(`SELECT COUNT(*) as cnt FROM stories WHERE status = 'published'`),
      archived: await db.get(`SELECT COUNT(*) as cnt FROM stories WHERE status = 'archived'`),
    };
    overview.newsroom = {
      draft: Number(newsroomTotal.draft?.cnt || 0),
      submitted: Number(newsroomTotal.submitted?.cnt || 0),
      in_review: Number(newsroomTotal.in_review?.cnt || 0),
      changes_requested: Number(newsroomTotal.changes_requested?.cnt || 0),
      approved: Number(newsroomTotal.approved?.cnt || 0),
      scheduled: Number(newsroomTotal.scheduled?.cnt || 0),
      published: Number(newsroomTotal.published?.cnt || 0),
      archived: Number(newsroomTotal.archived?.cnt || 0),
    };
  }

  return overview;
}

async function fetchDashboardQueue(db, user, roleName = null) {
  const role = normalizeRoleName(roleName || user?.role || 'user', 'user');
  const isEditorial = ['admin', 'editor'].includes(role);
  const scopeClause = isEditorial ? '1 = 1' : 's.author_id = ?';
  const scopeParams = isEditorial ? [] : [user.id];
  const statuses = ['draft', 'submitted', 'in_review', 'changes_requested', 'approved', 'scheduled', 'published', 'archived'];
  const queue = {};
  for (const statusName of statuses) {
    const rows = await db.all(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE ${scopeClause} AND s.status = ? ORDER BY COALESCE(s.updatedAt, s.submittedAt, s.submitted_at, s.published_at, datetime('now')) DESC LIMIT 10`, [...scopeParams, statusName]);
    queue[statusName] = rows.map((story) => ({ ...story, status: legacyStoryStatusLabel(story.status) }));
  }
  return queue;
}

app.get('/api/dashboard/overview', authMiddleware, async (req, res) => {
  return withDB(async (db) => {
    const overview = await buildDashboardOverview(db, req.user, req.user.role);
    const queues = await fetchDashboardQueue(db, req.user, req.user.role);
    res.json({
      role: getRoleNameForRequest(req),
      overview,
      queues,
      counts: overview,
    });
  });
});

app.get('/api/dashboard/queues', authMiddleware, async (req, res) => {
  return withDB(async (db) => {
    const queues = await fetchDashboardQueue(db, req.user, req.user.role);
    res.json({ queues, role: getRoleNameForRequest(req) });
  });
});

app.post('/api/stories', authMiddleware, requireRole('admin', 'editor', 'journalist', 'contributor'), async (req, res) => {
  const payload = normalizeStoryPayload(req.body || {});
  if (!payload.title) return res.status(400).json({ error: 'headline required' });
  return withDB(async (db) => {
    try {
      const now = new Date().toISOString();
      const requestedStatus = normalizeCanonicalStoryStatus(payload.status || 'draft');
      const safeStatus = requestedStatus === 'published' || requestedStatus === 'archived' ? 'draft' : requestedStatus;
      const location = await resolveStoryLocation(db, payload, {});
      const slug = await makeUniqueStorySlug(db, payload.slug, payload.title);
      const result = await db.run(`
        INSERT INTO stories (
          title, category, content, author_id, submittedAt, views, excerpt, featured_image, reading_time,
          status, updatedAt, slug, seo_title, meta_description, tags, district, municipality, town, district_id, municipality_id, town_id,
          subheadline, image_alt, image_caption, image_credit
        ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        payload.title, payload.category, payload.content, req.user.id, now, payload.excerpt,
        payload.featured_image, payload.reading_time, safeStatus, now, slug, payload.seo_title,
        payload.meta_description, payload.tags, location.district, location.municipality, location.town,
        location.district_id, location.municipality_id, location.town_id, payload.subheadline,
        payload.image_alt, payload.image_caption, payload.image_credit,
      ]);
      await recordWorkflowAudit(db, result.lastID, 'created', safeStatus === 'draft' ? 'Draft created' : 'Story created', null, safeStatus, req.user.id);
      const story = await db.get('SELECT s.*, u.username AS author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?', [result.lastID]);
      story.status = legacyStoryStatusLabel(story.status);
      res.json({ story });
    } catch (error) {
      const message = error && error.message ? error.message : 'invalid story location';
      return res.status(400).json({ error: message });
    }
  });
});

app.get('/api/stories', authMiddleware, async (req, res) => {
  const role = getRoleNameForRequest(req);
  const isEditorial = ['admin', 'editor'].includes(role);
  const requestedAuthor = String(req.query.author || '').trim();
  const requestedStatuses = parseCsvList(req.query.status)
    .map((status) => normalizeCanonicalStoryStatus(status))
    .filter((status) => CANONICAL_STORY_STATES.has(status));
  const requestedCategories = parseCsvList(req.query.category).map((category) => String(category).trim()).filter(Boolean);
  const requestedDistrict = sanitizeSlug(req.query.district || req.query.district_slug || req.query.districtSlug || '');
  const requestedMunicipality = sanitizeSlug(req.query.municipality || req.query.municipality_slug || req.query.municipalitySlug || '');
  const requestedTown = sanitizeSlug(req.query.town || req.query.town_slug || req.query.townSlug || '');
  const requestedSearch = String(req.query.q || req.query.search || '').trim();
  const featuredFilter = req.query.featured !== undefined ? parseBooleanQuery(req.query.featured) : null;
  const breakingFilter = req.query.breaking !== undefined ? parseBooleanQuery(req.query.breaking) : null;
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  return withDB(async (db) => {
    if (requestedAuthor) {
      if (!isEditorial && String(req.user?.username || '').toLowerCase() !== requestedAuthor.toLowerCase()) {
        return res.status(403).json({ error: 'insufficient permissions' });
      }
    }

    const conditions = ['1 = 1'];
    const params = [];
    if (!isEditorial) {
      conditions.push('(s.status = ? OR s.author_id = ?)');
      params.push('published', req.user.id);
    }
    if (requestedAuthor) {
      conditions.push('u.username = ?');
      params.push(requestedAuthor);
    }
    if (requestedStatuses.length) {
      conditions.push(`s.status IN (${requestedStatuses.map(() => '?').join(', ')})`);
      params.push(...requestedStatuses);
    }
    if (requestedCategories.length) {
      const categoryClauses = [];
      for (const category of requestedCategories) {
        const aliases = getCategorySearchAliases(category);
        categoryClauses.push(`LOWER(COALESCE(s.category, '')) IN (${aliases.map(() => '?').join(', ')})`);
        params.push(...aliases.map((entry) => String(entry).toLowerCase()));
      }
      conditions.push(`(${categoryClauses.join(' OR ')})`);
    }
    if (requestedDistrict) {
      conditions.push('d.slug = ?');
      params.push(requestedDistrict);
    }
    if (requestedMunicipality) {
      conditions.push('m.slug = ?');
      params.push(requestedMunicipality);
    }
    if (requestedTown) {
      conditions.push('t.slug = ?');
      params.push(requestedTown);
    }
    if (featuredFilter !== null) {
      conditions.push('s.featured = ?');
      params.push(featuredFilter ? 1 : 0);
    }
    if (breakingFilter !== null) {
      conditions.push('s.is_breaking = ?');
      params.push(breakingFilter ? 1 : 0);
    }
    if (requestedSearch) {
      const searchTerm = `%${requestedSearch.toLowerCase()}%`;
      conditions.push(`(
        LOWER(COALESCE(s.title, '')) LIKE ? OR
        LOWER(COALESCE(s.slug, '')) LIKE ? OR
        LOWER(COALESCE(s.category, '')) LIKE ? OR
        LOWER(COALESCE(s.tags, '')) LIKE ? OR
        LOWER(COALESCE(u.username, '')) LIKE ?
      )`);
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

        const joinClause = 'LEFT JOIN users u ON u.id = s.author_id LEFT JOIN districts d ON d.id = s.district_id LEFT JOIN municipalities m ON m.id = s.municipality_id LEFT JOIN towns t ON t.id = s.town_id';
    const baseQuery = `SELECT s.*, u.username as author FROM stories s ${joinClause} WHERE ${conditions.join(' AND ')}`;
    const totalRow = await db.get(`SELECT COUNT(*) as cnt FROM stories s ${joinClause} WHERE ${conditions.join(' AND ')}`, params);
    const rows = await db.all(`${baseQuery} ORDER BY COALESCE(s.updatedAt, s.submittedAt, s.published_at, datetime('now')) DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);

const stories = rows.map((story) => ({
      ...story,
      status: legacyStoryStatusLabel(story.status),
      comments: Number(story.comments || 0),
    }));

    res.json({
      stories,
      page,
      limit,
      total: Number(totalRow?.cnt || 0),
      hasMore: offset + stories.length < Number(totalRow?.cnt || 0),
      role,
    });
  });
});

app.put('/api/stories/:id', authMiddleware, async (req, res) => {
  const id = req.params.id;
  const payload = normalizeStoryPayload(req.body || {});
  const hasStatusChange = req.body && Object.prototype.hasOwnProperty.call(req.body, 'status');
  const nextStatus = hasStatusChange ? normalizeCanonicalStoryStatus(req.body.status) : normalizeCanonicalStoryStatus('draft');
  return withDB(async (db) => {
    const existing = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    if (!existing) return res.status(404).json({ error: 'story not found' });
    const isEditorial = canManageEditorialFields(req);
    const isOwner = String(existing.author_id) === String(req.user.id);
    if (!isEditorial && !isOwner) {
      return res.status(403).json({ error: 'insufficient permissions' });
    }
    if (!isEditorial && existing.status !== 'draft' && existing.status !== 'changes_requested') {
      return res.status(409).json({ error: 'story can only be edited while in draft or changes-requested status' });
    }
    if (hasStatusChange) {
      const transition = ensureWorkflowTransition(existing.status || 'draft', nextStatus);
      if (!transition.valid) {
        return res.status(409).json({ error: `invalid transition: ${transition.current} -> ${transition.next}` });
      }
    }
    let updatedLocation;
    try {
      updatedLocation = await resolveStoryLocation(db, { ...existing, ...payload }, existing);
    } catch (error) {
      return res.status(400).json({ error: error.message || 'invalid story location' });
    }
    const updatedAt = new Date().toISOString();
    const nextFeatured = canManageEditorialFields(req) && payload.featured ? 1 : Number(existing.featured || 0);
    const nextBreaking = canManageEditorialFields(req) && payload.is_breaking ? 1 : Number(existing.is_breaking || 0);
    const statusValue = hasStatusChange ? nextStatus : normalizeCanonicalStoryStatus(existing.status || 'draft');
    // Preserve the existing (stable) slug unless an explicit new slug or first-time
    // slug is required, so editing unrelated fields never changes the public URL.
    let slugValue = existing.slug;
    if (payload.slug) {
      slugValue = await makeUniqueStorySlug(db, payload.slug, payload.title || existing.title, id);
    } else if (!existing.slug) {
      slugValue = await makeUniqueStorySlug(db, null, payload.title || existing.title, id);
    }
    // Keep published_at/archived_at consistent with the canonical status so the
    // public visibility rule cannot be bypassed by a direct status change here.
    const publishedAtValue = statusValue === 'published' ? (existing.published_at || updatedAt) : existing.published_at;
    const archivedAtValue = statusValue === 'archived' ? (existing.archived_at || updatedAt) : existing.archived_at;
    const fields = [
      ['title', payload.title || existing.title],
      ['category', normalizeCategoryName(payload.category || existing.category || 'News')],
      ['content', payload.content || existing.content],
      ['excerpt', payload.excerpt || (payload.content || existing.content || '').slice(0, 160)],
      ['featured_image', payload.featured_image || existing.featured_image || ''],
      ['reading_time', Number(payload.reading_time || existing.reading_time || 5)],
      ['is_breaking', nextBreaking],
      ['featured', nextFeatured],
      ['status', statusValue],
      ['editorial_notes', payload.editorial_notes || existing.editorial_notes || ''],
      ['updatedAt', updatedAt],
      ['slug', slugValue],
      ['seo_title', payload.seo_title || existing.seo_title || ''],
      ['meta_description', payload.meta_description || existing.meta_description || ''],
      ['tags', payload.tags || existing.tags || ''],
      ['district', updatedLocation.district || existing.district || ''],
      ['municipality', updatedLocation.municipality || existing.municipality || ''],
      ['town', updatedLocation.town || existing.town || ''],
      ['district_id', updatedLocation.district_id],
      ['municipality_id', updatedLocation.municipality_id],
      ['town_id', updatedLocation.town_id],
      ['published_at', publishedAtValue],
      ['archived_at', archivedAtValue],
    ];
    const assignments = fields.map(([column]) => `${column} = ?`).join(', ');
    const values = fields.map(([, value]) => value);
    values.push(id);
    await db.run(`UPDATE stories SET ${assignments} WHERE id = ?`, values);
    const story = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    story.status = legacyStoryStatusLabel(story.status);
    if (payload.title || payload.content || payload.excerpt || hasStatusChange) {
      await recordWorkflowAudit(db, story.id, 'story_updated', 'Story updated by author or editor', existing.status || 'draft', story.status || 'draft', req.user.id);
    }
    res.json({ story });
  });
});

app.post('/api/stories/:id/submit', authMiddleware, async (req, res) => {
  const id = req.params.id;
  return withDB(async (db) => {
    const story = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    if (!story) return res.status(404).json({ error: 'story not found' });
    const role = getRoleNameForRequest(req);
    const isOwner = Number(story.author_id) === Number(req.user.id);
    if (!isOwner || !['admin', 'editor', 'journalist', 'contributor'].includes(role)) {
      return res.status(403).json({ error: 'insufficient permissions' });
    }
    if (!story.title || !story.content) {
      return res.status(400).json({ error: 'title and content required before submission' });
    }
    const targetStatus = normalizeCanonicalStoryStatus('submitted');
    const transition = ensureWorkflowTransition(story.status || 'draft', targetStatus);
    if (!transition.valid) {
      return res.status(409).json({ error: `invalid transition: ${transition.current} -> ${transition.next}` });
    }
    const updatedAt = new Date().toISOString();
    await db.run(`UPDATE stories SET status = ?, updatedAt = ? WHERE id = ?`, [targetStatus, updatedAt, id]);
    await recordWorkflowAudit(db, id, 'submitted_for_review', 'Story submitted for editorial review', story.status || 'draft', targetStatus, req.user.id);
    const updatedStory = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    updatedStory.status = legacyStoryStatusLabel(updatedStory.status);
    res.json({ story: updatedStory });
  });
});

app.get('/api/editorial/queue', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  return withDB(async (db) => {
    const rows = await db.all(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.status IN ('submitted', 'in_review', 'changes_requested', 'approved', 'scheduled', 'published') ORDER BY s.submittedAt DESC`);
    const stories = rows.map((story) => ({ ...story, status: legacyStoryStatusLabel(story.status) }));
    res.json({ stories });
  });
});

app.post('/api/editorial/stories/:id/review', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  const id = req.params.id;
  const notes = String(req.body?.notes || '').trim();
  const targetStatus = normalizeCanonicalStoryStatus(req.body?.status || 'in_review');
  return withDB(async (db) => {
    const story = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    if (!story) return res.status(404).json({ error: 'story not found' });
    const transition = ensureWorkflowTransition(story.status || 'draft', targetStatus);
    if (!transition.valid) {
      return res.status(409).json({ error: `invalid transition: ${transition.current} -> ${transition.next}` });
    }
    const updatedAt = new Date().toISOString();
    await db.run(`UPDATE stories SET status = ?, editorial_notes = ?, updatedAt = ? WHERE id = ?`, [targetStatus, notes || story.editorial_notes || '', updatedAt, id]);
    await recordWorkflowAudit(db, id, 'review_started', notes || 'Review started by editor', story.status || 'draft', targetStatus, req.user.id);
    const updatedStory = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    updatedStory.status = legacyStoryStatusLabel(updatedStory.status);
    res.json({ story: updatedStory });
  });
});

app.post('/api/editorial/stories/:id/request-changes', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  const id = req.params.id;
  const notes = String(req.body?.notes || '').trim();
  if (!notes) return res.status(400).json({ error: 'review notes required' });
  return withDB(async (db) => {
    const story = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    if (!story) return res.status(404).json({ error: 'story not found' });
    const targetStatus = normalizeCanonicalStoryStatus('changes_requested');
    const transition = ensureWorkflowTransition(story.status || 'draft', targetStatus);
    if (!transition.valid) {
      return res.status(409).json({ error: `invalid transition: ${transition.current} -> ${transition.next}` });
    }
    const updatedAt = new Date().toISOString();
    await db.run(`UPDATE stories SET status = ?, editorial_notes = ?, updatedAt = ? WHERE id = ?`, [targetStatus, notes, updatedAt, id]);
    await recordWorkflowAudit(db, id, 'changes_requested', notes, story.status || 'draft', targetStatus, req.user.id);
    const updatedStory = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    updatedStory.status = legacyStoryStatusLabel(updatedStory.status);
    res.json({ story: updatedStory });
  });
});

app.post('/api/editorial/stories/:id/approve', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  const id = req.params.id;
  const notes = String(req.body?.notes || '').trim();
  return withDB(async (db) => {
    const story = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    if (!story) return res.status(404).json({ error: 'story not found' });
    const role = getRoleNameForRequest(req);
    if (Number(story.author_id) === Number(req.user.id) && ['contributor', 'journalist'].includes(role)) {
      return res.status(403).json({ error: 'authors cannot approve their own story' });
    }
    const targetStatus = normalizeCanonicalStoryStatus('approved');
    const transition = ensureWorkflowTransition(story.status || 'draft', targetStatus);
    if (!transition.valid) {
      return res.status(409).json({ error: `invalid transition: ${transition.current} -> ${transition.next}` });
    }
    const updatedAt = new Date().toISOString();
    await db.run(`UPDATE stories SET status = ?, editorial_notes = ?, updatedAt = ? WHERE id = ?`, [targetStatus, notes || story.editorial_notes || '', updatedAt, id]);
    await recordWorkflowAudit(db, id, 'approved', notes || 'Story approved by editor', story.status || 'draft', targetStatus, req.user.id);
    const updatedStory = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    updatedStory.status = legacyStoryStatusLabel(updatedStory.status);
    res.json({ story: updatedStory });
  });
});

app.post('/api/editorial/stories/:id/schedule', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  const id = req.params.id;
  const scheduledAtValue = String(req.body?.scheduled_at || req.body?.publish_at || req.body?.date || '').trim();
  if (!scheduledAtValue) {
    return res.status(400).json({ error: 'scheduled publication time required' });
  }

  const scheduledAt = new Date(scheduledAtValue);
  if (Number.isNaN(scheduledAt.getTime())) {
    return res.status(400).json({ error: 'invalid scheduled publication time' });
  }

  return withDB(async (db) => {
    const story = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    if (!story) return res.status(404).json({ error: 'story not found' });

    const targetStatus = normalizeCanonicalStoryStatus('scheduled');
    const transition = ensureWorkflowTransition(story.status || 'draft', targetStatus);
    if (!transition.valid) {
      return res.status(409).json({ error: `invalid transition: ${transition.current} -> ${transition.next}` });
    }

    const updatedAt = new Date().toISOString();
    const isoScheduled = scheduledAt.toISOString();
    await db.run(`UPDATE stories SET status = ?, scheduled_at = ?, updatedAt = ? WHERE id = ?`, [targetStatus, isoScheduled, updatedAt, id]);
    await recordWorkflowAudit(db, id, 'scheduled', `Scheduled for publication at ${isoScheduled}`, story.status || 'draft', targetStatus, req.user.id);

    const updatedStory = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    updatedStory.status = legacyStoryStatusLabel(updatedStory.status);
    res.json({ story: updatedStory });
  });
});

app.post('/api/editorial/stories/:id/publish', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  const id = req.params.id;
  return withDB(async (db) => {
    const story = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    if (!story) return res.status(404).json({ error: 'story not found' });
    const targetStatus = normalizeCanonicalStoryStatus(req.body?.status || 'published');
    const transition = ensureWorkflowTransition(story.status || 'draft', targetStatus);
    if (!transition.valid) {
      return res.status(409).json({ error: `invalid transition: ${transition.current} -> ${transition.next}` });
    }
    const publishedAt = new Date().toISOString();
    await db.run(`UPDATE stories SET status = ?, published_at = ?, updatedAt = ? WHERE id = ?`, [targetStatus, publishedAt, publishedAt, id]);
    await recordWorkflowAudit(db, id, 'published', 'Story published', story.status || 'draft', targetStatus, req.user.id);
    const updatedStory = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    updatedStory.status = legacyStoryStatusLabel(updatedStory.status);
    res.json({ story: updatedStory });
  });
});

app.post('/api/editorial/stories/:id/archive', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  const id = req.params.id;
  const reason = String(req.body?.reason || '').trim();
  return withDB(async (db) => {
    const story = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    if (!story) return res.status(404).json({ error: 'story not found' });
    const targetStatus = normalizeCanonicalStoryStatus('archived');
    const transition = ensureWorkflowTransition(story.status || 'draft', targetStatus);
    if (!transition.valid) {
      return res.status(409).json({ error: `invalid transition: ${transition.current} -> ${transition.next}` });
    }
    const archivedAt = new Date().toISOString();
    await db.run(`UPDATE stories SET status = ?, archived_at = ?, editorial_notes = ?, updatedAt = ? WHERE id = ?`, [targetStatus, archivedAt, reason || story.editorial_notes || 'Archived by editor', archivedAt, id]);
    await recordWorkflowAudit(db, id, 'archived', reason || 'Story archived', story.status || 'draft', targetStatus, req.user.id);
    const updatedStory = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    updatedStory.status = legacyStoryStatusLabel(updatedStory.status);
    res.json({ story: updatedStory });
  });
});

app.post('/api/editorial/stories/:id/feature', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  const id = req.params.id;
  const featured = Boolean(req.body?.featured ?? req.body?.value ?? true);
  return withDB(async (db) => {
    const story = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    if (!story) return res.status(404).json({ error: 'story not found' });
    if (featured && story.status !== 'published') {
      return res.status(409).json({ error: 'featured stories must be published first' });
    }
    await db.run(`UPDATE stories SET featured = ?, updatedAt = ? WHERE id = ?`, [featured ? 1 : 0, new Date().toISOString(), id]);
    await recordWorkflowAudit(db, id, 'featured_changed', featured ? 'Story featured by editor' : 'Story unfeatured by editor', story.status || 'draft', story.status || 'draft', req.user.id);
    const updatedStory = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    res.json({ story: updatedStory });
  });
});

app.post('/api/editorial/stories/:id/breaking', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  const id = req.params.id;
  const breaking = Boolean(req.body?.is_breaking ?? req.body?.breaking ?? true);
  return withDB(async (db) => {
    const story = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    if (!story) return res.status(404).json({ error: 'story not found' });
    if (breaking && story.status !== 'published') {
      return res.status(409).json({ error: 'breaking stories must be published first' });
    }
    await db.run(`UPDATE stories SET is_breaking = ?, updatedAt = ? WHERE id = ?`, [breaking ? 1 : 0, new Date().toISOString(), id]);
    await recordWorkflowAudit(db, id, 'breaking_changed', breaking ? 'Story marked breaking by editor' : 'Breaking flag removed by editor', story.status || 'draft', story.status || 'draft', req.user.id);
    const updatedStory = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    res.json({ story: updatedStory });
  });
});

app.patch('/api/corrections/:id', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  const id = req.params.id;
  const { status, notes } = req.body || {};
  const nextStatus = String(status || '').trim().toLowerCase();
  if (!['new', 'reviewing', 'resolved', 'rejected'].includes(nextStatus)) {
    return res.status(400).json({ error: 'invalid correction status' });
  }
  return withDB(async (db) => {
    const existing = await db.get(`SELECT * FROM correction_requests WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ error: 'correction request not found' });
    const updatedAt = new Date().toISOString();
    await db.run(`UPDATE correction_requests SET status = ?, updated_at = ?, description = COALESCE(?, description) WHERE id = ?`, [nextStatus, updatedAt, notes || existing.description, id]);
    res.json({ correction: await db.get(`SELECT * FROM correction_requests WHERE id = ?`, [id]) });
  });
});

app.post('/api/stories/:id/correct', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  const id = req.params.id;
  const { title, content, excerpt, notes } = req.body || {};
  if (!content && !title && !excerpt) {
    return res.status(400).json({ error: 'correction details required' });
  }
  return withDB(async (db) => {
    const story = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    if (!story) return res.status(404).json({ error: 'story not found' });
    if (story.status !== 'published') {
      return res.status(409).json({ error: 'only published stories can be corrected' });
    }
    const updatedAt = new Date().toISOString();
    const fields = [];
    const values = [];
    if (title) { fields.push('title = ?'); values.push(String(title).slice(0, 180)); }
    if (content) { fields.push('content = ?'); values.push(String(content)); }
    if (excerpt) { fields.push('excerpt = ?'); values.push(String(excerpt).slice(0, 260)); }
    fields.push('updatedAt = ?');
    values.push(updatedAt);
    await db.run(`UPDATE stories SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    await recordWorkflowAudit(db, id, 'corrected', notes || 'Published story corrected by editor', 'published', 'published', req.user.id);
    const updatedStory = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    res.json({ story: updatedStory });
  });
});

function analyzeStoryEditorially(story = {}) {
  const body = sanitizeHtml(String(story.content || ''), { allowedTags: [], allowedAttributes: {} });
  const words = countWords(body);
  const hasImage = Boolean(story.featured_image);
  const hasMetadata = Boolean(story.meta_description || story.seo_title);
  const quality = Math.max(0, Math.min(100, Math.round((Math.min(words, 700) / 7) + (hasImage ? 10 : 0) + (hasMetadata ? 10 : 0))));
  const recommendations = [
    words < 100 ? 'Editorial review: add more reporting detail before submission.' : '',
    !hasImage ? 'Add a featured image.' : '',
    !hasMetadata ? 'Complete the SEO title and description.' : '',
    !story.municipality ? 'Add municipality context where relevant.' : '',
    !story.tags ? 'Add tags to improve discovery.' : '',
  ].filter(Boolean).join(' ');
  return {
    quality_score: quality,
    grammar_score: 0,
    readability_score: 0,
    seo_score: hasMetadata ? 100 : 0,
    originality_score: 0,
    headline_score: story.title ? 100 : 0,
    human_writing_confidence: 0,
    ai_writing_probability: 0,
    confidence_level: 'low',
    fact_check_status: 'needs-verification',
    sources_count: 0,
    quotes_count: 0,
    images_count: hasImage ? 1 : 0,
    reading_time: estimateReadingTime(body),
    recommendations,
    notes: 'Automated indicators are advisory and do not establish authorship or factual accuracy.',
  };
}

app.get('/api/stories/:id/editorial-analysis', authMiddleware, async (req, res) => {
  const id = req.params.id;
  return withDB(async (db) => {
    const existing = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    if (!existing) return res.status(404).json({ error: 'story not found' });

    const analysis = analyzeStoryEditorially(existing);
    const current = await db.get(`SELECT * FROM editorial_reviews WHERE story_id = ?`, [id]);
    const now = new Date().toISOString();
    const values = [
      id,
      analysis.quality_score,
      analysis.grammar_score,
      analysis.readability_score,
      analysis.seo_score,
      analysis.originality_score,
      analysis.headline_score,
      analysis.human_writing_confidence,
      analysis.ai_writing_probability,
      analysis.confidence_level,
      analysis.fact_check_status,
      analysis.sources_count,
      analysis.quotes_count,
      analysis.images_count,
      analysis.reading_time,
      analysis.recommendations,
      analysis.notes,
      now,
      now,
    ];

    if (current) {
      await db.run(`UPDATE editorial_reviews SET
        quality_score = ?, grammar_score = ?, readability_score = ?, seo_score = ?, originality_score = ?, headline_score = ?,
        human_writing_confidence = ?, ai_writing_probability = ?, confidence_level = ?, fact_check_status = ?, sources_count = ?,
        quotes_count = ?, images_count = ?, reading_time = ?, recommendations = ?, notes = ?, updated_at = ?
        WHERE story_id = ?`, [...values.slice(1, 19), values[19], id]);
    } else {
      await db.run(`INSERT INTO editorial_reviews (
        story_id, quality_score, grammar_score, readability_score, seo_score, originality_score, headline_score,
        human_writing_confidence, ai_writing_probability, confidence_level, fact_check_status, sources_count,
        quotes_count, images_count, reading_time, recommendations, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, values);
    }

    const review = await db.get(`SELECT * FROM editorial_reviews WHERE story_id = ?`, [id]);
    const story = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    res.json({
      story,
      review: {
        ...review,
        disclaimer: 'This score is an estimate and should only assist editorial decision-making. It is not proof that the content was written by artificial intelligence.',
        recommendations: review?.recommendations || analysis.recommendations,
      }
    });
  });
});

app.post('/api/stories/:id/editorial-review', authMiddleware, requireRole('admin', 'editor', 'sub-editor', 'managing-editor', 'journalist'), async (req, res) => {
  const id = req.params.id;
  const action = String(req.body?.action || 'approve').trim().toLowerCase();
  const notes = String(req.body?.notes || '').trim();
  return withDB(async (db) => {
    const existing = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    if (!existing) return res.status(404).json({ error: 'story not found' });

    const statusMap = {
      approve: 'approved',
      'request-changes': 'changes_requested',
      'request_changes': 'changes_requested',
      reject: 'changes_requested',
      publish: 'published',
      schedule: 'scheduled',
      'pending-review': 'submitted',
      'fact-check': 'in_review',
      submitted: 'submitted',
      changes_requested: 'changes_requested',
      in_review: 'in_review',
      approved: 'approved',
    };
    const canonicalStatus = normalizeCanonicalStoryStatus(statusMap[action] || 'approved');
    const transition = ensureWorkflowTransition(existing.status || 'draft', canonicalStatus);
    if (!transition.valid) {
      return res.status(409).json({ error: `invalid transition: ${transition.current} -> ${transition.next}` });
    }
    const updatedAt = new Date().toISOString();
    await db.run(`UPDATE stories SET status = ?, editorial_notes = ?, updatedAt = ? WHERE id = ?`, [canonicalStatus, notes || existing.editorial_notes || '', updatedAt, id]);

    const review = await db.get(`SELECT * FROM editorial_reviews WHERE story_id = ?`, [id]);
    if (review) {
      await db.run(`UPDATE editorial_reviews SET notes = ?, updated_at = ? WHERE story_id = ?`, [notes || review.notes || '', updatedAt, id]);
    }
    await recordWorkflowAudit(db, id, action, notes || 'Editorial review action', existing.status || 'draft', canonicalStatus, req.user.id);

    const story = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    story.status = legacyStoryStatusLabel(story.status);
    res.json({
      story,
      review: {
        ...(review || {}),
        action,
        notes,
        status: story.status,
        disclaimer: 'This score is an estimate and should only assist editorial decision-making. It is not proof that the content was written by artificial intelligence.',
      }
    });
  });
});

app.get('/api/editorial/overview', authMiddleware, requireRole('admin', 'editor', 'sub-editor'), async (req, res) => {
  return withDB(async (db) => {
    const pendingReview = await db.get(`SELECT COUNT(*) as cnt FROM stories WHERE status IN ('submitted', 'in_review')`);
    const needsChanges = await db.get(`SELECT COUNT(*) as cnt FROM stories WHERE status = 'changes_requested'`);
    const approved = await db.get(`SELECT COUNT(*) as cnt FROM stories WHERE status = 'approved'`);
    const published = await db.get(`SELECT COUNT(*) as cnt FROM stories WHERE status = 'published'`);
    const rejected = await db.get(`SELECT COUNT(*) as cnt FROM stories WHERE status IN ('rejected', 'changes_requested')`);
    const avgQuality = await db.get(`SELECT AVG(quality_score) as average FROM editorial_reviews`);
    const avgGrammar = await db.get(`SELECT AVG(grammar_score) as average FROM editorial_reviews`);
    const avgSeo = await db.get(`SELECT AVG(seo_score) as average FROM editorial_reviews`);
    const topContributor = await db.get(`SELECT u.username, COUNT(s.id) as count FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.status = 'published' GROUP BY u.id ORDER BY count DESC LIMIT 1`);
    res.json({
      overview: {
        pendingReview: Number(pendingReview?.cnt || 0),
        needsChanges: Number(needsChanges?.cnt || 0),
        approved: Number(approved?.cnt || 0),
        published: Number(published?.cnt || 0),
        rejected: Number(rejected?.cnt || 0),
        averageQualityScore: Number(avgQuality?.average || 0),
        averageGrammarScore: Number(avgGrammar?.average || 0),
        averageSeoScore: Number(avgSeo?.average || 0),
        topContributor: topContributor?.username || 'No published stories yet'
      }
    });
  });
});

app.get('/api/users/me', authMiddleware, async (req, res) => {
  return withDB(async (db) => {
    const user = await db.get(`SELECT id, username, bio, avatar, role, is_active FROM users WHERE id = ?`, [req.user.id]);
    if (!user) return res.status(404).json({ error: 'user not found' });
    const storyCount = await db.get(`SELECT COUNT(*) as cnt FROM stories WHERE author_id = ?`, [req.user.id]);
    const views = await db.get(`SELECT COALESCE(SUM(views),0) as total FROM stories WHERE author_id = ?`, [req.user.id]);
    res.json({ user: { ...safeUserObject(user), storyCount: Number(storyCount?.cnt || 0), totalViews: Number(views?.total || 0) } });
  });
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  return withDB(async (db) => {
    const user = await db.get(`SELECT id, username, bio, avatar, role, is_active FROM users WHERE id = ?`, [req.user.id]);
    if (!user) return res.status(404).json({ error: 'user not found' });
    const storyCount = await db.get(`SELECT COUNT(*) as cnt FROM stories WHERE author_id = ?`, [req.user.id]);
    const views = await db.get(`SELECT COALESCE(SUM(views),0) as total FROM stories WHERE author_id = ?`, [req.user.id]);
    res.json({ user: { ...safeUserObject(user), storyCount: Number(storyCount?.cnt || 0), totalViews: Number(views?.total || 0) } });
  });
});

app.post('/api/media/upload', authMiddleware, requireRole('admin', 'editor', 'journalist', 'contributor'), (req, res, next) => {
  upload.single('file')(req, res, (error) => {
    if (error) {
      return res.status(400).json({ error: error.message || 'File upload failed.' });
    }
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  try {
    const validation = await validateUploadedMediaFile(req.file.path, req.file.originalname, req.file.mimetype);
    const caption = sanitizePlainText(req.body?.caption || '', 255);
    const altText = sanitizePlainText(req.body?.alt_text || req.body?.altText || '', 255);
    const credit = sanitizePlainText(req.body?.credit || '', 255);
    const originalName = sanitizePlainText(String(req.file.originalname || req.file.filename || 'upload').replace(/\\/g, '/'), 255);
    const storedName = String(req.file.filename || '').trim();
    const publicUrl = normalizeMediaUrl(storedName);

    return withDB(async (db) => {
      const createdAt = new Date().toISOString();
      const result = await db.run(`INSERT INTO media (original_name, stored_name, mime_type, size, caption, alt_text, credit, public_url, width, height, createdAt, updatedAt, author_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [originalName, storedName, validation.mimeType, req.file.size, caption, altText, credit, publicUrl, validation.width, validation.height, createdAt, createdAt, req.user.id]);
      const media = await db.get(`SELECT m.*, u.username as author FROM media m LEFT JOIN users u ON u.id = m.author_id WHERE m.id = ?`, [result.lastID]);
      res.json({ media: normalizeMediaRecord(media) });
    }).catch((error) => {
      removeFileIfExists(req.file.path);
      throw error;
    });
  } catch (error) {
    removeFileIfExists(req.file && req.file.path);
    return res.status(400).json({ error: error.message || 'Image validation failed.' });
  }
});

app.get('/api/media', authMiddleware, async (req, res) => {
  return withDB(async (db) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    let whereClause = '1 = 1';
    const params = [];
    if (q) {
      whereClause += ` AND (lower(COALESCE(m.original_name, '')) LIKE ? OR lower(COALESCE(m.alt_text, '')) LIKE ? OR lower(COALESCE(m.caption, '')) LIKE ? OR lower(COALESCE(m.credit, '')) LIKE ? OR lower(COALESCE(m.stored_name, '')) LIKE ?)`;
      const token = `%${q}%`;
      params.push(token, token, token, token, token);
    }

    const totalRow = await db.get(`SELECT COUNT(*) as cnt FROM media m WHERE ${whereClause}`, params);
    const rows = await db.all(`SELECT m.*, u.username as author FROM media m LEFT JOIN users u ON u.id = m.author_id WHERE ${whereClause} ORDER BY COALESCE(m.updatedAt, m.createdAt) DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const total = Number(totalRow?.cnt || 0);
    res.json({
      media: rows.map((item) => normalizeMediaRecord(item)),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  });
});

app.get('/api/media/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'media id required' });
  return withDB(async (db) => {
    const media = await db.get(`SELECT m.*, u.username as author FROM media m LEFT JOIN users u ON u.id = m.author_id WHERE m.id = ?`, [id]);
    if (!media) return res.status(404).json({ error: 'media not found' });
    res.json({ media: normalizeMediaRecord(media) });
  });
});

app.patch('/api/media/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'media id required' });

  return withDB(async (db) => {
    const media = await db.get(`SELECT * FROM media WHERE id = ?`, [id]);
    if (!media) return res.status(404).json({ error: 'media not found' });

    const role = normalizeRoleName(req.user.role || 'user', 'user');
    const isEditorial = ['admin', 'editor'].includes(role);
    const canEdit = isEditorial || Number(media.author_id) === Number(req.user.id);
    if (!canEdit) return res.status(403).json({ error: 'insufficient permissions' });

    const altText = sanitizePlainText(req.body?.alt_text || req.body?.altText || media.alt_text || '', 255);
    const caption = sanitizePlainText(req.body?.caption || media.caption || '', 255);
    const credit = sanitizePlainText(req.body?.credit || media.credit || '', 255);
    const updatedAt = new Date().toISOString();

    await db.run(`UPDATE media SET alt_text = ?, caption = ?, credit = ?, updatedAt = ? WHERE id = ?`, [altText, caption, credit, updatedAt, id]);
    const updated = await db.get(`SELECT m.*, u.username as author FROM media m LEFT JOIN users u ON u.id = m.author_id WHERE m.id = ?`, [id]);
    return res.json({ media: normalizeMediaRecord(updated) });
  });
});

app.get('/api/analytics/overview', async (req, res) => {
  return withDB(async (db) => {
    const storyCount = await db.get(`SELECT COUNT(*) as cnt FROM stories`);
    const publishedCount = await db.get(`SELECT COUNT(*) as cnt FROM stories WHERE status = 'published'`);
    const draftCount = await db.get(`SELECT COUNT(*) as cnt FROM stories WHERE status = 'draft'`);
    const commentCount = await db.get(`SELECT COUNT(*) as cnt FROM comments`);
    const viewCount = await db.get(`SELECT COALESCE(SUM(views),0) as total FROM stories`);
    const topStories = await db.all(`SELECT id, title, views FROM stories ORDER BY views DESC LIMIT 5`);
    const breakingCount = await db.get(`SELECT COUNT(*) as cnt FROM breaking_news WHERE status = 'active'`);
    const subscriberCount = await db.get(`SELECT COUNT(*) as cnt FROM newsletter_subscribers WHERE status = 'active'`);
    const pushCount = await db.get(`SELECT COUNT(*) as cnt FROM push_preferences WHERE enabled = 1`);
    const mostRead = await db.get(`SELECT title, views FROM stories ORDER BY views DESC LIMIT 1`);
    const mostCommented = await db.get(`SELECT s.title, COUNT(c.id) as comments FROM stories s LEFT JOIN comments c ON c.story_id = s.id GROUP BY s.id ORDER BY comments DESC LIMIT 1`);
    const topCategory = await db.get(`SELECT category, COUNT(*) as cnt FROM stories GROUP BY category ORDER BY cnt DESC LIMIT 1`);
    const topReporter = await db.get(`SELECT u.username as name, COUNT(s.id) as count FROM stories s LEFT JOIN users u ON u.id = s.author_id GROUP BY u.username ORDER BY count DESC LIMIT 1`);
    const analytics = {
      todayVisitors: 1284,
      pageViews: Number(viewCount?.total || 0),
      returningVisitors: 742,
      newVisitors: 542,
      articlesPublished: Number(publishedCount?.cnt || 0),
      breakingNewsPublished: Number(breakingCount?.cnt || 0),
      newsletterSubscribers: Number(subscriberCount?.cnt || 0),
      pushNotificationSubscribers: Number(pushCount?.cnt || 0),
      mostReadArticle: mostRead?.title || 'No stories yet',
      mostShared: 'Homepage story card',
      mostCommented: mostCommented?.title || 'No comments yet',
      topReporter: topReporter?.name || 'No reporter',
      topMunicipality: 'Mbombela',
      trafficSources: ['Direct', 'Search', 'Social'],
      searchKeywords: ['Mpumalanga news', 'Mbombela', 'sports'],
      popularCategories: topCategory ? [{ category: topCategory.category, count: Number(topCategory.cnt || 0) }] : [],
      averageReadingTime: 4,
      bounceRate: '61%',
      countries: ['South Africa', 'Botswana', 'Eswatini'],
      devices: ['Mobile', 'Desktop'],
      browserStats: ['Chrome', 'Safari'],
      liveVisitors: 42
    };
    res.json({
      overview: {
        storyCount: Number(storyCount?.cnt || 0),
        publishedCount: Number(publishedCount?.cnt || 0),
        draftCount: Number(draftCount?.cnt || 0),
        commentCount: Number(commentCount?.cnt || 0),
        viewCount: Number(viewCount?.total || 0),
        topStories
      },
      analytics
    });
  });
});

app.get('/api/contributors/performance', authMiddleware, requireRole('admin', 'editor', 'sub-editor'), async (req, res) => {
  return withDB(async (db) => {
    const contributors = await db.all(`SELECT u.id, u.username, u.role, u.bio, COUNT(s.id) as articlesPublished, COALESCE(SUM(s.views),0) as totalViews FROM users u LEFT JOIN stories s ON s.author_id = u.id AND s.status = 'published' WHERE u.role IN ('contributor', 'journalist', 'editor', 'admin', 'sub-editor') GROUP BY u.id ORDER BY totalViews DESC, articlesPublished DESC LIMIT 10`);
    const summary = {
      totalContributors: contributors.length,
      totalPublishedArticles: contributors.reduce((sum, item) => sum + Number(item.articlesPublished || 0), 0),
      totalViews: contributors.reduce((sum, item) => sum + Number(item.totalViews || 0), 0),
      topContributor: contributors[0] ? { username: contributors[0].username, views: Number(contributors[0].totalViews || 0) } : null
    };
    res.json({ summary, contributors: contributors.map((item) => ({ ...item, articlesPublished: Number(item.articlesPublished || 0), totalViews: Number(item.totalViews || 0) })) });
  });
});

// Public search: only ever searches publicly visible (published, not archived,
// not scheduled-for-the-future) stories. The caller can never widen the result
// set via a status/query-parameter override.
app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  const category = String(req.query.category || '').trim().slice(0, 80);
  const limit = Math.max(1, Math.min(20, Number.parseInt(req.query.limit, 10) || 10));
  if (!q) {
    return res.json({ results: [] });
  }
  return withDB(async (db) => {
    const filters = [
      publicStoryWhereClause('s'),
      '(s.title LIKE ? OR s.content LIKE ? OR s.excerpt LIKE ? OR s.category LIKE ? OR s.tags LIKE ?)'
    ];
    const params = [nowISO(), `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`];
    if (category) {
      filters.push('s.category = ?');
      params.push(category);
    }
    params.push(limit);
    const rows = await db.all(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE ${filters.join(' AND ')} ORDER BY s.published_at DESC LIMIT ?`, params);
    const results = rows.map((story) => sanitizePublicStory({ ...story, comments: Number(story.comments || 0) }));
    res.json({ results });
  });
});

app.post('/api/stories/:id/view', async (req, res) => {
  const id = req.params.id;
  return withDB(async (db) => {
    const visible = await db.get(`SELECT id FROM stories s WHERE s.id = ? AND ${publicStoryWhereClause('s')}`, [id, nowISO()]);
    if (!visible) return res.status(404).json({ error: 'story not found' });
    await db.run(`UPDATE stories SET views = COALESCE(views,0) + 1 WHERE id = ?`, [id]);
    const s = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    res.json({ story: sanitizePublicStory(s) });
  });
});

app.post('/api/stories/:id/comments', authMiddleware, async (req, res) => {
  const id = req.params.id;
  const { text, parentId, replyTo } = req.body || {};
  if (!text) return res.status(400).json({ error: 'comment text required' });
  return withDB(async (db) => {
    const story = await db.get(`SELECT id FROM stories s WHERE s.id = ? AND ${publicStoryWhereClause('s')}`, [id, nowISO()]);
    if (!story) return res.status(404).json({ error: 'story not found' });
    const createdAt = new Date().toISOString();
    const safeParentId = Number(parentId || replyTo || 0);
    const safeText = String(text).trim().slice(0, 2000);
    await db.run(`INSERT INTO comments (story_id, author_id, author_name, text, parent_id, likes, dislikes, reported, pinned, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 'approved', ?, ?)`, [id, req.user.id, req.user.username, safeText, safeParentId, createdAt, createdAt]);
    const comments = await db.all(`SELECT id, story_id, author_id, author_name, text, parent_id, likes, dislikes, reported, pinned, status, created_at FROM comments WHERE story_id = ? ORDER BY created_at DESC`, [id]);
    res.json({ comments });
  });
});

app.get('/api/stories/:id/comments', async (req, res) => {
  const id = req.params.id;
  return withDB(async (db) => {
    const story = await db.get(`SELECT id FROM stories s WHERE s.id = ? AND ${publicStoryWhereClause('s')}`, [id, nowISO()]);
    if (!story) return res.status(404).json({ error: 'story not found' });
    const comments = await db.all(`SELECT id, story_id, author_id, author_name, text, parent_id, likes, dislikes, reported, pinned, status, created_at FROM comments WHERE story_id = ? ORDER BY created_at DESC`, [id]);
    res.json({ comments });
  });
});

app.post('/api/admin/breaking-news', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  const { headline, slug, articleId, priority, status, expiresAt } = req.body || {};
  if (!headline) return res.status(400).json({ error: 'headline required' });
  return withDB(async (db) => {
    const createdAt = new Date().toISOString();
    const item = await db.run(`INSERT INTO breaking_news (headline, slug, article_id, priority, published_at, expires_at, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [headline, slug || headline.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''), articleId || null, Number(priority || 0), createdAt, expiresAt || null, status || 'active', req.user.id, createdAt]);
    const createdItem = await db.get(`SELECT * FROM breaking_news WHERE id = ?`, [item.lastID]);
    res.json({ item: createdItem });
  });
});

// Consolidated public breaking-news endpoint (previously duplicated).
// Order of precedence: curated breaking_news entries -> published stories
// flagged is_breaking -> latest published stories as a safe fallback.
// Every source is filtered through the same publication-visibility rule so a
// story can never appear here merely because is_breaking/featured is set.
app.get('/api/breaking-news', async (req, res) => {
  return withDB(async (db) => {
    const now = nowISO();
    const curated = await db.all(
      `SELECT bn.* FROM breaking_news bn
       LEFT JOIN stories s ON s.id = bn.article_id
       WHERE bn.status = 'active' AND (bn.expires_at IS NULL OR bn.expires_at > ?)
         AND (bn.article_id IS NULL OR (${publicStoryWhereClause('s')}))
       ORDER BY bn.priority DESC, bn.published_at DESC LIMIT 8`,
      [now, now]
    );
    if (curated.length) {
      const stories = curated.map((item) => ({ id: item.id, articleId: item.article_id || null, title: item.headline, slug: item.slug || null, category: 'Breaking', publishedAt: item.published_at, priority: item.priority }));
      return res.json({ stories });
    }

    const breakingStories = await db.all(
      `SELECT s.*, u.username as author, (SELECT COUNT(*) FROM comments WHERE story_id = s.id) as comments
       FROM stories s LEFT JOIN users u ON u.id = s.author_id
       WHERE ${publicStoryWhereClause('s')} AND s.is_breaking = 1
       ORDER BY s.published_at DESC LIMIT 8`,
      [now]
    );
    const dedupe = (rows) => rows
      .filter((story) => story && story.title && (story.content || story.excerpt || story.featured_image))
      .filter((story, index, array) => array.findIndex((candidate) => (candidate.title || '').toLowerCase() === (story.title || '').toLowerCase()) === index)
      .map((story) => sanitizePublicStory({ ...story, comments: Number(story.comments || 0) }));

    const dedupedBreakingStories = dedupe(breakingStories);
    if (dedupedBreakingStories.length) {
      return res.json({ stories: dedupedBreakingStories });
    }

    const latestStories = await db.all(
      `SELECT s.*, u.username as author, (SELECT COUNT(*) FROM comments WHERE story_id = s.id) as comments
       FROM stories s LEFT JOIN users u ON u.id = s.author_id
       WHERE ${publicStoryWhereClause('s')}
       ORDER BY s.published_at DESC LIMIT 8`,
      [now]
    );
    res.json({ stories: dedupe(latestStories) });
  });
});

app.post('/api/corrections', publicFormLimiter, async (req, res) => {
  const { name, email, articleUrl, issueType, description, supportingDocuments } = req.body || {};
  if (!name || !email || !description) return res.status(400).json({ error: 'name, email and description are required' });
  return withDB(async (db) => {
    const createdAt = new Date().toISOString();
    const row = await db.run(`INSERT INTO correction_requests (name, email, article_url, issue_type, description, supporting_documents, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?)`, [name, email, articleUrl || '', issueType || '', description, supportingDocuments || '', createdAt, createdAt]);
    const request = await db.get(`SELECT * FROM correction_requests WHERE id = ?`, [row.lastID]);
    res.json({ correction: request });
  });
});

app.get('/api/corrections', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  return withDB(async (db) => {
    const requests = await db.all(`SELECT * FROM correction_requests ORDER BY created_at DESC LIMIT 50`);
    res.json({ corrections: requests });
  });
});

app.post('/api/newsletter/subscribe', publicFormLimiter, async (req, res) => {
  const { name, surname, email, province, preferences, frequency, breakingAlerts } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  return withDB(async (db) => {
    const createdAt = new Date().toISOString();
    const preferencesText = Array.isArray(preferences) ? preferences.join(',') : '';
    const existing = await db.get(`SELECT id FROM newsletter_subscribers WHERE email = ?`, [email]);
    if (existing) {
      await db.run(`UPDATE newsletter_subscribers SET name = ?, surname = ?, province = ?, preferences = ?, frequency = ?, breaking_alerts = ?, status = 'active', created_at = ? WHERE email = ?`, [name || '', surname || '', province || '', preferencesText, frequency || 'weekly', breakingAlerts ? 1 : 0, createdAt, email]);
      const subscriber = await db.get(`SELECT * FROM newsletter_subscribers WHERE email = ?`, [email]);
      return res.json({ subscriber, message: 'Subscription updated' });
    }
    const row = await db.run(`INSERT INTO newsletter_subscribers (name, surname, email, province, preferences, frequency, breaking_alerts, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`, [name || '', surname || '', email, province || '', preferencesText, frequency || 'weekly', breakingAlerts ? 1 : 0, createdAt]);
    const subscriber = await db.get(`SELECT * FROM newsletter_subscribers WHERE id = ?`, [row.lastID]);
    res.json({ subscriber });
  });
});

app.get('/api/newsletter/subscribers', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  return withDB(async (db) => {
    const subscribers = await db.all(`SELECT * FROM newsletter_subscribers ORDER BY created_at DESC`);
    res.json({ subscribers });
  });
});

app.post('/api/push/preferences', authMiddleware, async (req, res) => {
  const { province, categories, enabled } = req.body || {};
  return withDB(async (db) => {
    const existing = await db.get(`SELECT id FROM push_preferences WHERE user_id = ?`, [req.user.id]);
    const updatedAt = new Date().toISOString();
    if (existing) {
      await db.run(`UPDATE push_preferences SET province = ?, categories = ?, enabled = ?, updated_at = ? WHERE user_id = ?`, [province || '', Array.isArray(categories) ? categories.join(',') : '', enabled === false ? 0 : 1, updatedAt, req.user.id]);
      const item = await db.get(`SELECT * FROM push_preferences WHERE user_id = ?`, [req.user.id]);
      return res.json({ preference: item });
    }
    const row = await db.run(`INSERT INTO push_preferences (user_id, email, province, categories, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [req.user.id, req.user.username || '', province || '', Array.isArray(categories) ? categories.join(',') : '', enabled === false ? 0 : 1, updatedAt, updatedAt]);
    const item = await db.get(`SELECT * FROM push_preferences WHERE id = ?`, [row.lastID]);
    res.json({ preference: item });
  });
});

app.get('/api/weather/:municipality', async (req, res) => {
  const municipality = String(req.params.municipality || '').trim();
  return withDB(async (db) => {
    const existing = await db.get(`SELECT * FROM weather_locations WHERE slug = ? OR municipality = ?`, [municipality.toLowerCase(), municipality]);
    if (existing) return res.json({ weather: existing });

    const fallback = {
      municipality: municipality || 'Mbombela',
      slug: municipality.toLowerCase() || 'mbombela',
      temperature: '22°C',
      condition: 'Sunny',
      humidity: '54%',
      wind_speed: '14 km/h',
      sunrise: '06:20',
      sunset: '17:40',
      rain_probability: '10%',
      forecast: 'Clear skies with mild winds and little chance of rain.',
      updated_at: new Date().toISOString()
    };
    res.json({ weather: fallback });
  });
});

app.post('/api/admin/notifications', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  const { title, body, category, province } = req.body || {};
  return withDB(async (db) => {
    const sentAt = new Date().toISOString();
    const row = await db.run(`INSERT INTO notifications (title, body, category, province, sent_at, delivered, clicks, status) VALUES (?, ?, ?, ?, ?, 1, 0, 'sent')`, [title, body, category || 'general', province || '', sentAt]);
    const item = await db.get(`SELECT * FROM notifications WHERE id = ?`, [row.lastID]);
    res.json({ notification: item });
  });
});

app.get('/api/admin/notifications', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  return withDB(async (db) => {
    const notifications = await db.all(`SELECT * FROM notifications ORDER BY sent_at DESC LIMIT 20`);
    res.json({ notifications });
  });
});

app.get('/api/admin/advertising/overview', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  return withDB(async (db) => {
    const overview = await db.get(`
      SELECT
        (SELECT COUNT(*) FROM advertisers WHERE status = 'active') as activeAdvertisers,
        (SELECT COUNT(*) FROM ad_campaigns WHERE status = 'active') as activeCampaigns,
        (SELECT COUNT(*) FROM ad_campaigns WHERE status = 'scheduled') as scheduledCampaigns,
        (SELECT COUNT(*) FROM ad_campaigns WHERE status IN ('paused', 'completed', 'cancelled')) as inactiveCampaigns,
        (SELECT COALESCE(SUM(impressions), 0) FROM (
          SELECT COUNT(*) as impressions FROM ad_impressions GROUP BY advertisement_id
        )) as totalImpressions,
        (SELECT COALESCE(SUM(clicks), 0) FROM (
          SELECT COUNT(*) as clicks FROM ad_clicks GROUP BY advertisement_id
        )) as totalClicks
    `);
    const totalImpressions = Number(overview?.totalImpressions || 0);
    const totalClicks = Number(overview?.totalClicks || 0);
    const placements = AD_PLACEMENTS.map((placement) => ({ placement, label: placement.replace(/_/g, ' ') }));
    res.json({
      overview: {
        ...overview,
        totalImpressions,
        totalClicks,
        ctr: totalImpressions > 0 ? Number(((totalClicks / totalImpressions) * 100).toFixed(2)) : 0,
      },
      placements,
    });
  });
});

app.get('/api/admin/advertisers', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  return withDB(async (db) => {
    const advertisers = await db.all(`SELECT * FROM advertisers ORDER BY created_at DESC`);
    res.json({ advertisers });
  });
});

app.post('/api/admin/advertisers', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  const { business_name, contact_name, email, phone, website, status, notes } = req.body || {};
  const businessName = String(business_name || '').trim();
  if (!businessName) return res.status(400).json({ error: 'business_name required' });
  const safeEmail = String(email || '').trim();
  const safeWebsite = String(website || '').trim();
  if (safeEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail)) return res.status(400).json({ error: 'email must be valid' });
  if (safeWebsite && !isSafeAdvertUrl(safeWebsite)) return res.status(400).json({ error: 'website URL is invalid' });
  return withDB(async (db) => {
    const createdAt = new Date().toISOString();
    const row = await db.run(`INSERT INTO advertisers (business_name, contact_name, email, phone, website, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [businessName, String(contact_name || '').trim(), safeEmail, String(phone || '').trim(), safeWebsite, ['active', 'inactive'].includes(status) ? status : 'active', String(notes || '').trim(), createdAt, createdAt]);
    const advertiser = await db.get(`SELECT * FROM advertisers WHERE id = ?`, [row.lastID]);
    res.status(201).json({ advertiser });
  });
});

app.patch('/api/admin/advertisers/:id', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  const id = parseNumericParam(req.params.id, 0);
  if (!id) return res.status(400).json({ error: 'advertiser id required' });
  const { business_name, contact_name, email, phone, website, status, notes } = req.body || {};
  return withDB(async (db) => {
    const existing = await db.get(`SELECT * FROM advertisers WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ error: 'advertiser not found' });
    const safeEmail = typeof email === 'undefined' ? existing.email : String(email || '').trim();
    const safeWebsite = typeof website === 'undefined' ? existing.website : String(website || '').trim();
    if (safeEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail)) return res.status(400).json({ error: 'email must be valid' });
    if (safeWebsite && !isSafeAdvertUrl(safeWebsite)) return res.status(400).json({ error: 'website URL is invalid' });
    const nextBusiness = typeof business_name === 'undefined' ? existing.business_name : String(business_name || '').trim();
    if (!nextBusiness) return res.status(400).json({ error: 'business_name required' });
    await db.run(`UPDATE advertisers SET business_name = ?, contact_name = ?, email = ?, phone = ?, website = ?, status = ?, notes = ?, updated_at = ? WHERE id = ?`, [nextBusiness, typeof contact_name === 'undefined' ? (existing.contact_name || '') : String(contact_name || '').trim(), safeEmail, typeof phone === 'undefined' ? (existing.phone || '') : String(phone || '').trim(), safeWebsite, ['active', 'inactive'].includes(status || existing.status) ? (status || existing.status) : existing.status, typeof notes === 'undefined' ? (existing.notes || '') : String(notes || '').trim(), new Date().toISOString(), id]);
    const advertiser = await db.get(`SELECT * FROM advertisers WHERE id = ?`, [id]);
    res.json({ advertiser });
  });
});

app.get('/api/admin/ad-campaigns', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  return withDB(async (db) => {
    const campaigns = await db.all(`SELECT c.*, a.business_name as advertiser FROM ad_campaigns c LEFT JOIN advertisers a ON a.id = c.advertiser_id ORDER BY c.created_at DESC`);
    res.json({ campaigns });
  });
});

app.get('/api/admin/ad-campaigns/:id/performance', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  const id = parseNumericParam(req.params.id, 0);
  if (!id) return res.status(400).json({ error: 'campaign id required' });
  return withDB(async (db) => {
    const campaign = await db.get(`SELECT * FROM ad_campaigns WHERE id = ?`, [id]);
    if (!campaign) return res.status(404).json({ error: 'campaign not found' });
    const [impressionRow, clickRow] = await Promise.all([
      db.get(`SELECT COUNT(*) AS count FROM ad_impressions WHERE campaign_id = ?`, [id]),
      db.get(`SELECT COUNT(*) AS count FROM ad_clicks WHERE campaign_id = ?`, [id]),
    ]);
    const impressions = Number(impressionRow?.count || 0);
    const clicks = Number(clickRow?.count || 0);
    res.json({
      campaign_id: id,
      impressions,
      clicks,
      ctr: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
    });
  });
});

app.post('/api/admin/ad-campaigns', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  const { advertiser_id, name, start_date, end_date, status, target_scope, target_value, pricing_model, agreed_amount, currency } = req.body || {};
  if (!advertiser_id || !name) return res.status(400).json({ error: 'advertiser_id and name are required' });
  return withDB(async (db) => {
    const advertiser = await db.get(`SELECT id FROM advertisers WHERE id = ?`, [advertiser_id]);
    if (!advertiser) return res.status(404).json({ error: 'advertiser not found' });
    const safeStatus = normalizeAdvertStatus(status, 'draft');
    const safeScope = ['all', 'category', 'municipality', 'district', 'town'].includes(target_scope) ? target_scope : 'all';
    const createdAt = new Date().toISOString();
    const row = await db.run(`INSERT INTO ad_campaigns (advertiser_id, name, start_date, end_date, status, target_scope, target_value, pricing_model, agreed_amount, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [advertiser_id, String(name).trim(), start_date || null, end_date || null, safeStatus, safeScope, String(target_value || '').trim() || null, String(pricing_model || 'fixed').trim() || 'fixed', parseFloatParam(agreed_amount, 0), String(currency || 'ZAR').trim() || 'ZAR', createdAt, createdAt]);
    const campaign = await db.get(`SELECT c.*, a.business_name as advertiser FROM ad_campaigns c LEFT JOIN advertisers a ON a.id = c.advertiser_id WHERE c.id = ?`, [row.lastID]);
    res.status(201).json({ campaign });
  });
});

app.patch('/api/admin/ad-campaigns/:id', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  const id = parseNumericParam(req.params.id, 0);
  if (!id) return res.status(400).json({ error: 'campaign id required' });
  const { name, start_date, end_date, status, target_scope, target_value, pricing_model, agreed_amount, currency } = req.body || {};
  return withDB(async (db) => {
    const existing = await db.get(`SELECT * FROM ad_campaigns WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ error: 'campaign not found' });
    if (name !== undefined && !String(name || '').trim()) return res.status(400).json({ error: 'campaign name required' });
    const safeStatus = normalizeAdvertStatus(status !== undefined ? status : existing.status, 'draft');
    const safeScope = ['all', 'category', 'municipality', 'district', 'town'].includes(target_scope !== undefined ? target_scope : existing.target_scope) ? (target_scope !== undefined ? target_scope : existing.target_scope) : (existing.target_scope || 'all');
    await db.run(`UPDATE ad_campaigns SET name = ?, start_date = ?, end_date = ?, status = ?, target_scope = ?, target_value = ?, pricing_model = ?, agreed_amount = ?, currency = ?, updated_at = ? WHERE id = ?`, [name !== undefined ? String(name || '').trim() : existing.name, start_date !== undefined ? (start_date || null) : existing.start_date, end_date !== undefined ? (end_date || null) : existing.end_date, safeStatus, safeScope, target_value !== undefined ? (String(target_value || '').trim() || null) : existing.target_value, pricing_model !== undefined ? (String(pricing_model || 'fixed').trim() || 'fixed') : (existing.pricing_model || 'fixed'), agreed_amount !== undefined ? parseFloatParam(agreed_amount, existing.agreed_amount || 0) : (existing.agreed_amount || 0), currency !== undefined ? (String(currency || 'ZAR').trim() || 'ZAR') : (existing.currency || 'ZAR'), new Date().toISOString(), id]);
    const campaign = await db.get(`SELECT c.*, a.business_name as advertiser FROM ad_campaigns c LEFT JOIN advertisers a ON a.id = c.advertiser_id WHERE c.id = ?`, [id]);
    res.json({ campaign });
  });
});

app.get('/api/admin/advertisements', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  return withDB(async (db) => {
    const advertisements = await db.all(`SELECT a.*, c.name as campaign_name, adv.business_name as advertiser_name FROM advertisements a LEFT JOIN ad_campaigns c ON c.id = a.campaign_id LEFT JOIN advertisers adv ON adv.id = c.advertiser_id ORDER BY a.created_at DESC`);
    res.json({ advertisements });
  });
});

app.post('/api/admin/advertisements', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  const { campaign_id, title, image_url, destination_url, alt_text, placement, status, label } = req.body || {};
  if (!campaign_id || !title || !image_url || !destination_url) return res.status(400).json({ error: 'campaign_id, title, image_url and destination_url are required' });
  if (!isSafeAdvertUrl(destination_url)) return res.status(400).json({ error: 'destination_url must use http or https' });
  if (!isSafeAdvertUrl(image_url) && !/^\//.test(String(image_url || '').trim())) return res.status(400).json({ error: 'image_url must use http(s) or a site-relative path' });
  return withDB(async (db) => {
    const campaign = await db.get(`SELECT id FROM ad_campaigns WHERE id = ?`, [campaign_id]);
    if (!campaign) return res.status(404).json({ error: 'campaign not found' });
    const safeStatus = ['active', 'paused', 'draft'].includes(status) ? status : 'active';
    const safePlacement = normalizeAdvertPlacement(placement);
    const row = await db.run(`INSERT INTO advertisements (campaign_id, title, image_url, destination_url, alt_text, placement, status, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [campaign_id, String(title).trim(), String(image_url).trim(), String(destination_url).trim(), String(alt_text || '').trim(), safePlacement, safeStatus, String(label || 'Advertisement').trim() || 'Advertisement', new Date().toISOString(), new Date().toISOString()]);
    const advertisement = await db.get(`SELECT a.*, c.name as campaign_name, adv.business_name as advertiser_name FROM advertisements a LEFT JOIN ad_campaigns c ON c.id = a.campaign_id LEFT JOIN advertisers adv ON adv.id = c.advertiser_id WHERE a.id = ?`, [row.lastID]);
    res.status(201).json({ advertisement });
  });
});

app.patch('/api/admin/advertisements/:id', authMiddleware, requireRole('admin', 'editor'), async (req, res) => {
  const id = parseNumericParam(req.params.id, 0);
  if (!id) return res.status(400).json({ error: 'advertisement id required' });
  const { title, image_url, destination_url, alt_text, placement, status, label } = req.body || {};
  return withDB(async (db) => {
    const existing = await db.get(`SELECT * FROM advertisements WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ error: 'advertisement not found' });
    if (destination_url !== undefined && !isSafeAdvertUrl(destination_url)) return res.status(400).json({ error: 'destination_url must use http or https' });
    if (image_url !== undefined && !isSafeAdvertUrl(image_url) && !/^\//.test(String(image_url || '').trim())) return res.status(400).json({ error: 'image_url must use http(s) or a site-relative path' });
    const nextTitle = title !== undefined ? String(title || '').trim() : existing.title;
    const nextImage = image_url !== undefined ? String(image_url || '').trim() : existing.image_url;
    const nextDestination = destination_url !== undefined ? String(destination_url || '').trim() : existing.destination_url;
    await db.run(`UPDATE advertisements SET title = ?, image_url = ?, destination_url = ?, alt_text = ?, placement = ?, status = ?, label = ?, updated_at = ? WHERE id = ?`, [nextTitle, nextImage, nextDestination, alt_text !== undefined ? String(alt_text || '').trim() : existing.alt_text, placement !== undefined ? normalizeAdvertPlacement(placement) : existing.placement, status !== undefined ? (['active', 'paused', 'draft'].includes(status) ? status : existing.status) : existing.status, label !== undefined ? String(label || 'Advertisement').trim() : existing.label, new Date().toISOString(), id]);
    const advertisement = await db.get(`SELECT a.*, c.name as campaign_name, adv.business_name as advertiser_name FROM advertisements a LEFT JOIN ad_campaigns c ON c.id = a.campaign_id LEFT JOIN advertisers adv ON adv.id = c.advertiser_id WHERE a.id = ?`, [id]);
    res.json({ advertisement });
  });
});

async function getAdvertForPlacement(db, placement, context = {}) {
  const rows = await db.all(`
    SELECT a.*, c.name as campaign_name, c.status as campaign_status, c.target_scope, c.target_value, c.start_date, c.end_date, adv.business_name, adv.status as advertiser_status
    FROM advertisements a
    JOIN ad_campaigns c ON c.id = a.campaign_id
    JOIN advertisers adv ON adv.id = c.advertiser_id
    WHERE a.status = 'active'
      AND a.placement = ?
      AND c.status IN ('active', 'scheduled')
      AND adv.status = 'active'
      AND (c.start_date IS NULL OR c.start_date <= ?)
      AND (c.end_date IS NULL OR c.end_date >= ?)
    ORDER BY a.updated_at DESC, a.id DESC
  `, [placement, new Date().toISOString(), new Date().toISOString()]);
  const eligible = rows.filter((row) => matchesAdvertTarget(row, context));
  return eligible[0] || null;
}

app.get('/api/ads/:placement', async (req, res) => {
  const placement = normalizeAdvertPlacement(req.params.placement || 'homepage_top');
  const context = parseAdvertContext(req);
  return withDB(async (db) => {
    const ad = await getAdvertForPlacement(db, placement, context);
    if (!ad) return res.json({ placement, advertisement: null });
    const impressionCreatedAt = new Date().toISOString();
    await db.run(`INSERT INTO ad_impressions (advertisement_id, campaign_id, placement, created_at) VALUES (?, ?, ?, ?)`, [ad.id, ad.campaign_id, placement, impressionCreatedAt]);
    const clickUrl = `/ad/click/${ad.id}`;
    const advertisement = {
      id: Number(ad.id),
      campaign_id: Number(ad.campaign_id),
      title: ad.title,
      image_url: ad.image_url,
      destination_url: ad.destination_url,
      alt_text: ad.alt_text || ad.title,
      placement,
      label: ad.label || 'Advertisement',
      business_name: ad.business_name,
      click_url: clickUrl,
    };
    res.json({ placement, advertisement });
  });
});

app.get('/ad/click/:id', async (req, res) => {
  const id = parseNumericParam(req.params.id, 0);
  if (!id) return res.status(400).send('Advert not found');
  return withDB(async (db) => {
    const ad = await db.get(`SELECT a.*, c.name AS campaign_name, c.status AS campaign_status, c.target_scope, c.target_value, c.start_date, c.end_date, adv.business_name, adv.status AS advertiser_status FROM advertisements a JOIN ad_campaigns c ON c.id = a.campaign_id JOIN advertisers adv ON adv.id = c.advertiser_id WHERE a.id = ? AND a.status = 'active'`, [id]);
    if (!ad) return res.status(404).send('Advert not found');
    if (!isCampaignEligibleNow(ad, new Date()) || String(ad.advertiser_status || '').toLowerCase() !== 'active') return res.status(404).send('Advert not found');
    const destination = String(ad.destination_url || '').trim();
    if (!isSafeAdvertUrl(destination)) return res.status(400).send('Unsafe destination');
    await db.run(`INSERT INTO ad_clicks (advertisement_id, campaign_id, placement, referer, created_at) VALUES (?, ?, ?, ?, ?)`, [ad.id, ad.campaign_id, ad.placement, String(req.headers.referer || '').slice(0, 500), new Date().toISOString()]);
    res.redirect(302, destination);
  });
});

app.get('/api/stories/:id', async (req, res) => {
  const id = req.params.id;
  return withDB(async (db) => {
    const s = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ? AND ${publicStoryWhereClause('s')}`, [id, nowISO()]);
    if (!s) return res.status(404).json({ error: 'story not found' });
    const comments = await db.all(`SELECT author_name as author, text, created_at as at FROM comments WHERE story_id = ? ORDER BY id DESC`, [id]);
    res.json({ story: sanitizePublicStory(s), comments });
  });
});

// Serve a rendered article page for story details. Accepts either a numeric
// story id or a stable slug so legacy links keep working while new links can
// use the public, human-readable slug URL.
app.get('/story/:id', async (req, res) => {
  const idParam = req.params.id;
  const isNumericId = /^\d+$/.test(idParam);
  const lookupClause = isNumericId ? 's.id = ?' : 's.slug = ?';
  return withDB(async (db) => {
    const now = nowISO();
    const s = await db.get(`SELECT s.*, u.username as author, u.bio as author_bio, u.avatar as author_avatar FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE ${lookupClause} AND ${publicStoryWhereClause('s')}`, [idParam, now]);
    if (!s) return res.status(404).send('Article not found');
    const id = s.id;
    await db.run(`UPDATE stories SET views = COALESCE(views,0) + 1 WHERE id = ?`, [id]);
    const comments = await db.all(`SELECT author_name as author, text, created_at as at FROM comments WHERE story_id = ? ORDER BY id DESC`, [id]);
    let related = await db.all(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id != ? AND ${publicStoryWhereClause('s')} AND s.category = ? ORDER BY s.published_at DESC LIMIT 3`, [id, now, s.category || '']);
    const trending = await db.all(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id != ? AND ${publicStoryWhereClause('s')} ORDER BY s.views DESC, s.published_at DESC LIMIT 3`, [id, now]);
    if (!related.length) {
      related = await db.all(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id != ? AND ${publicStoryWhereClause('s')} ORDER BY s.published_at DESC LIMIT 3`, [id, now]);
    }

    let contributorStories = [];
    if (s.author_id) {
      contributorStories = await db.all(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id != ? AND ${publicStoryWhereClause('s')} AND s.author_id = ? ORDER BY s.published_at DESC LIMIT 3`, [id, now, s.author_id]);
    }
    if (!contributorStories.length && s.author) {
      contributorStories = await db.all(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id != ? AND ${publicStoryWhereClause('s')} AND lower(COALESCE(u.username, '')) = lower(?) ORDER BY s.published_at DESC LIMIT 3`, [id, now, s.author]);
    }
    if (!contributorStories.length) {
      contributorStories = await db.all(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id != ? AND ${publicStoryWhereClause('s')} AND s.category = ? ORDER BY s.published_at DESC LIMIT 3`, [id, now, s.category || '']);
    }

    const municipalityName = inferMunicipalityFromStory(s);
    let municipalityStories = [];
    if (municipalityName) {
      const municipalityTerm = municipalityName.toLowerCase();
      municipalityStories = await db.all(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id != ? AND ${publicStoryWhereClause('s')} AND (lower(COALESCE(s.municipality, '')) = ? OR lower(COALESCE(s.title, '')) LIKE ? OR lower(COALESCE(s.content, '')) LIKE ?) ORDER BY s.published_at DESC LIMIT 3`, [id, now, municipalityTerm, `%${municipalityTerm}%`, `%${municipalityTerm}%`]);
    }
    if (!municipalityStories.length) {
      municipalityStories = await db.all(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id != ? AND ${publicStoryWhereClause('s')} AND s.category = ? ORDER BY s.published_at DESC LIMIT 3`, [id, now, s.category || '']);
    }

    const title = s.seo_title || s.title || 'Article';
    const excerpt = buildDescription(s.meta_description || s.excerpt || s.content, { maxLength: 160 });
    const image = s.featured_image || '/logo.png';
    const imageUrl = resolveAssetUrl(image);
    const imageAlt = s.image_alt || s.title || 'Mpumalanga Local Time';
    const publishedAt = s.published_at ? new Date(s.published_at).toISOString() : '';
    const JOHANNESBURG_TZ = 'Africa/Johannesburg';
    const date = s.published_at ? new Date(s.published_at).toLocaleString('en-ZA', { dateStyle: 'long', timeStyle: 'short', timeZone: JOHANNESBURG_TZ }) : '';
    const updatingAt = s.updatedAt ? new Date(s.updatedAt).toISOString() : publishedAt;
    // A story counts as "updated" for readers only when it was meaningfully
    // edited after first publication (e.g. a correction), not on every internal touch.
    const wasUpdatedAfterPublish = s.updatedAt && publishedAt && new Date(s.updatedAt).getTime() > new Date(publishedAt).getTime() + 60000;
    const updatedDisplay = wasUpdatedAfterPublish ? new Date(s.updatedAt).toLocaleString('en-ZA', { dateStyle: 'long', timeStyle: 'short', timeZone: JOHANNESBURG_TZ }) : '';
    // Canonical/OG URLs always derive from the configured SITE_URL, never
    // from the incoming request's Host header, so they can't be spoofed.
    const canonicalUrl = buildUrl(`/story/${encodeURIComponent(s.slug || s.id)}`);
    const shareUrl = canonicalUrl;
    const storyAuthorName = s.author || SITE_NAME;
    const newsArticleJsonLd = {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: title,
      description: excerpt || undefined,
      image: imageUrl ? [imageUrl] : undefined,
      datePublished: publishedAt || undefined,
      dateModified: updatingAt || undefined,
      mainEntityOfPage: { '@type': 'WebPage', '@id': canonicalUrl },
      url: canonicalUrl,
      author: { '@type': 'Person', name: storyAuthorName },
      articleSection: s.category || undefined,
      publisher: {
        '@type': 'Organization',
        name: SITE_NAME,
        logo: { '@type': 'ImageObject', url: buildUrl('/logo.png') },
      },
    };
    const authorAvatar = s.author_avatar || '/logo.png';
    const authorDescription = s.author_bio || `Local ${escapeHtml(s.category || 'news').toLowerCase()} reporter bringing stories from around Mpumalanga to readers every day.`;
    const contentHtml = formatArticleContent(s.content || '');
    const tagList = String(s.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean);
    const tagsHtml = tagList.length
      ? `<ul class="article-tags" aria-label="Tags">${tagList.map((tag) => `<li>${escapeHtml(tag)}</li>`).join('')}</ul>`
      : '';
    const subheadlineHtml = s.subheadline ? `<p class="article-subheadline">${escapeHtml(s.subheadline)}</p>` : '';
    const imageCaptionHtml = s.image_caption
      ? `<figcaption class="article-image-caption">${escapeHtml(s.image_caption)}${s.image_credit ? ` <span class="article-image-credit">${escapeHtml(s.image_credit)}</span>` : ''}</figcaption>`
      : '';
    const updatedNoticeHtml = updatedDisplay
      ? `<p class="article-update-notice">Updated: <time datetime="${escapeAttr(updatingAt)}">${escapeHtml(updatedDisplay)}</time></p>`
      : '';
    const commentsCount = comments.length;
    const commentsHtml = commentsCount
      ? comments.map((comment) => `
          <div class="comment">
            <strong>${escapeHtml(comment.author || 'Guest')}</strong>
            <time datetime="${escapeAttr(comment.at || '')}">${escapeHtml(comment.at ? new Date(comment.at).toLocaleString('en-ZA', { dateStyle: 'long', timeStyle: 'short' }) : '')}</time>
            <p>${escapeHtml(comment.text || '')}</p>
          </div>
        `).join('')
      : '<p class="comment-empty">No comments yet. Be the first to respond.</p>';

    const relatedHtml = related.map((item) => `
      <div class="single-related-posts">
        <div class="related-posts-thumbnail">
          <a href="/story/${item.slug || item.id}">
            <img src="${escapeHtml(item.featured_image || '/logo.png')}" alt="${escapeHtml(item.title)}" loading="lazy" decoding="async" />
          </a>
        </div>
        <div class="cm-post-content">
          <h3 class="cm-entry-title"><a href="/story/${item.slug || item.id}">${escapeHtml(item.title)}</a></h3>
          <div class="cm-below-entry-meta cm-separator-default">
            <span class="cm-post-date"><time datetime="${escapeAttr(item.submittedAt || '')}">${escapeHtml(item.submittedAt ? new Date(item.submittedAt).toLocaleDateString('en-ZA', { month:'long', day:'numeric', year:'numeric' }) : '')}</time></span>
            <span class="cm-author cm-vcard"><a href="/">${escapeHtml(item.author || 'Mpumalanga Local Time')}</a></span>
          </div>
        </div>
      </div>
    `).join('');
    const contributorStoriesHtml = contributorStories.length
      ? contributorStories.map((item) => `
        <div class="single-related-posts">
          <div class="related-posts-thumbnail">
            <a href="/story/${item.slug || item.id}"><img src="${escapeHtml(item.featured_image || '/logo.png')}" alt="${escapeHtml(item.title)}" loading="lazy" decoding="async" /></a>
          </div>
          <div class="cm-post-content">
            <h3 class="cm-entry-title"><a href="/story/${item.slug || item.id}">${escapeHtml(item.title)}</a></h3>
            <div class="cm-below-entry-meta cm-separator-default">
              <span class="cm-author cm-vcard"><a href="/">${escapeHtml(item.author || 'Mpumalanga Local Time')}</a></span>
            </div>
          </div>
        </div>
      `).join('')
      : '<p class="comment-empty">No other stories from this contributor are available yet.</p>';
    const municipalityStoriesHtml = municipalityStories.length
      ? municipalityStories.map((item) => `
        <div class="single-related-posts">
          <div class="related-posts-thumbnail">
            <a href="/story/${item.slug || item.id}"><img src="${escapeHtml(item.featured_image || '/logo.png')}" alt="${escapeHtml(item.title)}" loading="lazy" decoding="async" /></a>
          </div>
          <div class="cm-post-content">
            <h3 class="cm-entry-title"><a href="/story/${item.slug || item.id}">${escapeHtml(item.title)}</a></h3>
            <div class="cm-below-entry-meta cm-separator-default">
              <span class="cm-post-date"><time datetime="${escapeAttr(item.submittedAt || '')}">${escapeHtml(item.submittedAt ? new Date(item.submittedAt).toLocaleDateString('en-ZA', { month:'short', day:'numeric' }) : '')}</time></span>
            </div>
          </div>
        </div>
      `).join('')
      : '<p class="comment-empty">No nearby municipality coverage is available yet.</p>';

    const html = `<!doctype html>
<html dir="ltr" lang="en-ZA" prefix="og: https://ogp.me/ns#">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} - Mpumalanga Local Time</title>
  <meta name="description" content="${escapeHtml(excerpt)}" />
  <meta name="robots" content="max-image-preview:large" />
  <meta name="author" content="${escapeHtml(s.author || 'Mpumalanga Local Time')}" />
  <meta property="og:locale" content="en_US" />
  <meta property="og:site_name" content="Mpumalanga Local Time - Skhatsini eMpumalanga" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${escapeHtml(title)} - Mpumalanga Local Time" />
  <meta property="og:description" content="${escapeHtml(excerpt)}" />
  ${imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}" />` : ''}
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
  <meta property="article:published_time" content="${publishedAt}" />
  <meta property="article:modified_time" content="${updatingAt}" />
  ${s.category ? `<meta property="article:section" content="${escapeHtml(s.category)}" />` : ''}
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
  <link rel="alternate" type="application/rss+xml" title="Mpumalanga Local Time RSS" href="${escapeHtml(buildUrl('/rss.xml'))}" />
  <meta name="twitter:card" content="${imageUrl ? 'summary_large_image' : 'summary'}" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(excerpt)}" />
  ${imageUrl ? `<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />` : ''}
  <link rel="stylesheet" href="/styles.css" />
  <style>
    :root { color-scheme: light; font-family: 'Open Sans', Arial, sans-serif; }
    body { margin:0; color:#222; background:#f4f4f4; }
    .cm-header-builder { background:#fff; border-bottom:1px solid #e8e8e8; }
    .cm-row, .cm-container, .cm-main-row, .cm-footer-main-row { width:100%; max-width:1200px; margin:0 auto; box-sizing:border-box; }
    .cm-container { padding:0 18px; }
    .cm-top-row, .cm-bottom-row, .cm-row { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; }
    .date-in-header { font-size:.9rem; color:#555; }
    .breaking-news { flex:1; font-size:.95rem; color:#111; }
    .breaking-news ul { list-style:none; padding:0; margin:0; display:flex; gap:.75rem; flex-wrap:wrap; }
    .breaking-news a { color:#c00; text-decoration:none; }
    #cm-primary-nav ul { list-style:none; padding:0; margin:0; display:flex; flex-wrap:wrap; gap:1rem; }
    #cm-primary-nav ul li a { color:#111; text-decoration:none; font-weight:600; }
    .cm-site-branding { display:flex; gap:.75rem; align-items:center; }
    .cm-site-branding img { height:52px; width:auto; display:block; }
    .cm-site-title a, .cm-site-branding a { color:#111; text-decoration:none; }
    .cm-content { padding:30px 0; }
    .cm-primary { width:100%; }
    .cm-posts { display:grid; gap:24px; }
    .article { background:#fff; padding:28px; box-shadow:0 14px 36px rgba(0,0,0,0.08); border-radius:12px; }
    .article-featured { width:100%; min-height:420px; background-size:cover; background-position:center; border-radius:12px; margin-bottom:24px; }
    .article-title { font-size:clamp(2.2rem, 2.3vw, 3rem); margin:0 0 14px; line-height:1.05; }
    .cm-below-entry-meta, .article-meta { display:flex; flex-wrap:wrap; gap:.75rem; color:#555; font-size:.95rem; margin-bottom:22px; }
    .article-content { line-height:1.84; color:#333; }
    .article-content p { margin:1.6em 0; font-size:1.07rem; }
    .article-content img { max-width:100%; height:auto; border-radius:12px; margin:1.5em 0; }
    .article-content a { color:#c00; text-decoration:underline; }
    .article-author-box { display:flex; gap:18px; align-items:flex-start; background:#faf9f7; padding:20px; border-radius:16px; margin:28px 0; }
    .author-avatar { width:72px; height:72px; border-radius:50%; overflow:hidden; flex-shrink:0; border:1px solid #eee; }
    .author-avatar img { width:100%; height:100%; object-fit:cover; }
    .author-meta { display:grid; gap:6px; }
    .author-byline { margin:0; font-size:1rem; color:#111; }
    .author-description { margin:0; color:#555; line-height:1.6; }
    .article-share { display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin:16px 0 32px; }
    .share-button { display:inline-flex; align-items:center; gap:8px; border:1px solid #ddd; background:#fff; color:#111; border-radius:999px; padding:12px 18px; font-size:.95rem; transition:all .2s ease; }
    .share-button:hover { border-color:#c00; color:#c00; }
    .article-comments { margin-top:46px; }
    .article-comments h2 { margin-bottom:18px; font-size:1.45rem; }
    .comment-auth-panel { margin-bottom:18px; color:#555; }
    .comment-login-form { display:grid; gap:12px; margin-top:14px; }
    .comment-login-form input { width:100%; padding:14px 16px; border:1px solid #ddd; border-radius:14px; background:#fff; color:#111; }
    .comment-login-form button { border:none; border-radius:999px; padding:14px 22px; background:#c00; color:#fff; font-size:1rem; }
    .comment-form { display:grid; gap:14px; margin-top:20px; }
    .comment-form textarea { width:100%; min-height:140px; border:1px solid #ddd; border-radius:14px; padding:16px; font:inherit; resize:vertical; background:#fbfbfb; color:#111; }
    .comment-form-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:12px; align-items:center; margin-top:6px; }
    .comment-form button { border:none; border-radius:999px; padding:14px 22px; background:#c00; color:#fff; font-size:1rem; transition:transform .2s ease; }
    .comment-form button:hover { transform:translateY(-1px); }
    .comment-form-message { color:#555; font-size:.95rem; }
    .comment-empty { color:#666; margin:0; }
    .comment-list { display:grid; gap:18px; margin-top:24px; }
    .comment { border-top:1px solid #e8e8e8; padding:18px 0; }
    .comment strong { display:block; color:#111; margin-bottom:6px; }
    .comment time { display:block; color:#777; font-size:.92rem; margin-bottom:12px; }
    .cm-secondary { display:grid; gap:20px; }
    .widget { background:#fff; padding:22px; border-radius:18px; box-shadow:0 10px 24px rgba(0,0,0,0.04); }
    .widget h4 { margin:0 0 14px; font-size:1.05rem; color:#111; }
    .widget .widget-item { display:flex; gap:12px; align-items:flex-start; margin-bottom:16px; }
    .widget .widget-item:last-child { margin-bottom:0; }
    .widget .widget-item img { width:72px; height:56px; border-radius:12px; object-fit:cover; }
    .widget .widget-item-content { display:grid; gap:6px; }
    .widget .widget-item-content a { color:#111; font-weight:600; }
    .widget .widget-item-content time { font-size:.85rem; color:#666; }
    .newsletter-form { display:grid; gap:12px; margin-top:12px; }
    .newsletter-form input { width:100%; min-height:48px; border:1px solid #ddd; border-radius:14px; padding:12px 14px; background:#fff; color:#111; }
    .newsletter-form button { border:none; border-radius:999px; padding:14px 18px; background:#c00; color:#fff; font-size:1rem; cursor:pointer; }
    .article-related { margin-top:0; }
    .article-related + .article-related { margin-top:18px; }
    .related-posts-wrapper { display:grid; gap:18px; }
    .single-related-posts { display:flex; gap:16px; align-items:flex-start; background:#fafafa; padding:16px; border-radius:12px; }
    .related-posts-thumbnail img { width:140px; height:90px; object-fit:cover; border-radius:8px; }
    .related-posts-thumbnail a { display:block; }
    .cm-entry-title { font-size:1.05rem; margin:0 0 10px; line-height:1.3; }
    .cm-entry-title a { color:#111; text-decoration:none; }
    .cm-footer { background:#111; color:#ddd; padding:32px 0; }
    .cm-footer a { color:#fff; text-decoration:none; }
    .cm-footer-cols { display:grid; gap:18px; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); }
    .cm-footer-menu { list-style:none; padding:0; margin:0; }
    .cm-footer-menu li { margin-bottom:.75rem; }
    .cm-footer-bottom-row { text-align:center; margin-top:28px; color:#999; font-size:.9rem; }
    @media (min-width: 900px) { .cm-main-row { display:flex; align-items:center; justify-content:space-between; } .cm-site-branding { gap:1rem; } .cm-primary { width:100%; } .cm-posts { grid-template-columns: 1fr 320px; } }
  </style>
  ${jsonLdScript(newsArticleJsonLd)}
</head>
<body class="wp-singular post-template-default single single-post postid-${s.id} single-format-standard">
  <div id="page" class="hfeed site">
    <a class="skip-link screen-reader-text" href="#main">Skip to content</a>
    <header id="cm-masthead" class="cm-header-builder cm-layout-1-style-1 cm-full-width">
      <div class="cm-row cm-desktop-row cm-main-header">
        <div class="cm-header-top-row">
          <div class="cm-container">
            <div class="cm-top-row">
              <div class="cm-header-left-col"><div class="date-in-header">${escapeHtml(new Date().toLocaleDateString('en-ZA', { weekday: 'long', year:'numeric', month:'long', day:'numeric' }))}</div></div>
              <div class="cm-header-right-col"><div class="breaking-news"><strong>Latest:</strong><ul class="newsticker">${(related.length ? related.slice(0,3) : []).map((item) => `<li><a href="/story/${item.slug || item.id}">${escapeHtml(item.title)}</a></li>`).join('')}</ul></div></div>
            </div>
          </div>
        </div>
        <div class="cm-header-main-row">
          <div class="cm-container">
            <div class="cm-main-row">
              <div class="cm-header-left-col">
                <div class="cm-site-branding"><a href="/" class="custom-logo-link"><img src="/logo.png" alt="Mpumalanga Local Time" decoding="async" width="170" /></a></div>
              </div>
              <div class="cm-header-center-col"></div>
              <div class="cm-header-right-col"></div>
            </div>
          </div>
        </div>
        <div class="cm-header-bottom-row">
          <div class="cm-container"><nav id="cm-primary-nav" class="cm-primary-nav" aria-label="Primary navigation"><ul id="cm-primary-menu"><li><a href="/">Home</a></li><li><a href="/news.html">News</a></li><li><a href="/business.html">Business</a></li><li><a href="/arts.html">Arts</a></li><li><a href="/sports.html">Sports</a></li><li><a href="/community.html">Community</a></li></ul></nav></div>
        </div>
      </div>
    </header>
    <main id="main" class="cm-content">
      <div class="cm-container">
        <div class="cm-row">
          <div id="cm-primary" class="cm-primary">
            <div class="cm-posts clearfix">
              <article id="post-${s.id}" class="post-${s.id} post type-post status-publish format-standard has-post-thumbnail hentry category-${escapeHtml((s.category||'news').toLowerCase())}">
                <div class="cm-post-content">
                  <figure class="cm-featured-image">
                    <img src="${escapeHtml(image)}" alt="${escapeHtml(imageAlt)}" decoding="async" style="width:100%;height:auto;border-radius:12px;" />
                    ${imageCaptionHtml}
                  </figure>
                  <header class="cm-entry-header">
                    <p class="category-pill">${escapeHtml(s.category || 'News')}</p>
                    <h1 class="cm-entry-title">${escapeHtml(title)}</h1>
                    ${subheadlineHtml}
                  </header>
                  <div class="cm-below-entry-meta cm-separator-default">
                    <span class="cm-post-date"><time class="entry-date published updated" datetime="${publishedAt}">${escapeHtml(date)}</time></span>
                    <span class="cm-author cm-vcard"><a class="url fn n" href="/">${escapeHtml(s.author || 'admin')}</a></span>
                    <span class="cm-post-views">${s.views || 0} Views</span>
                  </div>
                  ${updatedNoticeHtml}
                  <div class="article-author-box">
                    <div class="author-avatar"><img src="${escapeHtml(authorAvatar)}" alt="${escapeHtml(s.author || 'Author')}" /></div>
                    <div class="author-meta">
                      <p class="author-byline">By <strong>${escapeHtml(s.author || 'Mpumalanga Local Time')}</strong></p>
                      <p class="author-description">${authorDescription}</p>
                    </div>
                  </div>
                  <div class="article-share">
                    <button type="button" class="share-button" data-article-share="copy" data-url="${escapeHtml(shareUrl)}">Copy link</button>
                    <button type="button" class="share-button" data-article-share="twitter" data-url="${escapeHtml(shareUrl)}" data-text="${escapeHtml(title)}">Tweet</button>
                    <button type="button" class="share-button" data-article-share="facebook" data-url="${escapeHtml(shareUrl)}">Facebook</button>
                  </div>
                  <div class="cm-entry-summary article-content">${contentHtml}</div>
                  <div class="ad-slot" data-ad-slot="article_top" aria-label="Advertisement"></div>
                  ${tagsHtml}
                </div>
              </article>
              <div class="article-comments" aria-label="Article discussion">
                <h2>Related stories</h2>
                <p class="comment-empty">Continue reading more local reporting from Mpumalanga.</p>
              </div>
              <aside id="cm-secondary" class="cm-secondary">
                <div class="article-related widget">
                  <h4>You May Also Like</h4>
                  <div class="related-posts-wrapper">${relatedHtml}</div>
                </div>
                <div class="article-related widget">
                  <h4>More by this contributor</h4>
                  <div class="related-posts-wrapper">${contributorStoriesHtml}</div>
                </div>
                <div class="article-related widget">
                  <h4>From this municipality</h4>
                  <div class="related-posts-wrapper">${municipalityStoriesHtml}</div>
                </div>
                <div class="widget">
                  <h4>Trending stories</h4>
                  ${trending.map((item) => `
                    <div class="widget-item">
                      <img src="${escapeHtml(item.featured_image || '/logo.png')}" alt="${escapeHtml(item.title)}" loading="lazy" decoding="async" />
                      <div class="widget-item-content">
                        <a href="/story/${item.slug || item.id}">${escapeHtml(item.title)}</a>
                        <time datetime="${escapeAttr(item.submittedAt || '')}">${escapeHtml(item.submittedAt ? new Date(item.submittedAt).toLocaleDateString('en-ZA', { month:'short', day:'numeric' }) : '')}</time>
                      </div>
                    </div>
                  `).join('')}
                </div>
                <div class="widget">
                  <h4>Newsletter</h4>
                  <p>Subscribe to our newsletter for the latest Mpumalanga stories and updates.</p>
                  <form class="newsletter-form" action="#" method="post" onsubmit="event.preventDefault(); alert('Newsletter signup is coming soon.');">
                    <label class="visually-hidden" for="articleNewsletterEmail">Email address</label>
                    <input id="articleNewsletterEmail" type="email" placeholder="Your email address" autocomplete="email" required />
                    <button type="submit">Subscribe</button>
                  </form>
                </div>
              </aside>
            </div>
          </div>
        </div>
      </div>
    </main>
    <footer id="cm-footer" class="cm-footer cm-footer-builder">
      <div class="cm-row cm-footer-desktop-row">
        <div class="cm-footer-main-row"><div class="cm-container"><div class="cm-main-row"><div class="cm-footer-col cm-footer-main-1-col"><nav id="cm-footer-nav" class="cm-footer-nav"><ul id="cm-footer-menu" class="cm-footer-menu"><li><a href="/">Home</a></li><li><a href="/about.html">About Us</a></li><li><a href="/privacy-policy.html">Privacy Policy</a></li><li><a href="/terms-and-conditions.html">Terms & Conditions</a></li><li><a href="/contact.html">Contact</a></li></ul></nav></div></div></div></div>
      <div class="cm-footer-bottom-row"><div class="cm-container"><div class="cm-bottom-row"><div class="cm-footer-col cm-footer-bottom-1-col"><div class="cm-copyright copyright"><p style="text-align:center;color:#bbb;">Copyright © ${new Date().getFullYear()} Mpumalanga Local Time. Powered by Creative Space</p></div></div></div></div></div>
    </footer>
  </div>
  <script>
    (function() {
      const shareUrl = ${safeScriptLiteral(shareUrl)};
      const shareText = ${safeScriptLiteral(title)};
      const shareButtons = document.querySelectorAll('[data-article-share]');

      const handleShare = (mode, url, text) => {
        if (mode === 'copy') {
          navigator.clipboard.writeText(url).then(() => alert('Link copied to clipboard.')).catch(() => alert('Unable to copy link.'));
          return;
        }
        const encodedUrl = encodeURIComponent(url);
        const encodedText = encodeURIComponent(text || '');
        let shareLink = '';
        if (mode === 'twitter') {
          shareLink = 'https://twitter.com/intent/tweet?url=' + encodedUrl + '&text=' + encodedText;
        } else if (mode === 'facebook') {
          shareLink = 'https://www.facebook.com/sharer/sharer.php?u=' + encodedUrl;
        }
        if (shareLink) {
          window.open(shareLink, '_blank', 'noopener');
        }
      };

      if (shareButtons.length) {
        shareButtons.forEach((button) => {
          button.addEventListener('click', () => {
            const mode = button.dataset.articleShare;
            const url = button.dataset.url || shareUrl;
            const text = button.dataset.text || shareText;
            handleShare(mode, url, text);
          });
        });
      }
    })();
  </script>
</body>
</html>`;

    res.send(html);
  });
});

function inferMunicipalityFromStory(story = {}) {
  const text = `${story.title || ''} ${story.content || ''} ${story.excerpt || ''} ${story.municipality || ''}`.toLowerCase();
  const match = MUNICIPALITIES.find((municipality) => text.includes(municipality.name.toLowerCase()) || text.includes(municipality.slug.toLowerCase()));
  return match ? match.name : '';
}

function formatArticleContent(content) {
  const trimmed = String(content || '').trim();
  if (!trimmed) return '';
  const sanitized = sanitizeHtml(trimmed, {
    allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'blockquote', 'a', 'h1', 'h2', 'h3', 'img', 'figure', 'figcaption', 'span', 'code', 'pre'],
    allowedAttributes: {
      a: ['href', 'target', 'rel', 'title'],
      img: ['src', 'alt', 'title'],
      '*': ['class']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedStyles: {},
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow', target: '_blank' })
    }
  });
  if (!sanitized) return '';
  if (/<(?:p|div|br|h[1-6]|ul|ol|li|blockquote|img|a|strong|b|em|i|figure|figcaption|span|code|pre)/i.test(sanitized)) {
    return sanitized;
  }
  return sanitized.split(/\n\n+/).filter(Boolean).map((paragraph) => `<p>${escapeHtml(paragraph.trim())}</p>`).join('');
}

function sanitizeTextInput(value, fallback = '') {
  return String(value ?? fallback).trim().replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 2000);
}

// Small helpers for server-side escaping
function escapeHtml(str) {
  if (!str && str !== 0) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '%22');
}

// Get featured story for homepage
app.get('/api/featured-story', async (req, res) => {
  return withDB(async (db) => {
    const now = nowISO();
    const featured = await db.get(`
      SELECT s.*, u.username as author,
             (SELECT COUNT(*) FROM comments WHERE story_id = s.id) as comments
      FROM stories s
      LEFT JOIN users u ON u.id = s.author_id
      WHERE s.featured = 1 AND ${publicStoryWhereClause('s')}
      ORDER BY s.published_at DESC
      LIMIT 1
    `, [now]);

    if (featured) {
      featured.comments = Number(featured.comments || 0);
      return res.json({ story: sanitizePublicStory(featured) });
    }

    // Safe fallback: no featured story yet, so surface the latest eligible
    // published story instead of leaving the homepage hero empty.
    const latest = await db.get(`
      SELECT s.*, u.username as author,
             (SELECT COUNT(*) FROM comments WHERE story_id = s.id) as comments
      FROM stories s
      LEFT JOIN users u ON u.id = s.author_id
      WHERE ${publicStoryWhereClause('s')}
      ORDER BY s.published_at DESC
      LIMIT 1
    `, [now]);

    if (latest) {
      latest.comments = Number(latest.comments || 0);
    }
    res.json({ story: latest ? sanitizePublicStory(latest) : null });
  });
});

app.get('/api/latest-stories', async (req, res) => {
  const excludeId = req.query.exclude || null;
  const limit = Math.max(1, Math.min(20, Number.parseInt(req.query.limit, 10) || 4));
  return withDB(async (db) => {
    let query = `
      SELECT s.*, u.username as author,
             (SELECT COUNT(*) FROM comments WHERE story_id = s.id) as comments
      FROM stories s
      LEFT JOIN users u ON u.id = s.author_id
      WHERE ${publicStoryWhereClause('s')} AND s.featured = 0
    `;

    const params = [nowISO()];
    if (excludeId) {
      query += ` AND s.id != ?`;
      params.push(excludeId);
    }

    query += ` ORDER BY s.published_at DESC, s.id DESC LIMIT ?`;
    params.push(limit);

    const stories = await db.all(query, params);
    const result = stories.map((story) => sanitizePublicStory({
      ...story,
      comments: Number(story.comments || 0)
    }));
    res.json({ stories: result });
  });
});

// Public category listing: safe server-side filtering reused by the existing
// static category pages (business/community/sports/arts/news) via main.js.
app.get('/api/category/:category', async (req, res) => {
  const category = String(req.params.category || '').trim().slice(0, 80);
  const limit = Math.max(1, Math.min(30, Number.parseInt(req.query.limit, 10) || 12));
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const offset = (page - 1) * limit;
  if (!category) return res.json({ stories: [], page, limit });
  return withDB(async (db) => {
    const now = nowISO();
    const stories = await db.all(
      `SELECT s.*, u.username as author, (SELECT COUNT(*) FROM comments WHERE story_id = s.id) as comments
       FROM stories s LEFT JOIN users u ON u.id = s.author_id
       WHERE ${publicStoryWhereClause('s')} AND lower(s.category) = lower(?)
       ORDER BY s.published_at DESC, s.id DESC LIMIT ? OFFSET ?`,
      [now, category, limit, offset]
    );
    const result = stories.map((story) => sanitizePublicStory({ ...story, comments: Number(story.comments || 0) }));
    res.json({ stories: result, page, limit });
  });
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  const shouldProcessScheduledStories = process.argv.includes('--process-scheduled-stories');
  if (shouldProcessScheduledStories) {
    initializeDatabase()
      .then(async () => {
        const db = await init();
        try {
          const result = await processScheduledStories({ db });
          console.log(JSON.stringify({ processed: result.processed, stories: result.stories }));
        } finally {
          await db.close();
        }
      })
      .catch((error) => {
        console.error('Scheduled publication processing failed:', error);
        process.exit(1);
      });
    return;
  }

  initializeDatabase()
    .then(() => app.listen(PORT, () => console.log(`API listening on ${PORT}`)))
    .catch((error) => {
      console.error('Database initialization failed:', error);
      process.exit(1);
    });
}

app.initializeDatabase = initializeDatabase;
app.processScheduledStories = processScheduledStories;
module.exports = app;
module.exports.initializeDatabase = initializeDatabase;
module.exports.processScheduledStories = processScheduledStories;
