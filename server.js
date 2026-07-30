require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { init } = require('./db');
const {
  MUNICIPALITIES,
  getMunicipalityBySlug,
  getMunicipalityArticles,
  buildMunicipalityPageHtml,
  buildMunicipalityListHtml,
} = require('./municipality-page');

const DEFAULT_ADMIN = {
  username: 'admin',
  passwordEnv: process.env.INITIAL_PASSWORD || 'changeme',
  bio: 'Publisher and managing editor of Mpumalanga Local Time.',
  avatar: '/logo.png',
  role: 'admin'
};
const DEFAULT_USER = {
  username: 'reporter',
  passwordEnv: process.env.INITIAL_USER_PASSWORD || 'contributor',
  bio: 'Contributor covering local stories across Mpumalanga.',
  avatar: '/logo.png',
  role: 'user'
};

async function initializeDatabase() {
  const db = await init();
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        bio TEXT,
        avatar TEXT,
        role TEXT NOT NULL DEFAULT 'user'
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
        FOREIGN KEY(author_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        story_id INTEGER NOT NULL,
        author TEXT,
        text TEXT,
        at TEXT,
        FOREIGN KEY(story_id) REFERENCES stories(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS media (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original_name TEXT NOT NULL,
        stored_name TEXT NOT NULL,
        mime_type TEXT,
        size INTEGER DEFAULT 0,
        caption TEXT,
        createdAt TEXT NOT NULL,
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

    const storyColumns = await db.all('PRAGMA table_info(stories)');
    const storyColumnNames = storyColumns.map((column) => column.name);
    const mediaColumns = await db.all('PRAGMA table_info(media)');
    const mediaColumnNames = mediaColumns.map((column) => column.name);
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
    if (!mediaColumnNames.includes('caption')) {
      await db.run('ALTER TABLE media ADD COLUMN caption TEXT');
    }
    if (!mediaColumnNames.includes('createdAt')) {
      await db.run('ALTER TABLE media ADD COLUMN createdAt TEXT');
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

    const existingAdmin = await db.get(`SELECT id, role FROM users WHERE username = ?`, [DEFAULT_ADMIN.username]);
    if (!existingAdmin) {
      const hash = await bcrypt.hash(DEFAULT_ADMIN.passwordEnv, 10);
      await db.run(`INSERT INTO users (username, password, bio, avatar, role) VALUES (?, ?, ?, ?, ?)`, [DEFAULT_ADMIN.username, hash, DEFAULT_ADMIN.bio, DEFAULT_ADMIN.avatar, DEFAULT_ADMIN.role]);
    } else if ((existingAdmin.role || '').toLowerCase() !== DEFAULT_ADMIN.role.toLowerCase()) {
      await db.run(`UPDATE users SET role = ?, bio = ?, avatar = ? WHERE username = ?`, [DEFAULT_ADMIN.role, DEFAULT_ADMIN.bio, DEFAULT_ADMIN.avatar, DEFAULT_ADMIN.username]);
    }

    const existingReporter = await db.get(`SELECT id, role FROM users WHERE username = ?`, [DEFAULT_USER.username]);
    if (!existingReporter) {
      const hash = await bcrypt.hash(DEFAULT_USER.passwordEnv, 10);
      await db.run(`INSERT INTO users (username, password, bio, avatar, role) VALUES (?, ?, ?, ?, ?)`, [DEFAULT_USER.username, hash, DEFAULT_USER.bio, DEFAULT_USER.avatar, DEFAULT_USER.role]);
    } else if ((existingReporter.role || '').toLowerCase() !== DEFAULT_USER.role.toLowerCase()) {
      await db.run(`UPDATE users SET role = ?, bio = ?, avatar = ? WHERE username = ?`, [DEFAULT_USER.role, DEFAULT_USER.bio, DEFAULT_USER.avatar, DEFAULT_USER.username]);
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
  } finally {
    await db.close();
  }
}

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-this';
const app = express();
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
const upload = multer({ dest: uploadsDir });
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '/')));
app.use(express.static(path.join(__dirname, '/public')));

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/municipalities', (req, res) => {
  res.json({ municipalities: MUNICIPALITIES });
});

