// ========================================================
// SITE TRANSITION — star dive + arrival handshake + intro helpers
//
// Shared by the home star map (dive out) and every star page (arrive).
// Plain script, one global: SiteTransition. See portfolio-motion-brief.md.
//
//   Home:  js/star-dive.js runs the dive and calls prepare()/commit() here;
//          startDive({...}) / diveFrame() remain for the reduced-motion colour fade; onReset(fn)
//   Pages: SiteTransition.getMode(page) -> 'arrival' | 'first' | 'skip'
//          SiteTransition.run(ms, onFrame, onDone) / wireSkip(fn)
// ========================================================
(function () {
    "use strict";

    // ---- Timing (ms) — tune here ----
    var DIVE_BG_BLEND = 0.3;         // how far toward the bg it ends (0 = star colour, 1 = bg)
    var REDUCED_FADE_MS = 150;       // reduced motion: colour fade, then navigate
    var ARRIVAL_MAX_AGE_MS = 4000;   // arrival payload is stale after this

    // ---- Easings ----
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function easeInCubic(t) { return t * t * t; }
    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
    function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

    // ---- Destination page background colours (from each page's own CSS) ----
    // now/: --bg #05080f. projects/papers/rigel: css/portfolio-pages.css body #070a10.
    // skills: body #060a12. blogs: body radial-gradient centre #171b33.
    var DEST_BG = {
        "projects.html": [7, 10, 16],
        "papers.html": [7, 10, 16],
        "skills.html": [6, 10, 18],
        "blogs.html": [23, 27, 51],
        "now/": [5, 8, 15],
        "rigel.html": [7, 10, 16]
    };
    var DEFAULT_BG = [5, 8, 15];

    function reducedMotion() {
        return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }

    // ---- Mode detection (pages) ----
    function flagKey(page) { return "intro:" + page; }

    function seen(page) {
        try { return !!sessionStorage.getItem(flagKey(page)); } catch (e) { return false; }
    }
    function markSeen(page) {
        try { sessionStorage.setItem(flagKey(page), "1"); } catch (e) { }
    }

    // The head script has already consumed sessionStorage.arrival into window.__arrival.
    function getArrival() { return window.__arrival || null; }

    function getMode(page) {
        if (getArrival()) return "arrival";
        if (reducedMotion() || seen(page)) return "skip";
        return "first";
    }

    // ---- Time-driven runner: rAF, finish() jumps to the end state ----
    function run(duration, onFrame, onDone) {
        var start = null, raf = 0, ended = false;
        function end(skipped) {
            if (ended) return;
            ended = true;
            if (raf) cancelAnimationFrame(raf);
            onFrame(duration, true);
            if (onDone) onDone(skipped);
        }
        function step(now) {
            if (ended) return;
            if (start === null) start = now;
            var t = now - start;
            if (t >= duration) { end(false); return; }
            onFrame(t, false);
            raf = requestAnimationFrame(step);
        }
        raf = requestAnimationFrame(step);
        return {
            finish: function () { end(true); },
            cancel: function () { ended = true; if (raf) cancelAnimationFrame(raf); }
        };
    }

    // ---- Skip wiring: click, tap, Esc, Space -> fn() once ----
    function wireSkip(fn) {
        var done = false;
        function off() {
            done = true;
            document.removeEventListener("click", onClick, true);
            document.removeEventListener("touchstart", onClick, true);
            document.removeEventListener("keydown", onKey, true);
        }
        function fire() { if (done) return; off(); fn(); }
        function onClick() { fire(); }
        function onKey(e) {
            if (e.key === "Escape" || e.key === " " || e.code === "Space") {
                e.preventDefault();
                fire();
            }
        }
        document.addEventListener("click", onClick, true);
        document.addEventListener("touchstart", onClick, { capture: true, passive: true });
        document.addEventListener("keydown", onKey, true);
        return off;
    }

    // ---- Star dive (home) ----
    var dive = null;          // { t0, target, rgb, x, y, bg, reduced, timer }
    var resetHooks = [];
    var prefetched = {};

    function prefetch(href) {
        if (!href || prefetched[href]) return;
        prefetched[href] = true;
        try {
            var l = document.createElement("link");
            l.rel = "prefetch";
            l.href = href;
            document.head.appendChild(l);
        } catch (e) { }
    }

    function isDiving() { return !!dive; }

    // Resolve the dive's colours. arrival.rgb is exactly the dive's last flood colour,
    // so the seam is invisible; starRgb is the pure star colour.
    // opts: { star, target, rgb:[r,g,b] }
    function prepare(opts) {
        var rgb = opts.rgb.map(function (v) { return Math.round(v); });
        var reduced = reducedMotion();
        var bg = DEST_BG[opts.target] || DEFAULT_BG;
        var finalRgb = reduced ? rgb : rgb.map(function (v, i) { return Math.round(lerp(v, bg[i], DIVE_BG_BLEND)); });
        return { star: opts.star, target: opts.target, rgb: rgb, finalRgb: finalRgb, bg: bg, reduced: reduced };
    }

    // Write the arrival payload and navigate. ts is stamped now (navigation time), so a
    // dive of any length still falls inside the ARRIVAL_MAX_AGE_MS window on the other side.
    function commit(plan) {
        try {
            sessionStorage.setItem("arrival", JSON.stringify({ star: plan.star, rgb: plan.finalRgb, starRgb: plan.rgb, ts: Date.now() }));
        } catch (e) { }
        window.location.href = plan.target;
    }

    // Reduced-motion path (and fallback if star-dive.js is missing): colour fade, then navigate.
    // opts: { star, target, rgb:[r,g,b], x, y }  (x,y = star screen position)
    function startDive(opts) {
        if (dive) return false;
        var plan = prepare(opts);
        prefetch(opts.target);
        dive = {
            t0: performance.now(),
            target: opts.target,
            rgb: plan.rgb,
            x: opts.x,
            y: opts.y,
            bg: plan.bg,
            reduced: true,
            timer: setTimeout(function () { commit(plan); }, REDUCED_FADE_MS)
        };
        return true;
    }

    // Per-frame state of the reduced-motion fade, or null when idle.
    //   flood: 0..1 fill opacity; blend: 0 (the fill stays the pure star colour)
    function diveFrame() {
        if (!dive) return null;
        var ms = performance.now() - dive.t0;
        var f = { x: dive.x, y: dive.y, rgb: dive.rgb, bg: dive.bg, ms: ms, scale: 1, zoom: 0, blend: 0 };
        f.t = clamp(ms / REDUCED_FADE_MS, 0, 1);
        f.flood = f.t;
        return f;
    }

    function diveColor(f) {
        return [
            Math.round(lerp(f.rgb[0], f.bg[0], f.blend)),
            Math.round(lerp(f.rgb[1], f.bg[1], f.blend)),
            Math.round(lerp(f.rgb[2], f.bg[2], f.blend))
        ];
    }

    // ---- bfcache: Back must land on a normal home page ----
    function onReset(fn) { resetHooks.push(fn); }

    function reset() {
        if (dive) { clearTimeout(dive.timer); dive = null; }
        try { sessionStorage.removeItem("arrival"); } catch (e) { }
        for (var i = 0; i < resetHooks.length; i++) {
            try { resetHooks[i](); } catch (e) { }
        }
    }

    window.addEventListener("pageshow", function (e) {
        if (e.persisted) reset();
    });

    window.SiteTransition = {
        DEST_BG: DEST_BG,
        clamp: clamp,
        lerp: lerp,
        easeInCubic: easeInCubic,
        easeOutCubic: easeOutCubic,
        easeInOutCubic: easeInOutCubic,
        reducedMotion: reducedMotion,
        getMode: getMode,
        getArrival: getArrival,
        markSeen: markSeen,
        run: run,
        wireSkip: wireSkip,
        prefetch: prefetch,
        DIVE_BG_BLEND: DIVE_BG_BLEND,
        prepare: prepare,
        commit: commit,
        startDive: startDive,
        isDiving: isDiving,
        diveFrame: diveFrame,
        diveColor: diveColor,
        onReset: onReset,
        reset: reset,
        ARRIVAL_MAX_AGE_MS: ARRIVAL_MAX_AGE_MS
    };
}());
