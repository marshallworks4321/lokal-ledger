# Lokal Ledger

Built as a capstone project for SMEs and service-based businesses, Lokal Ledger is an early, browser-based prototype for helping small merchants keep track of stock, sales, and customer credit across business locations. It is designed to grow into a dependable product, rather than remain only a presentation.

## Run it in VS Code

You need Node.js (LTS) installed. Open this folder in VS Code, then open **Terminal → New Terminal** and run:

```bash
npm install
npm run dev
```

Open the local address printed in the terminal (usually [http://localhost:3000](http://localhost:3000)). Keep the terminal running while you use the app. Press `Ctrl+C` in that terminal to stop it.

Useful checks:

```bash
npm run lint
npm run build
```

## What works

- The supplied Lokal Ledger logo is optimized and displayed on the sign-in, onboarding, and workspace screens.
- Supabase email/password accounts and authenticated workspace data.
- Business/location onboarding, product creation, inventory, multi-product sale/restock entry, credit balances, payment recording, and insights.
- Customer profiles with contact details and linked sales totals, plus a shared services and follow-ups workspace for completed jobs, fees, contact numbers, maintenance dates, and reminders.
- Service businesses can record completed jobs, agreed fees, partial payments, and outstanding balances without creating inventory products.
- Smart Log uses an authenticated server route and Gemini structured output to prepare product or service-job drafts; every amount and quantity must be reviewed before saving. Manual sale and restock forms remain available when AI is offline.
- Product costs are recorded per restock and averaged as new costs arrive; the current average cost can also be corrected from Inventory. Sale prices cannot be below the current recorded average cost. Stock watch levels are configurable for each product.
- Products with no remaining stock can be archived and restored from Inventory; archiving hides an item without deleting its transaction history.
- Business Insights provides recorded totals plus optional, authenticated Gemini analysis of aggregated business metrics; customer names and phone numbers are not sent to the insights model.
- Subscription management provides a 21-day trial starting at the first business, ₦3,000/month for one business and ₦5,000/month for multiple businesses, manual and automatic Paystack payment options, and read-only access after expiry.
- A dedicated Locations screen for adding branches to an existing business; the overview greeting follows the user's local time and updates every minute.
- A visible header location menu for selecting All locations or an individual branch, including on narrow screens.
- Row-level database security scoped to authenticated business members.
- Browser speech-to-text where supported, with a review step before recording transactions.
- Light and dark themes, with a responsive layout for narrow screens.

## Important limits

This is an early MVP, not yet ready for real customer or financial records. Use fictional data while you test authentication, business separation, database permissions, backups, and the sales/payment workflow. Smart Log sends the text you type or dictate and the selected transaction type to Gemini for parsing; do not include customer names, phone numbers, or other sensitive details. The Gemini free tier is subject to Google's model availability, quotas, and terms; prompts submitted on the free tier may be used to improve Google products. Check Google's [current pricing and data terms](https://ai.google.dev/gemini-api/docs/pricing) before using it with any business data. The model only creates a draft and cannot save transactions. Authenticated Gemini tools share an app limit of 10 requests per minute, but provider usage should still be monitored and capped before wider testing. Business Insights uses confirmed totals and can request an AI summary; customer records are not sent. Product gross profit and inventory value are estimates based on recorded restock costs; review cost history and missing costs before relying on them. Service and credit reminder actions can open a WhatsApp or SMS draft when the customer profile has a valid phone number; the merchant must review and press send. No messages are sent automatically or scheduled for delivery. Voice input depends on browser support and microphone permission. Login sessions use persistent, same-site cookies with a 30-day maximum age and automatic refresh; signing out clears the session. Paystack billing must be configured with live or test credentials and monthly plan codes before payments work. Test the trial, one-business and multi-business plans, callback verification, webhook delivery, renewal cancellation, and expired read-only mode with test accounts before accepting real payments.

## Supabase setup

The initial migration in `supabase/migrations/20261023000000_initial_schema.sql` creates businesses, memberships, locations, products, sales/restocks, item lines, payments, stock movements, row-level security, and database functions for atomic transaction and payment updates. The app connects to these tables through Supabase Auth.

To prepare a Supabase project:

1. Create a project at [supabase.com](https://supabase.com/). Save its database password somewhere private; it is not needed in the web app.
2. If this is the Supabase project already used for Lokal Ledger, the initial migration has already been applied; do not run it again. For a new project, run `supabase/migrations/20261023000000_initial_schema.sql` once in the Supabase SQL Editor.
3. Run `supabase/migrations/20261024110000_validate_transaction_totals.sql` once. It makes the database reject sales/restocks when the recorded total does not match the product lines.
4. Run `supabase/migrations/20261025001500_create_business_rls_fix.sql` once. It routes business creation through a narrowly scoped, authenticated database function and removes direct business-row insertion.
5. Run `supabase/migrations/20261026090000_customer_crm_service_tracking.sql` once. It creates customer profiles and service follow-ups, links existing/new sales to customer records, and applies business-member row-level security. Existing sales are migrated into customer profiles.
6. Run `supabase/migrations/20261028010000_service_jobs.sql` once. It adds separate service-job and service-payment records with business-member access controls; service work does not change inventory quantities.
7. Run `supabase/migrations/20261028020000_service_job_followups.sql` once after the service-jobs migration. It adds phone capture to completed service jobs and lets a completed job create an optional maintenance follow-up in the same save.
8. Run `supabase/migrations/20261028030000_manual_followups_and_repayment_history.sql` once. It enables service-job payment history and lets you schedule reminders for new customers directly.
9. Run `supabase/migrations/20261028040000_cost_controls_and_stock_watch.sql`. It stores a moving average cost per product, cost snapshots per transaction line, prevents sales below recorded average cost, and adds a configurable stock-watch level. It can be safely rerun if a previous attempt partially applied. Existing products with unknown costs need an initial cost entered in Inventory before they can be sold or restocked.
10. Run `supabase/migrations/20261028050000_inventory_cost_edit_and_archive.sql` after the cost-controls migration. It allows cost-baseline corrections and safely archives/restores products without deleting their history; it can also be rerun after an interrupted attempt.
11. Run `supabase/migrations/20261028060000_subscriptions_and_trials.sql` once. It starts existing owners' trial windows at migration time, starts future owners' 21-day trial when they create their first business, and enforces expired accounts as read-only in the database.
12. In **Project Settings → API Keys**, copy the **Project URL**, the **publishable key** (typically starts with `sb_publishable_`), and the server-only **service_role** key. The service-role key bypasses row-level security: keep it only in server environment settings, never expose it with `NEXT_PUBLIC_`, and never paste it into chat or commit it.
13. In Paystack, create two monthly subscription plans: one for ₦3,000 and one for ₦5,000. Copy the secret key and the plan codes for each plan. Configure the Paystack webhook URL as `https://YOUR-DOMAIN/api/billing/webhook` and subscribe to `charge.success`, `subscription.create`, `subscription.disable`, and `subscription.not_renew` events. Use Paystack test keys and test plans first.
14. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_PLAN_SINGLE`, and `PAYSTACK_PLAN_MULTI`. Keep `.env.local` private; it is ignored by Git. Never paste keys into chat.
15. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/apikey) and set `GEMINI_API_KEY` in `.env.local`. Keep it server-only—never rename it with a `NEXT_PUBLIC_` prefix. `GEMINI_MODEL` defaults to `gemini-3.8-flash`; use an active Gemini model listed in Google's [model catalog](https://ai.google.dev/gemini-api/docs/models). Free-tier availability and usage limits depend on Google's current account and model rules.
16. Restart the development server with `npm run dev`, then sign up with a test email and create a business and location. Inventory is optional: merchants can record completed work from **Services & follow-ups**, enter a customer's name and phone (including a new customer), and optionally schedule maintenance at the same time. For inventory, set or correct product costs, record sales/restocks manually, choose a stock-watch quantity, and archive/restore zero-stock products in Inventory; Gemini remains optional and every Smart Log draft must be reviewed. Repayments support partial amounts and keep a dated payment history. Insights show sales, collections, outstanding debt, estimated gross profit, and inventory value based on recorded costs. Sales without usable cost data are excluded from profit estimates, which do not include other expenses. Smart Log sends the text to Gemini; avoid customer names, phone numbers, and sensitive details.
17. Continue using fictional data until you have verified access separation, subscription payment and webhook behavior, plan changes, expired read-only access, and database backups with separate test accounts.

## First private release checklist

Use a private preview before a public launch. Do not use real customer or financial records until the readiness checks below pass. The current local Git repository has no GitHub remote configured.

1. Finish and locally verify the logo, sign-up/sign-in, workspace setup, product creation, manual and Smart Log restocking/sales, cost floors and changing restock costs, configurable stock alerts, customer profiles, service follow-ups (including new customers), completion undo, service-job drafts, partial payments and repayment history, and AI Insights.
2. Create a **private** GitHub repository, connect this local repository to it, and confirm `.env.local` is not staged or pushed.
3. Connect the private repository to Vercel. Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `GEMINI_API_KEY`, and `GEMINI_MODEL` as Preview environment variables in Vercel. Keep `GEMINI_API_KEY` server-only and do not add a Supabase service-role/secret key.
4. After obtaining the preview URL, configure Supabase Auth's **Site URL** and allowed **Redirect URLs** for that deployment, then test email confirmation and sign-in from the deployed preview.
5. Use two separate test accounts to verify each business is private to its members. Test sales, stock, and payments with fictional records, and confirm the Supabase backup and recovery options.
6. Invite testers with a clear privacy notice and support contact. Keep the preview restricted while verifying the workflow.

## A sensible path to a real product

1. **Test the workflow with merchants.** Ask a few shop owners to try a preview using fictional information. Observe whether they can record a sale, find an item, understand a balance, and switch locations without help.
2. **Collect focused feedback.** Ask what they currently write down, where mistakes happen, which words they use for stock and credit, and what they would not trust an app to do. Keep feedback anonymous unless people agree to be identified.
3. **Tighten the rules and data model.** Decide how businesses, locations, staff permissions, products, stock movements, customers, sales, partial payments, and due dates relate before adding a production database.
4. **Harden the backend before real use.** Test tenant isolation with two accounts, validate every write and permission, configure backups, and create an audit trail. Keep secret keys on the server, never in browser code.
5. **Add AI carefully.** Start with a server-side model integration that turns a spoken or typed description into a draft. Show the parsed fields and require confirmation; do not allow the model to silently change financial records.
6. **Add integrations after validation.** Build WhatsApp/SMS reminders with consent, message previews, rate limits, and delivery records. Measure whether merchants actually want them.
7. **Prepare for mobile.** First make the web app easy to use on a phone. A progressive web app can be an intermediate step; a dedicated Android/iOS app can follow when offline use, camera/barcode workflows, or push notifications justify it.

## Let people test it

For a first feedback round, run the app locally and sit with testers while they use fictional data. For wider testing, deploy a private preview only after checking authentication, tenant isolation, database permissions, and a clear privacy notice. Do not use real merchant records until those checks and backups are in place.

For a competition or award entry, present the merchant problem, evidence from user testing, what you learned and changed, a live demo, and a realistic plan for privacy and reliability. No tool or project can guarantee a prize; strong judging evidence comes from a clear problem, a working demo, thoughtful testing, and honest limits.

## Technology

Next.js App Router, React, TypeScript, Tailwind CSS, and Lucide icons. The route wrapper is `app/page.tsx`, the workspace is `app/ledger-workspace.tsx`, the logo asset is in `public/lokal-ledger-logo.webp`, and the shared design tokens and component styles are in `app/globals.css`.
