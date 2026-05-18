const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./financial_system.db', (err) => {

  if (err) {
    console.error('Database connection error:', err.message);
  } else {
    console.log('Connected to SQLite database');
  }

});

db.serialize(() => {

  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      status TEXT,
      company_name TEXT,
      created_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS agent_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT,
      agent TEXT,
      status TEXT,
      result_data TEXT,
      created_at TEXT
    )
  `);

});

module.exports = db;