app.get('/api/municipalities/:slug', (req, res) => {
  const municipality = getMunicipalityBySlug(req.params.slug);
  if (!municipality) return res.status(404).json({ error: 'municipality not found' });
  res.json({ municipality, articles: getMunicipalityArticles(municipality) });
});

app.get('/municipalities', (req, res) => {
  res.send(buildMunicipalityListHtml(req));
});

app.get('/municipality/:slug', (req, res) => {
  const municipality = getMunicipalityBySlug(req.params.slug);
  if (!municipality) {
    return res.status(404).send('Municipality not found');
  }

  const articles = getMunicipalityArticles(municipality);
  res.send(buildMunicipalityPageHtml(municipality, articles, req));
});

app.get('/sitemap.xml', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const urls = [
    '/',
    '/news.html',
    '/business.html',
    '/community.html',
    '/sports.html',
    '/municipalities',
    ...MUNICIPALITIES.map((municipality) => `/municipality/${municipality.slug}`)
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((entry) => `\n  <url><loc>${baseUrl}${entry}</loc></url>`).join('')}\n</urlset>\n`;
  res.type('application/xml').send(xml);
});

app.get('/news-sitemap.xml', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${MUNICIPALITIES.map((municipality) => `\n  <url><loc>${baseUrl}/municipality/${municipality.slug}</loc></url>`).join('')}\n</urlset>\n`;
  res.type('application/xml').send(xml);
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nAllow: /\nSitemap: ' + `${req.protocol}://${req.get('host')}/sitemap.xml`);
});

// For any non-API route, check if HTML file exists
app.get('/:page', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  const file = path.join(__dirname, req.path + '.html');
  if (fs.existsSync(file)) {
    return res.sendFile(file);
  }
  next();
});

async function withDB(fn) {
  const db = await init();
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  return withDB(async (db) => {
    const user = await db.get(`SELECT * FROM users WHERE username = ?`, [username]);
    if (!user) return res.status(401).json({ error: 'invalid credentials' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });
    const role = user.role || 'user';
    const token = jwt.sign({ id: user.id, username: user.username, role }, SECRET, { expiresIn: '7d' });
    res.json({ token, username: user.username, role });
  });
});

// registration endpoint
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  return withDB(async (db) => {
    const exists = await db.get(`SELECT id FROM users WHERE username = ?`, [username]);
    if (exists) return res.status(409).json({ error: 'username taken' });
    const hash = await bcrypt.hash(password, 10);
    const r = await db.run(`INSERT INTO users (username, password, role) VALUES (?,?,?)`, [username, hash, 'user']);
    const user = await db.get(`SELECT id, username, role FROM users WHERE id = ?`, [r.lastID]);
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role || 'user' }, SECRET, { expiresIn: '7d' });
    res.json({ token, username: user.username, role: user.role || 'user' });
  });
});

function authMiddleware(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'missing token' });
  try {
    const data = jwt.verify(m[1], SECRET);
    req.user = data;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid token' });
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const role = String(req.user?.role || 'user').toLowerCase();
    if (!allowedRoles.map((entry) => entry.toLowerCase()).includes(role)) {
      return res.status(403).json({ error: 'insufficient permissions' });
    }
    next();
  };
}

function normalizeStoryPayload(payload = {}) {
  const status = String(payload.status || 'draft').trim().toLowerCase();
  const safeStatus = ['draft', 'pending-review', 'fact-check', 'approved', 'published', 'scheduled', 'archived'].includes(status) ? status : 'draft';
  return {
    title: payload.title || '',
    category: payload.category || 'News',
    content: payload.content || '',
    excerpt: payload.excerpt || '',
    featured_image: payload.featured_image || '',
    reading_time: Number(payload.reading_time || payload.readingTime || 5),
    is_breaking: payload.is_breaking === 1 || payload.is_breaking === true || payload.is_breaking === '1' ? 1 : 0,
    featured: payload.featured === 1 || payload.featured === true || payload.featured === '1' ? 1 : 0,
    status: safeStatus,
    editorial_notes: payload.editorial_notes || payload.editorialNotes || '',
    slug: payload.slug || '',
    seo_title: payload.seo_title || payload.seoTitle || '',
    meta_description: payload.meta_description || payload.metaDescription || '',
    tags: payload.tags || '',
  };
}

