// rigel.js

// ================== TUNING CONSTANTS ==================
// Everything time- or feel-related lives here so it can be tuned without reading the code.
const SLERP_MS        = 400;    // geodesic slerp between displayed states
const SLERP_EASE      = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2); // easeInOutCubic
const TRAIL_MS        = 900;    // how long a trail point lives (it fades over this time)
const TRAIL_ALPHA     = 0.85;   // trail alpha at its newest point
const IDLE_FPS        = 30;     // redraw cap when nothing is dragged or animated
const DPR_CAP         = 2;      // canvas backing-store scale cap
const BACK_ALPHA      = 0.35;   // back-hemisphere lines and dashes
const CIRCLE_SAMPLES  = 120;    // points per great circle
const PERSPECTIVE     = 0.1;    // mild size change with depth (near = larger)
const TIP_RADIUS      = 5;      // state-vector tip radius (CSS px) at zero depth
const TIP_DEPTH_SIZE  = 0.45;   // tip radius scales by (1 + this * z_v)
const TIP_ALPHA_MIN   = 0.4;    // tip alpha at the far side; 1 at the near side
const LABEL_ALPHA_MIN = 0.3;    // axis-label alpha at the far side; 1 at the near side

// ---- multi-sphere layout and enter/leave ----
const BLOCH_ASPECT          = 0.8;   // canvas height / width: fixed for every qubit count, so the page never shifts
const BLOCH_FULL_LABELS_MIN = 340;   // cell side (px) for full axis labels, e.g. "|+⟩ (X+)"
const BLOCH_SHORT_LABELS_MIN = 200;  // below this only |0⟩ and |1⟩ are labelled
const SPHERE_APPEAR_MS      = 300;   // a sphere fades/scales in or out over this long
const SPHERE_SCALE_MIN      = 0.72;  // scale of a sphere at appear = 0
const SPHERE_FADE_EASE      = (u) => 1 - Math.pow(1 - u, 3);
const SPHERE_REFLOW_TAU_MS  = 70;    // cells glide to their new layout with this time constant
const VIEW_TILT0            = 0.7;   // default camera (every sphere starts here; double-click resets to it)
const VIEW_PHI0             = 0.55;

// ---- intro timing (ms from intro start): arrival <= 2.5 s, first <= 4 s ----
// Each stage is [start, end]. In arrival mode the dive colour first collapses to the sphere centre.
const INTRO = {
    arrival: {
        total: 2400,
        collapse: [100, 600],
        equator: [500, 1000], meridianA: [900, 1400], meridianB: [1000, 1500],
        labels: [1400, 1800], vector: [1700, 2300],
        wires: [1200, 1900], gates: [1400, 2200], gateDur: 260
    },
    first: {
        total: 3500,
        collapse: null,
        equator: [300, 1000], meridianA: [900, 1600], meridianB: [1050, 1750],
        labels: [1700, 2200], vector: [2100, 3000],
        wires: [1800, 2700], gates: [2100, 3200], gateDur: 300
    }
};
const INTRO_SPHERE_STAGGER  = 90;    // ms between one sphere's intro and the next (the last still ends on cfg.total)
const INTRO_REDUCED_FADE_MS = 150;  // reduced motion: arrival fill fades out, nothing else
const INTRO_GROW_SHARE      = 0.35; // share of the swing spent growing the vector out of the centre
const INTRO_GATE_DROP_PX    = 10;   // gate buttons drop this far into place
const INTRO_WIRE_COLS       = 8;    // matches MAX_COLS
const INTRO_WIRE_ROW_LAG    = 0.06; // per-row lag of the wire draw (fraction of the wire stage)
const INTRO_EASE            = (u) => 1 - Math.pow(1 - u, 3); // easeOutCubic
const INTRO_EASE_IO         = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

// ================== DOM ENTRY ==================
function rigelBoot() {
    // Show the circuit section immediately (no 10s delay nonsense)
    const circuitSection = document.getElementById("circuit-section");
    if (circuitSection) {
        circuitSection.classList.remove("hidden");
    }

    initBlochSphere();
    initCircuitUI();

    // KaTeX is a blocking script in <head>, so it is loaded here and the state summary is
    // already rendered; the intro starts only after that.
    startIntro();

    // re-render the state panel once everything (including KaTeX) is ready
    window.addEventListener("load", () => updateQuantumState());
}

// ================== INTRO ==================
// The intro is a pure function of time: introFrame(t, cfg) sets the stage progress in
// blochIntro (read by the sphere draw loop) and on the circuit DOM (opacity/transform and
// one custom property only, so nothing ever shifts layout).

const blochIntro = {
    active: document.documentElement.classList.contains("rg-intro"),
    t: 0, cfg: null,     // intro clock (ms) and the stage table in use
    poke: null           // set by initBlochSphere: request a redraw
};

// Stage progress (0..1) of sphere q: the same sequence for every sphere, each started a
// little later than the one before, time-scaled so the last sphere still ends on cfg.total.
function blochIntroStages(q) {
    const b = blochIntro, cfg = b.cfg;
    if (!cfg) return { eq: 0, merA: 0, merB: 0, lab: 0, vec: 0 };
    const n = Math.max(1, blochState.vectors.length);
    const span = Math.max(1, cfg.total - (n - 1) * INTRO_SPHERE_STAGGER);
    const ti = (b.t - q * INTRO_SPHERE_STAGGER) * cfg.total / span;
    return {
        eq: introStage(ti, cfg.equator), merA: introStage(ti, cfg.meridianA), merB: introStage(ti, cfg.meridianB),
        lab: introStage(ti, cfg.labels), vec: introStage(ti, cfg.vector)
    };
}

window.__rigelIntro = { katexAtStart: null, mode: null };

function introClamp01(v) { return Math.max(0, Math.min(1, v)); }
function introStage(t, st) { return introClamp01((t - st[0]) / (st[1] - st[0])); }

function introCircuitEls() {
    return {
        gates: Array.from(document.querySelectorAll("#gate-palette .gate-btn")),
        cells: Array.from(document.querySelectorAll("#circuit-grid .circuit-cell"))
    };
}

function introFrame(t, cfg, els, arrival) {
    const root = document.documentElement;
    if (arrival && cfg.collapse) {
        const c = INTRO_EASE_IO(introStage(t, cfg.collapse));
        root.style.setProperty("--arrival-s", String(Math.max(0.0001, 1 - c)));
        root.style.setProperty("--arrival-op", c >= 1 ? "0" : "1");
    }
    blochIntro.cfg = cfg;
    blochIntro.t = t;
    if (blochIntro.poke) blochIntro.poke();

    // wires: each cell's curtain retracts as the wire front passes its column
    const wp = introStage(t, cfg.wires);
    els.cells.forEach(cell => {
        const col = +cell.dataset.col || 0, row = +cell.dataset.row || 0;
        const p = introClamp01(wp * (1 + INTRO_WIRE_ROW_LAG * 3) - row * INTRO_WIRE_ROW_LAG);
        cell.style.setProperty("--rg-wire", String(introClamp01(p * INTRO_WIRE_COLS - col)));
    });

    // gate palette: small stagger, drop + fade
    const n = els.gates.length;
    els.gates.forEach((btn, i) => {
        const start = cfg.gates[0] + (n > 1 ? i * (cfg.gates[1] - cfg.gates[0] - cfg.gateDur) / (n - 1) : 0);
        const u = INTRO_EASE(introClamp01((t - start) / cfg.gateDur));
        btn.style.opacity = String(u);
        btn.style.transform = "translateY(" + ((1 - u) * -INTRO_GATE_DROP_PX).toFixed(2) + "px)";
    });
}

function introFinish(els) {
    const root = document.documentElement;
    blochIntro.active = false;
    if (blochIntro.poke) blochIntro.poke(true);
    els.gates.forEach(b => { b.style.removeProperty("opacity"); b.style.removeProperty("transform"); });
    els.cells.forEach(c => c.style.removeProperty("--rg-wire"));
    ["--arrival-s", "--arrival-op", "--arrival-rgb", "--arrival-x", "--arrival-y"]
        .forEach(k => root.style.removeProperty(k));
    root.classList.remove("arriving", "rg-intro");
}

// mode: 'arrival' | 'first' | 'skip'; arrival: {star, rgb, ts} or null
function playIntro(mode, arrival) {
    const T = window.SiteTransition;
    const root = document.documentElement;
    const els = introCircuitEls();
    window.__rigelIntro.mode = mode;
    window.__rigelIntro.katexAtStart = !!document.querySelector("#state-output .katex");

    if (mode === "skip" || !T) { introFinish(els); return; }
    T.markSeen("rigel");
    if (T.reducedMotion()) {
        // reduced motion: at most a short fade of the arrival fill
        introFinish(els);
        if (arrival) {
            root.classList.add("arriving");
            T.run(INTRO_REDUCED_FADE_MS,
                t => root.style.setProperty("--arrival-op", String(1 - introClamp01(t / INTRO_REDUCED_FADE_MS))),
                () => { root.classList.remove("arriving"); root.style.removeProperty("--arrival-op"); });
        }
        return;
    }
    const isArrival = mode === "arrival";
    const cfg = isArrival ? INTRO.arrival : INTRO.first;
    root.classList.add("rg-intro");
    blochIntro.active = true;
    if (isArrival) {
        // the fill collapses onto the sphere centre (viewport coordinates of the canvas centre)
        const cv = document.getElementById("bloch-canvas");
        if (cv) {
            const r = cv.getBoundingClientRect();
            root.style.setProperty("--arrival-x", (r.left + r.width / 2).toFixed(1) + "px");
            root.style.setProperty("--arrival-y", (r.top + r.height / 2).toFixed(1) + "px");
        }
    }
    introFrame(0, cfg, els, isArrival);
    const handle = T.run(cfg.total, t => introFrame(t, cfg, els, isArrival), () => { off(); introFinish(els); });
    const off = T.wireSkip(() => handle.finish());
}
window.playIntro = playIntro;

