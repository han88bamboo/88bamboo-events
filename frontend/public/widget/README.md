# 88 Bamboo Events — homepage widget

Standalone, no-iframe JavaScript widgets that show upcoming events on
88bamboo.co (or any page). They fetch the public events feed cross-origin from
the events API and link to the listing pages on the apex domain.

## What it is

- **Grid widget:** `events-widget.js` (this folder). Served under the app's
  `basePath` (`/a/events`, and files in `public/` are served under it) at
  `https://88bamboo.co/a/events/widget/events-widget.js` — same-origin with the
  storefront, through the Shopify App Proxy. (Vercel also serves the identical
  file directly at `https://events.88bamboo.co/a/events/widget/events-widget.js`
  if you ever want to bypass the proxy for the script itself.)
- **Rotating list widget:** `events-list-widget.js` (this folder). Served at
  `https://88bamboo.co/a/events/widget/events-list-widget.js`. It shows at most
  3 events at a time and rotates to the next batch every 5 seconds by default.
- **Not part of Next.js routing.** It is plain vanilla JS the browser runs
  inside the Shopify theme — no React, no iframe, no build step.
- **Data source:** `GET https://events-api.88bamboo.co/events/widget` — an
  unguarded, cookie-free, CORS-open endpoint (backend `scripts/events.py`). CORS
  in production allows `https://88bamboo.co` (the store's canonical naked apex).

## Grid paste-in snippet (Shopify theme)

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

## Rotating list paste-in snippet (Shopify theme)

Add a **Custom Liquid** section (or edit a template) and paste:

```html
<div id="bamboo-events-list-widget"
     data-api="https://events-api.88bamboo.co"
     data-site="https://88bamboo.co"
     data-limit="24"
     data-title="Upcoming events"
     data-interval-ms="5000"></div>
<script src="https://88bamboo.co/a/events/widget/events-list-widget.js" defer></script>
```

All `data-*` attributes are **optional** and fall back to the production
defaults baked into the script:

| Attribute          | Default                          | Meaning                                          |
|--------------------|----------------------------------|--------------------------------------------------|
| `data-api`         | `https://events-api.88bamboo.co` | Public events API origin (the feed source).      |
| `data-site`        | `https://88bamboo.co`            | Apex site; list links become `…/a/events/<slug>`. |
| `data-limit`       | `24`                             | Max events fetched for rotation (backend caps at 24). |
| `data-page-size`   | `3`                              | Events shown per rotation; capped at 3.          |
| `data-interval-ms` | `5000`                           | Rotation interval in milliseconds.               |
| `data-title`       | *(none)*                         | Optional heading above the list.                 |

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

Rotating list local variant:

```html
<div id="bamboo-events-list-widget"
     data-api="http://localhost:5001"
     data-site="http://localhost:8080"
     data-limit="24"
     data-title="Upcoming events"
     data-interval-ms="5000"></div>
<script src="http://localhost:8080/a/events/widget/events-list-widget.js" defer></script>
```

(Only published events appear — approve at least one submission first.)
