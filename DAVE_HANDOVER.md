# DAVE 2.0 — Handover (Shubham + Vanshit)

DAVE is MYRA's engineering agent, running inside **RevaquoOS** (a NanoClaw install) on a
dedicated VPS. This doc is everything you need to operate, edit, and deploy it.

## Where it runs
- **Host:** Hostinger VPS (Mumbai), Ubuntu 24.04. SSH user: `revaquo`.
- **Project:** `/opt/revaquoos/revaquo-nanoclaw`  (git repo, `origin = Vatsal-AAI/revaquo-nanoclaw`)
- **Process:** systemd service **`revaquoos`** (NOT pm2). Runs the router as `revaquo`, auto-restarts, starts on boot.
- **Memory backend:** `cognitive-ai-memory` (YourMemory) via docker compose, on `172.17.0.1:8000`.
- **Agents:** each runs as a Docker container spawned per message/task, image `nanoclaw-agent:latest`.

## DAVE specifically
- **Persona/config:** `groups/whatsapp_shubham-myra/CLAUDE.md` — edit this to change what DAVE does,
  its tools, rules, voice. (Other agents: `groups/<folder>/CLAUDE.md`. Shared rules: `groups/global/CLAUDE.md`.)
- **DAVE's WhatsApp group:** "Shubham x MYRA" (JID `120363426134395091@g.us`).
- DAVE has full MYRA dev scope, LinkedIn-for-Shubham, gstack skills, and reports capability gaps (see below).

## Day-to-day commands (on the VPS, as `revaquo`)
```bash
sudo systemctl status revaquoos      # is it running?
sudo systemctl restart revaquoos     # restart the router
tail -f logs/nanoclaw.log            # live logs (pino-pretty)
journalctl -u revaquoos -f           # systemd-level logs (crashes, restarts)
docker ps                            # running agent containers (nanoclaw-*)
```

## Deploy loop (push -> live)
1. Edit code locally, `git push origin main`.
2. `ssh revaquo@<vps-ip>` then `cd /opt/revaquoos/revaquo-nanoclaw && ./deploy.sh`
   (pulls, `npm install`, `npm run build`, restarts the router).
- **If you change the agent image** (anything under `container/`), also run `./container/build.sh`
  — the agent image is built separately from the router.
- (You'll need your SSH public keys added to the `revaquo` user — send them to Vatsal. A
  push-to-deploy GitHub Action is a planned follow-up so you won't need SSH at all.)

## Editing an agent + the self-upgrade loop
- Any agent can write a need to `groups/global/capability-gaps.md`. **APEX** reads these and
  proposes/owns fixes (config or new skill), human-approved. So if DAVE needs a tool/skill,
  it logs the gap and APEX handles it (with Vatsal's approval).
- New skills live under `.claude/skills/` (applied via the NanoClaw skill system).

## Important gotchas (learned during the VPS migration)
- **Runs on systemd, not PM2.** PM2 mangled the logger (empty logs + crash-loop). Don't reintroduce PM2.
- **Container uid:** the router runs as `revaquo` (uid 1001), so agent containers run `--user 1001`.
  The image's `/home/node` must be recursively world-writable (`chmod -R 777`, baked into
  `container/Dockerfile`) or containers hit **EACCES** on every write. If you rebuild the image, keep that.
- **Scheduled tasks** (`scheduled_tasks` table in `store/messages.db`) are currently **paused** —
  re-enable by setting `status='active'` when ready (avoid mass-firing the backlog).
- **File mounts** (MYRA/Aashish OneDrive) are not yet synced to the VPS — agents work without
  local file access for now; that's the next phase.

## Stack
Node 20, TypeScript (`npm run build` -> `dist/`), Claude Agent SDK, Baileys (WhatsApp),
Docker (agent isolation), SQLite (`store/messages.db`), credential proxy on `:3001`.