function startIntro() {
    const T = window.SiteTransition;
    playIntro(T ? T.getMode("rigel") : "skip", window.__arrival || null);
}

// ================== BLOCH SPHERES ==================
// One canvas, one rAF loop, one sphere per qubit, each with its own camera (tilt, phi).

let blochAnimId = null;

// Live Bloch state shared between the circuit engine and the sphere renderer.
// vectors[q] = { x, y, z } — the (reduced) Bloch vector of qubit q, straight from
// the simulator. Each sphere shows a *displayed* vector that slerps toward it.
const blochState = {
    vectors: [{ x: 0, y: 0, z: 1 }], // |0⟩ before anything runs
    onUpdate: null,                  // set by initBlochSphere: retarget the animation
    getDisplayed: null,              // set by initBlochSphere: current displayed vectors
    getSpheres: null                 // set by initBlochSphere: per-sphere draw parameters
};

// Draw parameters of the last rendered frame (read by the test hook). tipZ / tipRadius /
// tipAlpha / trailPoints mirror sphere q0; every sphere's own values are in __rigelState().spheres.
const blochDraw = {
    tilt: 0, phi: 0, tipZ: 0, tipRadius: 0, tipAlpha: 0,
    trailPoints: 0, animating: false, dpr: 1, frames: 0, width: 0, height: 0
};

// Read-only test hook: simulator vectors, displayed (animated) vectors, per-sphere draw
// parameters (visible spheres only, each with its own tilt/phi). draw.tilt/phi mirror sphere q0.
window.__rigelState = () => ({
    vectors: blochState.vectors.map(v => ({ x: v.x, y: v.y, z: v.z })),
    displayed: (blochState.getDisplayed ? blochState.getDisplayed() : blochState.vectors)
        .map(v => ({ x: v.x, y: v.y, z: v.z })),
    spheres: blochState.getSpheres ? blochState.getSpheres() : [],
    draw: Object.assign({}, blochDraw)
});

// Geodesic interpolation of two Bloch vectors: the direction slerps along the great
// circle, the length interpolates linearly (so mixed states shrink/grow smoothly).
function slerpBloch(a, b, e) {
    const la = Math.hypot(a.x, a.y, a.z);
    const lb = Math.hypot(b.x, b.y, b.z);
    const len = la + (lb - la) * e;
    if (la < 1e-6 || lb < 1e-6) {
        // no defined direction at the maximally mixed point: plain lerp
        return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, z: a.z + (b.z - a.z) * e };
    }
    const ua = { x: a.x / la, y: a.y / la, z: a.z / la };
    const ub = { x: b.x / lb, y: b.y / lb, z: b.z / lb };
    const dot = Math.max(-1, Math.min(1, ua.x * ub.x + ua.y * ub.y + ua.z * ub.z));
    const th = Math.acos(dot);
    let dir;
    if (th < 1e-6) {
        dir = ua;
    } else if (th > Math.PI - 1e-6) {
        // antipodal: any perpendicular axis is a valid geodesic; pick a stable one
        const ref = Math.abs(ua.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
        let m = {
            x: ua.y * ref.z - ua.z * ref.y,
            y: ua.z * ref.x - ua.x * ref.z,
            z: ua.x * ref.y - ua.y * ref.x
        };
        const ml = Math.hypot(m.x, m.y, m.z);
        m = { x: m.x / ml, y: m.y / ml, z: m.z / ml };
        const c = Math.cos(Math.PI * e), s = Math.sin(Math.PI * e);
        dir = { x: ua.x * c + m.x * s, y: ua.y * c + m.y * s, z: ua.z * c + m.z * s };
    } else {
        const s0 = Math.sin((1 - e) * th) / Math.sin(th);
        const s1 = Math.sin(e * th) / Math.sin(th);
        dir = { x: ua.x * s0 + ub.x * s1, y: ua.y * s0 + ub.y * s1, z: ua.z * s0 + ub.z * s1 };
    }
    return { x: dir.x * len, y: dir.y * len, z: dir.z * len };
}

// Cell for each of n spheres inside a W x H canvas: 1 = whole panel, 2 = side by side,
// 3-4 = 2x2 (the lone third sphere is centred on the bottom row).
function blochLayout(n, W, H) {
    if (n <= 1) return [{ x: 0, y: 0, w: W, h: H }];
    if (n === 2) return [{ x: 0, y: 0, w: W / 2, h: H }, { x: W / 2, y: 0, w: W / 2, h: H }];
    const w = W / 2, h = H / 2;
    const rects = [{ x: 0, y: 0, w, h }, { x: w, y: 0, w, h }];
    if (n === 3) rects.push({ x: w / 2, y: h, w, h });
    else rects.push({ x: 0, y: h, w, h }, { x: w, y: h, w, h });
    return rects;
}

