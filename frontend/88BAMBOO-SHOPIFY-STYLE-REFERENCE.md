# 88 Bamboo — Shopify Style Reference Pack

A compact, styling-only reference for building a **separate Next.js app** (e.g. `www.88bamboo.co/a/events`) that looks seamless with the main `88bamboo.co` Shopify storefront.

> **Source of truth:** These values were extracted from the live Shopify theme source (Liquid + SCSS + saved theme settings). The public pages are behind bot protection, but the theme compiles deterministically, so the "final rendered form" documented here is derived from the compiled stylesheet (`assets/theme.scss.liquid`) combined with the actual saved values in `config/settings_data.json`. That combination *is* the final state.
>
> **Theme identity:** Shopify **Debut** theme (built with Shopify Slate), heavily customized. On **article/blog pages only**, **Bootstrap 4.6.2** (CSS + JS via jsDelivr CDN) and **jQuery 3.7.1** are additionally loaded and the layout uses Bootstrap's `.container` grid. Everywhere else the native Debut `.page-width` system is used.

---

## 1. Quick-start cheat sheet (copy these into your design tokens)

```
/* ---- COLOURS ---- */
--color-bg:              #ffffff;  /* page background */
--color-text:            #3d4246;  /* headings, nav, general text, base link colour (slate) */
--color-body-text:       #000000;  /* article / RTE body copy */
--color-link:            #000000;  /* body-copy links (inherit body text) */
--color-brand-green:     #004f2d;  /* primary buttons, checkout accent */
--color-brand-green-hi:  #009c59;  /* button hover (brighter green) */
--color-green-header:    #0b4321;  /* header announcement-bar background */
--color-green-h6:        #03652a;  /* h6 accent green */
--color-green-link:      #1a6132;  /* RTE/nav green link accent + hover underline */
--color-button-text:     #f2f0e3;  /* button label (cream) */
--color-accent-yellow:   #fcc200;  /* "reviews bar" strip background */
--color-sale-text:       #557b97;  /* sale price / muted blue */
--color-border:          #e8e9eb;  /* hairline borders / dividers */
--color-border-form:     #949494;  /* input borders */
--color-footer-bg:       #f5f5f5;  /* footer background */
--color-footer-text:     #3d4246;  /* footer text */

/* ---- TYPE ---- */
--font-heading: "Buenard", Georgia, "Times New Roman", serif;  /* weight 400 */
--font-body:    Georgia, "Times New Roman", serif;             /* generic serif stack */
--font-size-base: 16px;   /* body */
--line-height-base: 1.5;
--font-size-header-base: 22px;  /* heading scale anchor */
--heading-line-height: 1.2;

/* ---- LAYOUT ---- */
--page-width: 1200px;      /* .page-width (home, shop, blog listing, footer) */
--container-xl: 1140px;    /* Bootstrap .container on article pages */
--gutter: 55px;            /* desktop */
--gutter-mobile: 22px;
--section-spacing: 55px;   /* desktop vertical rhythm */
--section-spacing-small: 35px;
--border-radius: 2px;      /* buttons, inputs */

/* ---- BREAKPOINTS (min-width unless noted) ---- */
--bp-small-max: 749px;   /* "small" = mobile */
--bp-medium: 750px;      /* "medium-up" kicks in */
--bp-large: 990px;
--bp-widescreen: 1400px;
```

The whole site is **serif**. Headings are **Buenard** (a Google serif font, weight 400 / regular — NOT bold). Body is a generic serif system stack. There are **no CSS custom properties in the live theme** (SCSS is compiled to static CSS); the variables above are a convenience for your Next.js port.

---

## 2. Fonts & weights

