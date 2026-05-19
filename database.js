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
      created_at TEXT,
      submitted_inputs TEXT
    )
  `);

  db.run(`ALTER TABLE tasks ADD COLUMN submitted_inputs TEXT`, (err) => {
    // Ignore error if column already exists
  });

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

// Auto-seed historical data
db.get("SELECT COUNT(*) as count FROM tasks WHERE created_at LIKE '2026-05-13%'", (err, row) => {
  if (!err && row && row.count === 0) {
    console.log("Seeding historical data for May 13-19...");
    const days = ['2026-05-13', '2026-05-14', '2026-05-15', '2026-05-16', '2026-05-17', '2026-05-18', '2026-05-19'];
    const companies = ["Acme Corp", "TechNova", "Stark Industries", "Globex", "Initech", "Soylent"];
    function getRandomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

    db.serialize(() => {
      days.forEach((dayStr) => {
        const numTasks = getRandomInt(5, 12);
        for (let i = 0; i < numTasks; i++) {
          const taskId = `HIST-${dayStr}-${i}`;
          const company = companies[getRandomInt(0, companies.length - 1)];
          const hour = String(getRandomInt(8, 18)).padStart(2, '0');
          const min = String(getRandomInt(0, 59)).padStart(2, '0');
          const createdAt = `${dayStr}T${hour}:${min}:00.000Z`;
          
          const availableCash = getRandomInt(50, 150) * 1000;
          const monthlyExpenses = getRandomInt(20, 80) * 1000;
          const status = availableCash > monthlyExpenses * 1.5 ? "stable" : "tight";
          
          const submittedInputs = {
            companyName: company, industry: "technology", revenue: getRandomInt(100, 500) * 1000,
            totalExpenses: monthlyExpenses, headcount: getRandomInt(50, 200),
            accountsReceivable: getRandomInt(20, 60) * 1000, accountsPayable: getRandomInt(15, 45) * 1000,
            currentAssets: availableCash + getRandomInt(100, 300) * 1000,
            currentLiabilities: getRandomInt(50, 150) * 1000,
            previousCashBalance: availableCash - getRandomInt(-10, 20) * 1000,
            selectedAgents: ["cash", "invoice", "budget", "reconciliation", "credit"]
          };

          db.run(`INSERT INTO tasks (task_id, status, company_name, created_at, submitted_inputs) VALUES (?, ?, ?, ?, ?)`,
            [taskId, "completed", company, createdAt, JSON.stringify(submittedInputs)]);

          const cashResult = {
            taskId: taskId, agent: "cash", status: "success",
            processedData: { company: company, availableCash: `$${availableCash.toLocaleString()}`, monthlyExpenses: `$${monthlyExpenses.toLocaleString()}`, cashFlowStatus: status }
          };
          db.run(`INSERT INTO agent_results (task_id, agent, status, result_data, created_at) VALUES (?, ?, ?, ?, ?)`,
            [taskId, "cash", "success", JSON.stringify(cashResult), createdAt]);

          ["invoice", "budget", "reconciliation", "credit"].forEach(agent => {
            const result = { taskId: taskId, agent: agent, status: "success", processedData: { company: company, dummy: "data" } };
            db.run(`INSERT INTO agent_results (task_id, agent, status, result_data, created_at) VALUES (?, ?, ?, ?, ?)`,
              [taskId, agent, "success", JSON.stringify(result), createdAt]);
          });
        }
      });
    });
  }
});

module.exports = db;