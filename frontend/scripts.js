/* =====================================================
   FAgentLLM Dashboard — scripts.js
   Connects to backend: POST /analyze   GET /status/:id
   ===================================================== */

/* -------- Configuration -------- */
const API_BASE = "http://localhost:5000";   // Change if backend is hosted elsewhere
const POLL_INTERVAL = 1500;                 // ms between status polls
const POLL_TIMEOUT  = 60_000;               // give up after 60s

/* -------- Static metadata for the 5 agents -------- */
const AGENTS = {
  invoice: {
    label: "Invoice Agent",
    color: getCss("--c-blue"),
    colorDark: getCss("--c-blue-d"),
    eta: 2000,
  },
  budget: {
    label: "Budget Agent",
    color: getCss("--c-mint"),
    colorDark: getCss("--c-mint-d"),
    eta: 3000,
  },
  reconciliation: {
    label: "Reconciliation Agent",
    color: getCss("--c-lavender"),
    colorDark: getCss("--c-lavender-d"),
    eta: 3000,
  },
  credit: {
    label: "Credit Agent",
    color: getCss("--c-peach"),
    colorDark: getCss("--c-peach-d"),
    eta: 3000,
  },
  cash: {
    label: "Cash Agent",
    color: getCss("--c-pink"),
    colorDark: getCss("--c-pink-d"),
    eta: 3000,
  },
};

