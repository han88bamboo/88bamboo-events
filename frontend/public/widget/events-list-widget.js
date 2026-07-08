/* 88 Bamboo Events - rotating list widget.
 *
 * A standalone, dependency-free script for Shopify theme embeds. It uses the
 * same public upcoming-events feed as events-widget.js, but renders a compact
 * list of at most 3 events and rotates to the next batch every 5 seconds.
 *
 * EMBED SNIPPET (paste into a Shopify section/page; see widget/README.md):
 *
 *   <div id="bamboo-events-list-widget"
 *        data-api="https://events-api.88bamboo.co"
 *        data-site="https://88bamboo.co"
 *        data-limit="24"
 *        data-title="Upcoming events"
 *        data-interval-ms="5000"></div>
 *   <script src="https://88bamboo.co/a/events/widget/events-list-widget.js" defer></script>
 */
(function () {
  'use strict';

  var MOUNT_ID = 'bamboo-events-list-widget';
  var STYLE_ID = 'bamboo-events-list-widget-styles';
  var DEFAULT_API = 'https://events-api.88bamboo.co';
  var DEFAULT_SITE = 'https://88bamboo.co';
  var BASE_PATH = '/a/events';
  var DEFAULT_LIMIT = 24;
  var DEFAULT_PAGE_SIZE = 3;
  var DEFAULT_INTERVAL_MS = 5000;

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

  function numberAttr(mount, name, fallback, min, max) {
    var parsed = parseInt(mount.getAttribute(name), 10);
    if (!parsed || parsed < min) return fallback;
    if (max != null) return Math.min(parsed, max);
    return parsed;
  }

  function formatDate(iso) {
    if (!iso) return 'Date TBC';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return 'Date TBC';
    return d.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  function locationText(ev) {
    return [ev.city, ev.country].filter(Boolean).join(', ');
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css =
      '.belw-wrap{font-family:inherit;margin:0 auto;max-width:900px}' +
      '.belw-title{font-size:1.1rem;font-weight:700;margin:0 0 10px;color:#0B4321}' +
      '.belw-list{border-top:1px solid #e8e8e8;min-height:210px}' +
      '.belw-item{display:block;min-height:70px;padding:12px 0;border-bottom:1px solid #e8e8e8;text-decoration:none;color:inherit}' +
      '.belw-item:hover .belw-name{color:#0B4321;text-decoration:underline;text-underline-offset:3px}' +
      '.belw-name{display:block;font-weight:650;line-height:1.3;color:#111}' +
      '.belw-meta{display:block;margin-top:4px;font-size:.84rem;line-height:1.4;color:#666}' +
      '.belw-tag{display:inline-block;margin-top:6px;font-size:.72rem;background:#EAF2EC;color:#0B4321;padding:2px 8px;border-radius:999px}' +
      '.belw-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px}' +
      '.belw-count{font-size:.78rem;color:#777}' +
      '.belw-more{color:#0B4321;font-weight:650;text-decoration:none}' +
      '.belw-more:hover{text-decoration:underline;text-underline-offset:3px}' +
      '.belw-empty{color:#666;padding:20px 0}';
    document.head.appendChild(h('style', { id: STYLE_ID }, [css]));
  }

  function item(ev, site) {
    var href = site + BASE_PATH + '/' + encodeURIComponent(ev.slug);
    var date = formatDate(ev.start_datetime);
    if (ev.occurrence_count > 1) {
      date += ' +' + (ev.occurrence_count - 1) + ' more dates';
    }

    var meta = [date, locationText(ev)].filter(Boolean).join(' | ');
    var body = [
      h('span', { class: 'belw-name' }, [ev.name || 'Event']),
      h('span', { class: 'belw-meta' }, [meta]),
    ];
    if (ev.event_format) body.push(h('span', { class: 'belw-tag' }, [ev.event_format]));

    return h('a', { class: 'belw-item', href: href, target: '_top' }, body);
  }

  function batches(events, size) {
    var grouped = [];
    for (var i = 0; i < events.length; i += size) {
      grouped.push(events.slice(i, i + size));
    }
    return grouped;
  }

  function renderBatch(list, batch, opts) {
    list.innerHTML = '';
    batch.forEach(function (ev) {
      if (ev.slug) list.appendChild(item(ev, opts.site));
    });
  }

  function render(mount, events, opts) {
    mount.innerHTML = '';
    if (mount.__bambooEventsListTimer) {
      window.clearInterval(mount.__bambooEventsListTimer);
      mount.__bambooEventsListTimer = null;
    }

    var wrap = h('div', { class: 'belw-wrap' });
    if (opts.title) wrap.appendChild(h('div', { class: 'belw-title' }, [opts.title]));

    if (!events.length) {
      wrap.appendChild(h('div', { class: 'belw-empty' }, ['No upcoming events right now - check back soon.']));
      mount.appendChild(wrap);
      return;
    }

    var grouped = batches(events, opts.pageSize);
    var list = h('div', { class: 'belw-list' });
    var count = h('span', { class: 'belw-count' });
    var index = 0;

    function draw() {
      var batch = grouped[index] || grouped[0];
      var start = index * opts.pageSize + 1;
      var end = Math.min(start + batch.length - 1, events.length);
      renderBatch(list, batch, opts);
      count.textContent = start + '-' + end + ' of ' + events.length;
      index = (index + 1) % grouped.length;
    }

    draw();
    if (grouped.length > 1) {
      mount.__bambooEventsListTimer = window.setInterval(draw, opts.intervalMs);
    }

    wrap.appendChild(list);
    wrap.appendChild(
      h('div', { class: 'belw-foot' }, [
        count,
        h('a', { class: 'belw-more', href: opts.site + BASE_PATH, target: '_top' }, ['See all events']),
      ])
    );
    mount.appendChild(wrap);
  }

  function init() {
    var mount = document.getElementById(MOUNT_ID);
    if (!mount) return;

    var opts = {
      api: (mount.getAttribute('data-api') || DEFAULT_API).replace(/\/$/, ''),
      site: (mount.getAttribute('data-site') || DEFAULT_SITE).replace(/\/$/, ''),
      limit: numberAttr(mount, 'data-limit', DEFAULT_LIMIT, 1, 24),
      pageSize: numberAttr(mount, 'data-page-size', DEFAULT_PAGE_SIZE, 1, 3),
      intervalMs: numberAttr(mount, 'data-interval-ms', DEFAULT_INTERVAL_MS, 1000, 60000),
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
          h('div', { class: 'belw-wrap' }, [
            h('div', { class: 'belw-empty' }, ['Events are unavailable right now.']),
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
