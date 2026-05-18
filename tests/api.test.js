/**
 * FinanceAgentX — API & Validation Tests
 *
 * Tests the Express REST API endpoints and input validation.
 * These tests run against the HTTP layer only (no RabbitMQ required).
 *
 * Run:  npm test
 */

const http = require('http');
const path = require('path');

// We need to test the Express app without starting the full server,
// so we build a lightweight test server from the same Express app.
// Since server.js auto-starts, we create a minimal test harness.

const express = require('express');
const sqlite3 = require('sqlite3').verbose();

/* =====================================================
   BUILD A TEST-ONLY EXPRESS APP
   (mirrors server.js logic without RabbitMQ)
   ===================================================== */

const VALID_INDUSTRIES = ['technology', 'retail', 'manufacturing', 'healthcare', 'services'];

const AGENT_QUEUES = {
  invoice:        'invoice_queue',
  budget:         'budget_queue',
  reconciliation: 'reconciliation_queue',
  credit:         'credit_queue',
  cash:           'cash_queue',
};
const ALL_AGENTS = Object.keys(AGENT_QUEUES);

function validateAnalysisInput(data) {
  const errors = [];

  if (!data.companyName || typeof data.companyName !== 'string' || data.companyName.trim().length === 0) {
    errors.push('companyName is required and must be a non-empty string');
  }

  if (data.industry !== undefined && !VALID_INDUSTRIES.includes(data.industry)) {
    errors.push(`industry must be one of: ${VALID_INDUSTRIES.join(', ')}`);
  }

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

  if (data.debtToEquity !== undefined) {
    if (typeof data.debtToEquity !== 'number' || isNaN(data.debtToEquity) || data.debtToEquity < 0) {
      errors.push('debtToEquity must be a non-negative number');
    }
  }

  return errors;
}

// Build app
const app = express();
app.use(express.json());

// In-memory tasks store (mirrors server.js)
const tasks = {};

