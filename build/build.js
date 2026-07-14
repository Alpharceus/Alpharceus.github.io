#!/usr/bin/env node
/**
 * Static blog generator + sitemap regenerator for ramanpandey.com
 *
 * Source of truth: articles/*.md with YAML-ish front matter:
 *   ---
 *   id: my-post
 *   title: My Post
 *   date: 2026-01-01
 *   summary: One sentence.
 *   ---
 *
 * Outputs:
 *   articles/<id>.html   — static post pages (Article JSON-LD, canonical, back-nav)
 *   assets/blogs.json    — index { id, title, date, summary }
 *   blogs.html           — static card index page (Alnitak)
 *   sitemap.xml          — regenerated with all pages + posts
 */

const fs = require('fs');
const path = require('path');
const MarkdownIt = require('markdown-it');

const md = new MarkdownIt({ html: false, linkify: true, typographer: false });

const ROOT = path.join(__dirname, '..');
const SITE = 'https://ramanpandey.com';
const ARTICLES_DIR = path.join(ROOT, 'articles');

// ---------- front matter ----------
function parseFrontMatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { meta, body: raw.slice(m[0].length) };
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

// ---------- article page template ----------
function articleTemplate({ id, title, date, summary, about, html }) {
  const url = `${SITE}/articles/${id}.html`;
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    datePublished: date,
    description: summary,
    ...(about ? { about } : {}),
    url,
    author: {
      '@type': 'Person',
      name: 'Raman Pandey',
      url: `${SITE}/about/`,
    },
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)} | Raman Pandey</title>
  <meta name="description" content="${esc(summary)}">
  <link rel="canonical" href="${url}">
  <link rel="icon" type="image/svg+xml" href="../assets/favicon.svg">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(summary)}">
  <meta property="og:url" content="${url}">
  <meta name="twitter:card" content="summary">
  <script type="application/ld+json">
