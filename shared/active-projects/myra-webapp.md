# MYRA Webapp — Active Project

**Owner:** Shubham (development), Vatsal (strategy)
**Status:** Near-complete MVP — most features functional, two critical blockers

## File locations

- Local: C:\Users\ACER\OneDrive\MYRA\06. Platform Development\
- Specs: C:\Users\ACER\OneDrive\MYRA\02. Platform Specifications\
- Google Drive: vatsal@myrawellness.in
- GitHub: github.com/vb9816/myra-platform (private, Shubham manages)

## Tech stack (confirmed from codebase)

| Layer | Technology | Version |
|---|---|---|
| Frontend framework | Next.js (App Router, TypeScript) | 16.0.6 |
| UI library | React | 19.2.0 |
| Component system | Shadcn UI + Radix UI | Latest |
| Styling | Tailwind CSS | 3.4.18 |
| Animation | Framer Motion | 12.23.24 |
| Charts | Recharts | 3.5.1 |
| Forms | React Hook Form + Zod | 7.67.0 / 4.1.13 |
| Backend | Next.js API Routes + Firebase Cloud Functions | Node.js 18 |
| Database | Firebase Firestore | asia-south1 |
| Auth | Firebase Auth (Google Sign-In) | 12.6.0 |
| Voice/Video calling | Agora RTC SDK | 4.24.1 |
| Agora React hooks | agora-rtc-react | 2.5.0 |
| Payment gateway | Razorpay | 2.9.6 |
| Hosting | Firebase Hosting | asia-south1 |
| Firebase project ID | myra-5510f | — |

## What's built and working

- User authentication (Google Sign-In)
- Coach marketplace browsing and filtering (13 pages)
- Coach profiles with ratings and reviews
- User dashboard with session history
- Coach dashboard with online/offline status toggle
- Wallet system with balance management
- Welcome bonus system (₹1000 India, $10 international)
- Razorpay payment integration (INR + USD)
- Firestore database with RBAC-based security rules
- Coach application onboarding flow
- Admin portal (coach management, disputes, analytics)
- Review system for sessions
- Safety flags and dispute management
- Multi-currency support
- Agora voice calling (token generation, call room, mic controls, per-minute billing)

## Critical blockers

### 1. Agora Cloud Recording — MAJOR BLOCKER
- Voice calling works (token generation, call room, controls all functional)
- Cloud recording is STUBBED — returns mock data in dev mode
- Recording API endpoints commented out in /src/lib/agora.ts (lines 24-75)
- Needs: real Agora recording endpoint integration, AGORA_APP_CERTIFICATE env var
- Production mode requires external recording server

### 2. Build error — ReviewList.tsx
- Syntax error at line 55 (missing semicolon after JSX closing tag)
- File: /src/components/reviews/ReviewList.tsx
- Prevents production builds
- Quick fix once identified

## Architecture notes

- 3-role system: User, Coach, Admin
- User flow: Browse → Book → Pay → Call → Review
- Coach flow: Apply → Approved → Schedule → Take Calls → Earn
- Firestore collections: users, coaches, coach_applications, reviews, sessions, disputes, safety_flags
- Payment deduction: automatic from wallet/welcome bonus on call end, with subsidy tracking

## Key documents (OneDrive, need local sync to read content)

- MYRA_Product_Requirements_Document_Feb2026.docx
- MYRA Dev Summary_MVP_v1.docx
- MYRA - Product Experience.docx
- MYRA first contact form.docx
- SITE_MAP.md (in GitHub repo — full navigation flow diagram)
- ENV_VARIABLES_TEMPLATE.md (in GitHub repo — all required env vars)
