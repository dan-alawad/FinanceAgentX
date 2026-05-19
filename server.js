require('dotenv').config();

const path = require('path');
const cors = require('cors');
const tasks = {};

const express = require('express');
const app = express();

const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

const connectRabbitMQ = require('./rabbitmq');
const db = require('./database');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

let rabbitChannel;

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Financial Agent System API',
      version: '1.0.0',
      description: 'API documentation for the Financial Multi-Agent System'
    },
    servers: [
      {
        url: `http://localhost:${PORT}`
      }
    ]
  },
  apis: ['./server.js']
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

app.get('/health', (req, res) => {
  res.send('Server is running');
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

/**
 * @swagger
 * /analyze:
 *   post:
 *     summary: Submit a financial analysis task
 *     description: Sends financial data to all RabbitMQ agent queues for processing. The Cash Agent uses ML to predict availableCash, monthlyExpenses, and cashFlowStatus.
 *     tags:
 *       - Financial Analysis
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - companyName
 *             properties:
 *               companyName:
 *                 type: string
 *                 example: ABC Corporation
 *               revenue:
 *                 type: number
 *                 description: Monthly revenue ($)
 *                 example: 150000
 *               totalExpenses:
 *                 type: number
 *                 description: Total monthly operating expenses ($)
 *                 example: 95000
 *               accountsReceivable:
 *                 type: number
 *                 description: Outstanding receivables ($)
 *                 example: 45000
 *               accountsPayable:
 *                 type: number
 *                 description: Outstanding payables ($)
 *                 example: 32000
 *               currentAssets:
 *                 type: number
 *                 description: Total current assets ($)
 *                 example: 280000
 *               currentLiabilities:
 *                 type: number
 *                 description: Total current liabilities ($)
 *                 example: 120000
 *               previousCashBalance:
 *                 type: number
 *                 description: Cash balance from last period ($)
 *                 example: 90000
 *               industry:
 *                 type: string
 *                 enum: [technology, retail, manufacturing, healthcare, services]
 *                 example: technology
 *               selectedAgents:
 *                 type: array
 *                 description: Optional list of agents to dispatch. If omitted or empty, all 5 agents run (legacy behavior).
 *                 items:
 *                   type: string
 *                   enum: [invoice, budget, reconciliation, credit, cash]
 *                 example: ["invoice", "budget"]
 *     responses:
 *       202:
 *         description: Task submitted successfully
 *       400:
 *         description: Invalid request
 */

// Known agent → queue map. Used to dispatch only the requested subset.
const AGENT_QUEUES = {
  invoice:        'invoice_queue',
  budget:         'budget_queue',
  reconciliation: 'reconciliation_queue',
  credit:         'credit_queue',
  cash:           'cash_queue',
};
const ALL_AGENTS = Object.keys(AGENT_QUEUES);
const VALID_INDUSTRIES = ['technology', 'retail', 'manufacturing', 'healthcare', 'services'];

// Input validation helper
function validateAnalysisInput(data) {
  const errors = [];

  if (!data.companyName || typeof data.companyName !== 'string' || data.companyName.trim().length === 0) {
    errors.push('companyName is required and must be a non-empty string');
  }

  if (data.industry !== undefined && !VALID_INDUSTRIES.includes(data.industry)) {
    errors.push(`industry must be one of: ${VALID_INDUSTRIES.join(', ')}`);
  }

  // Validate numeric fields: must be numbers and non-negative where applicable
  const nonNegativeFields = [
    'revenue', 'totalExpenses', 'accountsReceivable', 'accountsPayable',
    'currentAssets', 'currentLiabilities', 'previousCashBalance',
    'invoiceAmount', 'vendorHistoryMonths', 'lineItems', 'daysSinceReceived',
    'previousInvoices', 'headcount', 'numDepartments', 'totalTransactions',
    'transactionVolume', 'numSources', 'daysSinceLastRecon', 'numAccounts',
    'outstandingDebt', 'collateralValue', 'yearsInBusiness', 'latePayments'
  ];

  for (const field of nonNegativeFields) {
    if (data[field] !== undefined) {
      if (typeof data[field] !== 'number' || isNaN(data[field])) {
        errors.push(`${field} must be a valid number`);
      } else if (data[field] < 0) {
        errors.push(`${field} must be non-negative`);
      }
    }
  }

  // Validate percentage fields (0-100)
  const percentFields = ['dataQuality', 'automationLevel', 'creditUtilization', 'paymentHistory'];
  for (const field of percentFields) {
    if (data[field] !== undefined) {
      if (typeof data[field] !== 'number' || isNaN(data[field])) {
        errors.push(`${field} must be a valid number`);
      } else if (data[field] < 0 || data[field] > 100) {
        errors.push(`${field} must be between 0 and 100`);
      }
    }
  }

  // Validate debtToEquity (can be any non-negative number)
  if (data.debtToEquity !== undefined) {
    if (typeof data.debtToEquity !== 'number' || isNaN(data.debtToEquity) || data.debtToEquity < 0) {
      errors.push('debtToEquity must be a non-negative number');
    }
  }

  return errors;
}

// POST ANALYZE
app.post('/analyze', async (req, res) => {

  const data = req.body;

  // Input validation
  const validationErrors = validateAnalysisInput(data);
  if (validationErrors.length > 0) {
    return res.status(400).json({
      success: false,
      error: validationErrors.length === 1 ? validationErrors[0] : 'Validation failed',
      errors: validationErrors
    });
  }

  if (!rabbitChannel) {
    return res.status(500).json({
      error: "RabbitMQ is not connected yet"
    });
  }

  // Resolve which agents to run. Defaults to all 5 (preserves legacy behavior).
  let selectedAgents = Array.isArray(data.selectedAgents) ? data.selectedAgents : null;
  if (!selectedAgents || selectedAgents.length === 0) {
    selectedAgents = ALL_AGENTS.slice();
  } else {
    // Keep only known agent names, preserve order, dedupe
    selectedAgents = [...new Set(
      selectedAgents.filter(a => typeof a === 'string' && AGENT_QUEUES[a])
    )];
    if (selectedAgents.length === 0) {
      return res.status(400).json({
        success: false,
        error: "selectedAgents must contain at least one of: " + ALL_AGENTS.join(', ')
      });
    }
  }

  const taskId = Date.now().toString();

  tasks[taskId] = {
    status: "processing",
    results: {},
    selectedAgents: selectedAgents,    // remember which agents were dispatched
  };

  db.run(
  `
    INSERT INTO tasks (task_id, status, company_name, created_at, submitted_inputs)
    VALUES (?, ?, ?, ?, ?)
  `,
  [
    taskId,
    "processing",
    data.companyName,
    new Date().toISOString(),
    JSON.stringify(data)
  ],
  (err) => {

    if (err) {
      console.error("Database insert error:", err.message);
    } else {
      console.log("Task saved to database");
    }

  }
);

  const message = {
    taskId: taskId,
    data: data
  };
  const messageBuffer = Buffer.from(JSON.stringify(message));

  // Assert + dispatch only the queues we actually need
  for (const agent of selectedAgents) {
    const queue = AGENT_QUEUES[agent];
    await rabbitChannel.assertQueue(queue);
    rabbitChannel.sendToQueue(queue, messageBuffer);
  }

  console.log(`Message sent to ${selectedAgents.length} agent queue(s): ${selectedAgents.join(', ')}`);

res.status(202).json({
  success: true,
  message: "Financial analysis task submitted successfully",
  taskId: taskId,
  status: "processing",
  selectedAgents: selectedAgents,
  statusUrl: `/status/${taskId}`
});

});

/**
 * @swagger
 * /status/{id}:
 *   get:
 *     summary: Get financial analysis task status
 *     description: Returns the current task status and collected agent results.
 *     tags:
 *       - Financial Analysis
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Task ID returned from the analyze endpoint
 *     responses:
 *       200:
 *         description: Task status retrieved successfully
 *       404:
 *         description: Task not found
 */

// GET STATUS
app.get('/status/:id', (req, res) => {

  const taskId = req.params.id;
  const task = tasks[taskId];

  if (!task) {
    return res.status(404).json({
      success: false,
      error: "Task not found"
    });
  }

  const completedAgents = Object.keys(task.results).length;
  // Use the per-task selection so progress reflects what was actually dispatched
  const totalAgents = (task.selectedAgents && task.selectedAgents.length) || 5;

  res.json({
    success: true,
    taskId: taskId,
    status: task.status,
    completedAgents: completedAgents,
    totalAgents: totalAgents,
    selectedAgents: task.selectedAgents || null,
    results: task.results
  });

});

/**
 * @swagger
 * /tasks:
 *   get:
 *     summary: Get recent task history
 *     description: Returns the most recent financial analysis tasks from the database, including their agent results.
 *     tags:
 *       - Financial Analysis
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           minimum: 1
 *           maximum: 100
 *         description: Maximum number of tasks to return
 *     responses:
 *       200:
 *         description: Task history retrieved successfully
 */

// GET TASK HISTORY
app.get('/tasks', (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);

  db.all(
    `SELECT task_id, status, company_name, created_at, submitted_inputs
     FROM tasks
     ORDER BY created_at DESC
     LIMIT ?`,
    [limit],
    (err, taskRows) => {
      if (err) {
        console.error('Database query error:', err.message);
        return res.status(500).json({ success: false, error: 'Database error' });
      }

      if (!taskRows || taskRows.length === 0) {
        return res.json({ success: true, tasks: [] });
      }

      const taskIds = taskRows.map(t => t.task_id);
      const placeholders = taskIds.map(() => '?').join(',');

      db.all(
        `SELECT task_id, agent, status, result_data, created_at
         FROM agent_results
         WHERE task_id IN (${placeholders})
         ORDER BY created_at ASC`,
        taskIds,
        (err2, resultRows) => {
          if (err2) {
            console.error('Database query error:', err2.message);
            return res.status(500).json({ success: false, error: 'Database error' });
          }

          // Group results by task_id
          const resultsByTask = {};
          for (const row of (resultRows || [])) {
            if (!resultsByTask[row.task_id]) resultsByTask[row.task_id] = {};
            try {
              resultsByTask[row.task_id][row.agent] = JSON.parse(row.result_data);
            } catch {
              resultsByTask[row.task_id][row.agent] = { status: row.status };
            }
          }

          const responseTasks = taskRows.map(t => {
            const inMemory = tasks[t.task_id];
            const results = resultsByTask[t.task_id] || {};
            const resultCount = Object.keys(results).length;

            let selectedAgents = inMemory ? inMemory.selectedAgents : null;
            let totalAgents = inMemory && inMemory.selectedAgents ? inMemory.selectedAgents.length : null;

            // Determine total agents if not in memory
            if (!totalAgents) {
              if (t.status === "completed" || resultCount >= 5) {
                totalAgents = resultCount > 0 ? resultCount : 5;
              } else {
                totalAgents = 5; // fallback
              }
            }

            // Fix status if it was stuck processing but actually finished
            let actualStatus = t.status;
            if (actualStatus === "processing" && resultCount > 0 && resultCount >= totalAgents) {
              actualStatus = "completed";
              // optionally update DB in background
              db.run(`UPDATE tasks SET status = ? WHERE task_id = ?`, ["completed", t.task_id]);
            }

            return {
              taskId: t.task_id,
              status: actualStatus,
              companyName: t.company_name,
              createdAt: t.created_at,
              submittedInputs: t.submitted_inputs ? JSON.parse(t.submitted_inputs) : {},
              results: results,
              selectedAgents: selectedAgents,
              totalAgents: totalAgents
            };
          });

          res.json({ success: true, tasks: responseTasks });
        }
      );
    }
  );
});

// CONNECT RABBITMQ
connectRabbitMQ()
  .then(async (channel) => {

    rabbitChannel = channel;

    // CREATE ALL QUEUES
    await channel.assertQueue('invoice_queue');
    await channel.assertQueue('budget_queue');
    await channel.assertQueue('reconciliation_queue');
    await channel.assertQueue('credit_queue');
    await channel.assertQueue('cash_queue');
    await channel.assertQueue('agent_results_queue');

    console.log('All queues created successfully');

    require('./agents/invoiceAgent');
    require('./agents/budgetAgent');
    require('./agents/reconciliationAgent');
    require('./agents/creditAgent');
    require('./agents/cashAgent');

    // LISTEN FOR AGENT RESULTS
    channel.consume('agent_results_queue', (message) => {

      const result = JSON.parse(message.content.toString());

      console.log("Result received from:", result.agent);

      if (tasks[result.taskId]) {

        tasks[result.taskId].results[result.agent] = result;
        
        db.run(
  `
    INSERT INTO agent_results
    (task_id, agent, status, result_data, created_at)
    VALUES (?, ?, ?, ?, ?)
  `,
  [
    result.taskId,
    result.agent,
    result.status,
    JSON.stringify(result),
    new Date().toISOString()
  ],
  (err) => {

    if (err) {
      console.error("Agent result database error:", err.message);
    } else {
      console.log(`${result.agent} result saved to database`);
    }

  }
);

        const resultCount = Object.keys(tasks[result.taskId].results).length;
        const targetCount = (tasks[result.taskId].selectedAgents && tasks[result.taskId].selectedAgents.length) || 5;

        if (resultCount === targetCount) {
          tasks[result.taskId].status = "completed";
          db.run(
            `UPDATE tasks SET status = ? WHERE task_id = ?`,
            ["completed", result.taskId],
            (updateErr) => {
              if (updateErr) console.error("Task status update error:", updateErr.message);
            }
          );
        }

      }

      channel.ack(message);

    });

  })
  .catch((error) => {
    console.error("RabbitMQ connection failed:", error.message);
  });

// START SERVER
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});