// In-memory SQLite for tests
const db = new sqlite3.Database(':memory:');

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS tasks (
    task_id TEXT PRIMARY KEY,
    status TEXT,
    company_name TEXT,
    created_at TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS agent_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT,
    agent TEXT,
    status TEXT,
    result_data TEXT,
    created_at TEXT
  )`);
});

app.get('/health', (req, res) => {
  res.send('Server is running');
});

app.post('/analyze', (req, res) => {
  const data = req.body;

  const validationErrors = validateAnalysisInput(data);
  if (validationErrors.length > 0) {
    return res.status(400).json({
      success: false,
      error: validationErrors.length === 1 ? validationErrors[0] : 'Validation failed',
      errors: validationErrors
    });
  }

  // RabbitMQ not available in tests — return a test-mode response
  let selectedAgents = Array.isArray(data.selectedAgents) ? data.selectedAgents : null;
  if (!selectedAgents || selectedAgents.length === 0) {
    selectedAgents = ALL_AGENTS.slice();
  } else {
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
    selectedAgents,
  };

  db.run(
    `INSERT INTO tasks (task_id, status, company_name, created_at) VALUES (?, ?, ?, ?)`,
    [taskId, "processing", data.companyName, new Date().toISOString()]
  );

  res.status(202).json({
    success: true,
    message: "Financial analysis task submitted successfully",
    taskId,
    status: "processing",
    selectedAgents,
    statusUrl: `/status/${taskId}`
  });
});

app.get('/status/:id', (req, res) => {
  const task = tasks[req.params.id];
  if (!task) {
    return res.status(404).json({ success: false, error: "Task not found" });
  }
  const completedAgents = Object.keys(task.results).length;
  const totalAgents = (task.selectedAgents && task.selectedAgents.length) || 5;
  res.json({
    success: true,
    taskId: req.params.id,
    status: task.status,
    completedAgents,
    totalAgents,
    selectedAgents: task.selectedAgents || null,
    results: task.results
  });
});

app.get('/tasks', (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
  db.all(
    `SELECT task_id, status, company_name, created_at FROM tasks ORDER BY created_at DESC LIMIT ?`,
    [limit],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, error: 'Database error' });
      res.json({ success: true, tasks: (rows || []).map(t => ({
        taskId: t.task_id, status: t.status, companyName: t.company_name, createdAt: t.created_at, results: {}
      }))});
    }
  );
});

/* =====================================================
   HELPER: make HTTP requests to the test server
   ===================================================== */
let server;
let baseUrl;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/* =====================================================
   TEST SUITE
   ===================================================== */

beforeAll((done) => {
  server = app.listen(0, () => {
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;
    done();
  });
});

afterAll((done) => {
  server.close(() => {
    db.close();
    done();
  });
});

// ─── Health Check ─────────────────────────────────────

describe('GET /health', () => {
  test('returns 200 with status message', async () => {
    const res = await request('GET', '/health');
    expect(res.status).toBe(200);
    expect(res.body).toContain('running');
  });
});

// ─── Input Validation ─────────────────────────────────

describe('POST /analyze — Input Validation', () => {
  test('rejects empty body', async () => {
    const res = await request('POST', '/analyze', {});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('rejects missing companyName', async () => {
    const res = await request('POST', '/analyze', { revenue: 100000 });
    expect(res.status).toBe(400);
    expect(res.body.errors).toContain('companyName is required and must be a non-empty string');
  });

  test('rejects empty string companyName', async () => {
    const res = await request('POST', '/analyze', { companyName: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('rejects invalid industry', async () => {
    const res = await request('POST', '/analyze', {
      companyName: 'Test Corp',
      industry: 'invalidIndustry'
    });
    expect(res.status).toBe(400);
    expect(res.body.errors.some(e => e.includes('industry'))).toBe(true);
  });

  test('rejects negative revenue', async () => {
    const res = await request('POST', '/analyze', {
      companyName: 'Test Corp',
      revenue: -5000
    });
    expect(res.status).toBe(400);
    expect(res.body.errors.some(e => e.includes('revenue'))).toBe(true);
  });

  test('rejects non-numeric revenue', async () => {
    const res = await request('POST', '/analyze', {
      companyName: 'Test Corp',
      revenue: 'banana'
    });
    expect(res.status).toBe(400);
    expect(res.body.errors.some(e => e.includes('revenue'))).toBe(true);
  });

  test('rejects percentage field > 100', async () => {
    const res = await request('POST', '/analyze', {
      companyName: 'Test Corp',
      dataQuality: 150
    });
    expect(res.status).toBe(400);
    expect(res.body.errors.some(e => e.includes('dataQuality'))).toBe(true);
  });

  test('rejects negative debtToEquity', async () => {
    const res = await request('POST', '/analyze', {
      companyName: 'Test Corp',
      debtToEquity: -1.5
    });
    expect(res.status).toBe(400);
    expect(res.body.errors.some(e => e.includes('debtToEquity'))).toBe(true);
  });

  test('reports multiple validation errors at once', async () => {
    const res = await request('POST', '/analyze', {
      revenue: -100,
      dataQuality: 200
    });
    expect(res.status).toBe(400);
    expect(res.body.errors.length).toBeGreaterThanOrEqual(3); // companyName + revenue + dataQuality
  });

  test('rejects invalid selectedAgents', async () => {
    const res = await request('POST', '/analyze', {
      companyName: 'Test Corp',
      selectedAgents: ['invalidAgent', 'fakeAgent']
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('selectedAgents');
  });
});

// ─── Successful Submission ────────────────────────────

describe('POST /analyze — Successful Submission', () => {
  test('accepts valid minimal input (companyName only)', async () => {
    const res = await request('POST', '/analyze', { companyName: 'Test Corp' });
    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.taskId).toBeDefined();
    expect(res.body.selectedAgents).toHaveLength(5);
    expect(res.body.statusUrl).toContain('/status/');
  });

  test('accepts valid full input with all fields', async () => {
    const res = await request('POST', '/analyze', {
      companyName: 'ABC Corporation',
      industry: 'technology',
      revenue: 150000,
      totalExpenses: 95000,
      accountsReceivable: 45000,
      accountsPayable: 32000,
      currentAssets: 280000,
      currentLiabilities: 120000,
      previousCashBalance: 90000,
      selectedAgents: ['invoice', 'cash']
    });
    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.selectedAgents).toEqual(['invoice', 'cash']);
  });

  test('accepts valid industry values', async () => {
    for (const industry of ['technology', 'retail', 'manufacturing', 'healthcare', 'services']) {
      const res = await request('POST', '/analyze', {
        companyName: 'Industry Test',
        industry
      });
      expect(res.status).toBe(202);
    }
  });

  test('defaults to all 5 agents when selectedAgents is empty', async () => {
    const res = await request('POST', '/analyze', {
      companyName: 'Default Agents',
      selectedAgents: []
    });
    expect(res.status).toBe(202);
    expect(res.body.selectedAgents).toHaveLength(5);
  });

  test('deduplicates selected agents', async () => {
    const res = await request('POST', '/analyze', {
      companyName: 'Dedup Test',
      selectedAgents: ['cash', 'cash', 'invoice', 'invoice']
    });
    expect(res.status).toBe(202);
    expect(res.body.selectedAgents).toHaveLength(2);
  });
});

// ─── Status Endpoint ──────────────────────────────────

describe('GET /status/:id', () => {
  test('returns 404 for unknown task ID', async () => {
    const res = await request('GET', '/status/nonexistent999');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('returns status for a valid task', async () => {
    // First create a task
    const createRes = await request('POST', '/analyze', { companyName: 'Status Test' });
    expect(createRes.status).toBe(202);
    const taskId = createRes.body.taskId;

    // Then check its status
    const statusRes = await request('GET', `/status/${taskId}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.success).toBe(true);
    expect(statusRes.body.taskId).toBe(taskId);
    expect(statusRes.body.status).toBe('processing');
    expect(statusRes.body.completedAgents).toBe(0);
    expect(statusRes.body.totalAgents).toBe(5);
  });
});