| Role | Family | Weight | Style | Notes |
|---|---|---|---|---|
| Headings (h1–h5, `.btn`, logo, nav) | **Buenard**, serif fallback | **400** (regular) | normal | Shopify setting `type_header_font: buenard_n4`. Buenard is on Google Fonts. Load it in Next.js. |
| Body / paragraphs / inputs | generic **serif** stack | 400 (bold 700, bolder available) | normal | Shopify setting `type_base_font: serif` → browser serif. Georgia/Times equivalent. |
| h6 | body serif | **700** | normal | Restyled to look like bold green body text (`#03652a`), NOT a Buenard heading. |
| Code / pre | Consolas, monospace | — | — | rare |

- Headings use `font-weight: 400` — do **not** bold them by default; Buenard at 400 is the intended look.
- Bold body text (`<strong>`) is very common in this site's content (authors bold whole paragraphs).

---

## 3. Type scale (anchor: base = 16px, header base = 22px)

Debut computes heading sizes as `header_base × factor`, rounded down, expressed in `em` relative to the 16px root.

| Element | Desktop (≥750px) | Mobile (≤749px) | Family / weight | Line-height |
|---|---|---|---|---|
| Body `p` | 16px | 16px | serif / 400 | 1.5 |
| **h1** | 29px (`22×1.35`) | 26px (`22×1.20`) | Buenard / 400 | 1.2 |
| **h2** | 22px (`22×1.00`) | ~19px (`×0.9`) | Buenard / 400 | 1.2 |
| **h3** | 22px | 22px | Buenard / 400 | 1.2 (`margin-top:.25rem`) |
| **h4** | 14px (`22×0.68`) | ~13px | Buenard / 400 | 1.2 |
| **h5** | 12px (`22×0.58`) | ~16px | Buenard / 400 | 1.2 |
| **h6** | 16px | 15px | serif / **700**, colour `#03652a` | 1.5 |
| **Article page title** (`.article__title`) | **~32px** (`font-size:200%`) | ~26px (falls back to h1) | Buenard / 400, centered | 1.2 |

- Heading margin: `0 0 17.5px` (`section-spacing-small/2`).
- The article-page `<h1 class="article__title">` is overridden to `200%` at ≥750px (≈32px). *Note a real bug in the theme:* the mobile override targets `.article_title` (single underscore) and never matches, so on mobile the title falls back to the h1 rule (~26px). Match the desktop 32px / mobile ~26px behaviour.
- Any `<h1>` that appears **inside** article body content is force-shrunk by JS to `16px / normal weight` (see `sections/article-content.liquid`). Only the top `.article__title` is large.

---

## 4. Colours (hex)

| Token | Hex | Where used |
|---|---|---|
| Page background | `#ffffff` | `body`, most sections |
| Primary text | `#3d4246` | headings, nav links, general text, default `a` colour (slate grey) |
| Body copy text | `#000000` | `.rte` / article body paragraphs |
| Link (body copy) | `#000000` | inherits body text; hover = slightly darkened slate |
| Brand green (primary) | `#004f2d` | `.btn` background, checkout accent/button, like/share/bookmark buttons |
| Brand green hover | `#009c59` | button hover state (brighter green) |
| Header bar green | `#0b4321` | header announcement-bar background (`color_bg`) |
| h6 green | `#03652a` | h6 text |
| Green link accent | `#1a6132` | RTE link underline + nav hover accents |
| Button label cream | `#f2f0e3` | `.btn` text colour |
| Accent yellow | `#fcc200` | site-wide "reviews bar" strip |
| Sale text | `#557b97` | sale prices (muted blue) |
| Border / divider | `#e8e9eb` | hairlines, blockquote borders |
| Input border | `#949494` | form fields |
| Image overlay | `#3d4246` @ 40% opacity | image overlays, text on images = `#fff` |
| Footer background | `#f5f5f5` | `.site-footer` |
| Footer text | `#3d4246` | footer text/links |
| In-article share box | `#fbcc85` (peach) | cloned like/share/bookmark strip background |

**Palette summary:** dark-green + cream primary, slate-grey text on white, with a yellow accent strip and peach highlight boxes. It reads as an editorial/whisky-magazine aesthetic.

---

## 5. Layout & containers