function initBlochSphere() {
    const canvas = document.getElementById("bloch-canvas");
    if (!canvas) {
        console.warn("[Rigel] No #bloch-canvas found; skipping Bloch sphere.");
        return;
    }
    const ctx = canvas.getContext("2d");
    const reducedMq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    const reduced = () => !!(reducedMq && reducedMq.matches);

    // Site tokens (css/site.css), with fallbacks so the canvas never depends on load order
    const css = getComputedStyle(document.documentElement);
    const tok = (name, fallback) => (css.getPropertyValue(name) || "").trim() || fallback;
    const COL = {
        link: tok("--link", "#8fb8ff"),
        ink: tok("--ink", "#e6eaf7"),
        soft: tok("--ink-soft", "#b6bfdc"),
        muted: tok("--ink-muted", "#858fb0"),
        warm: tok("--betelgeuse", "#ffb46e"),
        x: "#e8a07f",
        y: "#86d3aa",
        z: tok("--link", "#8fb8ff")
    };
    const MONO = tok("--font-mono", "'IBM Plex Mono', Menlo, Consolas, monospace");

    // ---- sizing: CSS pixels for drawing, backing store scaled by DPR (capped) ----
    let W = 420, H = 336, dpr = 1;
    let volumeLayer = null, volumeR = 0; // offscreen sphere volume + limb, rebuilt when the radius changes
    let needsFrame = true;
    let lastNow = 0;
    let lastDraw = 0;

    function cellMode(rect) {
        const m = Math.min(rect.w, rect.h);
        return m >= BLOCH_FULL_LABELS_MIN ? "full" : m >= BLOCH_SHORT_LABELS_MIN ? "short" : "min";
    }
    function sphereRadius(rect) {
        const f = { full: 0.36, short: 0.38, min: 0.40 }[cellMode(rect)];
        return f * Math.min(rect.w, rect.h);
    }

    function buildVolumeLayer(R) {
        volumeR = R;
        const D = Math.ceil(2 * R + 6);
        const layer = document.createElement("canvas");
        layer.width = Math.round(D * dpr);
        layer.height = Math.round(D * dpr);
        layer.dataset.d = String(D);
        const c = layer.getContext("2d");
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        const cx = D / 2, cy = D / 2;
        // lit from the upper left, darker toward the limb; kept low-contrast
        const g = c.createRadialGradient(cx - R * 0.38, cy - R * 0.42, R * 0.05, cx, cy, R);
        g.addColorStop(0, "rgba(150, 185, 255, 0.20)");
        g.addColorStop(0.55, "rgba(70, 95, 170, 0.10)");
        g.addColorStop(1, "rgba(8, 10, 24, 0.50)");
        c.beginPath();
        c.arc(cx, cy, R, 0, 2 * Math.PI);
        c.fillStyle = g;
        c.fill();
        c.lineWidth = 1.25;
        c.strokeStyle = "rgba(143, 184, 255, 0.55)";
        c.stroke();
        volumeLayer = layer;
    }

    // ---- spheres: one per qubit; leaving ones fade out before they are dropped ----
    // { q, rect (animated cell), tgt (target cell), appear 0..1, want 1|0, trail, vec, draw }
    let spheres = [];
    let sphereCount = 0;

    function syncSpheres(n, instant) {
        sphereCount = n;
        const rects = blochLayout(n, W, H);
        const R0 = sphereRadius(rects[0]);
        if (!volumeLayer || Math.abs(R0 - volumeR) > 0.5) buildVolumeLayer(R0);
        for (let q = 0; q < n; q++) {
            let s = spheres.find(x => x.q === q);
            if (!s) {
                s = { q, rect: Object.assign({}, rects[q]), tgt: rects[q], appear: instant ? 1 : 0, want: 1, trail: [], vec: null, draw: {},
                      tilt: VIEW_TILT0, phi: VIEW_PHI0 };
                spheres.push(s);
            }
            s.want = 1;
            s.tgt = rects[q];
            if (instant) { s.rect = Object.assign({}, rects[q]); s.appear = 1; }
        }
        spheres.forEach(s => { if (s.q >= n) s.want = 0; });
        if (instant) spheres = spheres.filter(s => s.want);
        spheres.sort((a, b) => a.q - b.q);
        canvas.setAttribute("aria-label",
            "Bloch spheres: one per qubit (" + n + "), each showing that qubit's live reduced state. Drag a sphere to rotate it on its own; double-click to reset its view.");
        needsFrame = true;
    }

    function resize() {
        const box = canvas.getBoundingClientRect();
        const w = Math.round(box.width) || 420;
        const h = Math.round(box.height) || Math.round(w * BLOCH_ASPECT);
        dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
        W = w; H = h;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        blochDraw.dpr = dpr;
        blochDraw.width = W;
        blochDraw.height = H;
        volumeLayer = null;
        syncSpheres(sphereCount || blochState.vectors.length, true);
    }
    window.addEventListener("resize", resize);
    if (window.ResizeObserver) {
        new ResizeObserver(() => {
            const b = canvas.getBoundingClientRect();
            if (Math.round(b.width) && (Math.round(b.width) !== W || Math.round(b.height) !== H)) resize();
        }).observe(canvas);
    }

    // Per-sphere cameras: the pointer-down location picks the sphere under it, and that
    // same sphere keeps rotating for the whole drag, even if the pointer leaves its cell.
    let dragging = false;
    let dragSphere = null;
    let lastX = 0, lastY = 0;

    function sphereAt(e) {
        const b = canvas.getBoundingClientRect();
        const px = (e.clientX - b.left) * (W / (b.width || W));
        const py = (e.clientY - b.top) * (H / (b.height || H));
        return spheres.find(s => s.want &&
            px >= s.tgt.x && px < s.tgt.x + s.tgt.w && py >= s.tgt.y && py < s.tgt.y + s.tgt.h) || null;
    }
    function resetView(s) {
        s.tilt = VIEW_TILT0;
        s.phi = VIEW_PHI0;
        needsFrame = true;
    }

    canvas.addEventListener("pointerdown", (e) => {
        dragSphere = sphereAt(e);
        if (!dragSphere) return;
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        canvas.classList.add("dragging");
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
    });
    canvas.addEventListener("pointermove", (e) => {
        if (!dragging || !dragSphere) return;
        dragSphere.phi += (e.clientX - lastX) * 0.008;
        dragSphere.tilt += (e.clientY - lastY) * 0.008;
        dragSphere.tilt = Math.max(-1.45, Math.min(1.45, dragSphere.tilt));
        lastX = e.clientX;
        lastY = e.clientY;
    });
    const endDrag = () => { dragging = false; dragSphere = null; canvas.classList.remove("dragging"); };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    // double-click (a double-tap on touch also fires dblclick) resets the sphere under it
    canvas.addEventListener("dblclick", (e) => {
        const s = sphereAt(e);
        if (s) resetView(s);
    });
    // double-tap fallback for touch browsers that suppress dblclick on a touch-action:none surface
    let lastTap = { t: 0, x: 0, y: 0 };
    canvas.addEventListener("pointerup", (e) => {
        if (e.pointerType !== "touch") return;
        const now = performance.now();
        if (now - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24) {
            const s = sphereAt(e);
            if (s) resetView(s);
            lastTap.t = 0;
        } else {
            lastTap = { t: now, x: e.clientX, y: e.clientY };
        }
    });

    // Returns screen x/y plus zv, the view-space depth (+ = toward the viewer).
    function project3D(x, y, z, cx, cy, R, tilt, phi) {
        // Rotate around x-axis (tilt) then around z by phi
        const ct = Math.cos(tilt);
        const st = Math.sin(tilt);

        const y1 = y * ct - z * st;
        const z1 = y * st + z * ct; // depth: unaffected by the in-plane phi turn
        const x1 = x;

        const cz = Math.cos(phi);
        const sz = Math.sin(phi);

        const x2 = x1 * cz - y1 * sz;
        const y2 = x1 * sz + y1 * cz;

        const scale = 1 + PERSPECTIVE * z1; // mild perspective: nearer is larger
        return {
            x: cx + x2 * R * scale,
            y: cy - y2 * R * scale,
            zv: z1
        };
    }

    // ---- displayed state: slerp from the previous display toward the simulator ----
    let displayed = blochState.vectors.map(v => ({ x: v.x, y: v.y, z: v.z }));
    let anim = null;          // { t0, from: [vec], to: [vec] }

    function displayedAt(now) {
        if (!anim) return displayed;
        const u = Math.min(1, (now - anim.t0) / SLERP_MS);
        const e = SLERP_EASE(u);
        return anim.to.map((to, q) => slerpBloch(anim.from[q], to, e));
    }
    // Intro swing: each vector grows out of the centre along |0>, then slerps (the same
    // geodesic used for gates) to the live simulator state. |0> is the default state, so
    // for the default circuit the second leg is a no-op and the end state is exact.
    function introVectors() {
        return blochState.vectors.map((to, q) => {
            const p = blochIntroStages(q).vec;
            const grow = Math.min(1, p / INTRO_GROW_SHARE);
            const swing = Math.max(0, (p - INTRO_GROW_SHARE) / (1 - INTRO_GROW_SHARE));
            const v0 = { x: 0, y: 0, z: INTRO_EASE(grow) };
            return slerpBloch(v0, to, SLERP_EASE(swing));
        });
    }
    blochState.getDisplayed = () => (blochIntro.active ? introVectors() : displayedAt(performance.now()));
    // the intro redraws the spheres at the idle cap (30 fps) unless forced, like every other redraw
    blochIntro.poke = (force) => {
        if (force || performance.now() - lastDraw >= 1000 / IDLE_FPS - 4) needsFrame = true;
    };

    function pushTrails(now, vecs) {
        spheres.forEach(s => {
            const v = s.want && vecs[s.q];
            if (v) s.trail.push({ x: v.x, y: v.y, z: v.z, t: now });
        });
    }

    blochState.onUpdate = function () {
        const now = performance.now();
        const target = blochState.vectors.map(v => ({ x: v.x, y: v.y, z: v.z }));
        const cur = displayedAt(now);
        const settled = anim ? anim.to : displayed;
        const sameShape = settled.length === target.length;
        const changed = !sameShape || target.some((t, q) =>
            Math.hypot(t.x - settled[q].x, t.y - settled[q].y, t.z - settled[q].z) > 1e-9);
        if (!changed) return;

        if (!sameShape || reduced()) {
            // qubit count changed, or reduced motion: jump, no slerp, no trail
            displayed = target;
            anim = null;
            spheres.forEach(s => { s.trail = []; });
            if (!sameShape) syncSpheres(target.length, reduced() || blochDraw.frames === 0);
        } else {
            anim = { t0: now, from: cur.map(v => ({ x: v.x, y: v.y, z: v.z })), to: target };
            pushTrails(now, cur);
        }
        blochDraw.animating = !!anim;
        needsFrame = true;
    };

    // per-sphere draw parameters for the test hook (visible spheres only)
    blochState.getSpheres = () => spheres.filter(s => s.want).map(s => ({
        q: s.q,
        tilt: s.tilt, phi: s.phi,
        rect: { x: s.tgt.x, y: s.tgt.y, w: s.tgt.w, h: s.tgt.h },
        appear: s.appear,
        mode: cellMode(s.tgt),
        radius: sphereRadius(s.tgt),
        vec: s.vec ? { x: s.vec.x, y: s.vec.y, z: s.vec.z } : null,
        r: s.draw.r === undefined ? null : s.draw.r,
        tipZ: s.draw.tipZ, tipRadius: s.draw.tipRadius, tipAlpha: s.draw.tipAlpha,
        trailPoints: s.trail.length,
        label: s.draw.label
    }));

    // ---- line helpers ----
    function strokeRuns(runs, style, width, dashed, alpha) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = style;
        ctx.lineWidth = width;
        ctx.setLineDash(dashed ? [3.5, 4] : []);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        runs.forEach(run => {
            if (run.length < 2) return;
            ctx.beginPath();
            ctx.moveTo(run[0].x, run[0].y);
            for (let i = 1; i < run.length; i++) ctx.lineTo(run[i].x, run[i].y);
            ctx.stroke();
        });
        ctx.restore();
    }

    // Sample a great circle and split it into front (zv >= 0) and back (zv < 0) runs,
    // inserting the exact crossing points so the two halves meet cleanly.
    function circleRuns(point3, cx, cy, R, tilt, phi, frac = 1) {
        const pts = [];
        for (let k = 0; k <= CIRCLE_SAMPLES; k++) {
            const a = (2 * Math.PI * frac * k) / CIRCLE_SAMPLES;
            const p3 = point3(a);
            pts.push({ p3, p: project3D(p3.x, p3.y, p3.z, cx, cy, R, tilt, phi) });
        }
        const front = [], back = [];
        let cur = null, curFront = null;
        const add = (isFront, p) => {
            if (cur === null || curFront !== isFront) {
                cur = [];
                curFront = isFront;
                (isFront ? front : back).push(cur);
            }
            cur.push(p);
        };
        add(pts[0].p.zv >= 0, pts[0].p);
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i];
            const fa = a.p.zv >= 0, fb = b.p.zv >= 0;
            if (fa !== fb) {
                const t = a.p.zv / (a.p.zv - b.p.zv);
                let m = { x: a.p3.x + (b.p3.x - a.p3.x) * t, y: a.p3.y + (b.p3.y - a.p3.y) * t, z: a.p3.z + (b.p3.z - a.p3.z) * t };
                const ml = Math.hypot(m.x, m.y, m.z) || 1;
                m = { x: m.x / ml, y: m.y / ml, z: m.z / ml };
                const pm = project3D(m.x, m.y, m.z, cx, cy, R, tilt, phi);
                add(fa, pm);   // close the run we were in
                add(fb, pm);   // open the next one at the same point
            }
            add(fb, b.p);
        }
        return { front, back, end: pts[pts.length - 1].p };
    }

    // Axis halves; label text per density: full (|+⟩ (X+)), short (|+⟩) or min (|0⟩ and |1⟩ only)
    const AXES = [
        { dir: { x: 1, y: 0, z: 0 }, col: COL.x, pos: ["|+⟩ (X+)", "|+⟩"], neg: ["|−⟩ (X−)", "|−⟩"] },
        { dir: { x: 0, y: 1, z: 0 }, col: COL.y, pos: ["|+i⟩ (Y+)", "|+i⟩"], neg: ["|−i⟩ (Y−)", "|−i⟩"] },
        { dir: { x: 0, y: 0, z: 1 }, col: COL.z, pos: ["|0⟩ (Z+)", "|0⟩"], neg: ["|1⟩ (Z−)", "|1⟩"], primary: true }
    ];

    // ---- one sphere, clipped to its cell; `fade` is the enter/leave multiplier ----
    function drawSphere(s, vecIn, now, intro, st) {
        const rect = s.rect;
        const mode = cellMode(s.tgt);
        const fade = SPHERE_FADE_EASE(s.appear);
        const scale = SPHERE_SCALE_MIN + (1 - SPHERE_SCALE_MIN) * fade;
        const R = sphereRadius(s.tgt) * scale;
        const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
        const tilt = s.tilt, phi = s.phi;

        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.x, rect.y, rect.w, rect.h);
        ctx.clip();

        if (volumeLayer) {
            const D = +volumeLayer.dataset.d, k = R / volumeR;
            ctx.globalAlpha = (intro ? st.eq : 1) * fade;
            ctx.drawImage(volumeLayer, 0, 0, volumeLayer.width, volumeLayer.height,
                cx - (D / 2) * k, cy - (D / 2) * k, D * k, D * k);
            ctx.globalAlpha = 1;
        }

        const p0 = project3D(0, 0, 0, cx, cy, R, tilt, phi);

        // great circles: equator (z = 0), xz meridian (y = 0), yz meridian (x = 0)
        const circleFrac = intro ? [st.eq, st.merA, st.merB] : [1, 1, 1];
        const circles = [
            (a) => ({ x: Math.cos(a), y: Math.sin(a), z: 0 }),
            (a) => ({ x: Math.cos(a), y: 0, z: Math.sin(a) }),
            (a) => ({ x: 0, y: Math.cos(a), z: Math.sin(a) })
        ].map((fn, i) => {
            const c = circleRuns(fn, cx, cy, R, tilt, phi, Math.max(circleFrac[i], 1e-4));
            return circleFrac[i] <= 0 ? { front: [], back: [], end: c.end } : c;
        });
        const labA = (intro ? st.lab : 1) * fade;

        // axes: each half runs from the origin to ±1.2; the half with zv < 0 is behind
        const AX = 1.2, LBL = 1.13;
        const halves = [];
        AXES.forEach(ax => {
            [[1, ax.pos], [-1, ax.neg]].forEach(([sgn, txt]) => {
                const end = project3D(sgn * AX * ax.dir.x, sgn * AX * ax.dir.y, sgn * AX * ax.dir.z, cx, cy, R, tilt, phi);
                const lab = project3D(sgn * LBL * ax.dir.x, sgn * LBL * ax.dir.y, sgn * LBL * ax.dir.z, cx, cy, R, tilt, phi);
                halves.push({
                    end, lab, text: mode === "full" ? txt[0] : txt[1], col: ax.col, front: end.zv >= 0,
                    showLabel: mode !== "min" || !!ax.primary
                });
            });
        });

        // -- back layer: back arcs, back axis halves --
        circles.forEach(c => strokeRuns(c.back, COL.soft, 1, true, BACK_ALPHA * fade));
        if (labA > 0) halves.filter(h => !h.front).forEach(h =>
            strokeRuns([[p0, h.end]], h.col, 1.1, true, BACK_ALPHA * labA));

        // -- state vector (not drawn until this sphere's intro swing begins) --
        const vec = intro && st.vec <= 0 ? null : vecIn;
        let tipInfo = null;
        if (vec) {
            const tip = project3D(vec.x, vec.y, vec.z, cx, cy, R, tilt, phi);
            const foot = project3D(vec.x, vec.y, 0, cx, cy, R, tilt, phi); // projection on the equatorial plane
            const zc = Math.max(-1, Math.min(1, tip.zv));
            tipInfo = {
                tip, foot,
                radius: TIP_RADIUS * (1 + TIP_DEPTH_SIZE * zc),
                alpha: TIP_ALPHA_MIN + (1 - TIP_ALPHA_MIN) * (zc + 1) / 2,
                r: Math.hypot(vec.x, vec.y, vec.z)
            };
        }

        function drawVector() {
            const { tip, foot, radius } = tipInfo;
            const alpha = tipInfo.alpha * fade;
            const len = Math.hypot(tip.x - p0.x, tip.y - p0.y);

            // trail (fading path of the tip)
            if (s.trail.length > 1) {
                ctx.save();
                ctx.lineCap = "round";
                for (let i = 1; i < s.trail.length; i++) {
                    const a = s.trail[i - 1], b = s.trail[i];
                    const age = 1 - (now - b.t) / TRAIL_MS;
                    if (age <= 0) continue;
                    const pa = project3D(a.x, a.y, a.z, cx, cy, R, tilt, phi);
                    const pb = project3D(b.x, b.y, b.z, cx, cy, R, tilt, phi);
                    ctx.globalAlpha = TRAIL_ALPHA * age * age * fade;
                    ctx.strokeStyle = COL.warm;
                    ctx.lineWidth = 1.2 + 2.2 * age;
                    ctx.beginPath();
                    ctx.moveTo(pa.x, pa.y);
                    ctx.lineTo(pb.x, pb.y);
                    ctx.stroke();
                }
                ctx.restore();
            }

            // dropline to the equatorial plane + the projected point on it
            ctx.save();
            ctx.globalAlpha = 0.45 * alpha;
            ctx.strokeStyle = COL.warm;
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.moveTo(tip.x, tip.y);
            ctx.lineTo(foot.x, foot.y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 0.6 * alpha;
            ctx.beginPath();
            ctx.arc(foot.x, foot.y, 2.4, 0, 2 * Math.PI);
            ctx.fillStyle = COL.warm;
            ctx.fill();
            ctx.restore();

            // shaft + tip
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(tip.x, tip.y);
            ctx.strokeStyle = COL.warm;
            ctx.lineWidth = 2.2;
            ctx.lineCap = "round";
            ctx.stroke();

            if (len > 6) {
                // tip: size and alpha follow depth
                ctx.shadowColor = COL.warm;
                ctx.shadowBlur = tip.zv >= 0 ? 10 : 0;
                ctx.beginPath();
                ctx.arc(tip.x, tip.y, radius, 0, 2 * Math.PI);
                ctx.fillStyle = COL.warm;
                ctx.fill();
            } else {
                // vector at/near origin: highlight the maximally-mixed dot
                ctx.beginPath();
                ctx.arc(p0.x, p0.y, 5.5, 0, 2 * Math.PI);
                ctx.strokeStyle = COL.warm;
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
            ctx.restore();
        }

        const tipBehind = !!tipInfo && tipInfo.tip.zv < 0;
        if (tipBehind) drawVector();

        // -- front layer: front arcs, front axis halves, centre dot --
        circles.forEach(c => strokeRuns(c.front, COL.soft, 1.1, false, 0.85 * fade));
        if (labA > 0) halves.filter(h => h.front).forEach(h =>
            strokeRuns([[p0, h.end]], h.col, 1.2, false, 0.9 * labA));
        if (intro) {
            // pen dot at the leading end of each circle still being drawn
            circles.forEach((c, i) => {
                if (circleFrac[i] <= 0 || circleFrac[i] >= 1) return;
                ctx.globalAlpha = fade;
                ctx.beginPath();
                ctx.arc(c.end.x, c.end.y, 2.4, 0, 2 * Math.PI);
                ctx.fillStyle = COL.link;
                ctx.fill();
            });
        }
        ctx.globalAlpha = fade;
        ctx.beginPath();
        ctx.arc(p0.x, p0.y, 3, 0, 2 * Math.PI);
        ctx.fillStyle = COL.link;
        ctx.fill();

        // labels: opacity follows depth, kept inside the cell, de-overlapped
        const fontPx = mode === "full" ? 11 : 10;
        ctx.font = fontPx + "px " + MONO;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const top = rect.y + 24, bot = rect.y + rect.h - 22;
        const placed = halves.filter(h => h.showLabel).map(h => {
            const half = ctx.measureText(h.text).width / 2 + 3;
            return {
                h, half,
                lx: Math.max(rect.x + half, Math.min(rect.x + rect.w - half, h.lab.x)),
                ly: Math.max(top, Math.min(bot, h.lab.y))
            };
        });
        // nudge apart any two labels whose boxes collide (e.g. |+i⟩ (Y+) and |1⟩ (Z−) at the default view)
        const LBL_H = fontPx + 2;
        for (let pass = 0; pass < 3; pass++) {
            for (let i = 0; i < placed.length; i++) {
                for (let j = i + 1; j < placed.length; j++) {
                    const A = placed[i], B = placed[j];
                    const ox = A.half + B.half - Math.abs(A.lx - B.lx);
                    const oy = LBL_H - Math.abs(A.ly - B.ly);
                    if (ox <= 0 || oy <= 0) continue;
                    const dir = A.ly <= B.ly ? 1 : -1;      // push the upper one up, the lower one down
                    const push = oy / 2 + 1;
                    A.ly = Math.max(top, Math.min(bot, A.ly - dir * push));
                    B.ly = Math.max(top, Math.min(bot, B.ly + dir * push));
                }
            }
        }
        placed.forEach(({ h, lx, ly }) => {
            const depth01 = (Math.max(-1, Math.min(1, h.lab.zv)) + 1) / 2;
            ctx.globalAlpha = (LABEL_ALPHA_MIN + (1 - LABEL_ALPHA_MIN) * depth01) * labA;
            ctx.fillStyle = h.col;
            ctx.fillText(h.text, lx, ly);
        });
        ctx.globalAlpha = 1;

        if (tipInfo && !tipBehind) drawVector();

        // qubit name (top left) and |r| readout (bottom left) of this sphere
        const labelPx = mode === "min" ? 11 : 12;
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.font = "600 " + labelPx + "px " + MONO;
        ctx.globalAlpha = fade;
        ctx.fillStyle = COL.soft;
        ctx.fillText("q" + s.q, rect.x + 10, rect.y + 6 + labelPx);
        if (tipInfo) {
            ctx.font = labelPx + "px " + MONO;
            ctx.fillStyle = COL.warm;
            ctx.fillText("|r| = " + tipInfo.r.toFixed(2), rect.x + 10, rect.y + rect.h - 10);
        }
        ctx.globalAlpha = 1;
        ctx.restore();

        s.vec = vecIn ? { x: vecIn.x, y: vecIn.y, z: vecIn.z } : null;
        s.draw = tipInfo
            ? { r: tipInfo.r, tipZ: tipInfo.tip.zv, tipRadius: tipInfo.radius, tipAlpha: tipInfo.alpha, label: "q" + s.q }
            : { r: undefined, tipZ: 0, tipRadius: 0, tipAlpha: 0, label: "q" + s.q };
    }

    // ---- one frame ----
    function stepSpheres(now) {
        const dt = Math.min(64, Math.max(0, now - (lastNow || now)));
        lastNow = now;
        const snap = reduced();
        const k = 1 - Math.exp(-dt / SPHERE_REFLOW_TAU_MS);
        let moving = false;
        spheres.forEach(s => {
            ["x", "y", "w", "h"].forEach(key => {
                const d = s.tgt[key] - s.rect[key];
                if (snap || Math.abs(d) < 0.25) s.rect[key] = s.tgt[key];
                else { s.rect[key] += d * k; moving = true; }
            });
            const goal = s.want ? 1 : 0;
            if (snap) s.appear = goal;
            else if (s.appear !== goal) {
                const step = dt / SPHERE_APPEAR_MS;
                s.appear = goal > s.appear ? Math.min(goal, s.appear + step) : Math.max(goal, s.appear - step);
                moving = true;
            }
        });
        spheres = spheres.filter(s => s.want || s.appear > 0);
        return moving;
    }

    function draw(now) {
        const moving = stepSpheres(now);
        if (moving) needsFrame = true;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        const intro = blochIntro.active;

        const disp = intro ? introVectors() : displayedAt(now);
        if (anim && now - anim.t0 >= SLERP_MS) {
            displayed = anim.to;   // settled exactly on the simulator vectors
            pushTrails(now, displayed);
            anim = null;
        } else if (anim) {
            pushTrails(now, disp);
        }
        // age out the trails
        spheres.forEach(s => {
            while (s.trail.length && now - s.trail[0].t > TRAIL_MS) s.trail.shift();
            if (reduced()) s.trail = [];
        });

        spheres.forEach(s => {
            const v = disp[s.q] || s.vec || { x: 0, y: 0, z: 1 };
            drawSphere(s, v, now, intro, intro ? blochIntroStages(s.q) : null);
        });

        const s0 = spheres.find(s => s.q === 0);
        if (s0) {
            blochDraw.tipZ = s0.draw.tipZ;
            blochDraw.tipRadius = s0.draw.tipRadius;
            blochDraw.tipAlpha = s0.draw.tipAlpha;
            blochDraw.trailPoints = s0.trail.length;
        }
        if (s0) { blochDraw.tilt = s0.tilt; blochDraw.phi = s0.phi; }
        blochDraw.animating = !!anim;
        blochDraw.frames++;
    }

    // ---- frame loop: full rate while dragging/animating, IDLE_FPS otherwise; paused when hidden ----
    function frame(now) {
        blochAnimId = null;
        if (document.hidden) return;
        const busy = dragging || anim || needsFrame || spheres.some(s => s.trail.length > 0);
        const minGap = 1000 / IDLE_FPS - 4; // tolerate rAF jitter around the 30 fps cadence
        if (busy || now - lastDraw >= minGap) {
            needsFrame = false;
            lastDraw = now;
            draw(now);
        } else {
            lastNow = now;
        }
        blochAnimId = requestAnimationFrame(frame);
    }
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            if (blochAnimId !== null) { cancelAnimationFrame(blochAnimId); blochAnimId = null; }
        } else if (blochAnimId === null) {
            needsFrame = true;
            lastNow = 0;
            blochAnimId = requestAnimationFrame(frame);
        }
    });

    sphereCount = blochState.vectors.length;
    resize();
    blochAnimId = requestAnimationFrame(frame);
}

