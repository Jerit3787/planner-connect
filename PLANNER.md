# planner-connect

This is a fork of [Forthify/fyutr-connect](https://github.com/Forthify/fyutr-connect), run as the timetable import service for the Stutastic Planner app. Like upstream, it's licensed under the [GNU AGPL v3](LICENSE.md). This repository is the complete source of the service at `connect.planner.danplace.tech`.

## What this fork adds

Everything is in `src/planner/`. Upstream's files (`src/index.ts`, `src/institution/**`, `src/routes/**`) are left unchanged, so merging upstream stays easy.

| File | What it does |
|---|---|
| `src/planner/index.ts` | The Worker entry (`main` in `wrangler.jsonc`). It wraps upstream's Hono app with the layers below. |
| `src/planner/appcheck.ts` | Every `/institution/*` request needs a valid [Firebase App Check](https://firebase.google.com/docs/app-check) token for the planner app (`X-Firebase-AppCheck`), so only the app can ask the service to sign in to a portal. `GET /institutions` stays open. |
| `src/planner/rate-limit.ts` | At most `RATE_LIMIT_PER_HOUR` imports an hour per network address and per student ID, counted in KV under SHA-256 keys and never the raw values, so the service can't be used to guess passwords. |
| `src/planner/errors.ts` | Every failure becomes one fixed code and message (`INVALID_CREDENTIALS`, `UNSUPPORTED_INSTITUTION`, `PORTAL_UNAVAILABLE`, `RATE_LIMITED`, `VALIDATION_ERROR`, `APP_CHECK_REQUIRED`). The portal's own error text, which can quote what was typed, never leaves the Worker. |
| CORS (in `index.ts`) | Only the web origins in `ALLOWED_ORIGINS`. The native apps send no `Origin`. |

## Changes to upstream files

- **`src/institution/iium/scraper.ts`:** i-Ma'luum's schedule page no longer carries the timetable. The page names a JSON endpoint and a page token on `#schedule-app`, and `/js/schedule.js` fetches the data. The scraper now does the same and falls back to the old table parsing.
  - It fetches semesters one at a time. Each page load replaces the session's page token (a 403), and parallel requests get a 429.
  - Offer this upstream.
- **Data-centre addresses:** i-Ma'luum refuses the timetable request from Cloudflare's addresses (`Client error: 403` in the page), although sign-in works. So the planner app signs in to i-Ma'luum on the device instead of through this service (planner issue #411).

## Passwords

- **On the server:** a student's portal password is used for the one sign-in it was sent for. It's never stored, never logged by our code, and never sent anywhere except the university's own portal.
- **Logs:** `observability` is off in `wrangler.jsonc`, so nothing upstream's scrapers print is kept either.
- **On the device:** if a student chooses to stay signed in, the app keeps the password in the device's own secure storage. It never comes back here.

## Tests

```sh
npm test            # vitest: App Check, CORS, errors, rate limit, no body logging
npx tsc --noEmit
```

## Merging upstream

```sh
git remote add upstream https://github.com/Forthify/fyutr-connect  # once
git fetch upstream && git merge upstream/main
npm test
```

New universities and scraper fixes arrive this way. Contribute scrapers upstream, not here.

## Deploying

```sh
npx wrangler deploy --env dev   # planner-connect-dev.<account>.workers.dev
npx wrangler deploy             # production
```
