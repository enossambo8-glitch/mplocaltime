const { init, isMysqlConfigured } = require('../db');

const expectedTables = ['users', 'stories', 'comments', 'media', 'advertisers', 'ad_campaigns', 'newsletter_subscribers'];

async function main() {
  if (!isMysqlConfigured()) {
    console.log(JSON.stringify({ database_type: 'sqlite', status: 'skipped', message: 'MySQL/MariaDB verification requires DB_HOST/DB_NAME settings.' }, null, 2));
    return;
  }

  const db = await init();
  try {
    const rows = [];
    for (const table of expectedTables) {
      const countResult = await db.get(`SELECT COUNT(*) AS count FROM ${table}`);
      rows.push({ table, count: Number(countResult.count || 0) });
    }

    const relationships = {
      stories_without_authors: await db.get('SELECT COUNT(*) AS count FROM stories s LEFT JOIN users u ON u.id = s.author_id WHERE s.author_id IS NOT NULL AND u.id IS NULL'),
      comments_without_stories: await db.get('SELECT COUNT(*) AS count FROM comments c LEFT JOIN stories s ON s.id = c.story_id WHERE c.story_id IS NOT NULL AND s.id IS NULL'),
      campaigns_without_advertisers: await db.get('SELECT COUNT(*) AS count FROM ad_campaigns c LEFT JOIN advertisers a ON a.id = c.advertiser_id WHERE c.advertiser_id IS NOT NULL AND a.id IS NULL'),
    };

    console.log(JSON.stringify({ database_type: 'mysql', tables: rows, relationships }, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error('Database verification failed:', error.message);
  process.exit(1);
});