// ================== CIRCUIT UI ==================

const MAX_QUBITS = 4;
const MAX_COLS   = 8;

const GATE_DEFS = [
    { id: "X",   label: "X",   kind: "single", family: "pauli",  name: "Pauli-X (NOT)" },
    { id: "Y",   label: "Y",   kind: "single", family: "pauli",  name: "Pauli-Y" },
    { id: "Z",   label: "Z",   kind: "single", family: "pauli",  name: "Pauli-Z" },
    { id: "H",   label: "H",   kind: "single", family: "had",    name: "Hadamard" },
    { id: "S",   label: "S",   kind: "single", family: "phase",  name: "S (quarter-turn phase)" },
    { id: "T",   label: "T",   kind: "single", family: "phase",  name: "T (eighth-turn phase)" },
    { id: "CX",  label: "CX",  kind: "two",    family: "ctrl",   name: "Controlled-X (CNOT)" },
    { id: "CZ",  label: "CZ",  kind: "two",    family: "ctrl",   name: "Controlled-Z (symmetric; also drawn as two dots)" },
    { id: "CY",  label: "CY",  kind: "two",    family: "ctrl",   name: "Controlled-Y" },
    { id: "CCX", label: "CCX", kind: "three",  family: "ctrl",   name: "Toffoli (CCX)" }
];

