CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(120) NOT NULL,
  password VARCHAR(255) NOT NULL,
  bio TEXT NULL,
  avatar VARCHAR(255) NULL,
  role VARCHAR(40) NOT NULL DEFAULT 'user',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS districts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(180) NOT NULL,
  slug VARCHAR(180) NOT NULL,
  province VARCHAR(120) NOT NULL DEFAULT 'Mpumalanga',
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_districts_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS municipalities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  district_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(180) NOT NULL,
  slug VARCHAR(180) NOT NULL,
  province VARCHAR(120) NOT NULL DEFAULT 'Mpumalanga',
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_municipalities_slug (slug),
  KEY idx_municipalities_district_id (district_id),
  CONSTRAINT fk_municipalities_districts FOREIGN KEY (district_id) REFERENCES districts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS towns (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  municipality_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(180) NOT NULL,
  slug VARCHAR(180) NOT NULL,
  province VARCHAR(120) NOT NULL DEFAULT 'Mpumalanga',
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_towns_slug (slug),
  KEY idx_towns_municipality_id (municipality_id),
  CONSTRAINT fk_towns_municipalities FOREIGN KEY (municipality_id) REFERENCES municipalities(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL,
  category VARCHAR(80) NULL,
  content LONGTEXT NULL,
  author_id BIGINT UNSIGNED NULL,
  submittedAt DATETIME NULL,
  views INT UNSIGNED NOT NULL DEFAULT 0,
  featured TINYINT(1) NOT NULL DEFAULT 0,
  featured_image VARCHAR(255) NULL,
  excerpt TEXT NULL,
  reading_time INT UNSIGNED NOT NULL DEFAULT 5,
  is_breaking TINYINT(1) NOT NULL DEFAULT 0,
  status VARCHAR(40) NOT NULL DEFAULT 'draft',
  editorial_notes TEXT NULL,
  updatedAt DATETIME NULL,
  slug VARCHAR(220) NULL,
  seo_title VARCHAR(255) NULL,
  meta_description TEXT NULL,
  tags TEXT NULL,
  district VARCHAR(180) NULL,
  municipality VARCHAR(180) NULL,
  town VARCHAR(180) NULL,
  district_id BIGINT UNSIGNED NULL,
  municipality_id BIGINT UNSIGNED NULL,
  town_id BIGINT UNSIGNED NULL,
  subheadline TEXT NULL,
  image_alt TEXT NULL,
  image_caption TEXT NULL,
  image_credit TEXT NULL,
  submitted_by BIGINT UNSIGNED NULL,
  submitted_at DATETIME NULL,
  published_at DATETIME NULL,
  published_by BIGINT UNSIGNED NULL,
  scheduled_at DATETIME NULL,
  archived_at DATETIME NULL,
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_stories_slug (slug),
  KEY idx_stories_status (status),
  KEY idx_stories_published_at (published_at),
  KEY idx_stories_category (category),
  KEY idx_stories_author_id (author_id),
  KEY idx_stories_created_at (created_at),
  CONSTRAINT fk_stories_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_stories_district FOREIGN KEY (district_id) REFERENCES districts(id) ON DELETE SET NULL,
  CONSTRAINT fk_stories_municipality FOREIGN KEY (municipality_id) REFERENCES municipalities(id) ON DELETE SET NULL,
  CONSTRAINT fk_stories_town FOREIGN KEY (town_id) REFERENCES towns(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS editorial_reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  story_id BIGINT UNSIGNED NOT NULL,
  quality_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  grammar_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  readability_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  seo_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  originality_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  headline_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  human_writing_confidence DECIMAL(5,2) NOT NULL DEFAULT 0,
  ai_writing_probability DECIMAL(5,2) NOT NULL DEFAULT 0,
  confidence_level VARCHAR(30) NOT NULL DEFAULT 'medium',
  fact_check_status VARCHAR(50) NOT NULL DEFAULT 'needs-verification',
  sources_count INT NOT NULL DEFAULT 0,
  quotes_count INT NOT NULL DEFAULT 0,
  images_count INT NOT NULL DEFAULT 0,
  reading_time INT NOT NULL DEFAULT 0,
  recommendations TEXT NULL,
  notes TEXT NULL,
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_editorial_reviews_story (story_id),
  CONSTRAINT fk_editorial_reviews_story FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS revision_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  story_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(120) NULL,
  notes TEXT NULL,
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  actor_id BIGINT UNSIGNED NULL,
  previous_status VARCHAR(40) NULL,
  new_status VARCHAR(40) NULL,
  PRIMARY KEY (id),
  KEY idx_revision_history_story_created (story_id, created_at),
  CONSTRAINT fk_revision_history_story FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS comments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  story_id BIGINT UNSIGNED NOT NULL,
  author TEXT NULL,
  author_id BIGINT UNSIGNED NULL,
  author_name VARCHAR(200) NULL,
  text TEXT NULL,
  at DATETIME NULL,
  parent_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  likes INT UNSIGNED NOT NULL DEFAULT 0,
  dislikes INT UNSIGNED NOT NULL DEFAULT 0,
  reported TINYINT(1) NOT NULL DEFAULT 0,
  pinned TINYINT(1) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'approved',
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_comments_story_status (story_id, status),
  KEY idx_comments_created_at (created_at),
  CONSTRAINT fk_comments_story FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS advertisers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_name VARCHAR(255) NOT NULL,
  contact_name VARCHAR(180) NULL,
  email VARCHAR(255) NULL,
  phone VARCHAR(50) NULL,
  website VARCHAR(255) NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'active',
  notes TEXT NULL,
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ad_campaigns (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  advertiser_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(255) NOT NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'draft',
  target_scope VARCHAR(40) NOT NULL DEFAULT 'all',
  target_value VARCHAR(180) NULL,
  pricing_model VARCHAR(50) NOT NULL DEFAULT 'fixed',
  agreed_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'ZAR',
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ad_campaigns_status_dates (status, start_date, end_date),
  CONSTRAINT fk_ad_campaigns_advertisers FOREIGN KEY (advertiser_id) REFERENCES advertisers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS advertisements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  image_url VARCHAR(500) NOT NULL,
  destination_url VARCHAR(500) NOT NULL,
  alt_text TEXT NULL,
  placement VARCHAR(80) NOT NULL DEFAULT 'homepage_top',
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  label VARCHAR(120) NOT NULL DEFAULT 'Advertisement',
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_advertisements_campaign_placement (campaign_id, placement),
  CONSTRAINT fk_advertisements_campaigns FOREIGN KEY (campaign_id) REFERENCES ad_campaigns(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ad_impressions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  advertisement_id BIGINT UNSIGNED NOT NULL,
  campaign_id BIGINT UNSIGNED NOT NULL,
  placement VARCHAR(80) NOT NULL,
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ad_impressions_campaign (campaign_id),
  CONSTRAINT fk_ad_impressions_advertisements FOREIGN KEY (advertisement_id) REFERENCES advertisements(id) ON DELETE CASCADE,
  CONSTRAINT fk_ad_impressions_campaigns FOREIGN KEY (campaign_id) REFERENCES ad_campaigns(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ad_clicks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  advertisement_id BIGINT UNSIGNED NOT NULL,
  campaign_id BIGINT UNSIGNED NOT NULL,
  placement VARCHAR(80) NOT NULL,
  referer TEXT NULL,
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ad_clicks_campaign (campaign_id),
  CONSTRAINT fk_ad_clicks_advertisements FOREIGN KEY (advertisement_id) REFERENCES advertisements(id) ON DELETE CASCADE,
  CONSTRAINT fk_ad_clicks_campaigns FOREIGN KEY (campaign_id) REFERENCES ad_campaigns(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS correction_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(180) NULL,
  email VARCHAR(255) NULL,
  article_url VARCHAR(500) NULL,
  issue_type VARCHAR(120) NULL,
  description TEXT NULL,
  supporting_documents TEXT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'new',
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS media (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NULL,
  size BIGINT UNSIGNED NOT NULL DEFAULT 0,
  caption TEXT NULL,
  alt_text TEXT NULL,
  credit TEXT NULL,
  public_url VARCHAR(500) NULL,
  width INT UNSIGNED NOT NULL DEFAULT 0,
  height INT UNSIGNED NOT NULL DEFAULT 0,
  createdAt DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  author_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY idx_media_created_at (createdAt),
  CONSTRAINT fk_media_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS breaking_news (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  headline VARCHAR(255) NOT NULL,
  slug VARCHAR(220) NULL,
  article_id BIGINT UNSIGNED NULL,
  priority INT NOT NULL DEFAULT 0,
  published_at DATETIME NULL,
  expires_at DATETIME NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'active',
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_breaking_news_active (status, published_at),
  KEY idx_breaking_news_slug (slug),
  CONSTRAINT fk_breaking_news_story FOREIGN KEY (article_id) REFERENCES stories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(180) NULL,
  frequency VARCHAR(30) NOT NULL DEFAULT 'weekly',
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_newsletter_email (email),
  KEY idx_newsletter_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  recipient_id BIGINT UNSIGNED NULL,
  sender_name VARCHAR(180) NULL,
  sender_email VARCHAR(255) NULL,
  subject VARCHAR(255) NULL,
  message TEXT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'new',
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notifications_recipient_status (recipient_id, status),
  CONSTRAINT fk_notifications_recipient FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS editorial_notes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  story_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  note TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_editorial_notes_story (story_id, created_at),
  CONSTRAINT fk_editorial_notes_story FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
  CONSTRAINT fk_editorial_notes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS story_corrections (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  story_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  note TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_story_corrections_story (story_id, created_at),
  CONSTRAINT fk_story_corrections_story FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
  CONSTRAINT fk_story_corrections_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(180) NULL,
  surname VARCHAR(180) NULL,
  email VARCHAR(255) NOT NULL,
  province VARCHAR(120) NULL,
  preferences TEXT NULL,
  frequency VARCHAR(30) NOT NULL DEFAULT 'weekly',
  breaking_alerts TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  PRIMARY KEY (id),
  UNIQUE KEY uq_newsletter_email (email),
  KEY idx_newsletter_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS push_preferences (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NULL,
  email VARCHAR(255) NULL,
  province VARCHAR(120) NULL,
  categories TEXT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_push_preferences_user (user_id),
  CONSTRAINT fk_push_preferences_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS weather_locations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  municipality VARCHAR(180) NOT NULL,
  slug VARCHAR(220) NULL,
  temperature VARCHAR(50) NULL,
  `condition` VARCHAR(120) NULL,
  humidity VARCHAR(50) NULL,
  wind_speed VARCHAR(50) NULL,
  sunrise VARCHAR(50) NULL,
  sunset VARCHAR(50) NULL,
  rain_probability VARCHAR(50) NULL,
  forecast TEXT NULL,
  updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_weather_locations_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS artists (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NULL,
  slug VARCHAR(220) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  stage_name VARCHAR(180) NULL,
  bio TEXT NULL,
  province VARCHAR(120) NULL,
  municipality VARCHAR(180) NULL,
  city VARCHAR(180) NULL,
  discipline VARCHAR(120) NULL,
  disciplines TEXT NULL,
  languages TEXT NULL,
  years_experience INT UNSIGNED NOT NULL DEFAULT 0,
  awards TEXT NULL,
  education TEXT NULL,
  gallery TEXT NULL,
  videos TEXT NULL,
  music TEXT NULL,
  portfolio TEXT NULL,
  social_links TEXT NULL,
  website VARCHAR(255) NULL,
  email VARCHAR(180) NULL,
  availability VARCHAR(80) NOT NULL DEFAULT 'Available',
  booking_status VARCHAR(80) NOT NULL DEFAULT 'Open for bookings',
  verified TINYINT(1) NOT NULL DEFAULT 0,
  followers_count INT UNSIGNED NOT NULL DEFAULT 0,
  reviews_count INT UNSIGNED NOT NULL DEFAULT 0,
  profile_photo VARCHAR(255) NULL,
  cover_image VARCHAR(255) NULL,
  featured TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_artists_slug (slug),
  KEY idx_artists_user (user_id),
  CONSTRAINT fk_artists_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS artist_bookings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  artist_id BIGINT UNSIGNED NOT NULL,
  client_name VARCHAR(200) NOT NULL,
  organisation VARCHAR(200) NULL,
  email VARCHAR(180) NULL,
  phone VARCHAR(80) NULL,
  event_date DATETIME NULL,
  venue VARCHAR(180) NULL,
  budget VARCHAR(120) NULL,
  message TEXT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'new',
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_artist_bookings_artist (artist_id),
  CONSTRAINT fk_artist_bookings_artist FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS artist_reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  artist_id BIGINT UNSIGNED NOT NULL,
  reviewer_name VARCHAR(200) NOT NULL,
  rating INT NOT NULL DEFAULT 5,
  comment TEXT NULL,
  verified_booking TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_artist_reviews_artist (artist_id),
  CONSTRAINT fk_artist_reviews_artist FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS creative_organisations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(220) NOT NULL,
  name VARCHAR(220) NOT NULL,
  category VARCHAR(120) NULL,
  province VARCHAR(120) NULL,
  municipality VARCHAR(180) NULL,
  city VARCHAR(180) NULL,
  bio TEXT NULL,
  website VARCHAR(255) NULL,
  email VARCHAR(255) NULL,
  phone VARCHAR(80) NULL,
  featured TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_creative_organisations_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS venues (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(220) NOT NULL,
  name VARCHAR(220) NOT NULL,
  category VARCHAR(120) NULL,
  province VARCHAR(120) NULL,
  municipality VARCHAR(180) NULL,
  city VARCHAR(180) NULL,
  address TEXT NULL,
  capacity VARCHAR(80) NULL,
  website VARCHAR(255) NULL,
  featured TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_venues_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(220) NOT NULL,
  title VARCHAR(255) NOT NULL,
  category VARCHAR(120) NULL,
  province VARCHAR(120) NULL,
  municipality VARCHAR(180) NULL,
  city VARCHAR(180) NULL,
  venue VARCHAR(180) NULL,
  start_date DATETIME NULL,
  end_date DATETIME NULL,
  description TEXT NULL,
  featured TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_events_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS opportunities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(220) NOT NULL,
  title VARCHAR(255) NOT NULL,
  category VARCHAR(120) NULL,
  province VARCHAR(120) NULL,
  municipality VARCHAR(180) NULL,
  deadline DATETIME NULL,
  description TEXT NULL,
  featured TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_opportunities_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  recipient_id BIGINT UNSIGNED NULL,
  sender_name VARCHAR(180) NULL,
  sender_email VARCHAR(255) NULL,
  subject VARCHAR(255) NULL,
  message TEXT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'new',
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_messages_recipient_status (recipient_id, status),
  CONSTRAINT fk_messages_recipient FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
