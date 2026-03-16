# Platform Registry — All Revaquo Infrastructure

## Full platform list

| Platform | Account | Venture | Monitor for | Confirmed from |
|---|---|---|---|---|
| Firebase | vatsal.bass14@gmail.com | MYRA | Usage, billing, errors | Codebase (myra-5510f) |
| GCP | vatsal.bass14@gmail.com | MYRA + AAI | Credits, compute, billing | Codebase |
| Supabase | tkmciskgptkqdzvvmoko.supabase.co | AAI (FRT) | DB usage, billing, RLS | FRT codebase |
| Vercel | fund-reporting-tool-aai-v1.vercel.app | AAI (FRT) | Deployment status, build | FRT codebase |
| Railway | fund-reporter-backend-production.up.railway.app | AAI (FRT) | Service health, billing | FRT codebase |
| Render | myra-pm.onrender.com | MYRA (PM dashboard) | Service health | MYRA PM codebase |
| Cloudflare R2 | [ASK VATSAL — account ID] | AAI (FRT) | Storage usage, billing | FRT codebase |
| Razorpay | [ASK VATSAL — account ID] | MYRA | Payment processing, disputes | MYRA codebase |
| MYRA Google Drive | vatsal@myrawellness.in | MYRA | Storage, sharing | Setup |
| AAI Google Drive | vatsal@aashishintelligence.com | AAI | Storage, sharing | Setup |
| Cloudflare DNS | [ASK VATSAL] | Both | DNS, security alerts | — |
| Canva Pro | [ASK VATSAL] | Both | Usage | — |
| Claude Team | Team plan | Both | Usage allocation | — |
| Claude API | [ASK VATSAL — API key account] | AAI (FRT) | ~$0.43/report, model routing | FRT codebase |
| MS OneDrive | Personal | All | Storage | — |
| GitHub (personal) | vb9816 | MYRA | Repo activity | Auth confirmed |
| GitHub (AAI) | Vatsal-AAI | AAI | Repo activity | Auth confirmed |
| Agora | [ASK VATSAL — App ID in env] | MYRA | Calling usage, recording | MYRA codebase |

## Alert thresholds

- GCP: below $50 credits or above $30/month spend → immediate alert
- Firebase: any unexpected billing spike → immediate alert
- Claude API: above ₹200/day or ₹3,000 by 20th of month → immediate alert
- Supabase: monitor free tier limits (FRT) → alert at 80% usage
- Railway: monitor compute hours and billing → alert on spike
- Vercel: monitor build minutes and bandwidth → alert on spike
- Any security event on any platform → immediate WhatsApp to Vatsal AND Shubham
