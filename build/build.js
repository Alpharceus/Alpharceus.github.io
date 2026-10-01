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
 *   projects.html        — project cards rendered from assets/projects.json between
 *                          <!-- projects:start --> and <!-- projects:end --> markers
 *   sitemap.xml          — regenerated with all pages + posts (lastmod = last git commit
 *                          date of each page's source file; mtime if git is unavailable)
 *   llms.txt             — llmstxt.org-style index for LLM clients (existing site wording only)
 *   llms-full.txt        — About FAQ + article summaries as plain text
 *   about/index.html     — FAQPage JSON-LD between <!-- faq-jsonld:start/end --> markers,
 *                          generated from the visible FAQ so the two can never drift
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const MarkdownIt = require('markdown-it');

const md = new MarkdownIt({ html: false, linkify: true, typographer: false });

const ROOT = path.join(__dirname, '..');
const SITE = 'https://ramanpandey.com';
const ARTICLES_DIR = path.join(ROOT, 'articles');
const PERSON_ID = `${SITE}/#person`;
const OG_IMAGE = `${SITE}/assets/og-card.png`;
const CONTACT = {
  email: 'info@ramanpandey.com',
  resume: `${SITE}/assets/resume.pdf`,
  linkedin: 'https://linkedin.com/in/alpha-arceus',
  github: 'https://github.com/Alpharceus',
  x: 'https://x.com/alpha_arceus',
};

// ---------- git dates ----------
// Last commit date (YYYY-MM-DD) of a repo-relative file. Falls back to the file's mtime
// when git is unavailable, the checkout is not a repo, or the file is untracked.
function gitDate(rel) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', rel], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(out)) return out;
  } catch (e) { /* fall through */ }
  return fs.statSync(path.join(ROOT, rel)).mtime.toISOString().slice(0, 10);
}

// Meta descriptions stay <= 160 chars: trim at a word boundary and add an ellipsis.
function metaDesc(s) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  if (t.length <= 160) return t;
  return t.slice(0, 159).replace(/\s+\S*$/, '').replace(/[\s,;:.—-]+$/, '') + '…';
}

// Open Graph + Twitter tags (every page shares the same card image).
function socialTags({ type, title, desc, url }) {
  return [
    `  <meta property="og:type" content="${type}">`,
    `  <meta property="og:site_name" content="Raman Pandey">`,
    `  <meta property="og:title" content="${esc(title)}">`,
    `  <meta property="og:description" content="${esc(desc)}">`,
    `  <meta property="og:url" content="${url}">`,
    `  <meta property="og:image" content="${OG_IMAGE}">`,
    `  <meta name="twitter:card" content="summary_large_image">`,
    `  <meta name="twitter:image" content="${OG_IMAGE}">`,
  ].join('\n');
}

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
function articleTemplate({ id, title, date, summary, about, modified, html }) {
  const url = `${SITE}/articles/${id}.html`;
  const desc = metaDesc(summary);
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    datePublished: date,
    dateModified: modified > date ? modified : date,
    description: summary,
    ...(about ? { about } : {}),
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    image: OG_IMAGE,
    author: {
      '@type': 'Person',
      '@id': PERSON_ID,
      name: 'Raman Pandey',
      url: `${SITE}/`,
    },
    publisher: { '@id': PERSON_ID },
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)} | Raman Pandey</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${url}">
  <link rel="icon" type="image/svg+xml" href="../assets/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
${socialTags({ type: 'article', title, desc, url })}
  <script type="application/ld+json">
