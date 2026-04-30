# FORGE — Implementation Plan

**Framework for Optimized Response Generation & Execution**

A tool for responding to government and commercial procurement solicitations: RFPs, RFIs, RFQs, and Sources Sought notices.

---

## 1. Domain Analysis

Government and commercial procurement response is high-stakes and deadline-driven:

- A single RFP response can be 200–500 pages across multiple volumes (Technical, Management, Past Performance, Cost/Price).
- Solicitations arrive in inconsistent formats: PDF scans, Word docs, web portal extracts, spreadsheet compliance matrices.
- Section L (Instructions to Offerors) and Section M (Evaluation Criteria) of a federal solicitation are the two most critical artifacts.
- Page limits, font requirements, and formatting constraints are pass/fail compliance gates.
- Past performance requires factually accurate CPARS references, contract numbers, and contact info.
- Pricing volumes vary by contract type (FFP, T&M, Cost-Plus) with labor categories, rates, ODCs, travel, fees.
- The Pink Team / Red Team / Gold Team review cycle is the industry-standard workflow.
- Proposals reuse 60–70% of prior content, but must be adapted, not copy-pasted.

---

## 2. Tech Stack

### Frontend
| Tech | Why |
|---|---|
| **Next.js 14+ (App Router)** | SSR, React Server Components, built-in API routes, TypeScript support |
| **TypeScript** | Type safety across the proposal data model |
| **Tailwind CSS + shadcn/ui** | Rapid UI with accessible primitives |
| **TipTap (ProseMirror)** | Rich text editor with real-time collab (Y.js), track changes, comments |
| **Zustand** | Lightweight state management |

### Backend
| Tech | Why |
|---|---|
| **Next.js API Routes + tRPC** | Type-safe API, shared types FE/BE |
| **Node.js 20+** | Unified language, strong doc-processing ecosystem |
| **BullMQ (Redis)** | Job queue for doc ingestion, AI generation, PDF export |
| **Socket.io / Liveblocks** | Real-time collab, presence awareness |

### Database & Storage
| Tech | Why |
|---|---|
| **PostgreSQL 16** | Relational integrity; JSONB for flexible metadata |
| **pgvector** | Vector similarity search over knowledge base |
| **Redis** | Sessions, cache, job queue, pub/sub |
| **S3 / MinIO** | Object storage for uploaded docs and generated outputs |

### AI & Document Processing
| Tech | Why |
|---|---|
| **Anthropic Claude API** | Sonnet for high-volume; Opus for high-stakes generation |
| **pdf-parse, pdf-lib** | PDF read/write |
| **mammoth.js** | DOCX parsing |
| **docx** | DOCX generation with formatting control |
| **Puppeteer** | HTML-to-PDF with exact formatting |
| **Tesseract.js** | OCR for scanned PDFs |

### Infrastructure
| Tech | Why |
|---|---|
| **Docker + Docker Compose** | Local dev parity, simple deploy |
| **Prisma** | Type-safe ORM with pgvector support |
| **NextAuth.js v5** | Auth + SSO/SAML support |
| **Zod** | Runtime validation paired with tRPC |

**Why not a separate backend (NestJS/FastAPI)?** Start monolithic with a Next.js + tRPC app; heavy processing (ingestion, AI, export) runs in BullMQ workers that can be extracted as services later.

---

## 3. Architecture

```
PRESENTATION
  Dashboard | Solicitation Analyzer | Proposal Editor
  Knowledge Base | Compliance Tracker | Export & Formatting
         ↓ tRPC + WebSocket ↓
API / SERVICE LAYER
  Solicitation | Proposal | Knowledge Base | Compliance
  AI Engine | Export | Auth & Permissions | Collaboration
         ↓
ASYNC WORKERS (BullMQ)
  Doc Ingestion | AI Generation | Embeddings | Export
         ↓
DATA LAYER
  PostgreSQL + pgvector | Redis | S3 / MinIO
         ↓
EXTERNAL INTEGRATIONS
  Claude API | SAM.gov | GovWin | FPDS | CPARS
```

---

## 4. Database Schema (Prisma)

### Entity Map

```
Organization ─┬── User
              ├── OrganizationCapability
              ├── Certification
              ├── PastPerformance
              ├── PersonnelProfile
              ├── BoilerplateSection
              └── Solicitation ──┬── SolicitationDocument
                                 ├── Requirement
                                 ├── EvaluationCriterion
                                 └── Proposal ──┬── Volume
                                                ├── Section
                                                ├── SectionVersion
                                                ├── ComplianceItem
                                                ├── ReviewCycle
                                                ├── ReviewComment
                                                └── ProposalExport
```

### Core Tables (abbreviated)

**Organization** — CAGE code, DUNS/UEI, SAM registration, NAICS codes, set-aside status, clearances.

**User** — Role-based (ADMIN, CAPTURE_MANAGER, PROPOSAL_MANAGER, AUTHOR, REVIEWER, PRICING_ANALYST, VIEWER).