app.post('/api/stories', authMiddleware, requireRole('admin', 'editor', 'journalist', 'contributor'), async (req, res) => {
  const payload = normalizeStoryPayload(req.body || {});
  if (!payload.title || !payload.content) return res.status(400).json({ error: 'title and content required' });
  return withDB(async (db) => {
    const submittedAt = new Date().toISOString();
    const r = await db.run(`
      INSERT INTO stories (
        title, category, content, author_id, submittedAt, views, excerpt, featured_image, reading_time, is_breaking, featured, status, editorial_notes, updatedAt, slug, seo_title, meta_description, tags
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [payload.title, payload.category, payload.content, req.user.id, submittedAt, payload.excerpt || payload.content.slice(0, 160), payload.featured_image, payload.reading_time, payload.is_breaking, payload.featured, payload.status, payload.editorial_notes, submittedAt, payload.slug || payload.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''), payload.seo_title, payload.meta_description, payload.tags]);
    const story = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [r.lastID]);
    res.json({ story });
  });
});

app.get('/api/stories', authMiddleware, async (req, res) => {
  const author = req.query.author;
  return withDB(async (db) => {
    if (author) {
      const rows = await db.all(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE u.username = ? ORDER BY s.submittedAt DESC`, [author]);
      const out = await Promise.all(rows.map(async (r) => {
        const c = await db.get(`SELECT COUNT(*) as cnt FROM comments WHERE story_id = ?`, [r.id]);
        r.comments = Number(c.cnt || 0);
        return r;
      }));
      return res.json({ stories: out });
    }
    const rows = await db.all(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id ORDER BY s.submittedAt DESC`);
    res.json({ stories: rows });
  });
});

app.put('/api/stories/:id', authMiddleware, async (req, res) => {
  const id = req.params.id;
  const payload = normalizeStoryPayload(req.body || {});
  return withDB(async (db) => {
    const existing = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    if (!existing) return res.status(404).json({ error: 'story not found' });
    const role = String(req.user?.role || 'user').toLowerCase();
    const isEditorial = ['admin', 'editor', 'managing-editor', 'sub-editor', 'journalist'].includes(role);
    if (!isEditorial && String(existing.author_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'insufficient permissions' });
    }
    const updatedAt = new Date().toISOString();
    const fields = [
      ['title', payload.title],
      ['category', payload.category],
      ['content', payload.content],
      ['excerpt', payload.excerpt || payload.content.slice(0, 160)],
      ['featured_image', payload.featured_image],
      ['reading_time', payload.reading_time],
      ['is_breaking', payload.is_breaking],
      ['featured', payload.featured],
      ['status', payload.status],
      ['editorial_notes', payload.editorial_notes],
      ['updatedAt', updatedAt],
      ['slug', payload.slug || (payload.title || existing.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')],
      ['seo_title', payload.seo_title],
      ['meta_description', payload.meta_description],
      ['tags', payload.tags],
    ];
    const assignments = fields.map(([column]) => `${column} = ?`).join(', ');
    const values = fields.map(([, value]) => value);
    values.push(id);
    await db.run(`UPDATE stories SET ${assignments} WHERE id = ?`, values);
    const story = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    res.json({ story });
  });
});

app.get('/api/users/me', authMiddleware, async (req, res) => {
  return withDB(async (db) => {
    const user = await db.get(`SELECT id, username, bio, avatar, role FROM users WHERE id = ?`, [req.user.id]);
    if (!user) return res.status(404).json({ error: 'user not found' });
    const storyCount = await db.get(`SELECT COUNT(*) as cnt FROM stories WHERE author_id = ?`, [req.user.id]);
    const views = await db.get(`SELECT COALESCE(SUM(views),0) as total FROM stories WHERE author_id = ?`, [req.user.id]);
    res.json({ user: { ...user, storyCount: Number(storyCount?.cnt || 0), totalViews: Number(views?.total || 0) } });
  });
});

app.post('/api/media/upload', authMiddleware, requireRole('admin', 'editor', 'journalist', 'contributor'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  return withDB(async (db) => {
    const caption = String(req.body.caption || '').trim();
    const createdAt = new Date().toISOString();
    const originalName = String(req.file.originalname || req.file.filename || 'upload').trim();
    const storedName = String(req.file.filename || '').trim();
    const mimeType = String(req.file.mimetype || 'application/octet-stream').trim();
    const size = Number(req.file.size || 0);
    const row = await db.run(`INSERT INTO media (original_name, stored_name, mime_type, size, caption, createdAt, author_id) VALUES (?, ?, ?, ?, ?, ?, ?)`, [originalName, storedName, mimeType, size, caption, createdAt, req.user.id]);
    const media = await db.get(`SELECT * FROM media WHERE id = ?`, [row.lastID]);
    res.json({ media: { ...media, url: `/uploads/${media.stored_name}` } });
  });
});

app.get('/api/media', authMiddleware, async (req, res) => {
  return withDB(async (db) => {
    const rows = await db.all(`SELECT m.*, u.username as author FROM media m LEFT JOIN users u ON u.id = m.author_id ORDER BY m.createdAt DESC LIMIT 20`);
    res.json({ media: rows.map((item) => ({ ...item, url: `/uploads/${item.stored_name}` })) });
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

app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const category = String(req.query.category || '').trim();
  const status = String(req.query.status || 'published').trim();
  if (!q) {
    return res.json({ results: [] });
  }
  return withDB(async (db) => {
    const filters = ['(title LIKE ? OR content LIKE ? OR excerpt LIKE ? OR category LIKE ? OR tags LIKE ?)'];
    const params = [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`];
    if (category) {
      filters.push('category = ?');
      params.push(category);
    }
    if (status) {
      filters.push('status = ?');
      params.push(status);
    }
    const rows = await db.all(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE ${filters.join(' AND ')} ORDER BY s.submittedAt DESC LIMIT 10`, params);
    const results = rows.map((story) => ({ ...story, comments: Number(story.comments || 0) }));
    res.json({ results });
  });
});

app.post('/api/stories/:id/view', async (req, res) => {
  const id = req.params.id;
  return withDB(async (db) => {
    await db.run(`UPDATE stories SET views = COALESCE(views,0) + 1 WHERE id = ?`, [id]);
    const s = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    res.json({ story: s });
  });
});

app.post('/api/stories/:id/comments', authMiddleware, async (req, res) => {
  const id = req.params.id;
  const { text, parentId, replyTo } = req.body || {};
  if (!text) return res.status(400).json({ error: 'comment text required' });
  return withDB(async (db) => {
    const createdAt = new Date().toISOString();
    const safeParentId = Number(parentId || replyTo || 0);
    await db.run(`INSERT INTO comments (story_id, author_id, author_name, text, parent_id, likes, dislikes, reported, pinned, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 'approved', ?, ?)`, [id, req.user.id, req.user.username, text, safeParentId, createdAt, createdAt]);
    const comments = await db.all(`SELECT id, story_id, author_id, author_name, text, parent_id, likes, dislikes, reported, pinned, status, created_at FROM comments WHERE story_id = ? ORDER BY created_at DESC`, [id]);
    res.json({ comments });
  });
});

app.get('/api/stories/:id/comments', async (req, res) => {
  const id = req.params.id;
  return withDB(async (db) => {
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

app.get('/api/breaking-news', async (req, res) => {
  return withDB(async (db) => {
    const items = await db.all(`SELECT * FROM breaking_news WHERE status = 'active' AND (expires_at IS NULL OR expires_at > ?) ORDER BY priority DESC, published_at DESC LIMIT 8`, [new Date().toISOString()]);
    if (items.length) {
      const stories = items.map((item) => ({ id: item.id, title: item.headline, category: 'Breaking', submittedAt: item.published_at, priority: item.priority }));
      return res.json({ stories });
    }

    const fallbackStories = await db.all(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.is_breaking = 1 OR s.featured = 0 ORDER BY s.submittedAt DESC LIMIT 8`);
    const stories = fallbackStories.map((story) => ({ ...story, comments: Number(story.comments || 0) }));
    res.json({ stories });
  });
});

