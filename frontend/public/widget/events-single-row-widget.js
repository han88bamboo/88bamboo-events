/* 88 Bamboo Events - rotating single-row card widget.
 *
 * A standalone, dependency-free script for Shopify theme embeds. It uses the
 * same public upcoming-events feed and card design as events-widget.js, but
 * renders one responsive row and rotates to the next batch every 5 seconds.
 *
 * EMBED SNIPPET (paste into a Shopify section/page; see widget/README.md):
 *
 *   <div id="bamboo-events-single-row-widget"
 *        data-api="https://events-api.88bamboo.co"
 *        data-site="https://88bamboo.co"
 *        data-limit="24"
 *        data-max-cards="4"
 *        data-title="Upcoming events"
 *        data-interval-ms="5000"></div>
 *   <script src="https://88bamboo.co/a/events/widget/events-single-row-widget.js" defer></script>
 */
(function () {
  'use strict';

  var MOUNT_ID = 'bamboo-events-single-row-widget';
  var STYLE_ID = 'bamboo-events-single-row-widget-styles';
  var DEFAULT_API = 'https://events-api.88bamboo.co';
  var DEFAULT_SITE = 'https://88bamboo.co';
  var BASE_PATH = '/a/events';
  var DEFAULT_LIMIT = 24;
  var DEFAULT_MAX_CARDS = 4;
  var DEFAULT_INTERVAL_MS = 5000;
  var CARD_MIN_WIDTH = 240;
  var CARD_GAP = 16;

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

  function categories(ev) {
    return Array.isArray(ev.drink_categories) ? ev.drink_categories.filter(Boolean) : [];
  }

  // These values intentionally mirror events-widget.js so the two card
  // widgets remain visually interchangeable.
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css =
      '.besrw-wrap{font-family:inherit;margin:0 auto;max-width:1100px}' +
      '.besrw-title{font-size:1.4rem;font-weight:700;margin:0 0 16px;color:#0B4321}' +
      '.besrw-grid{display:grid;gap:16px}' +
      '.besrw-card{display:flex;flex-direction:column;border:1px solid #eee;border-radius:12px;overflow:hidden;text-decoration:none;color:inherit;background:#fff;transition:box-shadow .15s ease,transform .15s ease}' +
      '.besrw-card:hover{box-shadow:0 6px 20px rgba(0,0,0,.10);transform:translateY(-2px)}' +
      '.besrw-img{width:100%;height:150px;object-fit:cover;background:#f3f3f3}' +
      '.besrw-img-empty{display:flex;align-items:center;justify-content:center;color:#9a9a9a;font-size:.78rem}' +
      '.besrw-body{padding:12px 14px;display:flex;flex-direction:column;gap:4px}' +
      '.besrw-name{font-weight:600;line-height:1.25;color:#111}' +
      '.besrw-meta{font-size:.82rem;color:#666}' +
      '.besrw-pills{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}' +
      '.besrw-fmt,.besrw-cat{display:inline-block;font-size:.72rem;line-height:1.25;padding:2px 8px;border-radius:999px}' +
      '.besrw-fmt{background:#EAF2EC;color:#0B4321}' +
      '.besrw-cat{background:#F6F1E8;color:#5f4524}' +
      '.besrw-empty{color:#666;padding:20px 0}' +
      '.besrw-more{display:inline-block;margin-top:16px;color:#0B4321;font-weight:600;text-decoration:none}';
    document.head.appendChild(h('style', { id: STYLE_ID }, [css]));
  }

  function card(ev, site) {
    var href = site + BASE_PATH + '/' + encodeURIComponent(ev.slug);
    var kids = [];
    if (ev.image_url) {
      kids.push(h('img', { class: 'besrw-img', src: ev.image_url, alt: '', loading: 'lazy' }));
    } else {
      kids.push(h('div', { class: 'besrw-img besrw-img-empty' }, ['No image']));
    }

    var body = [
      h('div', { class: 'besrw-name' }, [ev.name || 'Event']),
      h('div', { class: 'besrw-meta' }, [
        formatDate(ev.start_datetime) +
          (ev.occurrence_count > 1 ? ' +' + (ev.occurrence_count - 1) + ' more dates' : ''),
      ]),
      h('div', { class: 'besrw-meta' }, [
        [ev.city, ev.country].filter(Boolean).join(', '),
      ]),
    ];
    var pills = [];
    if (ev.event_format) pills.push(h('span', { class: 'besrw-fmt' }, [ev.event_format]));
    categories(ev).forEach(function (cat) {
      pills.push(h('span', { class: 'besrw-cat' }, [cat]));
    });
    if (pills.length) body.push(h('div', { class: 'besrw-pills' }, pills));

    kids.push(h('div', { class: 'besrw-body' }, body));
    return h('a', { class: 'besrw-card', href: href, target: '_top' }, kids);
  }

  function batches(events, size) {
    var grouped = [];
    for (var i = 0; i < events.length; i += size) {
      grouped.push(events.slice(i, i + size));
    }
    return grouped;
  }

  function visibleCardCount(width, maxCards) {
    var cardsThatFit = Math.floor((width + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP));
    return Math.max(1, Math.min(maxCards, cardsThatFit));
  }

  function render(mount, events, opts) {
    mount.innerHTML = '';
    if (mount.__bambooEventsSingleRowTimer) {
      window.clearInterval(mount.__bambooEventsSingleRowTimer);
      mount.__bambooEventsSingleRowTimer = null;
    }
    if (mount.__bambooEventsSingleRowObserver) {
      mount.__bambooEventsSingleRowObserver.disconnect();
      mount.__bambooEventsSingleRowObserver = null;
    }

    var wrap = h('div', { class: 'besrw-wrap' });
    if (opts.title) wrap.appendChild(h('div', { class: 'besrw-title' }, [opts.title]));

    var validEvents = events.filter(function (ev) { return ev && ev.slug; });
    if (!validEvents.length) {
      wrap.appendChild(h('div', { class: 'besrw-empty' }, ['No upcoming events right now — check back soon.']));
      mount.appendChild(wrap);
      return;
    }

    var grid = h('div', { class: 'besrw-grid' });
    var currentBatch = 0;
    var currentCardCount = 0;

    function draw(resetBatch) {
      var nextCardCount = visibleCardCount(grid.clientWidth || wrap.clientWidth, opts.maxCards);
      if (resetBatch || nextCardCount !== currentCardCount) currentBatch = 0;
      currentCardCount = nextCardCount;

      var grouped = batches(validEvents, currentCardCount);
      if (currentBatch >= grouped.length) currentBatch = 0;
      grid.innerHTML = '';
      grid.style.gridTemplateColumns = 'repeat(' + currentCardCount + ', minmax(0, 1fr))';
      grouped[currentBatch].forEach(function (ev) {
        grid.appendChild(card(ev, opts.site));
      });
    }

    function advance() {
      var grouped = batches(validEvents, currentCardCount);
      if (grouped.length < 2) return;
      currentBatch = (currentBatch + 1) % grouped.length;
      draw(false);
    }

    wrap.appendChild(grid);
    wrap.appendChild(
      h('a', { class: 'besrw-more', href: opts.site + BASE_PATH, target: '_top' }, ['See all events →'])
    );
    mount.appendChild(wrap);
    draw(true);

    if (validEvents.length > 1) {
      mount.__bambooEventsSingleRowTimer = window.setInterval(advance, opts.intervalMs);
    }

    if (typeof window.ResizeObserver === 'function') {
      mount.__bambooEventsSingleRowObserver = new window.ResizeObserver(function () {
        var nextCardCount = visibleCardCount(grid.clientWidth || wrap.clientWidth, opts.maxCards);
        if (nextCardCount !== currentCardCount) draw(true);
      });
      mount.__bambooEventsSingleRowObserver.observe(wrap);
    } else {
      window.addEventListener('resize', function () {
        var nextCardCount = visibleCardCount(grid.clientWidth || wrap.clientWidth, opts.maxCards);
        if (nextCardCount !== currentCardCount) draw(true);
      });
    }
  }

  function init() {
    var mount = document.getElementById(MOUNT_ID);
    if (!mount) return;

    var opts = {
      api: (mount.getAttribute('data-api') || DEFAULT_API).replace(/\/$/, ''),
      site: (mount.getAttribute('data-site') || DEFAULT_SITE).replace(/\/$/, ''),
      limit: numberAttr(mount, 'data-limit', DEFAULT_LIMIT, 1, 24),
      maxCards: numberAttr(mount, 'data-max-cards', DEFAULT_MAX_CARDS, 1, 4),
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
          h('div', { class: 'besrw-wrap' }, [
            h('div', { class: 'besrw-empty' }, ['Events are unavailable right now.']),
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