**Solicitation** — Solicitation number, type (RFP/RFI/RFQ/SOURCES_SOUGHT), agency, NAICS, set-aside, contract type, deadlines, Section L/M raw text, parsed eval factors, page requirements, bid decision.

**SolicitationDocument** — Uploaded files, parsed content, document type (SOW/PWS/SECTION_L/SECTION_M/AMENDMENT/ATTACHMENT).

**Requirement** — Reference ID (e.g., "L.5.2.1"), source text, category, MANDATORY/DESIRED/INFORMATIONAL, link to eval criterion, embedding.

**EvaluationCriterion** — Factor/subfactor hierarchy with relative importance.

**Proposal** — Status through workflow (PLANNING → OUTLINING → DRAFTING → PINK_TEAM → REVISING → RED_TEAM → GOLD_TEAM → FINAL_REVIEW → PRODUCTION → SUBMITTED), internal deadlines per review gate.

**Volume** — Number, type (TECHNICAL/MANAGEMENT/PAST_PERFORMANCE/COST_PRICE/etc.), max pages, font, margin requirements.

**Section** — Number, title, assigned user, ProseMirror JSON content, word count, page estimate, AI-generated percentage.

**SectionVersion** — Full version history: content, change description, changedByUserId, changeType (MANUAL_EDIT/AI_GENERATION/AI_REVISION/REVIEW_UPDATE), diff.

**ComplianceItem** — Links requirement → section → status (NOT_ADDRESSED/PARTIALLY/FULLY/VERIFIED/NON_COMPLIANT/N/A), response location, verifier.

**ReviewCycle & ReviewComment** — Pink/Red/Gold team cycles, anchored comments with severity (CRITICAL/MAJOR/MINOR/SUGGESTION).

**AuditEntry** — Every AI generation and human edit, with model used, prompt hash, tokens consumed, confidence.

**Knowledge Base**: `OrganizationCapability`, `PastPerformance`, `PersonnelProfile`, `BoilerplateSection` — each with pgvector embeddings for semantic retrieval.

Full Prisma schema to be created at `packages/db/prisma/schema.prisma`.

---

## 5. API Design (tRPC Routers)

```
solicitation.*   → create, list, getById, uploadDocument, triggerParse,
                   extractRequirements, extractEvalCriteria, updateBidDecision,
                   getTimeline

proposal.*       → create, list, getById, updateStatus, createVolume,
                   createSection, updateSection, assignSection,
                   getSectionHistory, restoreVersion, getProgress

ai.*             → generateDraft, reviseDraft, generateExecutiveSummary,
                   generateComplianceMatrix, analyzeStrengths,
                   suggestImprovements, streamGeneration, getGenerationStatus

compliance.*     → getMatrix, updateItem, runCheck, getGapAnalysis, exportMatrix

knowledgeBase.*  → capabilities, pastPerformance, personnel, boilerplate (CRUD);
                   search (semantic), importFromProposal

review.*         → createCycle, startCycle, addComment, resolveComment,
                   completeCycle, getCommentsBySection

export.*         → generatePdf, generateDocx, getFormatCheck,
                   getExportHistory, downloadExport

collaboration.*  → getPresence, getSectionLock, acquireLock, releaseLock
```

---

## 6. Directory Structure

```
FORGE/
├── package.json
├── pnpm-workspace.yaml           # Monorepo
├── turbo.json                    # Build orchestration
├── docker-compose.yml            # Postgres+pgvector, Redis, MinIO
├── .env.example
│
├── packages/
│   ├── db/                       # Prisma schema, migrations, client
│   ├── shared/                   # Types, constants, Zod validators, utils
│   └── ai/                       # Claude client, prompts, RAG pipeline
│       └── src/
│           ├── prompts/          # requirement-extraction, section-generation,
│           │                       compliance-check, revision, etc.
│           ├── chains/           # ingest, generate, review chains
│           └── rag/              # embeddings, retriever, context-builder
│
├── apps/web/                     # Next.js app
│   └── src/
│       ├── app/                  # App router pages
│       │   ├── solicitations/[id]/...
│       │   ├── proposals/[id]/editor/[sectionId]/
│       │   ├── proposals/[id]/compliance/
│       │   ├── proposals/[id]/review/
│       │   ├── proposals/[id]/export/
│       │   ├── knowledge-base/...
│       │   └── settings/
│       ├── server/               # tRPC routers
│       ├── services/             # Business logic
│       ├── workers/              # BullMQ workers
│       ├── components/           # editor, solicitation, proposal,
│       │                           compliance, review, knowledge-base, dashboard
│       ├── hooks/
│       └── lib/                  # trpc, storage, auth, redis clients
│
├── workers/                      # Standalone worker processes
└── docs/                         # architecture, api-reference, deployment
```

---

## 7. AI Engine — RAG Pipeline