function getCss(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/* -------- In-memory state -------- */
const state = {
  tasks: [],     // [{ id, company, status, startedAt, results: {agent: data} }]
  logs: [],      // [{ level, title, detail, time }]
  totals: { completed: 0, pending: 0, perAgent: { invoice: 0, budget: 0, reconciliation: 0, credit: 0, cash: 0 } },
};

/* =====================================================
   SEED DATA (so the dashboard looks alive on first load)
   ===================================================== */
function seed() {
  // Seed recent tasks
  const now = Date.now();
  state.tasks = [];
  state.totals.completed = 0;
  state.totals.pending = 0;
  state.totals.perAgent = { invoice: 0, budget: 0, reconciliation: 0, credit: 0, cash: 0 };

  // Seed logs
  pushLog("info", "System", "Scheduled maintenance on May 20, 12:00 AM", new Date(now - 90 * 60_000));
  pushLog("info", "Backend online", "Connected to http://localhost:5000", new Date(now - 1 * 60_000));

  // Seed progress rows (in-flight tasks)
  state.progressRows = [];
}

/* =====================================================
   RENDERERS
   ===================================================== */
function renderTasksTable() {
  const tbody = document.getElementById("tasksTableBody");
  if (!tbody) return;

  const visibleTasks = state.tasks;

  tbody.innerHTML = visibleTasks
    .slice()
    .reverse()
    .map(t => {
      const baseAgent = t.agent === "multi"
        ? { label: "All 5 Agents", color: getCss("--c-lavender") }
        : (AGENTS[t.agent] || { label: "Multi-agent", color: getCss("--c-lavender") });
      // Custom label override (e.g. "3 agents", "Invoice", "All 5 Agents")
      const a = t.agentLabel
        ? { label: t.agentLabel, color: baseAgent.color }
        : baseAgent;

      const statusClass =
        t.status === "completed" ? "pill-done" :
        t.status === "processing" ? "pill-run" :
        t.status === "warning" ? "pill-warn" : "pill-fail";

      return `
        <tr class="task-row" data-task-id="${t.id}">
          <td><span class="task-id">${t.id.slice(-8).toUpperCase()}</span></td>
          <td>${escapeHtml(t.company)}</td>
          <td>
            <span class="agent-pill">
              <span class="swatch" style="background:${a.color}"></span>
              ${a.label}
            </span>
          </td>
          <td><span class="status-pill ${statusClass}">${t.status}</span></td>
          <td>${formatTime(t.startedAt)}</td>
        </tr>
      `;
    })
    .join("");

}

function renderProgressList() {
  const list = document.getElementById("progressList");
  if (!list) return;

  list.innerHTML = (state.progressRows || []).map(p => {
    const a = AGENTS[p.agent] || {
      label: "All 5 Agents",
      color: getCss("--c-lavender")
    };

    return `
      <div class="progress-row ${p.done ? "progress-done" : ""}" style="--accent:${a.color}">
        <div class="pr-icon">
          ${p.done
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                 <polyline points="20 6 9 17 4 12"/>
               </svg>`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                 <circle cx="12" cy="12" r="9"/>
                 <path d="M12 7v5l3 2"/>
               </svg>`
          }
        </div>
        <div class="pr-body">
          <p class="pr-title">${escapeHtml(p.title)}</p>
          <p class="pr-meta">${a.label} · ${p.id}</p>
          <div class="pr-progress"><div style="width:${p.percent}%"></div></div>
        </div>
        <div class="pr-percent">${p.done ? "✓" : `${p.percent}%`}</div>
      </div>
    `;
  }).join("");
}

function renderLogs() {
  const list = document.getElementById("logList");
  if (!list) return;
  const filter = document.getElementById("logFilter")?.value || "all";
  const filtered = filter === "all"
    ? state.logs
    : state.logs.filter(l => l.level === filter);

  list.innerHTML = filtered.slice(0, 30).map(l => `
    <li class="log-item log-${l.level}">
      <span></span>
      <span class="log-icon">${iconForLog(l.level)}</span>
      <div class="log-body">
        <strong>${escapeHtml(l.title)}</strong>
        <span>${escapeHtml(l.detail)}</span>
      </div>
      <span class="log-time">${formatTime(l.time)}</span>
    </li>
  `).join("");
}

function pushLog(level, title, detail, time) {
  state.logs.unshift({
    level: level || "info",
    title: title || "Log",
    detail: detail || "",
    time: time || new Date(),
  });
  if (state.logs.length > 60) state.logs.length = 60;
  renderLogs();
}

function iconForLog(level) {
  const map = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v.01M12 11v5"/></svg>',
    warn:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17v.01"/></svg>',
    error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/></svg>',
  };
  return map[level] || map.info;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function formatTime(d) {
  if (!(d instanceof Date)) d = new Date(d);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* =====================================================
   AGENT CARD UPDATES (from real backend results)
   ===================================================== */
function updateAgentCard(agent, data) {
  const setStat = (key, value) => {
    const el = document.querySelector(`[data-stat="${key}"]`);
    if (el) el.textContent = value;
  };
  const setProgress = (key, percent) => {
    const el = document.querySelector(`[data-stat="${key}"]`);
    if (el) el.style.width = `${percent}%`;
  };
  const setStatus = (agentKey, statusClass, label) => {
    const card = document.querySelector(`[data-agent="${agentKey}"]`);
    if (!card) return;
    const status = card.querySelector(".agent-status");
    if (!status) return;
    status.className = `agent-status ${statusClass}`;
    status.innerHTML = `<span class="dot"></span> ${label}`;
  };

  if (agent === "invoice") {
    setStat("invoice-amount", "$" + Number(data.invoiceAmount).toLocaleString());
    setStat("invoice-id",     data.invoiceId);
    setStat("invoice-note",   data.notes || (data.duplicateCheck ? "Duplicate detected" : "No duplicates detected"));
    setProgress("invoice-progress", data.paymentStatus === "approved" ? 100 : 60);
    setStatus("invoice", data.duplicateCheck ? "status-warning" : "status-active",
              data.duplicateCheck ? "Watch" : "Active");
  }
  if (agent === "budget") {
    setStat("budget-total",     data.totalBudget);
    setStat("budget-remaining", data.remainingBudget);
    setStat("budget-depts", `${(data.approvedDepartments || []).length} departments approved`);
    const total = parseMoney(data.totalBudget);
    const remain = parseMoney(data.remainingBudget);
    const used = total ? Math.round(((total - remain) / total) * 100) : 0;
    setProgress("budget-progress", used);
    setStatus("budget", "status-active", "Active");
  }
  if (agent === "reconciliation") {
    const matched = Number(data.matchedTransactions) || 0;
    const unmatched = Number(data.unmatchedTransactions) || 0;
    const total = matched + unmatched;
    setStat("recon-matched",   matched);
    setStat("recon-total",     total);
    setStat("recon-unmatched", unmatched);
    setStat("recon-status",    capitalize(data.reconciliationStatus) || "Pending");
    setProgress("recon-progress", total ? Math.round((matched / total) * 100) : 0);
    setStatus("reconciliation",
      data.reconciliationStatus === "successful" ? "status-active" : "status-processing",
      data.reconciliationStatus === "successful" ? "Active" : "Processing");
  }
  if (agent === "credit") {
    setStat("credit-score",       data.creditScore);
    setStat("credit-risk",        data.riskLevel);
    setStat("credit-eligibility", capitalize(data.loanEligibility));
    setStat("credit-note", data.riskLevel === "low"
      ? "Healthy credit profile"
      : `${data.riskLevel} risk — review accounts`);
    setProgress("credit-progress", Math.min(100, Math.round((Number(data.creditScore) / 850) * 100)));
    setStatus("credit",
      data.riskLevel === "low" ? "status-active" : "status-warning",
      data.riskLevel === "low" ? "Active" : "Watch");
  }
  if (agent === "cash") {
    setStat("cash-available", data.availableCash);
    setStat("cash-monthly",   data.monthlyExpenses);
    setStat("cash-status",    "Cash flow " + (data.cashFlowStatus || "—"));
    const avail = parseMoney(data.availableCash);
    const exp = parseMoney(data.monthlyExpenses);
    const ratio = avail ? Math.min(100, Math.round(((avail - exp) / avail) * 100)) : 0;
    setProgress("cash-progress", ratio);
    setStatus("cash",
      data.cashFlowStatus === "stable" ? "status-active" : "status-warning",
      data.cashFlowStatus === "stable" ? "Stable" : "Watch");
  }
}

function parseMoney(s) {
  if (typeof s === "number") return s;
  if (!s) return 0;
  return Number(String(s).replace(/[^0-9.\-]/g, "")) || 0;
}
function capitalize(s) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* =====================================================
   CHARTS
   ===================================================== */
const charts = {};

function initCharts() {
  if (!window.Chart) return;

  Chart.defaults.font.family = '"Manrope", system-ui, sans-serif';
  Chart.defaults.font.size = 11;
  Chart.defaults.color = "#7C7568";
  Chart.defaults.plugins.tooltip.backgroundColor = "#1F1B16";
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.plugins.tooltip.titleFont = { family: '"Fraunces", serif', size: 12, weight: 500 };

  /* ----- Tasks completed vs pending (bar) ----- */
  const tasksCtx = document.getElementById("tasksChart");
  if (tasksCtx) {
    const labels = ["May 12","May 13","May 14","May 15","May 16","May 17","May 18"];
    charts.tasks = new Chart(tasksCtx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Completed",
            data: [240, 312, 278, 340, 305, 360, 318],
            backgroundColor: getCss("--c-lavender"),
            borderRadius: 6,
            borderSkipped: false,
            barPercentage: 0.55,
            categoryPercentage: 0.7,
          },
          {
            label: "Pending",
            data: [80, 60, 110, 70, 95, 50, 88],
            backgroundColor: getCss("--c-peach"),
            borderRadius: 6,
            borderSkipped: false,
            barPercentage: 0.55,
            categoryPercentage: 0.7,
          },
        ],
      },
      options: chartOptions({ legend: false, gridX: false }),
    });
  }

  /* ----- Donut: tasks by agent ----- */
  const donutCtx = document.getElementById("distributionChart");
  if (donutCtx) {
    const data = [
      state.totals.perAgent.invoice,
      state.totals.perAgent.budget,
      state.totals.perAgent.reconciliation,
      state.totals.perAgent.credit,
      state.totals.perAgent.cash,
    ];
    const total = data.reduce((a,b) => a+b, 0);
    document.getElementById("donutTotal").textContent = total.toLocaleString();

    charts.donut = new Chart(donutCtx, {
      type: "doughnut",
      data: {
        labels: ["Invoice","Budget","Reconciliation","Credit","Cash"],
        datasets: [{
          data,
          backgroundColor: [
            getCss("--c-blue"),
            getCss("--c-mint"),
            getCss("--c-lavender"),
            getCss("--c-peach"),
            getCss("--c-pink"),
          ],
          borderColor: "#fff",
          borderWidth: 3,
          hoverOffset: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "68%",
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              boxWidth: 9,
              boxHeight: 9,
              padding: 10,
              usePointStyle: true,
              pointStyle: "circle",
              font: { size: 10.5 },
            },
          },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.label}: ${ctx.parsed} tasks`
            }
          }
        }
      }
    });
  }

  /* ----- Line: cash flow trend ----- */
  const trendCtx = document.getElementById("trendChart");
  if (trendCtx) {
    const labels = ["May 12","May 13","May 14","May 15","May 16","May 17","May 18"];
    const inflow = [180, 230, 195, 310, 240, 285, 260];
    const outflow = [120, 145, 170, 155, 195, 175, 165];

    const ctx = trendCtx.getContext("2d");
    const gradMint = ctx.createLinearGradient(0, 0, 0, 220);
    gradMint.addColorStop(0, "rgba(201, 228, 222, 0.5)");
    gradMint.addColorStop(1, "rgba(201, 228, 222, 0)");
    const gradPink = ctx.createLinearGradient(0, 0, 0, 220);
    gradPink.addColorStop(0, "rgba(242, 198, 222, 0.45)");
    gradPink.addColorStop(1, "rgba(242, 198, 222, 0)");

    charts.trend = new Chart(trendCtx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Inflow (k$)",
            data: inflow,
            borderColor: getCss("--c-mint-d"),
            backgroundColor: gradMint,
            tension: 0.38,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 5,
            borderWidth: 2.4,
          },
          {
            label: "Outflow (k$)",
            data: outflow,
            borderColor: getCss("--c-pink-d"),
            backgroundColor: gradPink,
            tension: 0.38,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 5,
            borderWidth: 2.4,
          },
        ],
      },
      options: chartOptions({ legend: false, gridX: false, tickStep: 100 }),
    });
  }
}

function chartOptions({ legend = false, gridX = true, tickStep } = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: "index" },
    plugins: {
      legend: { display: legend },
      tooltip: { displayColors: false },
    },
    scales: {
      x: {
        grid: { display: gridX, color: "#F0EAD9" },
        border: { display: false },
        ticks: { padding: 6 },
      },
      y: {
        grid: { color: "#F0EAD9", drawTicks: false },
        border: { display: false },
        ticks: {
          padding: 8,
          stepSize: tickStep,
          callback: v => v >= 1000 ? (v/1000) + "k" : v,
        },
        beginAtZero: true,
      },
    },
    animation: { duration: 700, easing: "easeOutQuart" },
  };
}

/* =====================================================
   BACKEND INTEGRATION
   ===================================================== */
  async function submitAnalysis(data) {
  const res = await fetch(`${API_BASE}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server returned ${res.status}`);
  }
  return await res.json();   // { success, taskId, status, statusUrl }
}

async function fetchStatus(taskId) {
  const res = await fetch(`${API_BASE}/status/${taskId}`);
  if (!res.ok) throw new Error(`Status fetch failed: ${res.status}`);
  return await res.json();
}

/* -------- Poll a single task until completed or timeout -------- */
function pollTask(taskId, companyName, taskRecord) {
  const started = Date.now();
  const seenAgents = new Set();
  // How many agents were actually dispatched for this task
  const expected = (taskRecord && taskRecord.selectedAgents && taskRecord.selectedAgents.length) || 5;

  const tick = async () => {
    try {
      const data = await fetchStatus(taskId);
      const results = data.results || {};

      taskRecord.results = results;
      taskRecord.status = data.status;
      taskRecord.completedAgents = data.completedAgents;
      if (typeof activeModalTaskId !== "undefined" && activeModalTaskId === taskId && !document.getElementById("taskModal")?.hidden) {
        openTaskModal(taskId);
      }

      // Update agent cards for any newly-seen results
      Object.entries(results).forEach(([agent, payload]) => {
        if (!seenAgents.has(agent)) {
          seenAgents.add(agent);
          if (payload.processedData) {
            updateAgentCard(agent, payload.processedData);
          }
          pushLog("success",
            `${(AGENTS[agent] && AGENTS[agent].label) || agent}`,
            `Completed for ${companyName}`,
            new Date());
          state.totals.perAgent[agent] = (state.totals.perAgent[agent] || 0) + 1;
          updateDonut();
        }
      });

      // Update task-level progress row — denominator is the number of selected agents
      const completed = data.completedAgents || seenAgents.size;
      const total = data.totalAgents || expected;
      const percent = Math.round((completed / total) * 100);
      updateProgressRow(taskRecord.id, percent);

      if (data.status === "completed" || completed >= total) {
        taskRecord.status = "completed";
        renderTasksTable();
        completeProgressRow(taskRecord.id);
        const detail = total === 5
          ? `${companyName} — all 5 agents reported`
          : `${companyName} — ${completed} of ${total} agents reported`;
        pushLog("success", "Analysis complete", detail, new Date());
        toast(`Analysis complete for ${companyName}`, "success");
        return;
      }

      if (Date.now() - started > POLL_TIMEOUT) {
        pushLog("warn", "Analysis timeout",
          `${companyName} did not finish in time`, new Date());
        taskRecord.status = "warning";
        renderTasksTable();
        return;
      }

      setTimeout(tick, POLL_INTERVAL);
    } catch (err) {
      pushLog("error", "Status fetch failed", err.message, new Date());
    }
  };

  tick();
}

/* -------- DEMO mode: simulate the 5 agents without backend -------- */
function simulateAnalysis(companyName, taskRecord) {
  const mocks = {
    invoice: {
      invoiceId: "INV-2026-" + Math.floor(Math.random()*900+100),
      company: companyName,
      invoiceAmount: 8000 + Math.floor(Math.random() * 12000),
      paymentStatus: "approved",
      duplicateCheck: Math.random() < 0.15,
      notes: "Invoice records appear valid",
    },
    budget: {
      company: companyName,
      totalBudget: "$" + (30 + Math.floor(Math.random()*40)) + ",000",
      approvedDepartments: ["Marketing","Operations","IT"].slice(0, 2 + Math.floor(Math.random()*2)),
      remainingBudget: "$" + (5 + Math.floor(Math.random()*20)) + ",000",
    },
    reconciliation: {
      company: companyName,
      matchedTransactions: 100 + Math.floor(Math.random() * 60),
      unmatchedTransactions: Math.floor(Math.random() * 10),
      reconciliationStatus: "successful",
    },
    credit: {
      company: companyName,
      creditScore: 600 + Math.floor(Math.random() * 250),
      riskLevel: Math.random() < 0.7 ? "low" : "moderate",
      loanEligibility: Math.random() < 0.8 ? "approved" : "review",
    },
    cash: {
      company: companyName,
      availableCash: "$" + (50 + Math.floor(Math.random() * 80)) + ",000",
      monthlyExpenses: "$" + (15 + Math.floor(Math.random() * 25)) + ",000",
      cashFlowStatus: Math.random() < 0.85 ? "stable" : "tight",
    },
  };

  // Only simulate the agents this task actually dispatched to.
  // Falls back to all 5 if no list (legacy callers).
  const agentsToRun = (taskRecord && taskRecord.selectedAgents && taskRecord.selectedAgents.length)
    ? taskRecord.selectedAgents
    : Object.keys(AGENTS);
  const total = agentsToRun.length;

  let done = 0;
  agentsToRun.forEach((key) => {
    const meta = AGENTS[key];
    if (!meta) return;
    setTimeout(() => {
      updateAgentCard(key, mocks[key]);
      pushLog("success", meta.label, `Completed for ${companyName} (demo)`, new Date());
      state.totals.perAgent[key]++;
      updateDonut();
      done++;
      const percent = Math.round((done / total) * 100);
      updateProgressRow(taskRecord.id, percent);
      if (done === total) {
        taskRecord.status = "completed";
        renderTasksTable();
        completeProgressRow(taskRecord.id);
        toast(`Analysis complete for ${companyName} (demo)`, "success");
      }
    }, meta.eta + Math.random() * 800);
  });
}

/* -------- Progress row helpers -------- */
function addProgressRow(id, company, agent) {
  state.progressRows = state.progressRows || [];
  state.progressRows.unshift({
    id,
    title: `Analyzing ${company}`,
    agent,
    percent: 5,
  });
  if (state.progressRows.length > 8) state.progressRows.length = 8;
  renderProgressList();
}
function updateProgressRow(id, percent) {
  if (!state.progressRows) return;
  const row = state.progressRows.find(r => r.id === id);
  if (row) {
    row.percent = percent;
    renderProgressList();
  }
}
function completeProgressRow(id) {
  if (!state.progressRows) return;
  const row = state.progressRows.find(r => r.id === id);
  if (row) {
    row.percent = 100;
    row.done = true;
    renderProgressList();
  }
}

function updateDonut() {
  if (!charts.donut) return;
  const data = [
    state.totals.perAgent.invoice,
    state.totals.perAgent.budget,
    state.totals.perAgent.reconciliation,
    state.totals.perAgent.credit,
    state.totals.perAgent.cash,
  ];
  charts.donut.data.datasets[0].data = data;
  charts.donut.update("none");
  const total = data.reduce((a,b) => a+b, 0);
  document.getElementById("donutTotal").textContent = total.toLocaleString();
  document.getElementById("qsTotal").textContent = total.toLocaleString();
}

/* =====================================================
   FORM SUBMISSION
   ===================================================== */

function getRelevantPayload(allData, selectedAgents) {
  const payload = {
    companyName: allData.companyName,
    industry: allData.industry,
    revenue: allData.revenue,
    totalExpenses: allData.totalExpenses,
    headcount: allData.headcount,
    selectedAgents: selectedAgents
  };

  const byAgent = {
    cash: [
      "accountsReceivable", "accountsPayable", "currentAssets",
      "currentLiabilities", "previousCashBalance"
    ],
    invoice: [
      "invoiceCategory", "invoiceAmount", "vendorHistoryMonths",
      "lineItems", "daysSinceReceived", "previousInvoices",
      "amountDeviation", "hasPurchaseOrder"
    ],
    budget: [
      "numDepartments", "fiscalQuarter", "yoyGrowth",
      "operatingMargin", "prevUtilization"
    ],
    reconciliation: [
      "totalTransactions", "transactionVolume", "dataQuality",
      "numSources", "daysSinceLastRecon", "automationLevel",
      "numAccounts", "prevErrorRate"
    ],
    credit: [
      "debtToEquity", "yearsInBusiness", "paymentHistory",
      "outstandingDebt", "creditUtilization", "latePayments",
      "collateralValue", "annualGrowth"
    ]
  };

  selectedAgents.forEach(agent => {
    (byAgent[agent] || []).forEach(key => {
      payload[key] = allData[key];
    });
  });

  return payload;
}



function bindForm() {
  const form = document.getElementById("analyzeForm");
  const input = document.getElementById("companyName");
  const btn = document.getElementById("runBtn");

  if (!form || !input || !btn) return;

  const runModeChips = document.getElementById("runModeChips");
  const agentPicker = document.getElementById("agentPicker");
  const taskModal = document.getElementById("taskModal");
  const closeBtn = document.getElementById("closeTaskModal");
  const tasksTableBody = document.getElementById("tasksTableBody");

  let runMode = "all";
  let activeModalTaskId = null;

  function getSelectedAgents() {
    if (runMode === "all") {
      return ["invoice", "budget", "reconciliation", "credit", "cash"];
    }

    const boxes = agentPicker
      ? agentPicker.querySelectorAll('input[name="agent"]:checked')
      : [];

    return Array.from(boxes).map(b => b.value);
  }

  function updateAgentInputVisibility() {
    const groups = document.querySelectorAll("[data-agent-group]");
    const selectedAgents = getSelectedAgents();

    groups.forEach(group => {
      const agent = group.dataset.agentGroup;
      const shouldShow = runMode === "all" || selectedAgents.includes(agent);
      group.style.display = shouldShow ? "" : "none";
    });
  }

  function openTaskModal(taskId) {
    activeModalTaskId = taskId;
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    document.getElementById("modal-task-id").textContent = task.id;
    document.getElementById("modal-company").textContent = task.company || "—";

    const agentsText = task.agentLabel ||
      (task.selectedAgents && task.selectedAgents.length === 5
        ? "All 5 agents"
        : `${(task.selectedAgents && task.selectedAgents.length) || 0} agents`);

    document.getElementById("modal-agents").textContent = agentsText;
    document.getElementById("modal-status").textContent = task.status || "—";
    document.getElementById("modal-started").textContent = task.startedAt ? formatTime(task.startedAt) : "—";

    const inputsDiv = document.getElementById("modal-inputs");
    if (task.submittedInputs && Object.keys(task.submittedInputs).length > 0) {
      inputsDiv.innerHTML = `
        <div class="input-grid-modal">
          ${Object.entries(task.submittedInputs)
            .filter(([k]) => k !== "selectedAgents")
            .map(([key, val]) => {
              const displayVal = typeof val === "number" ? val.toLocaleString() : String(val);
              return `<div class="input-row"><span class="input-key">${key}:</span> <span class="input-val">${escapeHtml(displayVal)}</span></div>`;
            })
            .join("")}
        </div>
      `;
    } else {
      inputsDiv.innerHTML = "<p style='color: var(--ink-3); font-size: 12px;'>No input data captured.</p>";
    }

    const resultsDiv = document.getElementById("modal-results");
    if (task.results && Object.keys(task.results).length > 0) {
      resultsDiv.innerHTML = `
        ${Object.entries(task.results)
          .map(([agent, result]) => {
            const meta = AGENTS[agent] || { label: agent };
            const status = result.status || "unknown";
            const data = result.processedData || {};
            const colorMap = {
              cash: "pink",
              credit: "peach",
              budget: "mint",
              reconciliation: "lavender",
              invoice: "blue"
            };
            const borderColor = getCss(`--c-${colorMap[agent] || "lavender"}`);

            return `
              <div class="result-card" style="border-left: 4px solid ${borderColor}">
                <div class="result-agent">${meta.label}</div>
                <div class="result-status">${status}</div>
                <div class="result-data">
                  ${Object.entries(data)
                    .map(([k, v]) => `<div><strong>${k}:</strong> ${escapeHtml(String(v))}</div>`)
                    .join("")}
                </div>
              </div>
            `;
          })
          .join("")}
      `;
    } else {
      resultsDiv.innerHTML = "<p style='color: var(--ink-3); font-size: 12px;'>Results not yet available.</p>";
    }

    taskModal.hidden = false;
  }

  function closeTaskModal() {
    activeModalTaskId = null;
    taskModal.hidden = true;
  }

  if (runModeChips && agentPicker) {
    runModeChips.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;

      runMode = chip.dataset.mode;

      runModeChips.querySelectorAll(".chip").forEach(c => {
        const isActive = c === chip;
        c.classList.toggle("active", isActive);
        c.setAttribute("aria-selected", String(isActive));
      });

      agentPicker.hidden = (runMode !== "selected");
      updateAgentInputVisibility();
    });

    agentPicker.addEventListener("change", () => {
      updateAgentInputVisibility();
    });
  }

  updateAgentInputVisibility();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const company = input.value.trim();
    if (!company) {
      toast("Please enter a company name", "error");
      input.focus();
      return;
    }

    const selectedAgents = getSelectedAgents();
    if (selectedAgents.length === 0) {
      toast("Pick at least one agent to run", "error");
      return;
    }

    const getNum = (id, fallback) => {
      const el = document.getElementById(id);
      const val = el ? parseFloat(el.value) : NaN;
      return isNaN(val) ? fallback : val;
    };

    const getStr = (id, fallback) => {
      const el = document.getElementById(id);
      return (el && el.value) ? el.value.trim() : fallback;
    };

    const analysisData = {
      companyName: company,
      industry: getStr("industry", "technology"),
      revenue: getNum("revenue", 150000),
      totalExpenses: getNum("totalExpenses", 95000),
      headcount: getNum("headcount", 120),

      accountsReceivable: getNum("accountsReceivable", 45000),
      accountsPayable: getNum("accountsPayable", 32000),
      currentAssets: getNum("currentAssets", 280000),
      currentLiabilities: getNum("currentLiabilities", 120000),
      previousCashBalance: getNum("previousCashBalance", 90000),

      invoiceCategory: getStr("invoiceCategory", "consulting"),
      invoiceAmount: getNum("invoiceAmount", 18500),
      vendorHistoryMonths: getNum("vendorHistoryMonths", 36),
      lineItems: getNum("lineItems", 8),
      daysSinceReceived: getNum("daysSinceReceived", 5),
      previousInvoices: getNum("previousInvoices", 24),
      amountDeviation: getNum("amountDeviation", 3.5),
      hasPurchaseOrder: getNum("hasPurchaseOrder", 1),

      numDepartments: getNum("numDepartments", 5),
      fiscalQuarter: getNum("fiscalQuarter", 2),
      yoyGrowth: getNum("yoyGrowth", 8.5),
      operatingMargin: getNum("operatingMargin", 22),
      prevUtilization: getNum("prevUtilization", 78.5),

      totalTransactions: getNum("totalTransactions", 150),
      transactionVolume: getNum("transactionVolume", 200000),
      dataQuality: getNum("dataQuality", 88.5),
      numSources: getNum("numSources", 4),
      daysSinceLastRecon: getNum("daysSinceLastRecon", 14),
      automationLevel: getNum("automationLevel", 75),
      numAccounts: getNum("numAccounts", 12),
      prevErrorRate: getNum("prevErrorRate", 2.5),

      debtToEquity: getNum("debtToEquity", 0.8),
      yearsInBusiness: getNum("yearsInBusiness", 15),
      paymentHistory: getNum("paymentHistory", 92),
      outstandingDebt: getNum("outstandingDebt", 75000),
      creditUtilization: getNum("creditUtilization", 35),
      latePayments: getNum("latePayments", 1),
      collateralValue: getNum("collateralValue", 300000),
      annualGrowth: getNum("annualGrowth", 12),

      selectedAgents: selectedAgents
    };

    const payloadToSend = getRelevantPayload(analysisData, selectedAgents);

    btn.disabled = true;
    const originalLabel = btn.querySelector(".btn-label").textContent;
    btn.querySelector(".btn-label").textContent = "Submitting…";

    const optimisticId = "T-" + Date.now();
    const allFive = selectedAgents.length === 5;

    const taskRecord = {
      id: optimisticId,
      company,
      agent: allFive ? "multi" : (selectedAgents.length === 1 ? selectedAgents[0] : "multi"),
      agentLabel: allFive
        ? "All 5 Agents"
        : (selectedAgents.length === 1
            ? (AGENTS[selectedAgents[0]] && AGENTS[selectedAgents[0]].label)
            : `${selectedAgents.length} agents`),
      selectedAgents: selectedAgents.slice(),
      submittedInputs: getRelevantPayload(analysisData, selectedAgents),
      results: {},
      status: "processing",
      startedAt: new Date(),
    };

    state.tasks.push(taskRecord);
    renderTasksTable();
    addProgressRow(optimisticId, company, taskRecord.agent);

    pushLog(
      "info",
      "Analysis dispatched",
      `${selectedAgents.length} agent${selectedAgents.length === 1 ? "" : "s"} started for ${company}`,
      new Date()
    );

    try {
      const result = await submitAnalysis(payloadToSend);

      taskRecord.id = result.taskId;

      if (state.progressRows) {
        const pr = state.progressRows.find(r => r.id === optimisticId);
        if (pr) pr.id = result.taskId;
      }

      renderTasksTable();
      renderProgressList();
      toast(`Task ${result.taskId.slice(-6)} dispatched`, "success");
      pollTask(result.taskId, company, taskRecord);
    } catch (err) {
      pushLog("warn", "Backend unreachable", `${err.message} — running demo simulation`, new Date());
      toast("Backend unreachable — running demo simulation", "error");
      simulateAnalysis(company, taskRecord);
    } finally {
      btn.disabled = false;
      btn.querySelector(".btn-label").textContent = originalLabel;
      input.value = "";
    }
  });

  if (closeBtn) {
    closeBtn.addEventListener("click", closeTaskModal);
  }

  taskModal?.querySelector(".modal-overlay")?.addEventListener("click", closeTaskModal);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && taskModal && !taskModal.hidden) {
      closeTaskModal();
    }
  });

  if (tasksTableBody) {
    tasksTableBody.addEventListener("click", (e) => {
      const row = e.target.closest(".task-row");
      if (row) {
        openTaskModal(row.dataset.taskId);
      }
    });
  }

  document.getElementById("logFilter")?.addEventListener("change", renderLogs);
}

/* =====================================================
   TOAST
   ===================================================== */
let toastTimer;
function toast(msg, kind = "info") {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.className = "toast show " + (kind === "error" ? "toast-error" :
                                  kind === "success" ? "toast-success" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

/* =====================================================
   BOOT
   ===================================================== */
document.addEventListener("DOMContentLoaded", () => {
  seed();
  renderTasksTable();
  renderProgressList();
  renderLogs();
  initCharts();
  bindForm();

  // Friendly handshake — try to ping backend silently
  fetch(`${API_BASE}/`).then(r => {
    if (r.ok) pushLog("info", "Backend online",
      `Connected to ${API_BASE}`, new Date());
  }).catch(() => {
    pushLog("warn", "Backend offline",
      `Could not reach ${API_BASE} — demo mode will be used`, new Date());
  });
});
