const { initializeDatabase } = require('./server');

(async () => {
  await initializeDatabase();
  console.log('Database migration bootstrap complete.');
})();
