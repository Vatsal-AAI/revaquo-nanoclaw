# Fund Reporting Tool — CONFIDENTIAL Active Project

**Client:** ANB Capital (Sanjay)
**Owner:** Vatsal + Shubham
**Status:** Phase 1 MVP in development (Mar 10 – Apr 30, 2026)

## File locations

- Local: C:\Users\ACER\OneDrive\Aashish\01. B2B Consulting Products\1. Fund Reporting Tool\
- Claude Code config: C:\Users\ACER\OneDrive\Aashish\01. B2B Consulting Products\.claude\ — PRESERVE ALWAYS
- Google Drive: vatsal@aashishintelligence.com
- GitHub: github.com/Vatsal-AAI/fund-reporting-tool (private)

## Overview

Automating investment fund reports for Saudi REIT structures. B2B SaaS platform for ANB Capital — 25 REIT funds, SAR 18.4B AUM, CMA regulatory compliance required.

## Tech stack (confirmed from codebase)

| Layer | Technology | Details |
|---|---|---|
| Frontend | Next.js 14.2.3 | React 18.3.1, TypeScript, App Router |
| UI/Styling | Tailwind CSS 3.4.3 | Shadcn UI components |
| Charts | Recharts | Fund analytics and visualisation |
| Backend | FastAPI (Python 3.11+) | Uvicorn, async |
| Database | Supabase | PostgreSQL + Auth + Storage, 20 tables |
| AI engine | Claude API | Sonnet + Opus model routing, ~$0.43/report |
| File storage | Cloudflare R2 | S3-compatible object storage |
| Frontend deploy | Vercel | fund-reporting-tool-aai-v1.vercel.app |
| Backend deploy | Railway | fund-reporter-backend-production.up.railway.app |
| DB hosting | Supabase Cloud | tkmciskgptkqdzvvmoko.supabase.co |

## Current status (from codebase audit, March 2026)

**Built (13 pages, 70+ API endpoints, 19 backend services):**
- AI-powered document extraction pipeline
- Report generation (PDF, DOCX, PPTX formats)
- Validation engine with data quality scoring
- Analytics dashboard with fund metrics
- Benchmarking against market indices
- Health scoring for fund portfolios
- User management and auth (Supabase)
- File upload and processing pipeline

**Pending:**
- Multi-agent pipeline (5 agents stubbed, not yet orchestrated)
- Batch processing for multiple funds
- Email notification system
- Org-scoped Row Level Security (RLS)
- CI/CD pipeline
- Production-grade error handling

**Critical issues to resolve:**
- Sign-up/sign-in flow broken
- Exposed security endpoints need lockdown
- Demo/hardcoded data in multiple places
- Demo credentials present in codebase
- RLS policies too broad for multi-tenant production

## 3-phase roadmap

- **Phase 1 (MVP):** Mar 10 – Apr 30, 2026 — core extraction, single-fund reports, basic dashboard
- **Phase 2 (Hardening):** May – Jun 30, 2026 — multi-tenant, security, batch, notifications
- **Phase 3 (Scale):** Jul – Sep 30, 2026 — multi-agent orchestration, advanced analytics, API access

## Access

Vatsal and Shubham only.