// palette groups (display only)
const GATE_GROUPS = [
    { title: "Pauli",      ids: ["X", "Y", "Z"] },
    { title: "Hadamard",   ids: ["H"] },
    { title: "Phase",      ids: ["S", "T"] },
    { title: "Controlled", ids: ["CX", "CZ", "CY", "CCX"] }
];

function gateFamily(id) {
    const d = GATE_DEFS.find(g => g.id === id);
    return d ? d.family : "pauli";
}

// circuit[col] = array of gate objects
let circuit           = [];
let currentGateId     = null;
let pendingTwo        = null; // { gateId, col, controlRow }
let pendingThree      = null; // { gateId, col, rows: [c1, c2] }

let numQubitsSelect   = null;
let basisContainer    = null;
let systemPresetSelect= null;
let circuitGrid       = null;

function initCircuitUI() {
    console.log("[Rigel] initCircuitUI");
    circuit = Array.from({ length: MAX_COLS }, () => []);

    numQubitsSelect     = document.getElementById("num-qubits-select");
    basisContainer      = document.getElementById("qubit-basis-selects");
    systemPresetSelect  = document.getElementById("system-preset-select");
    circuitGrid         = document.getElementById("circuit-grid");
    const gatePalette   = document.getElementById("gate-palette");
    const clearBtn      = document.getElementById("clear-circuit-btn");

    if (!numQubitsSelect || !basisContainer || !circuitGrid || !gatePalette) {
        console.warn("[Rigel] Missing core circuit DOM elements; aborting init.");
        return;
    }

    // ---------- basis selectors ----------
    function renderBasisSelectors() {
        const n = parseInt(numQubitsSelect.value, 10);
        basisContainer.innerHTML = "";
        for (let q = 0; q < n; q++) {
            const label = document.createElement("label");
            label.className = "field";
            label.innerHTML = `
                <span class="field-label">q${q}</span>
                <select data-qubit="${q}" aria-label="Input state of qubit ${q}">
                    <option value="0">|0⟩</option>
                    <option value="1">|1⟩</option>
                    <option value="+">|+⟩</option>
                    <option value="-">|−⟩</option>
                    <option value="+i">|+i⟩</option>
                    <option value="-i">|−i⟩</option>
                </select>
            `;
            basisContainer.appendChild(label);
        }
    }

    numQubitsSelect.addEventListener("change", () => {
        renderBasisSelectors();
        pendingTwo = null;
        pendingThree = null;
        renderCircuitGrid();
    });
    renderBasisSelectors();

    // state-affecting inputs outside the grid
    if (systemPresetSelect) {
        systemPresetSelect.addEventListener("change", () => { updateWireLabels(); updateQuantumState(); });
    }
    basisContainer.addEventListener("change", () => { updateWireLabels(); updateQuantumState(); });

    // ---------- gate palette ----------
    GATE_GROUPS.forEach(grp => {
        const wrap = document.createElement("div");
        wrap.className = "gate-group";
        const title = document.createElement("span");
        title.className = "gate-group-title";
        title.textContent = grp.title;
        wrap.appendChild(title);
        const row = document.createElement("div");
        row.className = "gate-group-row";
        grp.ids.forEach(id => {
            const g = GATE_DEFS.find(d => d.id === id);
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "gate-btn gate-fam-" + g.family;
            btn.textContent = g.label;
            btn.dataset.gateId = g.id;
            btn.title = `${g.label}: ${g.name}`;
            btn.setAttribute("aria-label", `${g.label} gate, ${g.name}`);
            btn.setAttribute("aria-pressed", "false");
            btn.addEventListener("click", () => {
                currentGateId = g.id;
                pendingTwo = null;
                pendingThree = null;
                document.querySelectorAll(".gate-btn").forEach(b => {
                    b.classList.remove("active");
                    b.setAttribute("aria-pressed", "false");
                });
                btn.classList.add("active");
                btn.setAttribute("aria-pressed", "true");
                updatePlacementUI();
            });
            row.appendChild(btn);
        });
        wrap.appendChild(row);
        gatePalette.appendChild(wrap);
    });

    // ---------- placement step indicator ----------
    // Reflects currentGateId / pendingTwo / pendingThree (display only; never changes them).
    function updatePlacementUI() {
        const status = document.getElementById("placement-status");
        const def = GATE_DEFS.find(g => g.id === currentGateId);
        let steps = [], done = 0, text = "", ghost = "";
        if (!def) {
            text = "Select a gate, then click a slot on a wire.";
        } else if (def.kind === "single") {
            steps = ["Place"];
            text = `${def.label}: ${def.name}. Click a slot on a wire to place it.`;
            ghost = def.label;
        } else if (def.kind === "two") {
            steps = ["Control", "Target"];
            done = pendingTwo ? 1 : 0;
            text = pendingTwo
                ? `Now click the target qubit in step ${pendingTwo.col + 1} (same column).`
                : `${def.label}: ${def.name}. Click the control qubit first.`;
            ghost = pendingTwo ? (def.id === "CX" ? "⊕" : def.id.slice(1)) : "●";
        } else {
            steps = ["Control 1", "Control 2", "Target"];
            done = pendingThree ? pendingThree.rows.length : 0;
            text = done === 0 ? `${def.label}: ${def.name}. Click the first control qubit.`
                : done === 1 ? `Click the second control qubit in step ${pendingThree.col + 1}.`
                : `Now click the target qubit in step ${pendingThree.col + 1}.`;
            ghost = done < 2 ? "●" : "⊕";
        }
        if (status) {
            const ol = status.querySelector(".placement-steps");
            ol.innerHTML = "";
            steps.forEach((label, i) => {
                const li = document.createElement("li");
                li.textContent = label;
                li.dataset.state = steps.length === 1 ? "active" : (i < done ? "done" : i === done ? "active" : "todo");
                ol.appendChild(li);
            });
            ol.hidden = steps.length < 2;
            status.querySelector(".placement-text").textContent = text;
            status.dataset.pending = (pendingTwo || pendingThree) ? "1" : "0";
        }
        circuitGrid.style.setProperty("--ghost", ghost ? `"${ghost}"` : '""');
        circuitGrid.dataset.armed = def ? "1" : "0";
        circuitGrid.dataset.family = def ? def.family : "";
        const pend = pendingTwo ? [[pendingTwo.controlRow, pendingTwo.col]]
            : pendingThree ? pendingThree.rows.map(r => [r, pendingThree.col]) : [];
        circuitGrid.querySelectorAll(".circuit-cell.pending").forEach(c => c.classList.remove("pending"));
        pend.forEach(([r, c]) => {
            const cell = circuitGrid.querySelector(`.circuit-cell[data-row="${r}"][data-col="${c}"]`);
            if (cell) cell.classList.add("pending");
        });
    }

    // wire labels show the input ket of each qubit (or |psi> when a system preset overrides them)
    function updateWireLabels() {
        const preset = systemPresetSelect && systemPresetSelect.value !== "none";
        circuitGrid.querySelectorAll(".circuit-label-cell[data-qubit]").forEach(el => {
            const q = el.dataset.qubit;
            const sel = basisContainer.querySelector(`select[data-qubit="${q}"]`);
            const ket = preset ? "|ψ⟩" : (sel ? sel.options[sel.selectedIndex].textContent : "|0⟩");
            const k = el.querySelector(".wire-ket");
            if (k) k.textContent = ket;
        });
    }

    // ---------- gate placing / deleting ----------
    function deleteGateAt(row, col) {
        circuit[col] = circuit[col].filter(g => {
            if (g.target === row) return false;
            if (g.control === row) return false;
            if (g.controls && g.controls.includes(row)) return false;
            return true;
        });
        pendingTwo = null;
        pendingThree = null;
        renderCircuitGrid();
    }

    function handleCellClick(row, col) {
        placeAt(row, col);
        updatePlacementUI();
    }

    function placeAt(row, col) {
        if (!currentGateId) return;
        const gateDef = GATE_DEFS.find(g => g.id === currentGateId);
        if (!gateDef) return;

        // ----- single-qubit gate -----
        if (gateDef.kind === "single") {
            circuit[col] = circuit[col].filter(
                g => !(g.target === row && !g.control && !g.controls)
            );
            circuit[col].push({ id: gateDef.id, target: row });
            pendingTwo = null;
            pendingThree = null;
            renderCircuitGrid();
            return;
        }

        // ----- two-qubit gates (CX/CZ/CY) -----
        if (gateDef.kind === "two") {
            if (!pendingTwo) {
                // first click: control
                pendingTwo = { gateId: gateDef.id, col, controlRow: row };
                return;
            } else {
                // second click: target (same column, different row)
                if (
                    pendingTwo.col !== col ||
                    pendingTwo.controlRow === row ||
                    pendingTwo.gateId !== gateDef.id
                ) {
                    pendingTwo = null;
                    return;
                }
                const control = pendingTwo.controlRow;
                const target  = row;

                // clear conflicting gates on those qubits in this column
                circuit[col] = circuit[col].filter(g => {
                    if (g.id === "CX" || g.id === "CZ" || g.id === "CY") {
                        if (
                            g.control === control ||
                            g.control === target ||
                            g.target === control ||
                            g.target === target
                        ) return false;
                    }
                    return true;
                });

                circuit[col].push({ id: gateDef.id, control, target });
                pendingTwo = null;
                renderCircuitGrid();
                return;
            }
        }

        // ----- three-qubit Toffoli (CCX) -----
        if (gateDef.kind === "three" && gateDef.id === "CCX") {
            if (!pendingThree) {
                pendingThree = { gateId: "CCX", col, rows: [row] };
                return;
            } else if (pendingThree.rows.length === 1) {
                if (pendingThree.col !== col || pendingThree.rows[0] === row) {
                    pendingThree = null;
                    return;
                }
                pendingThree.rows.push(row); // second control
                return;
            } else if (pendingThree.rows.length === 2) {
                if (pendingThree.col !== col || pendingThree.rows.includes(row)) {
                    pendingThree = null;
                    return;
                }
                const [c1, c2] = pendingThree.rows;
                const target   = row;

                circuit[col] = circuit[col].filter(g => {
                    if (g.id === "CCX") {
                        if (
                            g.target === target ||
                            g.target === c1 ||
                            g.target === c2 ||
                            g.controls?.includes(target) ||
                            g.controls?.includes(c1) ||
                            g.controls?.includes(c2)
                        ) return false;
                    }
                    return true;
                });

                circuit[col].push({ id: "CCX", controls: [c1, c2], target });
                pendingThree = null;
                renderCircuitGrid();
                return;
            }
        }
    }

    // ---------- circuit grid rendering ----------
    // Slots are .circuit-cell[data-row][data-col] (invisible until hovered/focused); wires,
    // gate tiles, control dots and connectors are drawn inside/over them.
    let focusSlot = null; // {row, col}: the slot that is the roving tab stop
    function cellAt(row, col) {
        return circuitGrid.querySelector(`.circuit-cell[data-row="${row}"][data-col="${col}"]`);
    }
    function gateAtSlot(row, col) {
        return circuit[col].find(g => g.target === row || g.control === row || (g.controls && g.controls.includes(row)));
    }
    function slotLabel(row, col) {
        const g = gateAtSlot(row, col);
        let what = "empty";
        if (g) {
            const role = g.target === row ? "target" : "control";
            what = (g.control === undefined && !g.controls) ? `${g.id} gate` : `${g.id} ${role}`;
        }
        return `Qubit ${row}, step ${col + 1}: ${what}`;
    }

    function renderCircuitGrid() {
        const n = parseInt(numQubitsSelect.value, 10);
        const ae = document.activeElement;
        const hadFocus = !!(ae && ae.classList && ae.classList.contains("circuit-cell") && circuitGrid.contains(ae));
        if (hadFocus) focusSlot = { row: +ae.dataset.row, col: +ae.dataset.col };
        if (!focusSlot || focusSlot.row >= n) focusSlot = { row: 0, col: 0 };
        circuitGrid.innerHTML = "";
        circuitGrid.style.setProperty("--rows", n);

        // rows q0..q(n-1)
        for (let q = 0; q < n; q++) {
            const labelCell = document.createElement("div");
            labelCell.className = "circuit-label-cell";
            labelCell.dataset.qubit = q;
            labelCell.style.gridArea = `${q + 1} / 1`;   // explicit placement: the connectors share the grid
            labelCell.innerHTML = `<span class="wire-q">q${q}</span><span class="wire-ket">|0⟩</span>`;
            circuitGrid.appendChild(labelCell);

            for (let col = 0; col < MAX_COLS; col++) {
                const cell = document.createElement("div");
                cell.className = "circuit-cell";
                cell.dataset.row = q;
                cell.dataset.col = col;
                cell.style.gridArea = `${q + 1} / ${col + 2}`;
                cell.tabIndex = (focusSlot.row === q && focusSlot.col === col) ? 0 : -1;
                cell.setAttribute("role", "button");
                cell.innerHTML = `<span class="slot-idx" aria-hidden="true">${col + 1}</span><span class="slot-ghost" aria-hidden="true"></span>`;

                cell.addEventListener("click", () => handleCellClick(q, col));
                cell.addEventListener("contextmenu", e => {
                    e.preventDefault();
                    deleteGateAt(q, col);
                });
                cell.addEventListener("keydown", e => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleCellClick(q, col);
                    } else if (e.key === "Delete" || e.key === "Backspace") {
                        e.preventDefault();
                        deleteGateAt(q, col);
                    } else {
                        const d = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[e.key];
                        if (!d) return;
                        e.preventDefault();
                        const r2 = Math.max(0, Math.min(n - 1, q + d[0]));
                        const c2 = Math.max(0, Math.min(MAX_COLS - 1, col + d[1]));
                        const next = cellAt(r2, c2);
                        if (next) {
                            circuitGrid.querySelectorAll(".circuit-cell[tabindex='0']").forEach(x => { x.tabIndex = -1; });
                            next.tabIndex = 0;
                            focusSlot = { row: r2, col: c2 };
                            next.focus();
                        }
                    }
                });

                circuitGrid.appendChild(cell);
            }
        }

        // now draw the gates and control connectors
        for (let col = 0; col < MAX_COLS; col++) {
            circuit[col].forEach(g => {
                if (g.id === "CX" || g.id === "CZ" || g.id === "CY") {
                    renderControlledGate(g, col);
                } else if (g.id === "CCX") {
                    renderCCXGate(g, col);
                } else {
                    renderSingleGate(g, col);
                }
            });
        }
        circuitGrid.querySelectorAll(".circuit-cell").forEach(cell => {
            cell.setAttribute("aria-label", slotLabel(+cell.dataset.row, +cell.dataset.col));
        });

        if (hadFocus) {
            const f = cellAt(focusSlot.row, focusSlot.col);
            if (f) f.focus();
        }

        updateWireLabels();
        updatePlacementUI();
        // every grid re-render corresponds to a circuit edit -> refresh the sphere
        updateQuantumState();
    }

    function putMark(cell, html) {
        if (!cell) return;
        cell.classList.add("has-gate");
        cell.insertAdjacentHTML("beforeend", html);
    }
    const tileHtml = (label, fam, role, op) =>
        `<span class="gate-tile gate-fam-${fam}" data-role="${role}" data-gate="${label}"${op ? ` data-op="${op}"` : ""}>${label}</span>`;
    const ctlDot = (role = "control") => `<span class="ctl-dot" data-role="${role}"></span>`;
    const xorTarget = () => `<span class="tgt-xor" data-role="target-xor"></span>`;

    function renderSingleGate(g, col) {
        putMark(cellAt(g.target, col), tileHtml(g.id, gateFamily(g.id), "gate"));
    }

    function renderControlledGate(g, col) {
        const tCell = cellAt(g.target, col);
        const cCell = cellAt(g.control, col);
        if (g.id === "CX") putMark(tCell, xorTarget());
        else putMark(tCell, tileHtml(g.id.slice(1), "ctrl", "target-box", g.id));   // CZ: dot + Z box, CY: dot + Y box
        putMark(cCell, ctlDot());
        if (tCell && cCell) appendWire([cCell, tCell]);
    }

    // Vertical connector, placed by grid line so it scales with the diagram: it spans the rows
    // from the top to the bottom qubit, trimmed by half a row at each end (centre to centre).
    function appendWire(cells) {
        const rows = cells.map(c => +c.dataset.row);
        const top = Math.min(...rows), bottom = Math.max(...rows);
        const wire = document.createElement("div");
        wire.className = "circuit-wire";
        wire.style.gridColumn = String(+cells[0].dataset.col + 2);
        wire.style.gridRow = `${top + 1} / ${bottom + 2}`;
        circuitGrid.appendChild(wire);
    }

    function renderCCXGate(g, col) {
        const [c1, c2] = g.controls;
        const rows = [c1, c2, g.target].sort((a, b) => a - b);
        putMark(cellAt(g.target, col), xorTarget());
        [c1, c2].forEach(r => putMark(cellAt(r, col), ctlDot()));
        const endCells = [rows[0], rows[2]].map(r => cellAt(r, col)).filter(Boolean);
        if (endCells.length === 2) appendWire(endCells);
    }

    renderCircuitGrid();

    // ---------- buttons ----------
    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            circuit = Array.from({ length: MAX_COLS }, () => []);
            renderCircuitGrid(); // re-render also refreshes state output + sphere
        });
    }
}

