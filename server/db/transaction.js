const { createPool, isMysqlConfigured } = require('./pool');

async function withTransaction(handler) {
  if (!isMysqlConfigured()) {
    return handler({
      query: async (sql, params = []) => {
        const { init } = require('../../db');
        const db = await init();
        try {
          return db.query ? db.query(sql, params) : db.all(sql, params);
        } finally {
          await db.close();
        }
      },
    });
  }

  const pool = createPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await handler(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  withTransaction,
};
