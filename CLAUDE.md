@AGENTS.md

# Claude Code: install and guide the user

This is a single-owner personal finance dashboard. Assume the user is not technical. Read README.md before acting. Perform terminal work yourself where permitted, use short explanations, and ask one simple question at a time only when human input is needed.

## Setup workflow

1. If not cloned yet, clone this repo into a new folder; never overwrite an existing project. Check the operating system, `git --version`, `node --version`, and `npm --version`. Prefer Node 24 LTS (see `.nvmrc`). Guide installation of missing tools for that OS.
2. In the project, run `npm ci`, then `npm run setup`. The setup script preserves `.env.local`. Never replace an existing user's keys or database.
3. Run `npm run dev` and confirm the root page returns successfully. Give the user the exact loopback URL and explain how to stop/restart. An empty dashboard is expected. No Clerk, Turso, Plaid, or Anthropic account is needed for this milestone. Keep the default loopback binding.
4. Offer a guided Plaid Sandbox walkthrough from README.md. Explain that these accounts are fictional. Have the user enter their own client ID and Sandbox secret privately into `.env.local`; help open the file, but do not request secrets in chat, print them, or commit them. Restart, guide Link with the documented test credentials, and verify linked accounts and transactions appear. Do not claim this passed without completing it.
5. Ask whether they want real bank data, optional AI, or an exchange integration. Explain the relevant setup and costs before enabling it. For real banks, first verify the user's own Plaid Production eligibility/product access using current official docs. The user must handle provider signup, billing authorization, credentials, bank login, and MFA. If access is unavailable, explain the blocker and leave the working Sandbox installation intact.
6. For AI, explain that this app's Anthropic API key/billing is separate from Claude Code login and that financial context is sent to Anthropic. The dashboard can request a daily briefing when AI is enabled. For exchanges, use read-only keys; exchange data is real even with Plaid Sandbox selected.
7. Finish with what actually works, the exact URL, restart instructions, and any remaining provider steps. Never claim live accounts or AI work if only the empty page was tested.

Do not deploy publicly as part of installation. Development mode bypasses authentication. Never change the bind address to make access easier. Never disable production authentication. Hosting requires an explicit separate request and verification of single-owner access with a dedicated Clerk app and persistent database. Do not schedule the cron route automatically.

## Code map and maintenance

- `src/components/dashboard.tsx`: dashboard, Plaid Link, charts, chat and purchase UI.
- `src/lib/dashboard.ts`, `categories.ts`: financial aggregation and categories.
- `src/lib/plaid.ts`, `crypto.ts`: bank linking/sync and encrypted tokens.
- `src/lib/db.ts`: schema and local SQLite/Turso storage; creates `data/` automatically.
- `src/lib/ai/finance-agent.ts`: model, context sent to Anthropic, daily briefing.
- `src/lib/auth.ts`, `src/proxy.ts`: development bypass and production Clerk owner restriction.
- `src/app/api/`: authenticated application routes and separately protected cron route.
- `.env.example`: supported settings; actual private values belong only in `.env.local`.
- `scripts/migrate-sqlite-to-turso.mjs`: advanced production migration; not needed for local setup.

Before Next.js edits, read the relevant installed docs specified in AGENTS.md. Preserve the lockfile and use `npm ci` for installs. Run lint and build for changes, then verify the affected flow. Keep screenshots, database contents, tokens, and financial details out of commits and logs. Never delete a user's data to fix a setup problem without their explicit permission. Local dates currently use America/Chicago in parts of the UI/AI briefing; ask about timezone only if the user wants personalization.