// ================== QUANTUM MATH ==================
// Minimal complex helpers & state evolution.
// This is intentionally simple and limited to n <= 4.

function c(re, im = 0) {
    return { re, im };
}
function cAdd(a, b) {
    return { re: a.re + b.re, im: a.im + b.im };
}
function cSub(a, b) {
    return { re: a.re - b.re, im: a.im - b.im };
}
function cMul(a, b) {
    return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}
function cConj(a) {
    return { re: a.re, im: -a.im };
}
function cScale(a, s) {
    return { re: a.re * s, im: a.im * s };
}
function cAbs2(a) {
    return a.re * a.re + a.im * a.im;
}

// Single-qubit basis states
function basisKet(kind) {
    // |0>, |1>, |+>, |->, |+i>, |-i>
    switch (kind) {
        case "0":  return [c(1,0),   c(0,0)];
        case "1":  return [c(0,0),   c(1,0)];
        case "+":  return [c(1/Math.SQRT2,0), c(1/Math.SQRT2,0)];
        case "-":  return [c(1/Math.SQRT2,0), c(-1/Math.SQRT2,0)];
        case "+i": return [c(1/Math.SQRT2,0), c(0,1/Math.SQRT2)];
        case "-i": return [c(1/Math.SQRT2,0), c(0,-1/Math.SQRT2)];
        default:   return [c(1,0),   c(0,0)];
    }
}