| Container | Max-width | Used on |
|---|---|---|
| `.page-width` | **1200px**, `margin: 0 auto` | home, shop, collections, blog listings, header, footer |
| Bootstrap `.container` | **1140px** (xl) / 960 / 720 / 540 | **article pages only** (Bootstrap 4.6.2) |

- Body wrapper: `<div class="page-container drawer-page-content" id="PageContainer">` → `<main class="main-content" id="MainContent">`. `.main-content` has `padding-top: 35px` (mobile) / `55px` (≥750px).
- `body` class is `template-{page_type}` (e.g. `template-index`, `template-article`).
- Vertical rhythm tokens: `$section-spacing: 55px`, `$section-spacing-small: 35px`, `$gutter-site: 55px` (mobile `22px`). Paragraph bottom margin ≈ `35px/1.8 ≈ 19px`.

### Article page structure (`templates/article.liquid`)
```
<article class="container">          ← Bootstrap container (1140px)
  <div class="grid"> <div class="grid__item">
    <div class="grid grid--full">
      <div class="grid__item medium-up--seven-tenths">   ← MAIN column = 70%
          {article-title}   {share buttons}   {article-content = article.content in .rte}
      </div>
      <div class="grid__item medium-up--three-tenths">   ← SIDEBAR = 30%
          {ads / newsletter / recommended / contributor}
      </div>
    </div>
  </div>
  {article-bottom-links}
</article>
{article-comments} {article-bottom-advertising} {article-back-category}
```
- Main column padding: `0 40px 0 30px` (≥750px), `0 10px 0 30px` (≤749px).
- **Effective article content column width ≈ 70% of 1140px ≈ ~740–790px** of readable text at desktop. For a clean events app, target a **content measure of ~720–780px**.
- On mobile the two columns stack (Debut `medium-up--*` classes are ≥750px only).

---

## 6. Top navbar / header (`sections/header.liquid`)

- Root: `<header class="site-header logo--left border-bottom">` (logo alignment = **left**).
- Layout: a `grid grid--no-gutters grid--table site-header__mobile-nav` (CSS `display:table` row).
- **Logo:** left, `max-width: 70px` (setting `logo_max_width: 70`), white-on-transparent PNG, wrapped in `<a class="site-header__logo-image">`. On the homepage the logo is inside an `<h1 class="h2 site-header__logo">`; on other pages a `<div>`.
- **Desktop nav:** `<nav id="AccessibleNav">` → `{% render 'site-nav' %}` producing `<ul class="site-nav list--inline" id="SiteNav">`. Custom inline style `width:130%`. Dropdowns: `.site-nav--has-dropdown` → `.site-nav__dropdown`, links `.site-nav__link.site-nav__link--main`, chevrons via `icon-chevron-down`.
- **Right icons:** `.site-header__icons-wrapper` with search toggle (`.site-header__search-toggle.js-drawer-open-top`), account + cart (both carry class `hide` → **hidden** on this store), and a hamburger (`.js-mobile-nav-toggle.mobile-nav--open`) shown on mobile.
- **No fixed pixel height** is set; header height ≈ logo (70px) + vertical padding. Treat the navbar as roughly **~90–110px tall** on desktop.
- Menu spacing comes from Debut's `.site-nav__link` padding (inline list, generous horizontal padding). Nav link colour = `#3d4246`, uppercase is **not** forced on nav.

### Bars stacked above the page (important for visual match)
Rendered in `layout/theme.liquid`, top-to-bottom:
1. **"Just In" marquee** — `.marquee-container > a.announcement-bar.announcement-bar--link` showing the latest `news` blog article title (`Just In 👉 <title>`). Always present.
2. Built-in Debut announcement bar — **disabled** (`message: false`).
3. **Reviews bar** — `<nav class="reviews-bar">` with `background-color:#FCC200` (yellow), `margin-bottom:2.5rem`, bold underlined links: "Over 2,500+ in-depth reviews: Whisky Reviews | Rum Reviews | …". Sits at the very top of `main-content` on every page.

