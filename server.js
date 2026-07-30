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
        municipality TEXT,
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
    if (!storyColumnNames.includes('municipality')) {
      await db.run('ALTER TABLE stories ADD COLUMN municipality TEXT');
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
function escapeInteger(value) {
  return Number(value || 0);
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

app.post('/api/artists/:id/bookings', async (req, res) => {
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

app.post('/api/messages', async (req, res) => {
  const { recipientId, senderName, senderEmail, subject, message } = req.body || {};
  if (!recipientId || !senderName || !senderEmail || !message) return res.status(400).json({ error: 'recipient, sender name, sender email and message are required' });
  return withDB(async (db) => {
    const row = await db.run(`INSERT INTO messages (recipient_id, sender_name, sender_email, subject, message, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'new', ?, ?)`, [recipientId, senderName, senderEmail, subject || 'Creative enquiry', message, new Date().toISOString(), new Date().toISOString()]);
    const item = await db.get(`SELECT * FROM messages WHERE id = ?`, [row.lastID]);
    res.json({ message: item });
  });
});

app.get('/api/messages', async (req, res) => {
  return withDB(async (db) => {
    const messages = await db.all(`SELECT * FROM messages ORDER BY created_at DESC LIMIT 20`);
    res.json({ messages });
  });
});

app.post('/api/artists/:id/reviews', async (req, res) => {
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
    res.json({ artists });
  });
});

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
    municipality: payload.municipality || '',
  };
}

app.post('/api/stories', authMiddleware, requireRole('admin', 'editor', 'journalist', 'contributor'), async (req, res) => {
  const payload = normalizeStoryPayload(req.body || {});
  if (!payload.title || !payload.content) return res.status(400).json({ error: 'title and content required' });
  return withDB(async (db) => {
    const submittedAt = new Date().toISOString();
    const r = await db.run(`
      INSERT INTO stories (
        title, category, content, author_id, submittedAt, views, excerpt, featured_image, reading_time, is_breaking, featured, status, editorial_notes, updatedAt, slug, seo_title, meta_description, tags, municipality
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [payload.title, payload.category, payload.content, req.user.id, submittedAt, payload.excerpt || payload.content.slice(0, 160), payload.featured_image, payload.reading_time, payload.is_breaking, payload.featured, payload.status, payload.editorial_notes, submittedAt, payload.slug || payload.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''), payload.seo_title, payload.meta_description, payload.tags, payload.municipality]);
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
      ['municipality', payload.municipality],
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

    let contributorStories = [];
    if (s.author_id) {
      contributorStories = await db.all(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id != ? AND s.author_id = ? ORDER BY s.submittedAt DESC LIMIT 3`, [id, s.author_id]);
    }
    if (!contributorStories.length && s.author) {
      contributorStories = await db.all(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id != ? AND lower(COALESCE(u.username, '')) = lower(?) ORDER BY s.submittedAt DESC LIMIT 3`, [id, s.author]);
    }
    if (!contributorStories.length) {
      contributorStories = await db.all(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id != ? AND s.category = ? ORDER BY s.submittedAt DESC LIMIT 3`, [id, s.category || '']);
    }

    const municipalityName = inferMunicipalityFromStory(s);
    let municipalityStories = [];
    if (municipalityName) {
      const municipalityTerm = municipalityName.toLowerCase();
      municipalityStories = await db.all(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id != ? AND (lower(COALESCE(s.municipality, '')) = ? OR lower(COALESCE(s.title, '')) LIKE ? OR lower(COALESCE(s.content, '')) LIKE ?) ORDER BY s.submittedAt DESC LIMIT 3`, [id, municipalityTerm, `%${municipalityTerm}%`, `%${municipalityTerm}%`]);
    }
    if (!municipalityStories.length) {
      municipalityStories = await db.all(`SELECT s.*, u.username as author FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.id != ? AND s.category = ? ORDER BY s.submittedAt DESC LIMIT 3`, [id, s.category || '']);
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
    const contributorStoriesHtml = contributorStories.length
      ? contributorStories.map((item) => `
        <div class="single-related-posts">
          <div class="related-posts-thumbnail">
            <a href="/story/${item.id}"><img src="${escapeHtml(item.featured_image || '/logo.png')}" alt="${escapeHtml(item.title)}" /></a>
          </div>
          <div class="cm-post-content">
            <h3 class="cm-entry-title"><a href="/story/${item.id}">${escapeHtml(item.title)}</a></h3>
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
            <a href="/story/${item.id}"><img src="${escapeHtml(item.featured_image || '/logo.png')}" alt="${escapeHtml(item.title)}" /></a>
          </div>
          <div class="cm-post-content">
            <h3 class="cm-entry-title"><a href="/story/${item.id}">${escapeHtml(item.title)}</a></h3>
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

function inferMunicipalityFromStory(story = {}) {
  const text = `${story.title || ''} ${story.content || ''} ${story.excerpt || ''} ${story.municipality || ''}`.toLowerCase();
  const match = MUNICIPALITIES.find((municipality) => text.includes(municipality.name.toLowerCase()) || text.includes(municipality.slug.toLowerCase()));
  return match ? match.name : '';
}

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