```
User: "Generate Draft" for Section 3.2
   ↓
1. GATHER CONTEXT
   • Section requirements  • Eval criteria
   • Volume outline        • Adjacent sections
   ↓
2. RETRIEVE KNOWLEDGE (pgvector)
   • Past proposals  • Past performance refs
   • Boilerplate     • Personnel (for staffing)
   ↓
3. BUILD PROMPT
   • System: role + writing rules
   • Context: requirements + eval criteria
   • Knowledge: RAG-retrieved content
   • Instruction: section-type specific
   ↓
4. GENERATE (Claude API, streamed to editor)
   ↓
5. POST-PROCESS
   • Format output  • Compliance quick-check
   • Log audit entry • Create section version
```

**Key prompt templates**:
- Requirement Extraction (parse "shall" vs "should" vs "may")
- Section Generation (reqs + eval + RAG + win themes + format)
- Compliance Check (section content vs assigned requirements)
- Red Team (evaluate as a government evaluator)

**Token budget**: chunk intelligently by clause, retrieve only top-K relevant KB entries, cache embeddings and parsed docs.

---

## 8. Phased Rollout

### Phase 1 — Foundation (Weeks 1–4)
Monorepo, Docker Compose, Prisma schema (Org/User/Solicitation/Document), NextAuth, doc upload to MinIO, ingestion worker (PDF/DOCX/OCR), dashboard + solicitation list.

### Phase 2 — AI Analysis (Weeks 5–8)
Claude integration, requirement extraction, evaluation criteria extraction, embedding pipeline, requirements UI, deadline tracking.

### Phase 3 — Knowledge Base (Weeks 9–12)
Full CRUD for capabilities/past performance/personnel/boilerplate, bulk import, semantic search, resume parsing.

### Phase 4 — Proposals & AI Generation (Weeks 13–20)
Proposal creation, volume/section structure, assignments, TipTap editor, AI generation panel (draft/revise/expand/condense with streaming), versioning with diffs, audit trail, progress dashboard.

### Phase 5 — Compliance Engine (Weeks 21–24)
Compliance matrix auto-gen, AI compliance verification, gap analysis, matrix export.

### Phase 6 — Review & Collaboration (Weeks 25–30)
Y.js real-time collab, presence, section locking, Pink/Red/Gold cycles, anchored comments, AI-assisted red team, notifications.

### Phase 7 — Export & Production (Weeks 31–34)
Puppeteer PDF (fonts/margins/TOC/headers), DOCX export, format compliance checker (page count, font, margins), full proposal ZIP.

### Phase 8 — Advanced (Weeks 35–40)
Win/loss tracking, SAM.gov integration, pricing volume support, template library, analytics, SSO/SAML, fine-grained permissions.

---

## 9. Critical Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Monolith vs microservices | **Modular monolith** with extractable workers | Faster early iteration; workers already decoupled via BullMQ |
| Document storage | **ProseMirror JSON in Postgres**, originals in S3 | Queryable, supports collab editing and track changes |
| AI audit granularity | **Every generation logged** with prompt hash, model, tokens | Govt scrutiny may require "was this AI-generated" answers |
| Embedding strategy | **At write-time**, pgvector for retrieval | Sub-100ms vector search, no separate vector DB |
| Real-time collab | **Y.js CRDT** with section-level granularity | Concurrent edits without central coord; limit blast radius |
| Pricing volumes | **Deferred to Phase 8** | Separate product concern; allow attachment uploads meanwhile |

---

## 10. Security

- **Encryption** at rest (Postgres TDE, S3 SSE) and in transit (TLS, WSS)
- **Organization isolation** enforced via Prisma middleware — never rely on developers to remember the filter
- **PostgreSQL Row-Level Security** as defense-in-depth
- **API keys** in secrets manager, never in code
- **Audit logging** for all access, not just mutations
- **Session management** with short-lived tokens and refresh
- **Input sanitization** — ProseMirror schema enforces allowed content

---

## 11. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Claude rate limits at crunch time | HIGH | Request queuing, prioritization, caching |
| Parsing accuracy | HIGH | Human-in-the-loop verification, manual override |
| Page estimation inaccuracy | MED | Calibration tool: render to PDF, compare estimated vs actual |
| Pricing scope creep | HIGH | Hard Phase-8 boundary, no calculation features before then |
| Large-proposal performance | MED | Paginate, lazy-load, background jobs for heavy queries |
| Schema evolution | MED | Religious Prisma migrations; JSONB for genuinely flexible data |

---

## 12. Critical Files (order of creation)

1. **`packages/db/prisma/schema.prisma`** — schema ripples through the entire system
2. **`packages/ai/src/prompts/section-generation.ts`** — core value proposition
3. **`apps/web/src/server/router.ts`** — defines API surface area
4. **`apps/web/src/components/editor/ProposalEditor.tsx`** — where users spend 80% of their time
5. **`docker-compose.yml`** — consistent local environment from day one

---

## Next Step

On approval of this plan, Phase 1 begins with scaffolding the monorepo, Docker Compose, and the initial Prisma schema.