---

## 7. Mobile navigation (`sections/header.liquid`)

- `<nav class="mobile-nav-wrapper medium-up--hide">` → `<ul id="MobileNav" class="mobile-nav">`. Hidden ≥750px; it's an off-canvas **drawer** toggled by the hamburger button (`.js-mobile-nav-toggle`), animated by Debut's `theme.js`.
- Multi-level (up to 3) accordion submenus: items `.mobile-nav__item`, links `.mobile-nav__link`, sublists `.mobile-nav__dropdown` (`data-level` 1/2/3), expand/collapse via `.js-toggle-submenu` with right/left chevron icons. Rows separated by `.border-bottom`.
- Icons swapped between `icon-hamburger` and `icon-close` on open/close.
- For a Next.js port: a slide-in drawer from the side with collapsible nested lists and a hamburger↔X toggle reproduces the behaviour; exact animation is not styling-critical.

---

## 8. Footer (`sections/footer.liquid`)

- `<footer class="site-footer">` → `.page-width` → `.site-footer__content` holding blocks. Background `#f5f5f5`, text `#3d4246`.
- **Live config = 2 blocks** → each becomes `site-footer__item--one-half`, list rendered inline (`list--inline`):
  1. **Quick links** (`link_list`, menu handle `footer-menu`) — heading uses `.h4`, links `.site-footer__linklist-item a`.
  2. **Newsletter** signup — heading `.h4` ("Subscribe to receive the latest recommendations, releases and exclusive offers."), email `input.newsletter__input` + `button.btn.newsletter__submit` (Subscribe).
- Below content: `<hr class="site-footer__hr">` (1px border, footer-bg darkened 10%).
- Bottom row (`grid grid--footer-float-right`): locale + currency selectors (`.disclosure` dropdowns), **social icons** (`.site-footer__social-icons`) for Facebook + Instagram + TikTok (TikTok is wired through the `tumblr` social slot) + RSS on blog pages, payment icons (`.site-footer__payment-icons`), and copyright `© {year}, 88 Bamboo`.
- Footer link hover: text/underline shifts to a computed darker shade of `#3d4246` (≈10% darker), underline `1px solid`.

---

## 9. Buttons (`assets/theme.scss.liquid`)

**`.btn` (primary):**
```css
background: #004f2d;
color: #f2f0e3;
font-family: "Buenard", serif;     /* header font */
font-weight: 400;
text-transform: uppercase;
letter-spacing: 0.08em;
font-size: 14px;                   /* base 16 − 2 */
border: 1px solid transparent;
border-radius: 2px;
padding: 8px 15px;                 /* mobile */
padding: 10px 18px;                /* ≥750px */
white-space: normal;
/* hover/focus */
background: #009c59;               /* brighter green */
color: #f2f0e3;
```
**Variants:**
- `.btn--secondary` — transparent bg, green text + green border.
- `.btn--tertiary` — transparent bg, `#3d4246` text + border (used for card "Read more").
- `.btn--small` — `padding: 8px 10px; font-size: 12px; line-height: 1`.
- `.btn--link` — looks like a plain text link (transparent, no border, left-aligned), colour `#3d4246`.
- Disabled: `opacity: 0.5`.

---

## 10. Links

```css
a            { color: #3d4246; text-decoration: none; }
a:hover,
a:focus      { color: <#3d4246 darkened ~10%>; }   /* ≈ #2d3134 */
a.classic-link { text-decoration: underline; }
a[href^="tel"] { color: inherit; }
```
- Body-copy (`.rte`) links inherit body text (`#000000`) and get a **green** (`#1a6132`) underline/hover accent in the article RTE context.
- Default links are **not underlined**; underline only via `.classic-link` or inside prose.

---

## 11. Cards — blog / article grid (`sections/featured-blog.liquid`, `snippets/relatedblogs.liquid`)

Grid: `<ul class="grid grid--uniform grid--blog">`, items `<li class="grid__item medium-up--one-third">` → **3 across on desktop, full-width stacked on mobile**.

