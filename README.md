# EPI Coverage

ระบบติดตามและวิเคราะห์ความครอบคลุมการได้รับวัคซีนเด็ก สำหรับสนับสนุนการดำเนินงานระดับพื้นที่และสำนักงานสาธารณสุขอำเภอ

EPI Coverage แสดงผลข้อมูลรายบุคคลจากแหล่งข้อมูล EPI ที่นำเข้า ส่วนข้อมูลสถิติรวมจาก MOPH/HDC OpenData ยังคงจัดเก็บใน Backend cache แยกต่างหากและไม่มีหน้าแสดงผล OpenData บน Frontend

---

## Overview

ระบบสนับสนุนงานหลัก ได้แก่:

* ติดตามการได้รับวัคซีนรายบุคคล;
* แสดงผล Fully Immunized ตามข้อมูล HDC ที่นำเข้า;
* จัดเก็บข้อมูลสถิติรวมจาก MOPH/HDC OpenData ใน Backend cache เพื่อใช้กับงานข้อมูลที่แยกต่างหาก;
* นำเข้าข้อมูล EPI ตามกลุ่มอายุ;
* จัดการหน่วยบริการและผู้ใช้งาน;
* จัดการเกณฑ์วัคซีนแบบ configurable;
* ตรวจสอบคุณภาพวันที่วัคซีน;
* ส่งออกข้อมูลสำหรับการติดตามในพื้นที่;
* บันทึกกิจกรรมที่สำคัญเพื่อการตรวจสอบย้อนหลัง.

---

## Reporting Views

หน้า EPI Tracking ของแต่ละกลุ่มอายุแสดงข้อมูลรายบุคคลสองมุมมอง

### View 1 — Individual Vaccine Follow-up

ใช้ข้อมูลรายบุคคลที่นำเข้าเพื่อสนับสนุนการติดตามวัคซีนตามช่วงอายุและเกณฑ์ที่ระบบกำหนด

### View 2 — Individual Fully Immunized

ใช้ข้อมูลรายบุคคลที่นำเข้า โดยผล Fully Immunized ที่แสดงในพฤติกรรมปัจจุบันยึดตามค่า `result` จาก HDC ที่นำเข้า

ข้อมูล MOPH/HDC OpenData เป็นข้อมูลรวม (aggregate) ที่ยังคงซิงค์และจัดเก็บใน Backend cache โดยไม่มี View 3 บนหน้า EPI Tracking หรือ Frontend OpenData dashboard

รายละเอียด business behavior ที่เป็น canonical source ดูที่ `docs/features.md`

---

## Architecture

สถาปัตยกรรมหลักของระบบ:

```text
Browser
  |
  v
React + TypeScript
  |
  v
Google Apps Script
  |
  +--> Google Sheets
  |
  +--> MOPH/HDC OpenData
```

องค์ประกอบหลัก:

* **Frontend:** React SPA + TypeScript + Vite
* **Backend/API:** Google Apps Script
* **Persistence:** Google Sheets
* **Authentication:** Google OAuth
* **External aggregate data:** MOPH/HDC OpenData ผ่าน backend proxy

รายละเอียดและข้อจำกัดเชิงสถาปัตยกรรมดูที่ `docs/spec.md` และ `docs/adr/`

---

## Technology Stack

### Frontend

* React
* TypeScript
* Vite
* React Router
* Tailwind CSS
* Radix / Shadcn-style UI components
* TanStack Query
* TanStack Table
* TanStack Virtual
* Recharts
* React Hook Form
* Zod
* SheetJS
* jsPDF
* Vitest

### Backend

* Google Apps Script
* Google Sheets
* JavaScript / CommonJS-oriented tooling
* Google Apps Script type definitions

---

## Repository Structure

```text
epi-coverage/
├── frontend/
│   └── React application
│
├── backend/
│   ├── src/
│   └── tests/
│
├── docs/
│   ├── features.md
│   ├── schema.md
│   ├── spec.md
│   └── adr/
│
├── DESIGN.md
├── CONTEXT.md
├── CLAUDE.md
├── AGENTS.md
└── README.md
```

The frontend follows Feature-Sliced Design principles. Existing boundaries should be preserved unless a deliberate architectural change is made.

---

## Prerequisites

Local frontend development requires:

* Git
* Node.js
* npm

Use the Node.js version supported by the current project dependencies.

Do not commit credentials, tokens, private health data, or production `.env` files.

---

## Local Development

Clone the repository and enter the project directory:

```bash
git clone https://github.com/9GotStory/epi-coverage.git
cd epi-coverage
```

Install frontend dependencies:

```bash
cd frontend
npm install
```

Start the frontend development server:

```bash
npm run dev
```

For a production build:

```bash
npm run build
```

Run frontend linting:

```bash
npm run lint
```

Preview a production build locally:

```bash
npm run preview
```

---

## Backend

The backend is implemented with Google Apps Script.

Backend source is maintained under:

```text
backend/
```

The GAS application owns backend responsibilities such as:

* persistence;
* authenticated application operations;
* imports and synchronization;
* administrative behavior;
* vaccine-rule configuration;
* audit-related behavior;
* server-side external API integration.

Do not move privileged backend behavior into the browser without an explicit architectural decision.

---

## Environment and Secrets

Runtime configuration and credentials must not be hardcoded into source code.

Follow the current architecture and `.gitignore` rules for environment-specific values.

Never commit:

* OAuth secrets;
* deployment credentials;
* private tokens;
* production health records;
* real CID data;
* ignored local EPI source datasets.

Local files matching `EPI-*YEAR.json` are treated as local source data and must remain untracked unless a separately designed sanitized-data workflow explicitly permits otherwise.

---

## Data Integrity

Healthcare facility identifiers must be preserved as strings.

Values containing leading zeroes must not be converted to numbers.

For example:

```text
06422
```

must not be normalized to:

```text
6422
```

See `docs/schema.md` for the canonical data contract.

---

## Testing and Verification

The repository has automated test suites for both frontend and backend code.

### Frontend

Run the canonical frontend test suite:

```bash
cd frontend
npm test
```

For interactive development, Vitest watch mode is available:

```bash
cd frontend
npm run test:watch
```

`test:watch` is a developer convenience and is not a completion gate.

For frontend changes, the standard verification commands are:

```bash
cd frontend
npm test
npm run lint
npm run build
```

### Backend

Run the canonical backend test suite:

```bash
cd backend
npm test
```

Backend tests use Node's built-in test runner.

### End-to-End (browser, mocked auth)

E2E tests exercise post-login flows without a real Google account (Issue #93). Auth is mocked at the browser (`localStorage` seeding through the app's own boot path) and every GAS API call is intercepted with synthetic fixtures — production backend and credentials are never touched. Run them with:

```bash
cd frontend
npm run test:e2e
```

The first run needs the Playwright browser binary (`npx playwright install chromium`). Spec files live in `frontend/e2e/` and use the `.e2e.ts` suffix so Vitest does not pick them up.

### Verification Rule

Testing, linting, and building are separate checks.

A successful build does not imply that tests passed, and a successful test run does not imply that linting or the production build passed.

Do not claim a check passed unless that specific command was actually executed successfully.

---

## Documentation

EPI Coverage uses explicit documentation ownership to reduce duplicated or conflicting rules.

| Question                                       | Canonical Source   |
| ---------------------------------------------- | ------------------ |
| What does a domain term mean?                  | `CONTEXT.md`       |
| What should the system do?                     | `docs/features.md` |
| What does the data mean?                       | `docs/schema.md`   |
| How is the system architected?                 | `docs/spec.md`     |
| Why was an architecture chosen?                | `docs/adr/`        |
| How should the UI look?                        | `DESIGN.md`        |
| How must coding agents work?                   | `CLAUDE.md`        |
| How do other coding agents enter the workflow? | `AGENTS.md`        |

Do not duplicate canonical rules into several documents.

---

## Architecture Decision Records

Significant architectural decisions are recorded under:

```text
docs/adr/
```

Current accepted ADRs include:

* ADR-0001 — Google Apps Script and Google Sheets backend architecture
* ADR-0002 — separation of individual EPI data and aggregate HDC OpenData
* ADR-0003 — centralized config-driven Vaccine Rules Engine

See `docs/adr/README.md` for ADR policy and lifecycle.

---

## AI-Assisted Development

The repository supports AI-assisted engineering.

Agent entry points:

* `CLAUDE.md` — canonical project-wide agent operating contract
* `AGENTS.md` — compatibility entry point for coding agents that support `AGENTS.md`

Agents must also follow the canonical domain, architecture, data, design, and ADR documentation applicable to each change.

Project-specific engineering skills may be installed separately. Skills do not override the repository's canonical rules.

---

## Security and Privacy

EPI Coverage processes health-related information and must be developed with appropriate security and privacy discipline.

Development rules include:

* do not commit production health records;
* do not include real CID values in test fixtures;
* do not expose sensitive records through logs;
* do not hardcode credentials or secrets;
* preserve authentication and authorization boundaries;
* use synthetic or irreversibly anonymized data for automated tests;
* do not bypass `.gitignore` to commit sensitive local datasets.

Correctness, data integrity, security, and traceability take priority over implementation speed.

---

## Legacy Planning

`task.md` contains historical project planning and completed roadmap information.

It remains useful as historical context but should not become the canonical tracker for new engineering work.

New development work may progressively move to the repository's configured issue-tracking workflow.

---

## Development Principle

EPI Coverage follows a simple project principle:

**Simple — Structured — Sustainable**

Prefer the smallest coherent solution that:

* preserves documented business behavior;
* protects sensitive data;
* respects existing architectural boundaries;
* is testable;
* is maintainable;
* avoids unnecessary abstraction or infrastructure.