// Tensor product of a list of local kets
function tensorProduct(kets) {
    let state = [c(1, 0)];
    for (const ket of kets) {
        const next = [];
        for (const a of state) {
            for (const b of ket) {
                next.push(cMul(a, b));
            }
        }
        state = next;
    }
    return state;
}

// Global initial state based on system preset or local bases
function buildInitialState() {
    const n = parseInt(numQubitsSelect.value, 10);
    const preset = systemPresetSelect ? systemPresetSelect.value : "none";

    const dim = 1 << n;
    let state = Array.from({ length: dim }, () => c(0,0));

    function setAmp(idx, val) {
        if (idx >= 0 && idx < dim) state[idx] = val;
    }

    if (preset && preset !== "none") {
        // global entangled presets; if n doesn't match, fall back
        if (preset.startsWith("bell") && n === 2) {
            const s = 1 / Math.SQRT2;
            if (preset === "bell-phi-plus") {
                setAmp(0b00, c(s,0));
                setAmp(0b11, c(s,0));
            } else if (preset === "bell-phi-minus") {
                setAmp(0b00, c(s,0));
                setAmp(0b11, c(-s,0));
            } else if (preset === "bell-psi-plus") {
                setAmp(0b01, c(s,0));
                setAmp(0b10, c(s,0));
            } else if (preset === "bell-psi-minus") {
                setAmp(0b01, c(s,0));
                setAmp(0b10, c(-s,0));
            }
            return state;
        }
        if (preset === "ghz-3" && n === 3) {
            const s = 1 / Math.SQRT2;
            setAmp(0b000, c(s,0));
            setAmp(0b111, c(s,0));
            return state;
        }
        if (preset === "ghz-4" && n === 4) {
            const s = 1 / Math.SQRT2;
            setAmp(0b0000, c(s,0));
            setAmp(0b1111, c(s,0));
            return state;
        }
        // if preset chosen but n mismatched, ignore and fall through to product state
    }

    // Product state from local bases
    const kets = [];
    const selects = basisContainer.querySelectorAll("select[data-qubit]");
    for (let q = 0; q < n; q++) {
        const sel = Array.from(selects).find(s => parseInt(s.dataset.qubit, 10) === q);
        const kind = sel ? sel.value : "0";
        kets.push(basisKet(kind));
    }
    state = tensorProduct(kets);
    return state;
}

// Bit-ordering convention: tensorProduct() builds the state with q0 as the
// MOST significant bit (so printed bitstrings read |q0 q1 …⟩), while the
// bit-manipulation gate kernels below index bits little-endian. All gate and
// expectation entry points therefore convert logical qubit → bit index here.
function bitOf(n, q) {
    return n - 1 - q;
}

// Apply single-qubit gate (2x2 unitary) to BIT q (little-endian; callers
// convert logical qubit → bit via bitOf)
function applySingleQubitGate(state, n, q, U) {
    const dim = state.length;
    const step = 1 << q;
    const span = step << 1;

    for (let base = 0; base < dim; base += span) {
        for (let i = 0; i < step; i++) {
            const i0 = base + i;
            const i1 = base + i + step;
            const a0 = state[i0];
            const a1 = state[i1];
            state[i0] = cAdd(cMul(U[0][0], a0), cMul(U[0][1], a1));
            state[i1] = cAdd(cMul(U[1][0], a0), cMul(U[1][1], a1));
        }
    }
}

// X,Y,Z,H,S,T matrices
const U_X = [[c(0,0), c(1,0)], [c(1,0), c(0,0)]];
const U_Z = [[c(1,0), c(0,0)], [c(0,0), c(-1,0)]];
const U_Y = [[c(0,0), c(0,-1)], [c(0,1), c(0,0)]];
const U_H = [
    [c(1/Math.SQRT2,0), c(1/Math.SQRT2,0)],
    [c(1/Math.SQRT2,0), c(-1/Math.SQRT2,0)]
];
const U_S = [[c(1,0), c(0,0)], [c(0,0), c(0,1)]];
const U_T = [[c(1,0), c(0,0)], [c(0,0), c(Math.SQRT1_2, Math.SQRT1_2)]];

// Controlled-Z
function applyCZ(state, n, control, target) {
    const dim = state.length;
    for (let i = 0; i < dim; i++) {
        const bC = (i >> control) & 1;
        const bT = (i >> target) & 1;
        if (bC && bT) {
            state[i].re *= -1;
            state[i].im *= -1;
        }
    }
}

// Controlled-Y
function applyCY(state, n, control, target) {
    const dim = state.length;
    const step = 1 << target;
    const span = step << 1;
    for (let base = 0; base < dim; base += span) {
        for (let i = 0; i < step; i++) {
            const i0 = base + i;
            const i1 = base + i + step;
            const bC0 = (i0 >> control) & 1;
            const bC1 = (i1 >> control) & 1;
            if (bC0 && bC1) {
                // both with control=1; but that can't happen for same control bit in same pair
                continue;
            }
            if (bC0 && !bC1) {
                const a0 = state[i0];
                const a1 = state[i1];
                // apply Y to (a0,a1)
                state[i0] = cMul(c(0,-1), a1); // -i*a1
                state[i1] = cMul(c(0, 1), a0); // i*a0
            } else if (!bC0 && bC1) {
                const a0 = state[i0];
                const a1 = state[i1];
                state[i0] = cMul(c(0,-1), a1);
                state[i1] = cMul(c(0, 1), a0);
            }
        }
    }
}

// CNOT
function applyCX(state, n, control, target) {
    const dim = state.length;
    const newState = state.map(a => ({ re: a.re, im: a.im }));
    for (let i = 0; i < dim; i++) {
        const bC = (i >> control) & 1;
        if (!bC) continue;
        const bT = (i >> target) & 1;
        const flipped = bT ? (i & ~(1 << target)) : (i | (1 << target));
        newState[flipped] = state[i];
    }
    for (let i = 0; i < dim; i++) {
        state[i] = newState[i];
    }
}

