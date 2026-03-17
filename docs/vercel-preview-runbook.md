# Vercel Preview Runbook

## Goal
Publish Quest Agent as a preview deployment that non-engineers can open in the browser.

## Important limitation
This preview is a demo environment.
If Supabase is not connected, saved data is stored only in the current browser using `localStorage`.
That means:
- it survives reload in the same browser
- it does not sync across devices
- it is not shared with other people

## Why this mode exists
Vercel preview environments should not rely on local file writes.
Quest Agent therefore uses browser `localStorage` when:
- the app is on Vercel
- Supabase is not configured

## Recommended branch setup
- use `preview/demo` for preview work
- set Vercel Production Branch to `release`
- keep day-to-day validation on preview URLs

## GitHub import steps
1. Open Vercel and choose "Add New Project".
2. Import `saibouno/quest-agent` from GitHub.
3. Let Vercel detect Next.js automatically.
4. Deploy once without environment variables.
5. In project settings, change Production Branch to `release`.
6. Push future demo changes to `preview/demo` to get fresh preview URLs.

## Environment variables
### Preview without backend
No environment variables required.
This runs in browser-local preview mode.

### Preview with backend later
Add these when you want shared persistence:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### AI later
Add these when you want real model calls instead of heuristic fallback:
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

## What non-engineers should know
- Vercel is the service that puts this web app on the internet.
- A preview URL is a temporary shareable link for checking the current build.
- In the current preview setup, data is only saved in the browser you used.

## Verification checklist
After deployment, confirm:
- the app opens
- `/intake`, `/map`, `/today`, and `/review` all render
- creating a goal survives reload in the same browser
- creating a map, updating today's quests, and saving a review also survive reload

## What is not done by this runbook
- custom domain setup
- production launch
- shared persistence without Supabase
- authentication