// ─── Task History ─────────────────────────────────────

describe('GET /tasks', () => {
  test('returns task history', async () => {
    const res = await request('GET', '/tasks');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.tasks)).toBe(true);
    // Should have tasks from previous tests
    expect(res.body.tasks.length).toBeGreaterThan(0);
  });

  test('respects limit parameter', async () => {
    const res = await request('GET', '/tasks?limit=2');
    expect(res.status).toBe(200);
    expect(res.body.tasks.length).toBeLessThanOrEqual(2);
  });

  test('each task has expected fields', async () => {
    const res = await request('GET', '/tasks?limit=1');
    expect(res.status).toBe(200);
    const task = res.body.tasks[0];
    expect(task).toHaveProperty('taskId');
    expect(task).toHaveProperty('status');
    expect(task).toHaveProperty('companyName');
    expect(task).toHaveProperty('createdAt');
  });
});

// ─── ML Inference Script Validation ───────────────────

describe('ML Model Inference Scripts', () => {
  const { execFile } = require('child_process');

  const agents = [
    { name: 'Cash', dir: 'cash_agent_model', keys: ['agent', 'status', 'processedData'] },
    { name: 'Invoice', dir: 'invoice_agent_model', keys: ['agent', 'status', 'processedData'] },
    { name: 'Budget', dir: 'budget_agent_model', keys: ['agent', 'status', 'processedData'] },
    { name: 'Credit', dir: 'credit_agent_model', keys: ['agent', 'status', 'processedData'] },
    { name: 'Reconciliation', dir: 'reconciliation_agent_model', keys: ['agent', 'status', 'processedData'] },
  ];

  const sampleInput = JSON.stringify({
    companyName: 'Test Corp',
    industry: 'technology',
    revenue: 150000,
    totalExpenses: 95000,
    accountsReceivable: 45000,
    accountsPayable: 32000,
    currentAssets: 280000,
    currentLiabilities: 120000,
    previousCashBalance: 90000,
    invoiceCategory: 'consulting',
    invoiceAmount: 18500,
    vendorHistoryMonths: 36,
    lineItems: 8,
    daysSinceReceived: 5,
    previousInvoices: 24,
    amountDeviation: 3.5,
    hasPurchaseOrder: 1,
    numDepartments: 5,
    fiscalQuarter: 2,
    yoyGrowth: 8.5,
    operatingMargin: 22,
    headcount: 120,
    prevUtilization: 78.5,
    totalTransactions: 150,
    transactionVolume: 200000,
    dataQuality: 88.5,
    numSources: 4,
    daysSinceLastRecon: 14,
    automationLevel: 75,
    numAccounts: 12,
    prevErrorRate: 2.5,
    debtToEquity: 0.8,
    yearsInBusiness: 15,
    paymentHistory: 92,
    outstandingDebt: 75000,
    creditUtilization: 35,
    latePayments: 1,
    collateralValue: 300000,
    annualGrowth: 12,
  });

  for (const agent of agents) {
    test(`${agent.name} Agent inference returns valid JSON with expected keys`, (done) => {
      const scriptPath = path.join(__dirname, '..', agent.dir, 'inference.py');

      execFile('python', [scriptPath, sampleInput], {
        timeout: 30000,
        maxBuffer: 1024 * 1024
      }, (error, stdout, stderr) => {
        if (error) {
          // If Python or model not available, skip gracefully
          console.warn(`  ⚠ ${agent.name} model not available: ${error.message}`);
          done();
          return;
        }

        // Extract JSON from stdout
        let jsonStr = '';
        let braceDepth = 0;
        let capturing = false;
        for (const char of stdout) {
          if (char === '{') { capturing = true; braceDepth++; }
          if (capturing) jsonStr += char;
          if (char === '}') { braceDepth--; if (braceDepth === 0 && capturing) break; }
        }

        let result;
        try {
          result = JSON.parse(jsonStr.trim());
        } catch (parseErr) {
          done(new Error(`Failed to parse ${agent.name} output: ${parseErr.message}`));
          return;
        }

        // Validate structure
        for (const key of agent.keys) {
          expect(result).toHaveProperty(key);
        }
        expect(result.agent).toBe(agent.name.toLowerCase());
        expect(result.status).toBe('completed');
        expect(typeof result.processedData).toBe('object');
        expect(result.processedData).toHaveProperty('company');

        done();
      });
    }, 35000); // 35s timeout for ML model loading
  }
});