${JSON.stringify(jsonld, null, 2)}
  </script>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0; padding: 0 20px;
      background: #0e101f; color: #d6dcf0;
      font: 400 1.05rem/1.75 Georgia, 'Times New Roman', serif;
    }
    article { max-width: 680px; margin: 0 auto; padding: 48px 0 80px; }
    h1, h2 { font-family: 'Segoe UI', Helvetica, Arial, sans-serif; color: #f0f3ff; line-height: 1.3; }
    h1 { font-size: 2rem; margin-bottom: 0.3em; }
    h2 { font-size: 1.3rem; margin-top: 2em; }
    a { color: #8fb8ff; }
    blockquote { border-left: 3px solid #4a6bb0; margin-left: 0; padding-left: 1.2em; color: #aab4d4; }
    .post-meta { font-family: 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 0.9rem; color: #8b95b5; margin-bottom: 2.5em; }
    .back-nav { font-family: 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 0.9rem; margin-bottom: 3em; }
    .back-nav a { text-decoration: none; }
    hr { border: none; border-top: 1px solid #2a3050; margin: 2.5em 0; }
    img { max-width: 100%; }
    pre { overflow-x: auto; background: #161a30; padding: 1em; border-radius: 6px; }
  </style>
</head>
<body>
  <article>
    <nav class="back-nav"><a href="../blogs.html">&larr; All posts</a> &nbsp;&middot;&nbsp; <a href="../index.html">ramanpandey.com</a></nav>
    <h1>${esc(title)}</h1>
    <p class="post-meta">By <a href="../about/">Raman Pandey</a> &middot; <time datetime="${esc(date)}">${esc(formatDate(date))}</time></p>
${html}
  </article>
</body>
</html>
`;
}

// ---------- blog index template ----------
// Alnitak (philosophy & scicomm pillar):
//  • Book-open veil — pure overlay on top of fully-rendered content (crawlers
//    and curl see everything from the first byte); ≤1.5s, click-to-skip,
//    once per session, auto-skipped under prefers-reduced-motion.
//  • Quotes on idle — sentences from Raman's own essays surface in the page
//    MARGINS (never over or adjacent to the cards) after ~5s without any
//    scroll/pointer/key activity; any interaction fades them immediately.
//    Wide viewports only (margins must exist). Pool: assets/blog-quotes.json.
function blogsIndexTemplate(posts, quotes) {
  const cards = posts
    .map(
      (p) => `      <a class="post-card" href="articles/${p.id}.html">
        <h2>${esc(p.title)}</h2>
        <time datetime="${esc(p.date)}">${esc(formatDate(p.date))}</time>
        <p>${esc(p.summary)}</p>
        <span class="read-more">Read &rarr;</span>
      </a>`
    )
    .join('\n');

  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Blog — Raman Pandey',
    url: `${SITE}/blogs.html`,
    description:
      'Essays on science, skepticism, and philosophy — the science-communication pillar of the portfolio, rendered as cards over a deep-field starscape.',
    about: 'Philosophy and science communication',
    isPartOf: { '@type': 'WebSite', name: 'Raman Pandey — Portfolio', url: `${SITE}/` },
    author: { '@type': 'Person', name: 'Raman Pandey', url: `${SITE}/about/` },
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Blog | Raman Pandey</title>
  <meta name="description" content="Essays on science, skepticism, and philosophy by Raman Pandey — quantum computing researcher and science-communication enthusiast.">
  <link rel="canonical" href="${SITE}/blogs.html">
  <link rel="icon" type="image/svg+xml" href="assets/favicon.svg">
  <script type="application/ld+json">
${JSON.stringify(jsonld, null, 2)}
  </script>
  <script>
  // veil guard: repeat visitors and reduced-motion users never see the overlay
  // TESTING PHASE: once-per-session is OFF (veil replays every load) — set
  // VEIL_ONCE_PER_SESSION back to true before launch
  window.VEIL_ONCE_PER_SESSION = false;
  (function () {
    var d = document.documentElement;
    try {
      if ((window.VEIL_ONCE_PER_SESSION && sessionStorage.getItem('blogVeilPlayed')) ||
          window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        d.classList.add('no-veil');
      } else {
        d.classList.add('veiling'); // stages the content entrance after the book opens
      }
    } catch (e) { d.classList.add('no-veil'); }
  }());
  </script>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh;
      font-family: 'Segoe UI', Helvetica, Arial, sans-serif;
      color: #d6dcf0;
      background:
        radial-gradient(1px 1px at 12% 22%, rgba(255,255,255,0.8) 50%, transparent 51%),
        radial-gradient(1px 1px at 34% 68%, rgba(255,255,255,0.55) 50%, transparent 51%),
        radial-gradient(1.5px 1.5px at 56% 12%, rgba(200,220,255,0.7) 50%, transparent 51%),
        radial-gradient(1px 1px at 71% 41%, rgba(255,255,255,0.6) 50%, transparent 51%),
        radial-gradient(1.5px 1.5px at 88% 76%, rgba(255,230,200,0.6) 50%, transparent 51%),
        radial-gradient(1px 1px at 45% 89%, rgba(255,255,255,0.5) 50%, transparent 51%),
        radial-gradient(1px 1px at 5% 60%, rgba(200,220,255,0.6) 50%, transparent 51%),
        radial-gradient(1.2px 1.2px at 64% 58%, rgba(255,255,255,0.65) 50%, transparent 51%),
        radial-gradient(1px 1px at 25% 40%, rgba(255,255,255,0.45) 50%, transparent 51%),
        radial-gradient(ellipse at 60% 20%, #171b33 0%, #0e101f 55%);
      background-attachment: fixed;
    }
    header { padding: 22px 32px; }
    header a { color: #8fb8ff; text-decoration: none; font-size: 0.9rem; letter-spacing: 0.08em; }
    main { max-width: 760px; margin: 0 auto; padding: 20px 24px 90px; }
    h1 { color: #f0f3ff; font-weight: 600; letter-spacing: 0.02em; }
    .lede { color: #8b95b5; margin-bottom: 2.6em; }
    .post-card {
      display: block; text-decoration: none; color: inherit;
      background: rgba(22, 26, 48, 0.72);
      border: 1px solid rgba(120, 150, 220, 0.18);
      border-radius: 14px;
      padding: 22px 26px; margin-bottom: 22px;
      transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
      backdrop-filter: blur(2px);
    }
    .post-card:hover {
      transform: translateY(-2px);
      border-color: rgba(140, 180, 255, 0.45);
      box-shadow: 0 6px 30px rgba(60, 100, 200, 0.18);
    }
    .post-card h2 { margin: 0 0 4px; font-size: 1.2rem; color: #eef2ff; }
    .post-card time { font-size: 0.82rem; color: #8b95b5; }
    .post-card p { color: #b8c1dd; font-size: 0.95rem; line-height: 1.6; margin: 10px 0 8px; }
    .read-more { font-size: 0.85rem; color: #8fb8ff; }
    footer { text-align: center; color: #6b7494; font-size: 0.8rem; padding: 20px; }

    /* ---- book-open veil (index only; pure overlay above real content) ----
       Scene: ancient tome on display → camera slowly zooms while the cover
       opens and pages flip to a spread → veil lifts, blog elements fade in. */
    #book-veil {
      position: fixed; inset: 0; z-index: 60;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; overflow: hidden;
      background: radial-gradient(ellipse at 50% 42%, #1b1526 0%, #0b0912 62%, #050408 100%);
    }
    .veil-stage { perspective: 1500px; perspective-origin: 50% 42%; }
    .book-scene { transform: scale(0.85); transform-style: preserve-3d; }
    .book {
      position: relative;
      width: min(300px, 56vw); aspect-ratio: 5 / 7;
      transform-style: preserve-3d;
      transform: rotateX(12deg); /* closed book sits dead center; shifts right as it opens so the spread stays centered */
    }
    .book::before { /* spine */
      content: ""; position: absolute; top: -2px; bottom: -2px; left: -12px; width: 14px;
      background: linear-gradient(90deg, #170d04 0%, #3a2510 60%, #241505 100%);
      border-radius: 6px 0 0 6px;
      box-shadow: 0 14px 40px rgba(0,0,0,0.6);
    }
    .book::after { /* page-block edge peeking past the cover */
      content: ""; position: absolute; top: 7px; bottom: 7px; right: -3px; width: 6px;
      background: repeating-linear-gradient(90deg, #e2d3ab 0 1px, #b3a074 1px 2px);
      border-radius: 0 2px 2px 0;
    }
    .book-back, .book-cover {
      position: absolute; inset: 0;
      transform-origin: left center;
      border-radius: 3px 10px 10px 3px;
      background:
        radial-gradient(ellipse at 30% 22%, rgba(255,220,150,0.08), transparent 55%),
        linear-gradient(115deg, #241505 0%, #4a2f14 35%, #5d3d1c 55%, #38230d 85%, #1d1105 100%);
      box-shadow: 0 18px 50px rgba(0,0,0,0.65), inset 0 0 40px rgba(0,0,0,0.5);
    }
    .book-back { inset: -3px -4px; border-radius: 3px 11px 11px 3px; }
    .book-cover { transform: translateZ(12px); }
    .book-cover::before { /* embossed gold frame */
      content: ""; position: absolute; inset: 11px;
      border: 3px double rgba(212, 175, 95, 0.55);
      border-radius: 2px 7px 7px 2px;
    }
    .cover-mark {
      position: absolute; top: 17%; left: 0; right: 0; text-align: center;
      color: rgba(224, 188, 112, 0.9); font-family: Georgia, serif; font-size: 1.7rem;
      text-shadow: 0 0 14px rgba(224, 188, 112, 0.35);
    }
    .cover-title {
      position: absolute; top: 32%; left: 0; right: 0; padding: 0 16%;
      text-align: center;
      color: rgba(224, 188, 112, 0.88); font-family: Georgia, serif;
      font-size: 1.02rem; letter-spacing: 0.14em; line-height: 1.7;
      text-transform: uppercase;
      text-shadow: 0 0 10px rgba(224, 188, 112, 0.25);
    }
    .cover-author {
      position: absolute; bottom: 13%; left: 0; right: 0; text-align: center;
      color: rgba(212, 175, 95, 0.65); font-family: Georgia, serif;
      font-size: 0.64rem; letter-spacing: 0.34em; text-transform: uppercase;
      text-indent: 0.34em; /* recenter: letter-spacing pads only the right side */
    }
    .leaf {
      position: absolute; inset: 5px 7px 5px 0;
      transform-origin: left center;
      border-radius: 0 6px 6px 0;
      background: linear-gradient(100deg, #d5c49c 0%, #eee1c0 18%, #e5d5ae 60%, #c9b688 100%);
      box-shadow: inset -14px 0 24px rgba(90, 70, 40, 0.25), inset 5px 0 12px rgba(90, 70, 40, 0.4);
    }
    .leaf::after { /* faint script lines on the parchment */
      content: ""; position: absolute; inset: 13% 11%;
      background: repeating-linear-gradient(180deg, rgba(90, 70, 45, 0.3) 0 1px, transparent 1px 9px);
      opacity: 0.45;
    }
    .leaf-1 { transform: translateZ(10px); }
    .leaf-2 { transform: translateZ(9px); }
    .leaf-3 { transform: translateZ(8px); }
    .leaf-4 { transform: translateZ(7px); }
    .leaf-5 { transform: translateZ(6px); }
    .leaf-6 { transform: translateZ(5px); }
    .leaf-7 { transform: translateZ(4px); }
    .leaf-8 { transform: translateZ(3px); }
    .leaf-9 { transform: translateZ(2px); }
    .leaf-10 { transform: translateZ(1px); }
    .veil-hint {
      position: absolute; bottom: 26px; left: 26px;
      font-size: 0.7rem; letter-spacing: 0.14em;
      color: rgba(170, 185, 220, 0.55); text-transform: uppercase;
    }
    /* timeline (runs when html.veil-open lands): camera zooms the whole time,
       cover opens at 0.45s, five leaves flip 1.4s→3s (five stay — the book
       lands on a middle spread), veil lifts at 3.15s */
    html.veil-open .book-scene { animation: veilCamera 3.4s cubic-bezier(0.4, 0.1, 0.3, 1) forwards; }
    html.veil-open .book { animation: bookCenter 1.3s 0.45s cubic-bezier(0.65, 0, 0.35, 1) forwards; }
    html.veil-open .book-cover { animation: coverOpen 1.3s 0.45s cubic-bezier(0.65, 0, 0.35, 1) forwards; }
    html.veil-open .leaf-1 { animation: leafFlip1 0.7s 1.4s ease-in-out forwards; }
    html.veil-open .leaf-2 { animation: leafFlip2 0.7s 1.62s ease-in-out forwards; }
    html.veil-open .leaf-3 { animation: leafFlip3 0.7s 1.84s ease-in-out forwards; }
    html.veil-open .leaf-4 { animation: leafFlip4 0.7s 2.06s ease-in-out forwards; }
    html.veil-open .leaf-5 { animation: leafFlip5 0.7s 2.28s ease-in-out forwards; }
    html.veil-open #book-veil { animation: veilLift 0.75s 3.15s ease forwards; }
    @keyframes veilCamera {
      0% { transform: scale(0.85); }
      60% { transform: scale(1.24); }
      100% { transform: scale(1.85) translateY(4vh); }
    }
    @keyframes bookCenter {
      from { transform: rotateX(12deg) translateX(0); }
      to { transform: rotateX(8deg) translateX(50%); }
    }
    @keyframes coverOpen { to { transform: translateZ(12px) rotateY(-178deg); } }
    @keyframes leafFlip1 { to { transform: translateZ(10px) rotateY(-176deg); } }
    @keyframes leafFlip2 { to { transform: translateZ(9px) rotateY(-173.5deg); } }
    @keyframes leafFlip3 { to { transform: translateZ(8px) rotateY(-171deg); } }
    @keyframes leafFlip4 { to { transform: translateZ(7px) rotateY(-168.5deg); } }
    @keyframes leafFlip5 { to { transform: translateZ(6px) rotateY(-166deg); } }
    @keyframes veilLift { to { opacity: 0; } }
    html.no-veil #book-veil { display: none; }

    /* blog elements appear once the book has opened (only when the veil plays;
       no-JS / reduced-motion never get the hidden state) */
    html.veiling header, html.veiling main > *, html.veiling footer {
      opacity: 0; transform: translateY(16px);
    }
    html.veil-done header, html.veil-done main > *, html.veil-done footer {
      opacity: 1; transform: none;
      transition: opacity 0.9s ease, transform 0.9s ease;
    }
    html.veil-done main > *:nth-child(1) { transition-delay: 0.1s; }
    html.veil-done main > *:nth-child(2) { transition-delay: 0.22s; }
    html.veil-done main > *:nth-child(3) { transition-delay: 0.34s; }
    html.veil-done main > *:nth-child(4) { transition-delay: 0.46s; }
    html.veil-done main > *:nth-child(5) { transition-delay: 0.58s; }
    html.veil-done main > *:nth-child(n+6) { transition-delay: 0.7s; }
    html.veil-done footer { transition-delay: 0.8s; }

    /* ---- margin quotes, persistent rotation (never over the cards) ---- */
    .idle-quote {
      position: fixed; z-index: 5;
      width: min(280px, calc((100vw - 900px) / 2 - 40px));
      opacity: 0; pointer-events: none;
      transition: opacity 1.4s ease;
      font-family: Georgia, 'Times New Roman', serif;
      font-style: italic; font-size: 1.02rem; line-height: 1.7;
      color: rgba(196, 208, 238, 0.88);
    }
    .idle-quote.show { opacity: 1; }
    .idle-quote .q-src {
      display: block; margin-top: 0.7em;
      font-family: 'Segoe UI', Helvetica, Arial, sans-serif;
      font-style: normal; font-size: 0.7rem; letter-spacing: 0.08em;
      color: rgba(130, 145, 185, 0.85);
    }
    #quote-left { left: 30px; top: 24vh; }
    #quote-right { right: 30px; top: 50vh; text-align: right; }
    /* margins too narrow → no quotes at all (text-over-text is forbidden) */
    @media (max-width: 1319px) { .idle-quote { display: none; } }
    @media (prefers-reduced-motion: reduce) { .idle-quote { display: none; } }
  </style>
</head>
<body>
  <div id="book-veil" aria-hidden="true">
    <div class="veil-stage">
      <div class="book-scene">
        <div class="book">
          <div class="book-back"></div>
          <div class="leaf leaf-10"></div>
          <div class="leaf leaf-9"></div>
          <div class="leaf leaf-8"></div>
          <div class="leaf leaf-7"></div>
          <div class="leaf leaf-6"></div>
          <div class="leaf leaf-5"></div>
          <div class="leaf leaf-4"></div>
          <div class="leaf leaf-3"></div>
          <div class="leaf leaf-2"></div>
          <div class="leaf leaf-1"></div>
          <div class="book-cover">
            <span class="cover-mark">&#10022;</span>
            <span class="cover-title">Essays on Science, Skepticism &amp; Philosophy</span>
            <span class="cover-author">R &middot; Pandey</span>
          </div>
        </div>
      </div>
    </div>
    <span class="veil-hint">click to skip</span>
  </div>
  <noscript><style>#book-veil { display: none; }</style></noscript>

  <div id="quote-left" class="idle-quote" aria-hidden="true"></div>
  <div id="quote-right" class="idle-quote" aria-hidden="true"></div>

  <header>
    <nav><a href="index.html">&larr; Home</a></nav>
  </header>
  <main>
    <h1>Blog</h1>
    <p class="lede">Essays on science, skepticism, and philosophy &mdash; written for humans, readable by machines.</p>
${cards}
  </main>
  <footer>&copy; 2026 Raman Pandey</footer>

  <script>
  (function () {
    var docEl = document.documentElement;

    // ---- book-open veil: ancient tome, ~4s, click/key to skip ----
    // CSS owns the choreography (html.veil-open); JS only starts it, reveals
    // the content near the end, and hard-stops everything at 3.95s or on skip
    var veil = document.getElementById('book-veil');
    var veilTimers = [];
    function endVeil() {
      veilTimers.forEach(clearTimeout);
      docEl.classList.add('no-veil');
      docEl.classList.add('veil-done');
      if (window.VEIL_ONCE_PER_SESSION) {
        try { sessionStorage.setItem('blogVeilPlayed', '1'); } catch (e) {}
      }
    }
    if (veil && docEl.classList.contains('veiling') && !docEl.classList.contains('no-veil')) {
      veil.addEventListener('click', endVeil);
      window.addEventListener('keydown', endVeil, { once: true });
      // don't burn the animation while the tab is still hidden (fresh window
      // spawning, background tab) — wait until the reader can actually see it
      var startVeil = function () {
        if (docEl.classList.contains('no-veil')) return;
        docEl.classList.add('veil-open');
        // blog elements start appearing while the veil is still lifting
        veilTimers.push(setTimeout(function () { docEl.classList.add('veil-done'); }, 3050));
        veilTimers.push(setTimeout(endVeil, 3950));
      };
      if (document.visibilityState === 'hidden') {
        document.addEventListener('visibilitychange', function onVis() {
          if (document.visibilityState === 'visible') {
            document.removeEventListener('visibilitychange', onVis);
            startVeil();
          }
        });
      } else {
        startVeil();
      }
    } else {
      endVeil();
    }

    // ---- margin quotes: my own sentences, persistent rotation ----
    var QUOTES = __QUOTES_JSON__;
    var slots = [document.getElementById('quote-left'), document.getElementById('quote-right')];
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !slots[0] || !slots[1] || !QUOTES.length) {
      console.log('[margin-quotes] disabled: ' + (reduced ? 'prefers-reduced-motion' : 'no slots or empty quote pool'));
      return;
    }
    console.log('[margin-quotes] armed: ' + QUOTES.length + ' quotes; viewport ' +
      window.innerWidth + 'px (needs >=1320)');

    var lastIdx = -1, slotFlip = 0;

    function nextQuote() {
      if (window.innerWidth < 1320) {
        console.log('[margin-quotes] paused: viewport ' + window.innerWidth + 'px < 1320px — widen/maximize the window');
        setTimeout(nextQuote, 4000);
        return;
      }
      var idx;
      do { idx = Math.floor(Math.random() * QUOTES.length); }
      while (QUOTES.length > 1 && idx === lastIdx);
      lastIdx = idx;
      var q = QUOTES[idx];
      var slot = slots[slotFlip % 2];
      slotFlip++;
      slot.textContent = '\\u201C' + q.text + '\\u201D';
      var src = document.createElement('span');
      src.className = 'q-src';
      src.textContent = '\\u2014 ' + q.title;
      slot.appendChild(src);
      slot.classList.add('show');
      console.log('[margin-quotes] showing #' + idx + ' in ' + slot.id + ' (holds 8s, next 2.5s after fade)');
      setTimeout(function () {
        slot.classList.remove('show');
        setTimeout(nextQuote, 2500);
      }, 8000);
    }

    nextQuote();
  }());
  </script>
</body>
</html>
`.replace('__QUOTES_JSON__', () => JSON.stringify(quotes || []));
}

// ---------- sitemap ----------
const STATIC_PAGES = [
  { loc: `${SITE}/`, priority: '1.0' },
  { loc: `${SITE}/about/`, priority: '0.9' },
  { loc: `${SITE}/projects.html`, priority: '0.8' },
  { loc: `${SITE}/rigel.html`, priority: '0.8' },
  { loc: `${SITE}/skills.html`, priority: '0.7' },
  { loc: `${SITE}/now/`, priority: '0.7' },
  { loc: `${SITE}/papers.html`, priority: '0.6' },
  { loc: `${SITE}/blogs.html`, priority: '0.6' },
];

function sitemapTemplate(posts) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    ...STATIC_PAGES.map(
      (p) => `  <url>\n    <loc>${p.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <priority>${p.priority}</priority>\n  </url>`
    ),
    ...posts.map(
      (p) => `  <url>\n    <loc>${SITE}/articles/${p.id}.html</loc>\n    <lastmod>${p.date}</lastmod>\n    <priority>0.6</priority>\n  </url>`
    ),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

// ---------- main ----------
function main() {
  const posts = [];
  for (const file of fs.readdirSync(ARTICLES_DIR).filter((f) => f.endsWith('.md')).sort()) {
    const raw = fs.readFileSync(path.join(ARTICLES_DIR, file), 'utf8');
    const { meta, body } = parseFrontMatter(raw);
    const id = meta.id || path.basename(file, '.md');
    if (!meta.title || !meta.date) {
      console.error(`SKIP ${file}: missing title/date front matter`);
      continue;
    }
    const post = { id, title: meta.title, date: meta.date, summary: meta.summary || '', about: meta.about || '' };
    posts.push(post);
    const html = md.render(body);
    fs.writeFileSync(path.join(ARTICLES_DIR, `${id}.html`), articleTemplate({ ...post, html }));
    console.log(`built articles/${id}.html`);
  }

  posts.sort((a, b) => (a.date < b.date ? 1 : -1));

  // blogs.json stays a slim index: { id, title, date, summary }
  const index = posts.map(({ id, title, date, summary }) => ({ id, title, date, summary }));
  fs.writeFileSync(path.join(ROOT, 'assets', 'blogs.json'), JSON.stringify(index, null, 2) + '\n');
  console.log('built assets/blogs.json');

  // curated idle-quote pool (skipped gracefully if the file is absent)
  let quotes = [];
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'blog-quotes.json'), 'utf8'));
    const titleById = Object.fromEntries(posts.map((p) => [p.id, p.title]));
    quotes = raw
      .filter((q) => q && q.text)
      .map((q) => ({ text: q.text, title: titleById[q.source] || 'from the essays' }));
  } catch (e) {
    console.warn('no assets/blog-quotes.json — building blogs.html without idle quotes');
  }

  fs.writeFileSync(path.join(ROOT, 'blogs.html'), blogsIndexTemplate(posts, quotes));
  console.log('built blogs.html');

  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemapTemplate(posts));
  console.log('built sitemap.xml');
}

main();
