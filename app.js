const app = require("./server.js");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";

app.initializeDatabase()
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log(`API listening on ${HOST}:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Database initialization failed:", error);
    process.exit(1);
  });