Card anatomy:
- **Image:** `a.article__link` → `.article__grid-image-wrapper` → `.article__grid-image-container` with `padding-top: {100 / aspect_ratio}%` (preserves the image's **native aspect ratio**; no forced crop). `<img class="article__grid-image lazyload">`, lazy-loaded (lazysizes), `data-widths="[180,360,540,720,900,1080,1296,1512,1728,2048]"`, target render height ~**345px**.
- **Meta:** `.article__grid-meta` containing:
  - `<h3 class="article__title"><a>…</a></h3>` (Buenard 22px)
  - optional `.article__author`, `.article__date`
  - `.rte.article__grid-excerpt` — excerpt or first 150 chars of content
  - `<a class="btn btn--tertiary btn--small">Read more</a>`

For the events app, replicate: image on top (native ratio, lazy), title in Buenard, small muted date, short excerpt, outlined "Read more" pill.

---

## 12. Images & aspect ratios

- **Logo:** 70px max-width, transparent PNG.
- **Blog card images:** native aspect ratio preserved via `padding-top` percentage hack; responsive `srcset` up to 2048px; rendered ~345px tall.
- **Article featured image** (when enabled): `.article-featured-image-container { max-width: 600px; margin: 0 auto; }`, `img { width:100%; height:auto; }`, `object-fit: cover; object-position: center top`. *(Currently commented out in the article template, but this is the intended treatment.)*
- General: `img { max-width: 100%; }` (fluid). Use `object-fit: cover` for fixed-ratio thumbnails.

---

## 13. Breakpoints & responsive behaviour

From `assets/theme.scss.liquid` (and mirrored in JS `theme.breakpoints`):
```
small       : max-width 749px          /* mobile */
medium      : 750px – 989px
medium-up   : min-width 750px          /* most "desktop" styling */
large       : 990px – 1399px
large-up    : min-width 990px
widescreen  : min-width 1400px
```
- Debut grid helper classes: `medium-up--one-third`, `medium-up--one-half`, `medium-up--seven-tenths`, `medium-up--three-tenths`, `small--one-whole`, `small--hide`, `medium-up--hide`, etc. — the `medium-up--*` fractions only apply ≥750px; below that everything is full width.
- Inputs get `font-size: 16px` on mobile to prevent iOS zoom.

---

## 14. Spacing patterns

| Token | Value |
|---|---|
| `$section-spacing` | 55px (desktop vertical section rhythm) |
| `$section-spacing-small` | 35px |
| `$gutter-site` | 55px desktop / 22px mobile (grid gutters) |
| Heading bottom margin | ~17.5px (`section-spacing-small/2`) |
| Paragraph / RTE bottom margin | ~19px (`section-spacing-small/1.8`) |
| `.main-content` top padding | 35px mobile / 55px desktop |
| Reviews bar bottom margin | 2.5rem |
| Button padding | 8px 15px mobile / 10px 18px desktop |
| Border radius | 2px |

---

## 15. Animations & hover states

- **Buttons:** `background-color` transitions to brighter green (`#009c59`) on hover.
- **Links:** colour shift on hover (slate → darker slate; green accent in prose).
- **Announcement/marquee link:** background auto-lightens/darkens on hover (`color_lighten`/`color_darken`).
- **Mobile nav drawer:** slide-in off-canvas + accordion submenu expand (Debut `theme.js`).
- **Card images:** lazy-load fade-in (lazysizes `.lazyload`).
- **Article share dropdowns** (`templates/article.liquid`): `transition: max-height .3s ease, padding .3s ease` + opacity/visibility fade; pill buttons `transition: all .3s ease`.
- No large-scale scroll animations or parallax that are styling-critical.

---

## 16. Dependencies (Liquid ↔ CSS ↔ JS)

- **`assets/theme.scss.liquid`** is the single compiled stylesheet driving nearly all visual rules; it reads Shopify settings (`{{ settings.color_* }}`, `{{ settings.type_* }}`) at compile time. To replicate, hardcode the resolved values in section 1/4.
- **`config/settings_data.json`** supplies the *actual* colour/font/logo values consumed by the SCSS and section `{% schema %}` defaults (see section 17).
- **Header/footer colours** are injected via inline `<style>` blocks inside `sections/header.liquid` and `sections/footer.liquid` (announcement + footer bg/text), computed with Liquid `color_brightness`/`color_lighten`/`color_darken` — not in the main CSS.
- **Article pages** additionally depend on **Bootstrap 4.6.2** (`.container`, grid) and **jQuery 3.7.1**, loaded from jsDelivr in `layout/theme.liquid`. Your Next.js app does not need Bootstrap, but be aware article widths come from Bootstrap's container (1140px), not `.page-width` (1200px).
- **`theme.js` / `vendor.js` / `lazysizes.js`** handle mobile-nav drawer, dropdowns, lazy images. Not styling-critical to port; reproduce behaviour with your own components.
- The article title size hack, in-content H1 shrink, and share-button cloning live as inline `<script>`/`<style>` in `sections/article-title.liquid`, `sections/article-content.liquid`, and `templates/article.liquid`.

---

## 17. Theme settings that affect styling (`config/settings_data.json` → `current`)

Non-secret, style-relevant values actually in use:
```json
"color_text": "#3d4246",
"color_body_text": "#000000",
"color_sale_text": "#557B97",
"color_button": "#004f2d",
"color_button_text": "#f2f0e3",
"color_small_button_text_border": "#3d4246",
"color_text_field_text": "#000",
"color_text_field_border": "#949494",
"color_text_field": "#ffffff",
"color_image_overlay_text": "#fff",
"color_image_overlay": "#3d4246",
"image_overlay_opacity": 40,
"color_borders": "#e8e9eb",
"color_body_bg": "#ffffff",
"type_header_font": "buenard_n4",     // Buenard, weight 400
"type_header_base_size": 22,
"type_base_font": "serif",            // generic serif
"type_base_size": 16
```
Header section settings: `align_logo: "left"`, `logo_max_width: 70`, announcement `color_bg: "#0b4321"`, `color_text: "#ffffff"` (announcement disabled).
Footer section settings: `color_footer_bg: "#f5f5f5"`, `color_footer_text: "#3d4246"`, payment/locale/currency selectors shown.

*(Everything below `current.sections` in that file is page content/merchandising, not styling.)*

---

## Files the Events AI builder may need to see verbatim

Only these are genuinely styling/layout-critical (skip everything else in the theme):

1. **`assets/theme.scss.liquid`** — the master stylesheet: colours, fonts, type scale, `.page-width`, `.btn`, links, headings, grid/breakpoints, spacing. *(The single most important file.)*
2. **`config/settings_data.json`** — the `current` block only (top ~60 lines): resolved colour/font/logo values that the SCSS consumes.
3. **`sections/header.liquid`** — navbar + mobile-nav markup, logo sizing, announcement bar, inline colour `<style>`.
4. **`sections/footer.liquid`** — footer structure, columns, newsletter/social/copyright, inline colour `<style>`.
5. **`snippets/site-nav.liquid`** — desktop nav markup and class names (`.site-nav`, `.site-nav__link`, dropdowns).
6. **`templates/article.liquid`** — article page layout (70/30 two-column), share buttons, inline article CSS.
7. **`sections/article-title.liquid`** — article `<h1 class="article__title">` sizing (200% desktop) + category label.
8. **`sections/article-content.liquid`** — how `article.content` is rendered (wrapped in `.rte`; in-content H1 shrink script).
9. **`sections/featured-blog.liquid`** (or `snippets/relatedblogs.liquid`) — blog/article **card** markup + classes.
10. **`layout/theme.liquid`** — global wrappers (`#PageContainer`, `.main-content`), the marquee + yellow "reviews bar", and the Bootstrap/jQuery includes used on article pages.
```