${JSON.stringify(jsonld, null, 2)}
  </script>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      background: #0e101f; color: #d6dcf0;
      font: 400 1.05rem/1.75 Georgia, 'Times New Roman', serif;
    }
    article { box-sizing: border-box; max-width: 640px; margin: 0 auto; padding: 48px 20px 40px; }
    article p { font-size: 1.0625rem; line-height: 1.75; }
    h1, h2 { font-family: 'Space Grotesk', 'Segoe UI', Helvetica, Arial, sans-serif; color: #f0f3ff; line-height: 1.3; }
    h1 { margin-bottom: 0.3em; }
    h2 { font-size: 1.3rem; margin-top: 2em; }
    a { color: #8fb8ff; }
    blockquote { border-left: 3px solid #4a6bb0; margin-left: 0; padding-left: 1.2em; color: #aab4d4; }
    .post-meta { font-family: 'Space Grotesk', 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 0.9rem; color: #8b95b5; margin-bottom: 2.5em; }
    .back-nav { font-family: 'IBM Plex Mono', 'Menlo', 'Consolas', monospace; font-size: 0.9rem; margin-bottom: 3em; }
    .back-nav a { display: inline-block; padding: 6px 0; color: #70bfff; text-decoration: none; }
    .back-nav a:hover { color: #e2cfff; }
    hr { border: none; border-top: 1px solid #2a3050; margin: 2.5em 0; }
    img { max-width: 100%; }
    pre { overflow-x: auto; background: #161a30; padding: 1em; border-radius: 6px; }
  </style>
  <link rel="stylesheet" href="../css/site.css">
  <script src="../js/site.js" defer></script>
</head>
<body class="pg-title">
  <header class="site-bar">
    <a class="site-bar__home" href="/">Raman Pandey</a>
    <nav aria-label="Site">
      <a href="../projects.html">Projects</a>
      <a href="../skills.html">Skills</a>
      <a href="../papers.html">Papers</a>
      <a href="../blogs.html" aria-current="page">Blog</a>
      <a href="../now/">Now</a>
      <a href="../rigel.html">Rigel</a>
      <a href="../about/">About</a>
    </nav>
  </header>
  <article>
    <nav class="back-nav"><a href="../blogs.html">&larr; All posts</a> &nbsp;&middot;&nbsp; <a href="/">ramanpandey.com</a></nav>
    <h1>${esc(title)}</h1>
    <p class="post-meta">By <a href="../about/">Raman Pandey</a> &middot; <time datetime="${esc(date)}">${esc(formatDate(date))}</time></p>
${html}
  </article>
  <footer>&copy; 2026 Raman Pandey</footer>
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
    author: { '@type': 'Person', '@id': PERSON_ID, name: 'Raman Pandey', url: `${SITE}/` },
  };
  const blogDesc = 'Essays on science, skepticism, and philosophy by Raman Pandey — quantum computing researcher and science-communication enthusiast.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Blog | Raman Pandey</title>
  <meta name="description" content="${esc(blogDesc)}">
  <link rel="canonical" href="${SITE}/blogs.html">
${socialTags({ type: 'website', title: 'Blog | Raman Pandey', desc: blogDesc, url: `${SITE}/blogs.html` })}
  <link rel="icon" type="image/svg+xml" href="assets/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
  <script type="application/ld+json">
${JSON.stringify(jsonld, null, 2)}
  </script>
  <script>
  // Arrival handshake + veil guard (portfolio-motion-brief.md section 2). Runs before first paint.
  //   arrival: came from the Alnitak dive -> colour fill collapses onto the cover star, then the book opens
  //   first:   no session flag -> the full book-open veil
  //   skip:    flag set on a direct load, or reduced motion -> no veil
  // (set VEIL_ONCE_PER_SESSION to false to replay the veil on every load while testing)
  window.VEIL_ONCE_PER_SESSION = true;
  (function () {
    var d = document.documentElement;
    try {
      var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var a = JSON.parse(sessionStorage.getItem('arrival') || 'null');
      var arriving = !!(a && Date.now() - a.ts < 4000);
      sessionStorage.removeItem('arrival');
      if (arriving) {
        d.classList.add('arriving');
        d.style.setProperty('--arrival-rgb', a.rgb.join(','));
        window.__arrival = a;
      }
      if (reduced) {
        d.classList.add('no-veil');
      } else if (arriving) {
        d.classList.add('veiling', 'veil-fast'); // shorter book-open, staged after the fill collapses
      } else if (window.VEIL_ONCE_PER_SESSION && sessionStorage.getItem('blogVeilPlayed')) {
        d.classList.add('no-veil');
      } else {
        d.classList.add('veiling'); // stages the content entrance after the book opens
      }
    } catch (e) { d.classList.add('no-veil'); }
    // failsafe: never leave the page covered if the intro script fails
    setTimeout(function () { d.classList.remove('arriving'); }, 6000);
  }());
  </script>
  <script src="js/transition.js"></script>
  <style>
    :root { color-scheme: dark; }
    html { background: #0e101f; }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh;
      font-family: var(--font-ui);
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
    /* standard site header bar (matches portfolio-pages.css) */
    header {
      background: #232749;
      padding: 0.6em 2em;
      box-shadow: 0 2px 16px rgba(32, 40, 90, 0.10);
    }
    header nav,
    header nav a {
      font-family: 'IBM Plex Mono', 'Menlo', 'Consolas', monospace;
      color: #70bfff;
      text-decoration: none;
      font-size: 1.05em;
    }
    header nav a:hover { color: #e2cfff; text-shadow: 0 0 6px #79c3ff55; }
    main { max-width: 760px; margin: 0 auto; padding: 20px 24px 90px; }
    h1 { color: #f0f3ff; }
    .lede { color: #8b95b5; margin-bottom: 2.6em; }
    .post-card {
      display: block; text-decoration: none; color: inherit;
      background: none;
      border: 0; border-top: 1px solid var(--line);
      border-radius: 0;
      padding: 24px 0;
    }
    .post-card h2 { margin: 0 0 4px; font-size: 1.2rem; color: #eef2ff; transition: color 0.2s ease; }
    .post-card:hover h2 { color: var(--link-hover); }
    .post-card time { font-size: 0.82rem; color: #8b95b5; }
    .post-card p { color: #b8c1dd; font-size: 0.95rem; line-height: 1.6; margin: 10px 0 8px; }
    .read-more { font-size: 0.85rem; color: #8fb8ff; }

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
    .book-cover { transform: translateZ(12px); transform-style: preserve-3d; }
    /* cover art faces outward only; without this the title shows mirrored once the cover swings open */
    .book-cover > span, .book-cover::before { backface-visibility: hidden; -webkit-backface-visibility: hidden; }
    .book-cover::after { /* inside of the cover: endpaper */
      content: ""; position: absolute; inset: 6px 8px 6px 4px;
      transform: translateZ(-1px) rotateY(180deg);
      backface-visibility: hidden; -webkit-backface-visibility: hidden;
      border-radius: 8px 2px 2px 8px;
      background:
        radial-gradient(circle at 30% 30%, rgba(120, 60, 30, 0.25), transparent 40%),
        radial-gradient(circle at 70% 65%, rgba(60, 40, 80, 0.25), transparent 45%),
        linear-gradient(135deg, #3b2a1f, #2a1d2c 50%, #3a2616);
      box-shadow: inset 0 0 30px rgba(0,0,0,0.5);
    }
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

    /* ---- arrival: colour fill collapses onto the cover star (driven by playIntro) ---- */
    html.arriving body::before {
      content: ""; position: fixed; inset: 0; z-index: 9999; pointer-events: none;
      background: rgb(var(--arrival-rgb, 23, 27, 51));
      clip-path: circle(var(--arrival-r, 150vmax) at var(--arrival-x, 50%) var(--arrival-y, 50%));
      opacity: var(--arrival-op, 1);
    }
    /* the star glints once when the point lands */
    .cover-mark.glint { animation: markGlint 0.32s ease-out; }
    @keyframes markGlint {
      0% { transform: scale(1); filter: brightness(1); }
      35% { transform: scale(1.7); filter: brightness(1.9); text-shadow: 0 0 26px rgba(255, 226, 150, 0.95), 0 0 6px #fff; }
      100% { transform: scale(1); filter: brightness(1); }
    }
    /* arrival veil: the same book-open, compressed (whole arrival <= 2.5s).
       Timeline from html.veil-open: cover 0.2s, leaves 0.7s-1.36s, veil lifts 1.3s-1.7s */
    html.veil-fast.veil-open .book-scene { animation: veilCamera 1.5s cubic-bezier(0.4, 0.1, 0.3, 1) forwards; }
    html.veil-fast.veil-open .book { animation: bookCenter 0.6s 0.2s cubic-bezier(0.65, 0, 0.35, 1) forwards; }
    html.veil-fast.veil-open .book-cover { animation: coverOpen 0.6s 0.2s cubic-bezier(0.65, 0, 0.35, 1) forwards; }
    html.veil-fast.veil-open .leaf-1 { animation: leafFlip1 0.3s 0.7s ease-in-out forwards; }
    html.veil-fast.veil-open .leaf-2 { animation: leafFlip2 0.3s 0.79s ease-in-out forwards; }
    html.veil-fast.veil-open .leaf-3 { animation: leafFlip3 0.3s 0.88s ease-in-out forwards; }
    html.veil-fast.veil-open .leaf-4 { animation: leafFlip4 0.3s 0.97s ease-in-out forwards; }
    html.veil-fast.veil-open .leaf-5 { animation: leafFlip5 0.3s 1.06s ease-in-out forwards; }
    html.veil-fast.veil-open #book-veil { animation: veilLift 0.35s 1.15s ease forwards; }
    html.veil-fast.veil-done header, html.veil-fast.veil-done main > *, html.veil-fast.veil-done footer {
      transition: opacity 0.3s ease, transform 0.3s ease;
    }
    html.veil-fast.veil-done main > *:nth-child(1) { transition-delay: 0.03s; }
    html.veil-fast.veil-done main > *:nth-child(2) { transition-delay: 0.07s; }
    html.veil-fast.veil-done main > *:nth-child(3) { transition-delay: 0.11s; }
    html.veil-fast.veil-done main > *:nth-child(4) { transition-delay: 0.15s; }
    html.veil-fast.veil-done main > *:nth-child(5) { transition-delay: 0.19s; }
    html.veil-fast.veil-done main > *:nth-child(n+6) { transition-delay: 0.23s; }
    html.veil-fast.veil-done footer { transition-delay: 0.25s; }
    @media (prefers-reduced-motion: reduce) { .cover-mark.glint { animation: none; } }

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
  <link rel="stylesheet" href="css/site.css">
  <script src="js/site.js" defer></script>
</head>
<body class="pg-title">
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

  <header class="site-bar">
    <a class="site-bar__home" href="/">Raman Pandey</a>
    <nav aria-label="Site">
      <a href="projects.html">Projects</a>
      <a href="skills.html">Skills</a>
      <a href="papers.html">Papers</a>
      <a href="blogs.html" aria-current="page">Blog</a>
      <a href="now/">Now</a>
      <a href="rigel.html">Rigel</a>
      <a href="about/">About</a>
    </nav>
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

    // ---- book-open veil: ancient tome, click/key to skip ----
    // CSS owns the choreography (html.veil-open); JS only starts it, reveals
    // the content near the end, and hard-stops everything on skip.
    // Once-per-session flag: the pre-existing 'blogVeilPlayed' key (kept as is).
    var T = window.SiteTransition;
    var veil = document.getElementById('book-veil');
    var mark = document.querySelector('.cover-mark');

    // ---- timing (ms): tune here ----
    var FIRST = { doneAt: 3050, total: 3950 };         // unchanged from before the arrival variant
    var ARRIVAL = {
      hold: 80, collapse: 340,                         // colour fill holds, then shrinks onto the star
      dotPx: 5, dotEnd: 520,                           // it lands as a small dot, absorbed into the glint
      glintAt: 420,                                    // star glints as the point lands
      openAt: 560,                                     // book-open starts (veil-fast timings in CSS)
      doneAt: 1450, total: 2050                        // content reveal, hard stop (headroom for slow Firefox timers)
    };
    var REDUCED_FADE_MS = 150;                         // reduced-motion arrival: fill fades out

    var veilTimers = [];
    var arrivalRun = null;
    function endVeil() {
      veilTimers.forEach(clearTimeout);
      docEl.classList.add('no-veil');
      docEl.classList.add('veil-done');
      if (window.VEIL_ONCE_PER_SESSION) {
        try { sessionStorage.setItem('blogVeilPlayed', '1'); } catch (e) {}
      }
    }
    function clearArrival() {
      docEl.classList.remove('arriving');
      ['--arrival-r', '--arrival-x', '--arrival-y', '--arrival-op', '--arrival-rgb'].forEach(function (k) {
        docEl.style.removeProperty(k);
      });
    }
    function setVar(k, v) { docEl.style.setProperty(k, String(v)); }
    function clamp01(v) { return Math.max(0, Math.min(1, v)); }

    // Centre of the gold star on the closed cover, in viewport px. Measured on the
    // glyph itself (the span is full width), so it follows the book's 3D transform.
    function starPoint() {
      var r = mark.getBoundingClientRect();
      if (document.createRange) {
        var rg = document.createRange();
        rg.selectNodeContents(mark);
        var g = rg.getBoundingClientRect();
        if (g.width > 0) r = g;
      }
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    window.blogStarPoint = starPoint;   // hook: where the arrival colour lands

    function startVeil() {
      if (docEl.classList.contains('no-veil')) return;
      docEl.classList.add('veil-open');
      // blog elements start appearing while the veil is still lifting
      veilTimers.push(setTimeout(function () { docEl.classList.add('veil-done'); }, FIRST.doneAt));
      veilTimers.push(setTimeout(endVeil, FIRST.total));
    }
    function whenVisible(fn) {
      // don't burn the animation while the tab is still hidden (fresh window
      // spawning, background tab) - wait until the reader can actually see it
      if (document.visibilityState === 'hidden') {
        document.addEventListener('visibilitychange', function onVis() {
          if (document.visibilityState === 'visible') {
            document.removeEventListener('visibilitychange', onVis);
            fn();
          }
        });
      } else {
        fn();
      }
    }

    // mode: 'arrival' | 'first' | 'skip'; arrival: {star, rgb, starRgb, ts} or null
    function playIntro(mode, arrival) {
      var playable = !!(veil && mark && docEl.classList.contains('veiling') && !docEl.classList.contains('no-veil'));
      if (mode === 'arrival' && !playable) {
        // reduced motion: no book, the arrival fill just fades out (<= 200 ms)
        endVeil();
        if (T) T.run(REDUCED_FADE_MS, function (t) { setVar('--arrival-op', 1 - clamp01(t / REDUCED_FADE_MS)); }, clearArrival);
        else clearArrival();
        return;
      }
      if (mode === 'skip' || !playable) { endVeil(); clearArrival(); return; }

      veil.addEventListener('click', endVeil);
      window.addEventListener('keydown', endVeil, { once: true });
      if (T) T.wireSkip(function () { if (arrivalRun) arrivalRun.finish(); else endVeil(); });

      if (mode !== 'arrival' || !T) { clearArrival(); whenVisible(startVeil); return; }

      whenVisible(function () {
        var p = starPoint();
        var W = window.innerWidth, H = window.innerHeight;
        var r0 = Math.hypot(Math.max(p.x, W - p.x), Math.max(p.y, H - p.y)) + 2;
        setVar('--arrival-x', p.x + 'px');
        setVar('--arrival-y', p.y + 'px');
        var glinted = false, opened = false, revealed = false;
        arrivalRun = T.run(ARRIVAL.total, function (t) {
          var c = clamp01((t - ARRIVAL.hold) / ARRIVAL.collapse);
          setVar('--arrival-r', (ARRIVAL.dotPx + (r0 - ARRIVAL.dotPx) * (1 - T.easeInOutCubic(c))).toFixed(1) + 'px');
          setVar('--arrival-op', t >= ARRIVAL.dotEnd ? 0 : 1);
          if (!glinted && t >= ARRIVAL.glintAt) { glinted = true; mark.classList.add('glint'); }
          if (!opened && t >= ARRIVAL.openAt) { opened = true; docEl.classList.add('veil-open'); }
          if (!revealed && t >= ARRIVAL.doneAt) { revealed = true; docEl.classList.add('veil-done'); }
        }, function () {
          clearArrival();
          endVeil();
        });
      });
    }
    window.playIntro = playIntro;
    playIntro(window.__arrival ? 'arrival' : (docEl.classList.contains('no-veil') ? 'skip' : 'first'), window.__arrival || null);

    // ---- margin quotes: my own sentences, persistent rotation ----
    var QUOTES = __QUOTES_JSON__;
    var slots = [document.getElementById('quote-left'), document.getElementById('quote-right')];
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !slots[0] || !slots[1] || !QUOTES.length) return;

    var lastIdx = -1, slotFlip = 0;

    function nextQuote() {
      if (window.innerWidth < 1320) { setTimeout(nextQuote, 4000); return; }
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
// src = repo-relative source file whose last commit date becomes <lastmod>
const STATIC_PAGES = [
  { loc: `${SITE}/`, src: 'index.html', priority: '1.0' },
  { loc: `${SITE}/about/`, src: 'about/index.html', priority: '0.9' },
  { loc: `${SITE}/projects.html`, src: 'projects.html', priority: '0.8' },
  { loc: `${SITE}/rigel.html`, src: 'rigel.html', priority: '0.8' },
  { loc: `${SITE}/skills.html`, src: 'skills.html', priority: '0.7' },
  { loc: `${SITE}/now/`, src: 'now/index.html', priority: '0.7' },
  { loc: `${SITE}/papers.html`, src: 'papers.html', priority: '0.6' },
  { loc: `${SITE}/blogs.html`, src: 'blogs.html', priority: '0.6' },
];

function sitemapTemplate(posts) {
  const urls = [
    ...STATIC_PAGES.map(
      (p) => `  <url>\n    <loc>${p.loc}</loc>\n    <lastmod>${gitDate(p.src)}</lastmod>\n    <priority>${p.priority}</priority>\n  </url>`
    ),
    ...posts.map(
      (p) => `  <url>\n    <loc>${SITE}/articles/${p.id}.html</loc>\n    <lastmod>${p.date}</lastmod>\n    <priority>0.6</priority>\n  </url>`
    ),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

// ---------- About FAQ -> FAQPage JSON-LD, llms.txt, llms-full.txt ----------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '\u2013', mdash: '\u2014', rarr: '\u2192', larr: '\u2190', middot: '\u00B7' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] !== undefined ? ENTITIES[e.toLowerCase()] : m;
  });
}
// visible text, whitespace collapsed (what a reader sees, minus layout)
function htmlText(s) {
  // block-level tags separate words; inline tags (a, strong, em) must not add spaces
  const t = s.replace(/<\/?(p|ul|ol|li|div|br|h[1-6]|section)[^>]*>/gi, ' ').replace(/<[^>]+>/g, '');
  return decodeEntities(t).replace(/\s+/g, ' ').trim();
}
// plain text keeping line structure (list items, paragraphs, <br>)
function htmlPlain(s) {
  const t = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|ul|ol|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(t)
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
}

function parseFaq() {
  const html = fs.readFileSync(path.join(ROOT, 'about', 'index.html'), 'utf8');
  const out = [];
  const re = /<section>\s*<h2>([\s\S]*?)<\/h2>([\s\S]*?)<\/section>/g;
  let m;
  while ((m = re.exec(html))) {
    const q = htmlText(m[1]);
    if (!q.endsWith('?')) continue; // only real FAQ entries (the Contact section is not one)
    out.push({ q, a: htmlText(m[2]), plain: htmlPlain(m[2]) });
  }
  return out;
}

function buildFaqJsonLd(faq) {
  const file = path.join(ROOT, 'about', 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  const re = /(<!-- faq-jsonld:start[^>]*-->)[\s\S]*?(<!-- faq-jsonld:end -->)/;
  if (!re.test(html)) throw new Error('about/index.html is missing the faq-jsonld:start / faq-jsonld:end markers');
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
  const json = JSON.stringify(ld, null, 2).replace(/</g, '\\u003c').split('\n').map((l) => '    ' + l).join('\n');
  const next = html.replace(re, (m, a, b) => `${a}\n    <script type="application/ld+json">\n${json}\n    </script>\n    ${b}`);
  if (next !== html) fs.writeFileSync(file, next);
  console.log(`built FAQPage JSON-LD (${faq.length} questions)`);
}

// Wording below is copied from the About page; nothing new is introduced here.
const LLMS_SUMMARY =
  'Raman Pandey is a graduate student in Electrical and Computer Engineering at the University of New Mexico (UNM) and a graduate research assistant at the Center for High Technology Materials (CHTM), advised by Prof. Marek Osinski. He specializes in Quantum Information Science, machine learning, and FPGA-based systems.';
const LLMS_SITE_LINE =
  'The site is an interactive portfolio structured as the Orion constellation. Every page also serves its content as static HTML.';

function llmsTxt(posts) {
  const pages = [
    ['Home', `${SITE}/`, 'the Orion star-map homepage.'],
    ['About', `${SITE}/about/`, 'who Raman is, research interests, projects, skills, tools, and academic goals, as an FAQ.'],
    ['Projects (Bellatrix)', `${SITE}/projects.html`, 'all projects with posters and artifacts, rendered as an animated microprocessor.'],
    ['Skills (Mintaka)', `${SITE}/skills.html`, '32 skills across hardware, quantum, software, and machine learning, rendered as an 8-mode Mach\u2013Zehnder interferometer mesh.'],
    ['Papers (Alnilam)', `${SITE}/papers.html`, 'journal publications (none yet; conference papers and posters live on the projects page).'],
    ['Blog (Alnitak)', `${SITE}/blogs.html`, 'essays on physics, computing, AI, and science communication.'],
    ['Now (Saiph)', `${SITE}/now/`, 'what Raman is working on this quarter, as a mission-control console.'],
    ['Rigel', `${SITE}/rigel.html`, 'an interactive quantum circuit simulator with a live Bloch sphere per qubit.'],
  ];
  const lines = [
    '# Raman Pandey',
    '',
    `> ${LLMS_SUMMARY}`,
    '',
    LLMS_SITE_LINE,
    '',
    '## Pages',
    '',
    ...pages.map(([n, u, d]) => `- [${n}](${u}): ${d}`),
    '',
    '## Blog articles',
    '',
    ...posts.map((p) => `- [${p.title}](${SITE}/articles/${p.id}.html): ${p.summary} (${p.date})`),
    '',
    '## Contact',
    '',
    `- [Email](mailto:${CONTACT.email}): ${CONTACT.email}`,
    `- [R\u00E9sum\u00E9 (PDF)](${CONTACT.resume})`,
    `- [LinkedIn](${CONTACT.linkedin})`,
    `- [GitHub](${CONTACT.github})`,
    `- [X](${CONTACT.x})`,
    '',
    '## Optional',
    '',
    `- [Sitemap](${SITE}/sitemap.xml): every page and article with last-modified dates.`,
    `- [Full text](${SITE}/llms-full.txt): the About FAQ and article summaries as plain text.`,
    '',
  ];
  return lines.join('\n');
}

function llmsFullTxt(posts, faq) {
  const lines = [
    '# Raman Pandey: full text',
    '',
    `> ${LLMS_SUMMARY}`,
    '',
    LLMS_SITE_LINE,
    '',
    `Source: ${SITE}/about/`,
    '',
    '## About (FAQ)',
    '',
  ];
  for (const f of faq) lines.push(`### ${f.q}`, '', f.plain, '');
  lines.push('## Blog articles', '');
  for (const p of posts) lines.push(`### ${p.title}`, '', `${SITE}/articles/${p.id}.html (${p.date})`, '', p.summary, '');
  lines.push(
    '## Contact',
    '',
    `Email: ${CONTACT.email}`,
    `R\u00E9sum\u00E9: ${CONTACT.resume}`,
    `LinkedIn: ${CONTACT.linkedin}`,
    `GitHub: ${CONTACT.github}`,
    `X: ${CONTACT.x}`,
    ''
  );
  return lines.join('\n');
}

// ---------- projects page cards ----------
// Cards are static HTML (crawlers/LLMs don't run JS); js/projects.js only enhances them.
const ARTIFACT_LABELS = { code: 'Code', code2: 'Code', paper: 'Paper', poster: 'Poster', nsf: 'NSF Award', org: 'GitHub Org' };
// a card with two repos (artifacts.code + artifacts.code2) labels them individually
const ARTIFACT_LABELS_TWO_CODE = { code: 'Code: Lattice', code2: 'Code: Galton' };

function projectCardHtml(proj) {
  const badges = Object.entries(proj.artifacts || {})
    .filter(([, url]) => url)
    .map(([key, url]) => {
      const label = (proj.artifacts.code2 && ARTIFACT_LABELS_TWO_CODE[key]) || ARTIFACT_LABELS[key] || esc(key);
      return `<a class="artifact-badge" href="${esc(url)}" data-title="${esc(proj.title)}">${label}</a>`;
    })
    .join('');
  const status = proj.status === 'in-progress'
    ? '<span class="status-chip in-progress">In&nbsp;progress</span>'
    : '<span class="status-chip done">Done</span>';
  const lines = [
    `<div class="project" id="${esc(proj.id)}"${proj.short ? ` data-short="${esc(proj.short)}"` : ''}>`,
    `  <div class="project-head"><h2>${esc(proj.title)}</h2> ${status}</div>`,
    `  <p>${esc(proj.desc || '')}</p>`,
  ];
  if (proj.summary) lines.push(`  <details><summary>Show Summary</summary><div>${esc(proj.summary)}</div></details>`);
  if (proj.note) lines.push(`  <p class="project-note">${esc(proj.note)}</p>`);
  if (badges) lines.push(`  <div class="artifact-row">${badges}</div>`);
  lines.push('</div>');
  return lines.join('\n');
}

function buildProjectsPage() {
  const projects = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'projects.json'), 'utf8').replace(/^\uFEFF/, ''));
  const file = path.join(ROOT, 'projects.html');
  const html = fs.readFileSync(file, 'utf8');
  const START = '<!-- projects:start -->';
  const END = '<!-- projects:end -->';
  const a = html.indexOf(START);
  const b = html.indexOf(END);
  if (a === -1 || b === -1 || b < a) throw new Error('projects.html is missing the projects:start / projects:end markers');
  const cards = projects.map(projectCardHtml).join('\n');
  const next = html.slice(0, a + START.length) + '\n' + cards + '\n        ' + html.slice(b);
  if (next !== html) fs.writeFileSync(file, next);
  console.log(`built projects.html (${projects.length} cards)`);
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
    const modified = gitDate(`articles/${file}`);
    fs.writeFileSync(path.join(ARTICLES_DIR, `${id}.html`), articleTemplate({ ...post, modified, html }));
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

  buildProjectsPage();

  const faq = parseFaq();
  buildFaqJsonLd(faq);

  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemapTemplate(posts));
  console.log('built sitemap.xml');

  fs.writeFileSync(path.join(ROOT, 'llms.txt'), llmsTxt(posts));
  console.log('built llms.txt');
  fs.writeFileSync(path.join(ROOT, 'llms-full.txt'), llmsFullTxt(posts, faq));
  console.log('built llms-full.txt');
}

main();
