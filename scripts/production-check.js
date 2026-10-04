require("dotenv").config();
const fs = require('fs');
const path = require('path');

const env = process.env;
const issues = [];
const warnings = [];

const required = [
  'NODE_ENV',
  'PORT',
  'HOST',
  'SITE_URL',
  'JWT_SECRET',
  'INITIAL_PASSWORD',
  'INITIAL_USER_PASSWORD',
  'ADSENSE_ENABLED',
];

for (const key of required) {
  if (!env[key] || String(env[key]).trim() === '') {
    issues.push(`${key} is not configured.`);
  }
}

const mysqlConfigured = Boolean(env.DB_HOST || env.DB_NAME || env.DB_USER || env.DB_PASSWORD || env.DB_PORT);
if (mysqlConfigured) {
  for (const key of ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) {
    if (!env[key] || String(env[key]).trim() === '') {
      issues.push(`${key} is required when MariaDB/MySQL is enabled.`);
    }
  }
} else if (!env.DATABASE_PATH || String(env.DATABASE_PATH).trim() === '') {
  issues.push('DATABASE_PATH is required when MariaDB/MySQL is not configured.');
}

if (String(env.NODE_ENV || '').trim() !== 'production') {
  issues.push('NODE_ENV must be set to production before a production preflight runs.');
}

if (String(env.ADSENSE_ENABLED || '').trim().toLowerCase() === 'true') {
  if (!env.ADSENSE_PUBLISHER_ID || String(env.ADSENSE_PUBLISHER_ID).trim() === '') {
    issues.push('ADSENSE_ENABLED=true requires a valid ADSENSE_PUBLISHER_ID.');
  }
  if (!env.ADSENSE_ADS_TXT_ENTRY || String(env.ADSENSE_ADS_TXT_ENTRY).trim() === '') {
    warnings.push('ADSENSE_ENABLED=true but ADSENSE_ADS_TXT_ENTRY is empty; add the approved seller declaration before activation.');
  }
}

const siteUrl = String(env.SITE_URL || '').trim();
if (siteUrl) {
  try {
    const parsed = new URL(siteUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      issues.push('SITE_URL must use http or https.');
    }
  } catch (error) {
    issues.push('SITE_URL is not a valid absolute URL.');
  }
}

const jwtSecret = String(env.JWT_SECRET || '').trim();
const insecureSecrets = new Set(['changeme', 'secret', 'development', 'testsecret', 'default', 'replace-with-secure-random-secret']);
if (jwtSecret && insecureSecrets.has(jwtSecret.toLowerCase())) {
  issues.push('JWT_SECRET is using an insecure placeholder value.');
}

const databasePath = String(env.DATABASE_PATH || '').trim();
if (databasePath) {
  const resolved = path.resolve(databasePath);
  const lower = resolved.toLowerCase();
  if (lower.includes('/public/') || lower.includes('/public_html/') || lower.includes('/www/') || lower.endsWith('/public') || lower.endsWith('/public_html')) {
    issues.push('DATABASE_PATH must not point to a publicly served web root or document directory.');
  }
  const directory = path.dirname(resolved);
  if (!fs.existsSync(directory)) {
    warnings.push(`Database directory ${directory} does not exist yet; it will be created on first DB startup.`);
  }
}

const databaseType = mysqlConfigured ? 'mysql' : 'sqlite';

const mediaUploadDir = String(env.MEDIA_UPLOAD_DIR || '').trim();
if (mediaUploadDir) {
  const resolved = path.resolve(mediaUploadDir);
  const lower = resolved.toLowerCase();
  if (lower.includes('/public/') || lower.includes('/public_html/') || lower.includes('/www/')) {
    warnings.push('MEDIA_UPLOAD_DIR points into a public web root; consider moving it to a private directory.');
  }
}

const port = Number.parseInt(env.PORT || '', 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  issues.push('PORT must be an integer between 1 and 65535.');
}

const host = String(env.HOST || '').trim();
if (host && host === 'localhost' && String(env.NODE_ENV || '').trim() === 'production') {
  warnings.push('HOST is set to localhost in production; a reverse proxy or 0.0.0.0 binding may be required.');
}

if (issues.length > 0) {
  console.error('Production preflight failed.');
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  if (warnings.length > 0) {
    console.warn('Warnings:');
    for (const warning of warnings) {
      console.warn(`- ${warning}`);
    }
  }
  process.exit(1);
}

const report = {
  node_env: env.NODE_ENV,
  port: Number(port),
  host,
  site_url: siteUrl,
  database_type: databaseType,
  database_path: databasePath || 'mysql-configured',
  database_directory: databasePath ? path.dirname(path.resolve(databasePath)) : 'mysql-managed',
  jwt_secret_configured: Boolean(jwtSecret),
  initial_password_configured: Boolean(env.INITIAL_PASSWORD),
  initial_user_password_configured: Boolean(env.INITIAL_USER_PASSWORD),
  adsense_enabled: String(env.ADSENSE_ENABLED || '').trim().toLowerCase() === 'true',
  adsense_publisher_id_configured: Boolean(env.ADSENSE_PUBLISHER_ID),
  uploads_directory: mediaUploadDir || 'default ./data/uploads',
  status: 'production_preflight_ok',
};

console.log(JSON.stringify(report, null, 2));
console.log('Production preflight passed.');
if (warnings.length > 0) {
  console.warn('Warnings:');
  for (const warning of warnings) {
    console.warn(`- ${warning}`);
  }
}
