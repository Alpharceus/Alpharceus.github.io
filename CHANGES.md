# Changes — 2026-07-07

Major overhaul: GEO/SEO baseline, static blog generation, two new pages
(Skills, Now), and interactivity fixes across the site.

## SEO / GEO baseline

- **robots.txt** (allow all + sitemap pointer) and **sitemap.xml** (regenerated
  automatically by the build step).
- **index.html**: meta description, canonical URL, Open Graph tags, WebSite
  JSON-LD with the constellation concept and `hasPart` of all seven pages,
  working nav (About / Projects / Papers) and footer links, and a `<noscript>`
  bio + link list so crawlers that don't run JS still see real content.
- **/about/**: proper Person JSON-LD (`@context`, `@type`, `sameAs` for
  GitHub / LinkedIn / X, UNM affiliation as an Organization) and CHTM +
  advisor named in the first FAQ answer.
- Per-page `WebPage` JSON-LD + meta description on Projects, Papers, Skills,
  Now, Blog, and Rigel — each names its pillar and treatment.
- SVG constellation favicon.
- Nav/logo/footer on the homepage stay invisible during the intro animation
  and fade in when the constellation finishes drawing (links remain in the
  DOM throughout — progressive reveal, not hidden text).
- `prefers-reduced-motion` now auto-skips the intro.

## Blog (static generation)

- Articles live as Markdown in `/articles/` with front matter
  (`id`, `title`, `date`, `summary`).
- `build/build.js` (markdown-it) renders each post to static HTML with
  Article JSON-LD, canonical URL, and back-nav; regenerates
  `assets/blogs.json`, `blogs.html` (card index — fixes the old 404), and
  `sitemap.xml`. Runs in CI before deploy and locally via `npm run build`.

## Projects

- New schema: `{ id, title, desc, summary, artifacts, note, status }` —
  artifact badges render only for links that exist (no placeholders),
  status chips (Done / In progress), per-project anchors.
- Entries cleaned up: research entries use approved public language only;
  removed template/placeholder data.

## Papers

- `papers.json` emptied (journal papers only — none yet); graceful empty
  state pointing to the projects page; removed a duplicate renderer that
  clobbered the list.

## Skills (new page)

- Interactive **binary MZI splitter tree**: one input beam, 31 tunable
  Mach–Zehnder interferometers, 32 output ports = 32 skills.
- Each node's phase shifter sets its split ratio (sin²θ/2 — real MZI
  transfer matrix; light conservation verified).
- Drag a phase shifter to tune continuously, click it to cycle
  100%↑ / 50:50 / 100%↓, click a skill to watch the mesh reconfigure and
  route all light to that port.
- Static grouped skill list below the canvas for crawlers.

## Now (new page)

- Mission-control console: live master clock, subsystem status lines
  (RESEARCH / WRITING / BUILD), timing-waveform background, prominent
  LAST SYNC date. Content is static HTML, updated quarterly.

## Rigel (quantum playground)

- Bloch sphere is now wired to the circuit engine: shows the live (reduced)
  Bloch vector of a selectable qubit, updates on every circuit edit;
  entangled qubits visibly shrink toward the maximally mixed center.
- Fixed a bit-ordering bug where gates acted on the wrong qubit for n > 1
  (verified with acceptance tests: H|0⟩ → |+⟩, then S → |+i⟩; Bell states).
- States render in LaTeX via KaTeX (kets, Bloch vectors, gate sequence).
- Sphere is user-rotatable by drag (auto-rotation removed).
- Circuit grid scrolls inside its panel instead of overflowing; control
  wires are positioned from actual cell geometry.

## Housekeeping

- `CLAUDE.md` with hard content constraints for future sessions.
- Terminal `blog` command updated to the new blog index.
- `schedule.json` replaced with explicitly fictional content.
- readme rewritten (UTF-8), star map wired to the new pages.
