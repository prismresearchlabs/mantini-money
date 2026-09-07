# Mantini Money

Your own personal finance dashboard: spending, income, account balances, investments, transaction categories, and an optional Claude-powered money assistant. Each person installs their own copy and connects their own accounts. No financial data or API keys come with this repository.

## Let Claude Code set it up

Give Claude Code this message:

> Please install https://github.com/prismresearchlabs/mantini-money on my computer. Read README.md and CLAUDE.md first, then follow the setup guide. I'm not technical: do the terminal work for me, explain things simply, and guide me through anything I must do myself. Start with the empty local dashboard, then help me connect Plaid Sandbox test accounts. Ask before enabling paid services or connecting real accounts.

Claude Code can install and configure the project. You will still need to create any service accounts, enter your own credentials privately, and complete bank sign-in yourself. **An empty dashboard needs no service accounts. Real bank connections require your own Plaid Production access**, which is subject to Plaid approval, supported institutions, and current pricing. Getting the app installed does not guarantee live-bank access.

## Manual installation

Install [Node.js](https://nodejs.org/) (24 LTS recommended) and [Git](https://git-scm.com/downloads), then run:

```sh
git clone https://github.com/prismresearchlabs/mantini-money.git
cd mantini-money
npm ci
npm run setup
npm run dev
```

Open **http://127.0.0.1:3000**. The first dashboard is empty until you connect a source. Keep the terminal running; press Ctrl+C to stop. To reopen later, run `npm run dev` in the same folder. If port 3000 is occupied, use the local URL printed in the terminal.

`npm run setup` creates the data folder and a private `.env.local` settings file. It never overwrites existing settings. Restart the server after changing settings.

## Connect test accounts first

1. Create your own account at the [Plaid Dashboard](https://dashboard.plaid.com/).
2. Find your client ID and Sandbox secret. Enter them in `.env.local` as `PLAID_CLIENT_ID` and `PLAID_SANDBOX_SECRET`. Keep `PLAID_ENV=sandbox`.
3. Restart `npm run dev`, open the dashboard, and use the account connection button.
4. Choose a test institution such as First Platypus Bank. Use `user_good` / `pass_good` when asked for test bank credentials. Follow the test instructions shown in Link if it uses another flow.
5. Finish linking and sync. Confirm accounts and transactions appear.

Sandbox uses fictional accounts, not your bank. See [Plaid's Sandbox guide](https://plaid.com/docs/sandbox/) for current test flows. The app requests Transactions, Investments when supported, and consent for Liabilities; provider access and institution support determine which data is available. The current integration is for US institutions and the dashboard displays dollar amounts.

## Connect your real accounts

After the test flow works, ask Claude Code to guide you through [Plaid Production access](https://support.plaid.com/hc/en-us/articles/16110110883479-How-are-Sandbox-Production-Trial-plan-and-Limited-Production-different). Review costs and eligibility in your own Plaid account. Set `PLAID_PRODUCTION_SECRET`, change `PLAID_ENV=production`, restart, and link your real accounts through Plaid Link. Some banks require additional OAuth configuration and an approved redirect URI; have Claude check the current Plaid instructions for your institution. Never paste a bank password into Claude Code or this repository.

Local Sandbox and Production use separate database files. Sandbox connections do not turn into real connections when you switch. Keep your matching Plaid secret: it is also used to derive the key that encrypts saved Plaid access tokens. Changing it can require reconnecting accounts.

## Optional integrations

- **AI assistant:** Create an API key in the [Claude Console](https://platform.claude.com/) and save it as `CLAUDE_API_KEY`. This app makes separately billed API calls; signing into Claude Code does not configure this key. Review API billing before enabling it. The current model is `claude-opus-4-6` in `src/lib/ai/finance-agent.ts`. The dashboard requests a daily briefing and offers chat and purchase analysis. See [API authentication](https://platform.claude.com/docs/en/manage-claude/authentication).
- **Coinbase:** Set `COINBASE_API_KEY_NAME` and `COINBASE_API_PRIVATE_KEY` using a View-only Coinbase App key with ECDSA/ES256 signing. For a multiline private key, use a quoted value with `\n` between lines. Do not grant trading or transfer permissions.
- **Kraken:** Set `KRAKEN_API_KEY` and `KRAKEN_API_SECRET`. Grant only Funds → Query Funds permission.

Leave unused keys blank. AI is optional; the core dashboard does not need it. Coinbase and Kraken credentials are independent of Plaid Sandbox: adding real exchange keys loads real balances even while Plaid is in Sandbox.

## Where your information goes

Local financial records are saved in `data/`. Plaid tokens are encrypted; transaction records and cached AI briefings are not encrypted by this app. Keep your computer and backups private. The repository ignores settings files, databases, logs, and screenshots.

Plaid handles bank linking. Exchange integrations call the exchanges. If you enable AI, the app sends financial context—including balances, holdings, account names/last four digits, and recent transactions—to Anthropic for analysis. Your own copy never connects to the author's accounts or database. Treat generated guidance as a tool to review, not an instruction to move money.

## Local use and hosting

The supported beginner path is **`npm run dev` on your own computer**, bound to `127.0.0.1`. Local development intentionally skips login. Do not expose this server through a tunnel, public IP, or `0.0.0.0`.

The source also includes an advanced hosted path using Clerk and Turso, but hosting is not part of the quick start. `npm run build` / `npm start` use production authentication and require Clerk configuration. Each installation is single-owner; the earliest Clerk user claims that installation. A friend needs a separate installation, database, and Clerk application. A hosted deployment needs persistent storage, authentication validation, protected credentials, and a separate security review before real data is connected. No deployment or automatic paid daily cron is configured here. `CRON_SECRET` protects the optional daily-analysis endpoint; leave it unset when unused. Turso uses the same remote database regardless of `PLAID_ENV`, so use separate databases if testing both environments remotely.

## Troubleshooting

- **Missing Node or Git:** Ask Claude Code to help install the missing tool for your operating system, then reopen your terminal.
- **Dependency/native-module install fails:** Use Node 24 LTS and rerun `npm ci`. Ask Claude to inspect the error; native modules may need your operating system's build tools.
- **Missing Plaid variable / link fails:** Check the matching client ID, secret, environment, and product access; restart after edits. Do not share secret values when reporting errors.
- **No AI response:** Check that `CLAUDE_API_KEY` is set and the API account has access and billing enabled. The rest of the dashboard still works.
- **Login/Clerk error during local setup:** Use `npm run dev`, not `npm start`; leave Clerk settings blank for the local walkthrough.
- **Stale balances:** Use sync and inspect the connection status. Some institutions update data with a delay.

## Development

Next.js App Router, React, TypeScript, libSQL/SQLite, Plaid, and the Vercel AI SDK. Run `npm run lint` and `npm run build` after code changes. See `CLAUDE.md` for a code map and the guided installation workflow. This is personal software shared as-is, not a multi-user finance service.

## License

[MIT](LICENSE). Third-party packages retain their own licenses.
