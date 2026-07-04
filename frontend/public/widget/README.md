# 88 Bamboo Events — homepage widget

A standalone, no-iframe JavaScript widget that shows upcoming events on
88bamboo.co (or any page). It fetches the public events feed cross-origin from
the events API and renders responsive branded cards that link to the listing
pages on the apex domain.

## What it is

- **One file:** `events-widget.js` (this folder). Served under the app's
  `basePath` (`/a/events`, and files in `public/` are served under it) at
  `https://88bamboo.co/a/events/widget/events-widget.js` — same-origin with the
  storefront, through the Shopify App Proxy. (Vercel also serves the identical
  file directly at `https://events.88bamboo.co/a/events/widget/events-widget.js`
  if you ever want to bypass the proxy for the script itself.)
- **Not part of Next.js routing.** It is plain vanilla JS the browser runs
  inside the Shopify theme — no React, no iframe, no build step.
- **Data source:** `GET https://events-api.88bamboo.co/events/widget` — an
  unguarded, cookie-free, CORS-open endpoint (backend `scripts/events.py`). CORS
  in production allows `https://88bamboo.co` (the store's canonical naked apex).

## Paste-in snippet (Shopify theme)

Add a **Custom Liquid** section (or edit a template) and paste:

```html
<div id="bamboo-events-widget"
     data-api="https://events-api.88bamboo.co"
     data-site="https://88bamboo.co"
     data-limit="6"
     data-title="Upcoming events"></div>
<script src="https://88bamboo.co/a/events/widget/events-widget.js" defer></script>
```

All `data-*` attributes are **optional** and fall back to the production
defaults baked into the script:

| Attribute    | Default                             | Meaning                                        |
|--------------|-------------------------------------|------------------------------------------------|
| `data-api`   | `https://events-api.88bamboo.co`    | Public events API origin (the feed source).    |
| `data-site`  | `https://88bamboo.co`               | Apex site; card links become `…/a/events/<slug>`. |
| `data-limit` | `6`                                 | Max cards to show (backend caps at 24).        |
| `data-title` | *(none)*                            | Optional heading above the grid.               |

## Local testing

With the local stack up (`docker compose up`), point the snippet at the local
API and site to preview it:

```html
<div id="bamboo-events-widget"
     data-api="http://localhost:5001"
     data-site="http://localhost:8080"
     data-limit="6"
     data-title="Upcoming events"></div>
<script src="http://localhost:8080/a/events/widget/events-widget.js" defer></script>
```

(Only published events appear — approve at least one submission first.)
