const db = require('./database');

const days = ['2026-05-13', '2026-05-14', '2026-05-15', '2026-05-16', '2026-05-17', '2026-05-18', '2026-05-19'];
const companies = ["Acme Corp", "TechNova", "Stark Industries", "Globex", "Initech", "Soylent", "Massive Dynamic", "Cyberdyne", "Umbrella Corp", "Wayne Enterprises", "Oscorp", "Hooli", "Pied Piper"];

// We need some cash flow data and completed task data.
// Completed tasks: random 5-15 per day
// Cash agent outputs: availableCash and monthlyExpenses.

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateHistory() {
  db.serialize(() => {
    days.forEach((dayStr) => {
      const numTasks = getRandomInt(5, 12);
      for (let i = 0; i < numTasks; i++) {
        const taskId = `HIST-${dayStr}-${i}`;
        const company = companies[getRandomInt(0, companies.length - 1)];
        // Add random hours/mins to make timestamps look natural
        const hour = String(getRandomInt(8, 18)).padStart(2, '0');
        const min = String(getRandomInt(0, 59)).padStart(2, '0');
        const createdAt = `${dayStr}T${hour}:${min}:00.000Z`;
        
        const availableCash = getRandomInt(50, 150) * 1000;
        const monthlyExpenses = getRandomInt(20, 80) * 1000;
        const status = availableCash > monthlyExpenses * 1.5 ? "stable" : "tight";
        
        const submittedInputs = {
          companyName: company,
          industry: "technology",
          revenue: getRandomInt(100, 500) * 1000,
          totalExpenses: monthlyExpenses,
          headcount: getRandomInt(50, 200),
          accountsReceivable: getRandomInt(20, 60) * 1000,
          accountsPayable: getRandomInt(15, 45) * 1000,
          currentAssets: availableCash + getRandomInt(100, 300) * 1000,
          currentLiabilities: getRandomInt(50, 150) * 1000,
          previousCashBalance: availableCash - getRandomInt(-10, 20) * 1000,
          selectedAgents: ["cash", "invoice", "budget", "reconciliation", "credit"]
        };

        db.run(
          `INSERT INTO tasks (task_id, status, company_name, created_at, submitted_inputs) VALUES (?, ?, ?, ?, ?)`,
          [taskId, "completed", company, createdAt, JSON.stringify(submittedInputs)]
        );

        // Add Cash agent result
        const cashResult = {
          taskId: taskId,
          agent: "cash",
          status: "success",
          processedData: {
            company: company,
            availableCash: `$${availableCash.toLocaleString()}`,
            monthlyExpenses: `$${monthlyExpenses.toLocaleString()}`,
            cashFlowStatus: status
          }
        };

        db.run(
          `INSERT INTO agent_results (task_id, agent, status, result_data, created_at) VALUES (?, ?, ?, ?, ?)`,
          [taskId, "cash", "success", JSON.stringify(cashResult), createdAt]
        );

        // We can optionally add dummy results for other agents to make it fully complete
        const agents = ["invoice", "budget", "reconciliation", "credit"];
        agents.forEach(agent => {
          const result = {
            taskId: taskId,
            agent: agent,
            status: "success",
            processedData: {
              company: company,
              dummy: "data"
            }
          };
          db.run(
            `INSERT INTO agent_results (task_id, agent, status, result_data, created_at) VALUES (?, ?, ?, ?, ?)`,
            [taskId, agent, "success", JSON.stringify(result), createdAt]
          );
        });
      }
    });
  });
}

generateHistory();
console.log("Historical data seeded.");