// Toffoli (CCX)
function applyCCX(state, n, c1, c2, target) {
    const dim = state.length;
    const newState = state.map(a => ({ re: a.re, im: a.im }));
    for (let i = 0; i < dim; i++) {
        const b1 = (i >> c1) & 1;
        const b2 = (i >> c2) & 1;
        if (!(b1 && b2)) continue;
        const bT = (i >> target) & 1;
        const flipped = bT ? (i & ~(1 << target)) : (i | (1 << target));
        newState[flipped] = state[i];
    }
    for (let i = 0; i < dim; i++) {
        state[i] = newState[i];
    }
}

// Apply all gates, column by column, left to right.
// Logical qubit rows are converted to state bits here (see bitOf).
function applyCircuit(state, n) {
    const b = (q) => bitOf(n, q);
    for (let col = 0; col < MAX_COLS; col++) {
        const gates = circuit[col];
        for (const g of gates) {
            // gates left on wires that are no longer shown (qubit count lowered) are skipped;
            // an out-of-range qubit would otherwise make the bit shifts below run away
            const rows = [g.target, g.control].concat(g.controls || []).filter(r => r !== undefined);
            if (rows.some(r => r >= n)) continue;
            switch (g.id) {
                case "X":
                    applySingleQubitGate(state, n, b(g.target), U_X); break;
                case "Y":
                    applySingleQubitGate(state, n, b(g.target), U_Y); break;
                case "Z":
                    applySingleQubitGate(state, n, b(g.target), U_Z); break;
                case "H":
                    applySingleQubitGate(state, n, b(g.target), U_H); break;
                case "S":
                    applySingleQubitGate(state, n, b(g.target), U_S); break;
                case "T":
                    applySingleQubitGate(state, n, b(g.target), U_T); break;
                case "CX":
                    applyCX(state, n, b(g.control), b(g.target)); break;
                case "CZ":
                    applyCZ(state, n, b(g.control), b(g.target)); break;
                case "CY":
                    applyCY(state, n, b(g.control), b(g.target)); break;
                case "CCX":
                    if (g.controls && g.controls.length === 2) {
                        applyCCX(state, n, b(g.controls[0]), b(g.controls[1]), b(g.target));
                    }
                    break;
                default:
                    break;
            }
        }
    }
    return state;
}

// Expectation <ψ|O_q|ψ> by applying O and taking inner product.
// q is a LOGICAL qubit index (converted to a bit index internally).
function expectationPauli(state, n, q, U) {
    const dim = state.length;
    // apply single-qubit U to copy
    const tmp = state.map(a => ({ re: a.re, im: a.im }));
    applySingleQubitGate(tmp, n, bitOf(n, q), U);
    // inner product <ψ|tmp>
    let acc = c(0,0);
    for (let i = 0; i < dim; i++) {
        acc = cAdd(acc, cMul(cConj(state[i]), tmp[i]));
    }
    return acc;
}

// ---------- LaTeX (KaTeX) state rendering ----------

function fmtNum(x) {
    let s = x.toFixed(3).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    if (s === "-0") s = "0";
    return s;
}

function fmtAmpLatex(a) {
    const re = Math.abs(a.re) < 1e-9 ? 0 : a.re;
    const im = Math.abs(a.im) < 1e-9 ? 0 : a.im;
    if (im === 0) return fmtNum(re);
    if (re === 0) {
        if (Math.abs(im - 1) < 1e-9) return "i";
        if (Math.abs(im + 1) < 1e-9) return "-i";
        return fmtNum(im) + "i";
    }
    return `(${fmtNum(re)} ${im > 0 ? "+" : "-"} ${fmtNum(Math.abs(im))}i)`;
}

function stateToLatex(state, n) {
    const terms = [];
    for (let i = 0; i < state.length; i++) {
        if (cAbs2(state[i]) < 1e-9) continue;
        const bits = i.toString(2).padStart(n, "0");
        let amp = fmtAmpLatex(state[i]);
        let sign = "+";
        if (amp.startsWith("-") && !amp.startsWith("(")) {
            sign = "-";
            amp = amp.slice(1);
        }
        if (amp === "1") amp = "";
        terms.push({ sign, tex: `${amp}${amp ? "\\," : ""}|${bits}\\rangle` });
    }
    if (!terms.length) return "|\\psi\\rangle = 0";
    let out = "|\\psi\\rangle = ";
    terms.forEach((term, i) => {
        if (i === 0) out += (term.sign === "-" ? "-" : "") + term.tex;
        else out += ` ${term.sign} ` + term.tex;
    });
    return out;
}

function gateSequenceText() {
    const lines = [];
    for (let col = 0; col < MAX_COLS; col++) {
        if (!circuit[col] || circuit[col].length === 0) continue;
        const parts = circuit[col].map(g => {
            if (g.id === "CX" || g.id === "CZ" || g.id === "CY") {
                return `${g.id}(control=q${g.control}, target=q${g.target})`;
            } else if (g.id === "CCX") {
                return `CCX(controls=q${g.controls[0]},q${g.controls[1]}, target=q${g.target})`;
            }
            return `${g.id}(q${g.target})`;
        });
        lines.push(`col ${col}: ${parts.join(", ")}`);
    }
    return lines.join("\n");
}

// Render the state panel with KaTeX (falls back to plain text if KaTeX
// hasn't loaded — e.g. CDN blocked)
function renderStateOutput(state, n) {
    const outEl = document.getElementById("state-output");
    if (!outEl) return;
    if (typeof katex === "undefined") {
        outEl.textContent = summarizeState(state, n);
        return;
    }
    outEl.innerHTML = "";
    const addLabel = (txt) => {
        const d = document.createElement("div");
        d.className = "section-label";
        d.textContent = txt;
        outEl.appendChild(d);
    };
    const addMath = (tex) => {
        const d = document.createElement("div");
        d.className = "math-line";
        katex.render(tex, d, { throwOnError: false });
        outEl.appendChild(d);
    };

    addLabel("Final state");
    addMath(stateToLatex(state, n));

    addLabel("Reduced Bloch vectors");
    blochState.vectors.forEach((v, q) => {
        const r = Math.hypot(v.x, v.y, v.z);
        addMath(`\\vec{r}_{q_{${q}}} = (${fmtNum(v.x)},\\ ${fmtNum(v.y)},\\ ${fmtNum(v.z)}), \\quad \\lVert\\vec{r}\\rVert = ${fmtNum(r)}`);
    });

    const seq = gateSequenceText();
    if (seq) {
        addLabel("Gate sequence");
        const pre = document.createElement("pre");
        pre.className = "gate-seq";
        pre.textContent = seq;
        outEl.appendChild(pre);
    }
}

// Plain-text fallback: final state and Bloch vectors per qubit
function summarizeState(state, n) {
    const dim = state.length;
    let lines = [];

    lines.push(`Final state (n = ${n}):`);
    for (let i = 0; i < dim; i++) {
        const amp = state[i];
        const prob = cAbs2(amp);
        if (prob < 1e-6) continue;
        const bitstring = i.toString(2).padStart(n, "0");
        const re = amp.re.toFixed(3);
        const im = amp.im.toFixed(3);
        lines.push(`  |${bitstring}⟩ : (${re} + ${im}i),  p = ${prob.toFixed(3)}`);
    }

    lines.push("");
    lines.push("Single-qubit reduced Bloch vectors (approx):");

    for (let q = 0; q < n; q++) {
        const ex = expectationPauli(state, n, q, U_X);
        const ey = expectationPauli(state, n, q, U_Y);
        const ez = expectationPauli(state, n, q, U_Z);

        const rx = ex.re;
        const ry = ey.re;
        const rz = ez.re;

        const r2 = rx*rx + ry*ry + rz*rz;
        const purity = (1 + r2) / 2;

        lines.push(
            `  q${q}:  ⟨X⟩=${rx.toFixed(3)}, ⟨Y⟩=${ry.toFixed(3)}, ⟨Z⟩=${rz.toFixed(3)},  |r|²=${r2.toFixed(3)},  purity≈${purity.toFixed(3)}`
        );
    }

    // gate narrative
    lines.push("");
    lines.push("Gate sequence (by column):");
    for (let col = 0; col < MAX_COLS; col++) {
        if (!circuit[col] || circuit[col].length === 0) continue;
        const parts = circuit[col].map(g => {
            if (g.id === "CX" || g.id === "CZ" || g.id === "CY") {
                return `${g.id}(control=q${g.control}, target=q${g.target})`;
            } else if (g.id === "CCX") {
                return `CCX(controls=q${g.controls[0]},q${g.controls[1]}, target=q${g.target})`;
            } else {
                return `${g.id}(q${g.target})`;
            }
        });
        lines.push(`  col ${col}: ${parts.join(", ")}`);
    }

    return lines.join("\n");
}

// Reduced Bloch vector of every qubit: (⟨X⟩, ⟨Y⟩, ⟨Z⟩) — identical to the
// partial-trace formulas x = 2Re(ρ01), y = −2Im(ρ01), z = ρ00 − ρ11.
function computeBlochVectors(state, n) {
    const vectors = [];
    for (let q = 0; q < n; q++) {
        vectors.push({
            x: expectationPauli(state, n, q, U_X).re,
            y: expectationPauli(state, n, q, U_Y).re,
            z: expectationPauli(state, n, q, U_Z).re
        });
    }
    return vectors;
}

// Recompute state + Bloch vectors and refresh sphere/output.
// Hooked into every circuit edit (grid renders, basis/preset changes, run).
function updateQuantumState() {
    if (!numQubitsSelect || !basisContainer) return;
    const n = parseInt(numQubitsSelect.value, 10);
    const state = buildInitialState();
    applyCircuit(state, n);

    blochState.vectors = computeBlochVectors(state, n);
    if (blochState.onUpdate) blochState.onUpdate();

    renderStateOutput(state, n);
}

// ================== BOOT ==================
// (last, so every top-level const above is initialised before the page is built)
// rigel.js is the last element of <body>, so the whole DOM already exists: build the page
// before the first frame (no layout shift when the circuit builder appears).
if (document.readyState === "loading" && !document.querySelector("footer")) {
    document.addEventListener("DOMContentLoaded", rigelBoot);
} else {
    rigelBoot();
}
