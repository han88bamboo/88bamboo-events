/* 88 Bamboo Events — homepage widget (plan §8).
 *
 * A standalone, dependency-free script the owner pastes into the Shopify theme as
 * a <script> + <div> (NOT part of Next.js routing, NO iframe). It fetches the
 * upcoming-events feed DIRECTLY, cross-origin, from the public events API and
 * renders responsive branded cards that deep-link to the apex listing pages.
 *
 * Because it runs inside the Shopify theme (a different origin from the API), it
 * relies on the API's CORS allowing https://www.88bamboo.co — which app.py grants
 * in production. The feed endpoint is unguarded and cookie-free by design.
 *
 * EMBED SNIPPET (paste into a Shopify section/page; see widget/README.md):
 *
 *   <div id="bamboo-events-widget"
 *        data-api="https://events-api.88bamboo.co"
 *        data-site="https://www.88bamboo.co"
 *        data-limit="6"
 *        data-title="Upcoming events"></div>
 *   <script src="https://events.88bamboo.co/a/events/widget/events-widget.js" defer></script>
 *
 * All data-* attributes are optional and fall back to the production defaults
 * below.
 */
(function () {
  'use strict';

  var MOUNT_ID = 'bamboo-events-widget';
  var DEFAULT_API = 'https://events-api.88bamboo.co';
  var DEFAULT_SITE = 'https://www.88bamboo.co';
  var BASE_PATH = '/a/events';

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'style') el.setAttribute('style', attrs[k]);
      else if (k === 'class') el.className = attrs[k];
      else el.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c == null) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  function formatDate(iso) {
    if (!iso) return 'Date TBC';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return 'Date TBC';
    return d.toLocaleDateString(undefined, {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    });
  }

  // Scoped styles — injected once, all class names namespaced so they can't
  // collide with the host Shopify theme.
  function injectStyles() {
    if (document.getElementById('bamboo-events-widget-styles')) return;
    var css =
      '.bew-wrap{font-family:inherit;margin:0 auto;max-width:1100px}' +
      '.bew-title{font-size:1.4rem;font-weight:700;margin:0 0 16px;color:#0B4321}' +
      '.bew-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}' +
      '.bew-card{display:flex;flex-direction:column;border:1px solid #eee;border-radius:12px;overflow:hidden;text-decoration:none;color:inherit;background:#fff;transition:box-shadow .15s ease,transform .15s ease}' +
      '.bew-card:hover{box-shadow:0 6px 20px rgba(0,0,0,.10);transform:translateY(-2px)}' +
      '.bew-img{width:100%;height:150px;object-fit:cover;background:#f3f3f3}' +
      '.bew-body{padding:12px 14px;display:flex;flex-direction:column;gap:4px}' +
      '.bew-name{font-weight:600;line-height:1.25;color:#111}' +
      '.bew-meta{font-size:.82rem;color:#666}' +
      '.bew-fmt{align-self:flex-start;margin-top:6px;font-size:.72rem;background:#EAF2EC;color:#0B4321;padding:2px 8px;border-radius:999px}' +
      '.bew-empty{color:#666;padding:20px 0}' +
      '.bew-more{display:inline-block;margin-top:16px;color:#0B4321;font-weight:600;text-decoration:none}';
    var style = h('style', { id: 'bamboo-events-widget-styles' }, [css]);
    document.head.appendChild(style);
  }

  function card(ev, site) {
    var href = site + BASE_PATH + '/' + encodeURIComponent(ev.slug);
    var kids = [];
    if (ev.image_url) {
      kids.push(h('img', { class: 'bew-img', src: ev.image_url, alt: '', loading: 'lazy' }));
    }
    var body = [
      h('div', { class: 'bew-name' }, [ev.name || 'Event']),
      h('div', { class: 'bew-meta' }, [formatDate(ev.start_datetime)]),
      h('div', { class: 'bew-meta' }, [
        [ev.city, ev.country].filter(Boolean).join(', '),
      ]),
    ];
    if (ev.event_format) body.push(h('span', { class: 'bew-fmt' }, [ev.event_format]));
    kids.push(h('div', { class: 'bew-body' }, body));
    return h('a', { class: 'bew-card', href: href, target: '_top' }, kids);
  }

  function render(mount, events, opts) {
    mount.innerHTML = '';
    var wrap = h('div', { class: 'bew-wrap' });
    if (opts.title) wrap.appendChild(h('div', { class: 'bew-title' }, [opts.title]));

    if (!events.length) {
      wrap.appendChild(h('div', { class: 'bew-empty' }, ['No upcoming events right now — check back soon.']));
    } else {
      var grid = h('div', { class: 'bew-grid' });
      events.forEach(function (ev) { if (ev.slug) grid.appendChild(card(ev, opts.site)); });
      wrap.appendChild(grid);
    }
    wrap.appendChild(
      h('a', { class: 'bew-more', href: opts.site + BASE_PATH, target: '_top' }, ['See all events →'])
    );
    mount.appendChild(wrap);
  }

  function init() {
    var mount = document.getElementById(MOUNT_ID);
    if (!mount) return;

    var opts = {
      api: (mount.getAttribute('data-api') || DEFAULT_API).replace(/\/$/, ''),
      site: (mount.getAttribute('data-site') || DEFAULT_SITE).replace(/\/$/, ''),
      limit: parseInt(mount.getAttribute('data-limit'), 10) || 6,
      title: mount.getAttribute('data-title') || '',
    };

    injectStyles();

    fetch(opts.api + '/events/widget?limit=' + opts.limit, { credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .then(function (payload) {
        render(mount, (payload && payload.data) || [], opts);
      })
      .catch(function () {
        mount.innerHTML = '';
        mount.appendChild(
          h('div', { class: 'bew-wrap' }, [
            h('div', { class: 'bew-empty' }, ['Events are unavailable right now.']),
          ])
        );
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
