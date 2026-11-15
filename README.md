# Ask CARE — Cathay Pacific Accessibility & Travel Assistant

**Ask CARE** is an AI-powered accessibility and travel assistance web application built for Cathay Pacific passengers. It combines a conversational AI specialist with a guided accessibility questionnaire, a personalized curb-to-cabin journey timeline, and interactive pre-flight preparation tasks.

---

## Key Features

- **Ask CARE AI Chat (`/`)**  
  Conversational travel and accessibility specialist powered by Google Cloud Customer Engagement Suite (CES / CX Agent Studio). Grounded in official Cathay Pacific and Hong Kong International Airport (HKIA) accessibility policies, supporting rich Markdown responses, interactive quick-reply options, and direct navigation to the questionnaire and trip plan.

- **Accessibility Needs Questionnaire (`/survey.html`)**  
  Guided conversational assessment that walks passengers through accessibility need groups (Mobility, Visual, Hearing, Cognitive/Neurodivergent, Medical, etc.), matches available Cathay Pacific and airport-specific services across each leg of their itinerary, assigns SSR tags/codes, and persists selections to Cloud SQL.

- **Personalized Assistance Plan (`/plan.html`)**  
  Generates a tailored step-by-step travel timeline (*Before you fly*, *At departure*, *On board*, *In transit*, and *On arrival*) based on the passenger's booking and submitted questionnaire responses, complete with progress filters and a Customer Care call brief.

---

## Project Structure

```text
├── Backend/
│   ├── main.py             # FastAPI server, CES chat handler, MCP tools, survey & catalog APIs
│   ├── catalog.py          # Cloud SQL PostgreSQL catalog schema & live data fetcher
│   ├── import_catalog.py   # Workbook importer for initializing catalog tables
│   ├── task_replies.py     # API router & schema for saving passenger task form responses
│   ├── knowledge.py        # pgvector policy chunk schema & similarity search
│   └── test_ces.py         # Unit tests for CES session handling & retry logic
├── Frontend/
│   ├── index.html          # Ask CARE main chat interface
│   ├── main.js             # Chat UI logic, option parsing, and session state
│   ├── style.css           # Shared phone-frame shell & chat styling
│   ├── questionnaire.html  # Accessibility Needs Questionnaire view
│   ├── questionnaire.js    # Multi-step survey engine, leg matching, and tag assignment
│   ├── questionnaire.css   # Questionnaire styling
│   ├── plan.html           # Personalized Assistance Plan timeline view
│   ├── plan-build.js       # Journey timeline & task generation engine
│   ├── plan-data.js        # Offline fallback catalog snapshot
│   ├── plan.css            # Assistance plan styling
│   ├── demo-login.html     # Demo passenger profile selector
│   └── passenger-context.js# Shared passenger ID & session state helper
├── Dockerfile              # Container image definition for Google Cloud Run
└── requirements.txt        # Python dependencies
```

---

## Configuration

Create a `.env` file in the project root with your Google Cloud CES and PostgreSQL / Cloud SQL settings:

```env
CES_PROJECT=your-gcp-project-id
CES_LOCATION=us
CES_APP_ID=your-ces-app-id
CES_VERSION_ID=your-ces-version-id
CES_DEPLOYMENT_ID=your-ces-deployment-id

# Database connection (via DATABASE_URL or Cloud SQL Python Connector)
CLOUDSQL_INSTANCE=your-project:your-region:your-instance
DB_USER=postgres
DB_PASSWORD=your-db-password
DB_NAME=cathay
```

---

## Running Locally

1. **Install dependencies**:
   ```bash
   python3 -m venv .venv
   .venv/bin/pip install -r requirements.txt
   ```

2. **Start the FastAPI server** from the repository root:
   ```bash
   .venv/bin/uvicorn main:app --app-dir Backend --host 127.0.0.1 --port 8000
   ```

3. **Open in browser**:
   - Main Assistant: `http://127.0.0.1:8000`
   - Demo Passenger Selector: `http://127.0.0.1:8000/demo-login.html`
   - Accessibility Questionnaire: `http://127.0.0.1:8000/survey.html`
   - Personalized Assistance Plan: `http://127.0.0.1:8000/plan.html`

---

## Running Tests

```bash
PYTHONPATH=Backend python3 -m unittest discover -s Backend -p "test_*.py"
```
