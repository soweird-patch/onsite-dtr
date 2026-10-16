# Onsite DTR PWA

Mobile-first online attendance for one admin-configured site and field assignments. The PWA frontend is built with Vite for Vercel. Convex holds accounts, sessions, settings, attendance, audit events, and private selfie files. Employee login works from anywhere; only an **onsite punch** is restricted to the site GPS radius.

See [the regular, overtime, and Differential workflow](PREMIUM_FLOW.md) for the full employee, admin, and report flow.

## What works

- Admin creates or disables employee accounts using an exact 11-digit mobile number as the employee login, sets workdays, site GPS pin/radius, GPS accuracy limit, two payroll cutoff start days, and additional company no-work holidays. Admin login continues to use email. Passwords require at least eight characters.
- When no admin account exists, the sign-in screen offers first-admin registration with name, email, password, and optional profile picture. Admins can update their picture or delete their own account after confirming with their current password.
- Employee sees only their own current cutoff and prior attendance through **Kamusta Ka?**. The app prompts for onsite Time In when opened inside the configured radius and no Time In exists. Browsers cannot launch a closed PWA on site arrival.
- Every employee Time In and Time Out, onsite or offsite, requires a fresh device location and selfie. Offsite punches also require a field assignment note and await admin approval. Official time is recorded by Convex when the punch is saved.
- Regular time starts at **8:00 AM** and is capped at **8 hours**, with 12:00–1:00 PM included. Missing regular time can be recovered after 5:00 PM; only time beyond the completed eight regular hours can become overtime. Lateness is recorded only for an arrival at least one hour late that still leaves a regular-hours shortfall at Time Out. Work from 10:00 PM–6:00 AM is recorded separately as Differential and never counts toward regular time. Offsite employees can tap **Continue overtime** after 5:00 PM, and the app automatically closes an unfinished continued shift at 6:00 AM.
- Holidays do not count as no-record days or late/undertime, and employee punches are blocked on those dates. Admin can select an employee and date to load and edit existing punches or add a second return-to-work Time In/Out interval. Unchanged punches retain their proof; edited punches are audited admin corrections. Work gaps are excluded from hours. Records and printable cutoff reports show every interval and its regular, undertime, granted overtime, and Differential totals.
- The app shell is available offline, but attendance is **not** saved or queued offline. A punch counts only after a server success receipt. Admin can enter an audited backfill when there was no signal.

The default cutoff start days are **11 and 26**, and regular time is **08:00–17:00, Monday–Saturday**. The employee and admin dashboards show upcoming nationwide Philippine holidays from the published 2026 and 2027 proclamations. Regular and special non-working dates are no-work days; special working dates retain the employee workday schedule. The administrator can add local or company holidays. Later proclamations, including 2027 Eid dates, require a calendar update. Timezone is **Asia/Manila**. The report records hours but does not calculate salary, leave, holiday pay, or deductions.

## Local development

Requires Node.js 24 or newer.

```powershell
npm install
npx convex dev
```

The first Convex run writes `.env.local` with `VITE_CONVEX_URL`. Keep `npx convex dev` running while testing. In another terminal, start the PWA:

```powershell
npm run dev
```

Open the Vite URL, create the first admin account, set the site pin, then create employee accounts. Use test data on anonymous local deployments. Local Convex state is in `.convex/` and is ignored by Git.

## Production: Convex + Vercel

1. Log in to Convex and create/select a new cloud project with `npx convex dev --configure new`. Deploy functions with `npx convex deploy`.
2. Create a Vercel project from this directory. Set its production `VITE_CONVEX_URL` environment variable to the production Convex client URL, then deploy the Vercel project to get its HTTPS URL. Deploy later backend changes separately with `npx convex deploy` before rebuilding the frontend. The `/api/manifest` function reads public branding from Convex for the PWA install name and icons.
3. Open the deployed PWA and create the first admin account before sharing the URL. Configure the one site pin and radius, create employee accounts, then test a real employee device's camera and GPS onsite and offsite.

Do not put admin passwords in source control or browser code. Production deployment requires a Convex and Vercel account session. Convex hosts the backend; Vercel hosts the installable PWA frontend.

## Verify

```powershell
npm test
npm run build
```

`npm test` covers attendance rules, the admin account lifecycle, and the original local Node API. For a disposable Convex deployment with a test admin, run the integration script with `CONVEX_TEST_URL`, `CONVEX_TEST_ADMIN_EMAIL`, and `CONVEX_TEST_ADMIN_PASSWORD` set in the shell. It creates test employee records and proofs, so do not point it at production.

## Data and security

Authenticated data functions enforce the user's role. Employee queries expose only their own attendance; selfie retrieval checks employee ownership or admin role. Passwords use salted scrypt hashes. Sessions use hashed random tokens; the PWA stores the token in session storage for a 12-hour session or local storage for a 30-day remembered session. Admin edits revoke the employee's sessions. A privacy notice and retention policy for selfies and precise GPS coordinates should be set before real rollout. Device GPS can be spoofed, so offsite proof still needs human review.

Deleting an admin removes that account, its sessions, and its profile picture. It keeps employee accounts, attendance, site settings, and audit records. If that was the last admin, the first visitor to register becomes the new admin with access to the retained records; the delete screen warns about this before confirmation.

The previous SQLite/Node implementation remains in `server.js` and `public/` for local reference. `npm run start:legacy` runs it with the `ADMIN_EMAIL` and `ADMIN_PASSWORD` first-run environment variables; production uses `src/` and `convex/`.