app.post('/api/newsletter/subscribe', async (req, res) => {
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

app.get('/api/stories/:id', async (req, res) => {
  const id = req.params.id;
  return withDB(async (db) => {
    const s = await db.get(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    const comments = await db.all(`SELECT author, text, at FROM comments WHERE story_id = ? ORDER BY id DESC`, [id]);
    res.json({ story: s, comments });
  });
});

// Serve a rendered article page for story details
app.get('/story/:id', async (req, res) => {
  const id = req.params.id;
  return withDB(async (db) => {
    await db.run(`UPDATE stories SET views = COALESCE(views,0) + 1 WHERE id = ?`, [id]);
    const s = await db.get(`SELECT s.*, u.username as author, u.bio as author_bio, u.avatar as author_avatar FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id = ?`, [id]);
    if (!s) return res.status(404).send('Article not found');
    const comments = await db.all(`SELECT author, text, at FROM comments WHERE story_id = ? ORDER BY id DESC`, [id]);
    let related = await db.all(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id != ? AND s.category = ? ORDER BY s.submittedAt DESC LIMIT 3`, [id, s.category || '']);
    const trending = await db.all(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id != ? ORDER BY s.views DESC, s.submittedAt DESC LIMIT 3`, [id]);
    if (!related.length) {
      related = await db.all(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id != ? ORDER BY s.submittedAt DESC LIMIT 3`, [id]);
    }

    const title = s.title || 'Article';
    const excerpt = s.excerpt || (s.content ? s.content.slice(0, 160) : '');
    const image = s.featured_image || '/logo.png';
    const publishedAt = s.submittedAt ? new Date(s.submittedAt).toISOString() : '';
    const date = s.submittedAt ? new Date(s.submittedAt).toLocaleString('en-ZA', { dateStyle: 'long', timeStyle: 'short' }) : '';
    const updatingAt = publishedAt;
    const shareUrl = req.protocol + '://' + req.get('host') + req.originalUrl;
    const authorAvatar = s.author_avatar || '/logo.png';
    const authorDescription = s.author_bio || `Local ${escapeHtml(s.category || 'news').toLowerCase()} reporter bringing stories from around Mpumalanga to readers every day.`;
    const contentHtml = formatArticleContent(s.content || '');
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
          <a href="/story/${item.id}">
            <img src="${escapeHtml(item.featured_image || '/logo.png')}" alt="${escapeHtml(item.title)}" />
          </a>
        </div>
        <div class="cm-post-content">
          <h3 class="cm-entry-title"><a href="/story/${item.id}">${escapeHtml(item.title)}</a></h3>
          <div class="cm-below-entry-meta cm-separator-default">
            <span class="cm-post-date"><time datetime="${escapeAttr(item.submittedAt || '')}">${escapeHtml(item.submittedAt ? new Date(item.submittedAt).toLocaleDateString('en-ZA', { month:'long', day:'numeric', year:'numeric' }) : '')}</time></span>
            <span class="cm-author cm-vcard"><a href="/">${escapeHtml(item.author || 'Mpumalanga Local Time')}</a></span>
          </div>
        </div>
      </div>
    `).join('');

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
  <meta property="og:image" content="${escapeHtml(image)}" />
  <meta property="og:url" content="${escapeHtml(req.protocol + '://' + req.get('host') + req.originalUrl)}" />
  <meta property="article:published_time" content="${publishedAt}" />
  <meta property="article:modified_time" content="${updatingAt}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(excerpt)}" />
  <meta name="twitter:image" content="${escapeHtml(image)}" />
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
  <script type="application/ld+json">{
    "@context":"https://schema.org",
    "@type":"BlogPosting",
    "headline":"${escapeHtml(title)}",
    "description":"${escapeHtml(excerpt)}",
    "image":"${escapeHtml(image)}",
    "author":{"@type":"Person","name":"${escapeHtml(s.author || 'Mpumalanga Local Time')}"},
    "publisher":{"@type":"Organization","name":"Mpumalanga Local Time","logo":{"@type":"ImageObject","url":"https://mplocaltime.co.za/logo.png"}},
    "datePublished":"${publishedAt}",
    "dateModified":"${updatingAt}",
    "mainEntityOfPage":{"@type":"WebPage","@id":"${escapeHtml(req.protocol + '://' + req.get('host') + req.originalUrl)}"}
  }</script>
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
              <div class="cm-header-right-col"><div class="breaking-news"><strong>Latest:</strong><ul class="newsticker">${(related.length ? related.slice(0,3) : []).map((item) => `<li><a href="/story/${item.id}">${escapeHtml(item.title)}</a></li>`).join('')}</ul></div></div>
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
          <div class="cm-container"><nav id="cm-primary-nav" class="cm-primary-nav"><ul id="cm-primary-menu"><li><a href="/">Home</a></li><li><a href="/news.html">News</a></li><li><a href="/business.html">Business</a></li><li><a href="/arts.html">Arts</a></li><li><a href="/sports.html">Sports</a></li><li><a href="/community.html">Community</a></li></ul></nav></div>
        </div>
      </div>
    </header>
    <div id="cm-content" class="cm-content">
      <div class="cm-container">
        <div class="cm-row">
          <div id="cm-primary" class="cm-primary">
            <div class="cm-posts clearfix">
              <article id="post-${s.id}" class="post-${s.id} post type-post status-publish format-standard has-post-thumbnail hentry category-${escapeHtml((s.category||'news').toLowerCase())}">
                <div class="cm-post-content">
                  <div class="cm-featured-image"><img src="${escapeHtml(image)}" alt="${escapeHtml(title)}" style="width:100%;height:auto;border-radius:12px;" /></div>
                  <header class="cm-entry-header"><h1 class="cm-entry-title">${escapeHtml(title)}</h1></header>
                  <div class="cm-below-entry-meta cm-separator-default">
                    <span class="cm-post-date"><time class="entry-date published updated" datetime="${publishedAt}">${escapeHtml(date)}</time></span>
                    <span class="cm-author cm-vcard"><a class="url fn n" href="/">${escapeHtml(s.author || 'admin')}</a></span>
                    <span class="cm-post-views">${s.views || 0} Views</span>
                  </div>
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
                <div class="widget">
                  <h4>Trending stories</h4>
                  ${trending.map((item) => `
                    <div class="widget-item">
                      <img src="${escapeHtml(item.featured_image || '/logo.png')}" alt="${escapeHtml(item.title)}" />
                      <div class="widget-item-content">
                        <a href="/story/${item.id}">${escapeHtml(item.title)}</a>
                        <time datetime="${escapeAttr(item.submittedAt || '')}">${escapeHtml(item.submittedAt ? new Date(item.submittedAt).toLocaleDateString('en-ZA', { month:'short', day:'numeric' }) : '')}</time>
                      </div>
                    </div>
                  `).join('')}
                </div>
                <div class="widget">
                  <h4>Newsletter</h4>
                  <p>Subscribe to our newsletter for the latest Mpumalanga stories and updates.</p>
                  <form class="newsletter-form" action="#" method="post" onsubmit="event.preventDefault(); alert('Newsletter signup is coming soon.');">
                    <input type="email" placeholder="Your email address" required />
                    <button type="submit">Subscribe</button>
                  </form>
                </div>
              </aside>
            </div>
          </div>
        </div>
      </div>
    </div>
    <footer id="cm-footer" class="cm-footer cm-footer-builder">
      <div class="cm-row cm-footer-desktop-row">
        <div class="cm-footer-main-row"><div class="cm-container"><div class="cm-main-row"><div class="cm-footer-col cm-footer-main-1-col"><nav id="cm-footer-nav" class="cm-footer-nav"><ul id="cm-footer-menu" class="cm-footer-menu"><li><a href="/">Home</a></li><li><a href="/about.html">About Us</a></li><li><a href="/privacy-policy.html">Privacy Policy</a></li><li><a href="/terms-and-conditions.html">Terms & Conditions</a></li><li><a href="/contact.html">Contact</a></li></ul></nav></div></div></div></div>
      <div class="cm-footer-bottom-row"><div class="cm-container"><div class="cm-bottom-row"><div class="cm-footer-col cm-footer-bottom-1-col"><div class="cm-copyright copyright"><p style="text-align:center;color:#bbb;">Copyright © ${new Date().getFullYear()} Mpumalanga Local Time. Powered by Creative Space</p></div></div></div></div></div>
    </footer>
  </div>
  <script>
    (function() {
      const shareUrl = ${JSON.stringify(shareUrl)};
      const shareText = ${JSON.stringify(title)};
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

function formatArticleContent(content) {
  const trimmed = String(content || '').trim();
  if (!trimmed) return '';
  if (trimmed.includes('<p') || trimmed.includes('<div') || trimmed.includes('<br')) {
    return trimmed;
  }
  return trimmed.split(/\n\n+/).map((paragraph) => `<p>${escapeHtml(paragraph.trim())}</p>`).join('');
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
    const featured = await db.get(`
      SELECT s.*, u.username as author, 
             (SELECT COUNT(*) FROM comments WHERE story_id = s.id) as comments
      FROM stories s 
      LEFT JOIN users u ON u.id = s.author_id 
      WHERE s.featured = 1 
      ORDER BY s.submittedAt DESC 
      LIMIT 1
    `);
    
    if (featured) {
      featured.comments = Number(featured.comments || 0);
      return res.json({ story: featured });
    }
    
    // If no featured story, return the latest story
    const latest = await db.get(`
      SELECT s.*, u.username as author,
             (SELECT COUNT(*) FROM comments WHERE story_id = s.id) as comments
      FROM stories s 
      LEFT JOIN users u ON u.id = s.author_id 
      ORDER BY s.submittedAt DESC 
      LIMIT 1
    `);
    
    if (latest) {
      latest.comments = Number(latest.comments || 0);
    }
    res.json({ story: latest || null });
  });
});

app.get('/api/breaking-news', async (req, res) => {
  return withDB(async (db) => {
    const breakingStories = await db.all(`
      SELECT s.*, u.username as author,
             (SELECT COUNT(*) FROM comments WHERE story_id = s.id) as comments
      FROM stories s
      LEFT JOIN users u ON u.id = s.author_id
      WHERE s.featured = 0 AND s.is_breaking = 1
      ORDER BY s.submittedAt DESC LIMIT 6
    `);

    const dedupedBreakingStories = (breakingStories || [])
      .filter((story) => story && story.title && (story.content || story.excerpt || story.featured_image))
      .filter((story, index, array) => array.findIndex((candidate) => (candidate.title || '').toLowerCase() === (story.title || '').toLowerCase()) === index)
      .map((story) => ({ ...story, comments: Number(story.comments || 0) }));

    if (dedupedBreakingStories.length) {
      return res.json({ stories: dedupedBreakingStories });
    }

    const latestStories = await db.all(`
      SELECT s.*, u.username as author,
             (SELECT COUNT(*) FROM comments WHERE story_id = s.id) as comments
      FROM stories s
      LEFT JOIN users u ON u.id = s.author_id
      WHERE s.featured = 0
      ORDER BY s.submittedAt DESC LIMIT 6
    `);

    const dedupedLatestStories = (latestStories || [])
      .filter((story) => story && story.title && (story.content || story.excerpt || story.featured_image))
      .filter((story, index, array) => array.findIndex((candidate) => (candidate.title || '').toLowerCase() === (story.title || '').toLowerCase()) === index)
      .map((story) => ({ ...story, comments: Number(story.comments || 0) }));

    return res.json({ stories: dedupedLatestStories });
  });
});

// Get latest stories (excluding featured or a specific story ID)
app.get('/api/latest-stories', async (req, res) => {
  const excludeId = req.query.exclude || null;
  return withDB(async (db) => {
    let query = `
      SELECT s.*, u.username as author,
             (SELECT COUNT(*) FROM comments WHERE story_id = s.id) as comments
      FROM stories s 
      LEFT JOIN users u ON u.id = s.author_id 
      WHERE s.featured = 0
    `;
    
    const params = [];
    if (excludeId) {
      query += ` AND s.id != ?`;
      params.push(excludeId);
    }
    
    query += ` ORDER BY s.submittedAt DESC LIMIT 4`;
    
    const stories = await db.all(query, params);
    const result = stories.map(s => ({
      ...s,
      comments: Number(s.comments || 0)
    }));
    res.json({ stories: result });
  });
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  initializeDatabase()
    .then(() => app.listen(PORT, () => console.log(`API listening on ${PORT}`)))
    .catch((error) => {
      console.error('Database initialization failed:', error);
      process.exit(1);
    });
}

app.initializeDatabase = initializeDatabase;
module.exports = app;
module.exports.initializeDatabase = initializeDatabase;
