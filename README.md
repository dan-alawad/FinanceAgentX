# FinanceAgentX

**Intelligent Financial Automation System Using Multi-Agent Architecture & Machine Learning**

A full-stack multi-agent platform that automates corporate financial analysis across five domains — Invoice Processing, Budget Analysis, Transaction Reconciliation, Credit Risk Assessment, and Cash Flow Forecasting. Each domain is handled by an autonomous AI agent backed by pre-trained machine learning models, communicating asynchronously through RabbitMQ message queues.

> **Capstone Project — Software Engineering Department**
> İstinye University, 2026
> **Authors:** Dan Alawad & Malak Mohammad
> **Supervisor:** Dr. Hüsamettin Osmanoğlu

---

## Architecture

```
Frontend (Browser)  →  REST API (Express.js)  →  RabbitMQ Message Broker
                                                        │
                              ┌──────────────────────────┼──────────────────────────┐
                              │             │            │            │              │
                        Invoice Agent  Budget Agent  Recon Agent  Credit Agent  Cash Agent
                              │             │            │            │              │
                        Python ML      Python ML    Python ML    Python ML     Python ML
                        (3 models)     (3 models)   (3 models)   (3 models)    (3 models)
                              │             │            │            │              │
                              └──────────────────────────┼──────────────────────────┘
                                                        │
                                                  Results Queue  →  SQLite Database
                                                        │
                                              Frontend (real-time polling)
```

## Technology Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | HTML5, CSS3, Vanilla JavaScript, Chart.js 4.4 |
| **Backend** | Node.js, Express.js 5 |
| **Message Broker** | RabbitMQ (via amqplib) |
| **Database** | SQLite 3 |
| **API Documentation** | Swagger / OpenAPI 3.0 |
| **ML Training** | Python 3, scikit-learn, XGBoost, pandas, numpy |
| **ML Inference** | Python scripts invoked via child_process |

## Features

- **5 autonomous AI agents** processing financial data in parallel
- **15 ML sub-models** (3 per agent) trained with synthetic data and 3-way algorithm comparison
- **RabbitMQ message queues** for asynchronous, decoupled agent communication
- **Selective agent dispatch** — run all 5 agents or pick a subset
- **Real-time dashboard** with live progress tracking, charts, and logs
- **Rule-based fallback** — agents degrade gracefully if ML models fail
- **Swagger API documentation** at `/api-docs`
- **SQLite persistence** for tasks and agent results
- **Demo/offline mode** — frontend works without the backend running

## ML Models — What Each Agent Predicts

| Agent | Prediction Targets |
|-------|-------------------|
| **Invoice** | invoiceAmount ($), paymentStatus (approved/pending/rejected), duplicateCheck (T/F) |
| **Budget** | totalBudget ($), remainingBudget ($), approvedDepartments (count) |
| **Reconciliation** | matchedTransactions, unmatchedTransactions, reconciliationStatus |
| **Credit** | creditScore (300–850), riskLevel (low/moderate/high), loanEligibility |
| **Cash** | availableCash ($), monthlyExpenses ($), cashFlowStatus (stable/tight/critical) |

Each target is trained with **Linear/Logistic Regression, Random Forest, and XGBoost**. The best-performing model (by R² or accuracy) is automatically saved for production inference.

## Prerequisites

- **Node.js** v18+
- **Python** 3.9+
- **RabbitMQ** server running locally (default: `amqp://localhost`)

## Installation

```bash
# 1. Clone the repository
git clone <repository-url>
cd FinanceAgentX

# 2. Install Node.js dependencies
npm install

# 3. Install Python dependencies
pip install -r requirements.txt
```

## Training the ML Models (One-Time Setup)

Each agent has its own ML pipeline. Run these once before starting the server:

```bash
# Generate synthetic datasets and train models for all 5 agents
cd invoice_agent_model && python generate_dataset.py && python train_model.py && cd ..
cd budget_agent_model && python generate_dataset.py && python train_model.py && cd ..
cd reconciliation_agent_model && python generate_dataset.py && python train_model.py && cd ..
cd credit_agent_model && python generate_dataset.py && python train_model.py && cd ..
cd cash_agent_model && python generate_dataset.py && python train_model.py && cd ..
```

This generates 2,000 synthetic samples per agent and saves trained models to `saved_models/`.

## Running the Application

```bash
# Make sure RabbitMQ is running first, then:
npm start
```

- **Dashboard:** http://localhost:5000
- **API Docs:** http://localhost:5000/api-docs
- **Health Check:** http://localhost:5000/health

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/analyze` | Submit a financial analysis task |
| `GET` | `/status/:id` | Get task status and agent results |
| `GET` | `/tasks` | Get recent task history |
| `GET` | `/health` | Server health check |
| `GET` | `/api-docs` | Interactive Swagger documentation |

## Running Tests

```bash
npm test
```

## Project Structure

```
FinanceAgentX/
├── server.js                    # Express API server & orchestrator
├── database.js                  # SQLite connection & schema
├── rabbitmq.js                  # RabbitMQ connection factory
├── package.json                 # Node.js dependencies
├── requirements.txt             # Python dependencies
│
├── agents/                      # Node.js agent workers
│   ├── invoiceAgent.js
│   ├── budgetAgent.js
│   ├── reconciliationAgent.js
│   ├── creditAgent.js
│   └── cashAgent.js
│
├── invoice_agent_model/         # ML pipeline for Invoice Agent
│   ├── generate_dataset.py      #   Synthetic data generation
│   ├── train_model.py           #   Model training & comparison
│   ├── inference.py             #   Production inference script
│   ├── data/                    #   Generated training data
│   └── saved_models/            #   Trained model artifacts (.joblib)
│
├── budget_agent_model/          # ML pipeline for Budget Agent
├── reconciliation_agent_model/  # ML pipeline for Reconciliation Agent
├── credit_agent_model/          # ML pipeline for Credit Agent
├── cash_agent_model/            # ML pipeline for Cash Agent
│
├── tests/                       # API & integration tests
│   └── api.test.js
│
└── frontend/                    # Dashboard UI
    ├── index.html
    ├── style.css
    └── scripts.js
```

## License

ISC