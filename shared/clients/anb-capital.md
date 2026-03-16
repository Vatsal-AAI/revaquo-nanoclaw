# ANB Capital — CONFIDENTIAL

**Contact:** Sanjay
**Engagement:** Aashish Intelligence — Fund Reporting Tool
**Status:** Active — Phase 1 MVP in development
**Local files:** C:\Users\ACER\OneDrive\Aashish\01. B2B Consulting Products\1. Fund Reporting Tool\
**GitHub:** github.com/Vatsal-AAI/fund-reporting-tool (private)

## Engagement overview

Building an automated fund reporting platform for investment fund reports targeting Saudi REIT structures. B2B SaaS product.

## Client details (from codebase)

- **Scale:** 25 REIT funds, SAR 18.4B in real estate AUM
- **Regulatory context:** Capital Market Authority (CMA, Saudi regulator) compliance required
- **Target accuracy:** 80% accurate report generation
- **Contract signed:** March 10, 2026
- **Phase 1 MVP deadline:** April 30, 2026

## Tech stack (from codebase)

- Frontend: Next.js 14.2.3, React 18, TypeScript, Tailwind, Recharts
- Backend: FastAPI (Python 3.11+), Uvicorn
- Database: Supabase (PostgreSQL + Auth + Storage), 20 tables
- AI: Claude API (Sonnet + Opus model routing), ~$0.43/report
- Storage: Cloudflare R2 (S3-compatible)
- Deployment: Vercel (frontend), Railway (backend), Supabase Cloud

## Current status (from codebase audit, as of March 2026)

**Built:** 13 frontend pages, 70+ API endpoints, 19 backend services, AI extraction pipeline, report generation (PDF/DOCX/PPTX), validation engine, analytics dashboard, benchmarking, health scoring

**Pending:** Multi-agent pipeline (5 agents stubbed, not orchestrated), batch processing, email notifications, org-scoped RLS, CI/CD pipeline

**Critical issues:**
- Sign-up/sign-in flow broken
- Exposed security endpoints need lockdown
- Demo data hardcoded in places
- RLS policies too broad for production

## 3-phase roadmap

- Phase 1 (MVP): Mar 10 – Apr 30, 2026
- Phase 2 (Hardening): May – Jun 30, 2026
- Phase 3 (Scale): Jul – Sep 30, 2026

## Access

Vatsal and Shubham only. No MYRA agents. No other team members.
