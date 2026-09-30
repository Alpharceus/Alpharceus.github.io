// ============================================================
// MINTAKA — Skills as a programmable 8-mode MZI router
//
// One laser enters rail 3 of an 8-mode rectangular (Clements)
// mesh: 8 columns, 28 Mach-Zehnder interferometers, followed by
// an output phase screen D.  Choosing a skill group (or a single
// output port) sets a target output field u — power 1/2 on each of
// the group's two rails, or all power on one rail — and the mesh is
// reprogrammed to produce it.
//
// Solver: a "funnel".  Only the seven MZIs of a splitter tree fed
// from rail 3 change their theta (they set the output magnitudes);
// the other 21 stay at theta = 0, phi = 0, and D carries every
// phase.  During a retune the target field u(t) is slerped from the
// old pattern to the new one and the funnel is re-solved each frame,
// so power is conserved on every frame.
//
// Convention: T_m(th, ph) = [[e^{i ph} cos th, -sin th],
//                            [e^{i ph} sin th,  cos th]] on modes
// (m, m+1); column k pairs {0,2,4,6} (even) or {1,3,5} (odd);
// U = D * C7 ... C0.
//
// Interactions: click a group button, or click an output port or its
// skills, to retune.  The mesh cycles through groups when idle.
// ============================================================

(function () {
    "use strict";

    // ---------- tuning constants ----------
    var RETUNE_MS = 600;          // retune duration
    var CYCLE_MS = 5200;          // idle auto-cycle period
    var HOLD_MS = 15000;          // idle cycle pauses this long after a click
    var IDLE_FRAME_MS = 33;       // idle frame budget (<= 30 fps)
    var PULSE_EVERY_MS = 1000;    // laser pulse spawn period
    var PULSE_SPEED = 240;        // logical px per second
    var DPR_CAP = 2;
    var LIT_POWER = 0.05;         // ports above this render at full brightness
    var DIM_ALPHA = 0.35;         // brightness of unlit skills
    var EPS_AMP = 1e-12;          // amplitude below which a phase is "undefined"
    var TINY_POW = 1e-22;         // subtree power below which theta is undefined

    // ---------- intro timing (ms) — tune here ----------
    // lead: arrival fill collapses to the emitter (arrival) / mesh fades in (first)
    // prop: the pulse front runs IN_X -> PORT_X; ports: bars grow, skills type in
    var INTRO = {
        arrival: { lead: 450, propEnd: 1650, total: 2400 },   // <= 2.5 s
        first: { lead: 900, propEnd: 2700, total: 3800 }      // <= 4 s
    };
    var INTRO_BARS_END = 0.5;     // ports phase: bars finish growing (fraction)
    var INTRO_TYPE_SPAN = 0.4;    // ports phase: spread of typing start times
    var INTRO_TYPE_LEN = 0.35;    // ports phase: typing time per line
    var INTRO_DIM_START = 0.6;    // ports phase: unlit skills start fading in
    var REDUCED_FADE_MS = 150;    // reduced motion: arrival fill fades, nothing else moves
    var STAR_RGB_FALLBACK = [214, 230, 255];

    // ============================================================
    // Physics (pure; exported as MZIRouter)
    // ============================================================
    var N = 8, IN_RAIL = 3, NCOLS = 8, TWO_PI = 2 * Math.PI;

    var SLOTS = [];               // 28 MZIs: {col, m}
    var COL_SLOTS = [];           // slot indices per column
    var SLOT_AT = {};
    (function () {
        for (var col = 0; col < NCOLS; col++) {
            COL_SLOTS.push([]);
            for (var m = col % 2; m + 1 < N; m += 2) {
                SLOT_AT[col + ":" + m] = SLOTS.length;
                COL_SLOTS[col].push(SLOTS.length);
                SLOTS.push({ col: col, m: m });
            }
        }
    })();

    // splitter tree for a laser on rail 3: stay = rails fed by the branch
    // that keeps the entry rail, hop = rails fed by the other output
    var FUNNEL = [
        { col: 0, m: 2, stay: [3, 4, 5, 6, 7], hop: [0, 1, 2] },
        { col: 1, m: 1, stay: [2], hop: [0, 1] },
        { col: 1, m: 3, stay: [3], hop: [4, 5, 6, 7] },
        { col: 2, m: 0, stay: [1], hop: [0] },
        { col: 2, m: 4, stay: [4], hop: [5, 6, 7] },
        { col: 3, m: 5, stay: [5], hop: [6, 7] },
        { col: 4, m: 6, stay: [6], hop: [7] }
    ];
    FUNNEL.forEach(function (f) { f.k = SLOT_AT[f.col + ":" + f.m]; });

    function wrap(t) {
        var r = ((t % TWO_PI) + TWO_PI) % TWO_PI;
        return r > TWO_PI - 1e-9 ? 0 : r;
    }
    function smoothstep(t) {
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        return t * t * (3 - 2 * t);
    }
    function newVec() { return { re: new Float64Array(N), im: new Float64Array(N) }; }
    function newConfig() {
        return { thetas: new Float64Array(SLOTS.length), phis: new Float64Array(SLOTS.length), deltas: new Float64Array(N) };
    }

    // target output fields (real, non-negative)
    function targetForGroup(g) {
        var u = newVec();
        u.re[2 * g] = u.re[2 * g + 1] = Math.SQRT1_2;
        return u;
    }
    function targetForPort(p) {
        var u = newVec();
        u.re[p] = 1;
        return u;
    }

    // forward-propagate a single-rail input; returns 10 field vectors:
    // [0] input, [1..8] after each column, [9] after the phase screen D
    function propagate(config, inRail) {
        var re = new Float64Array(N), im = new Float64Array(N);
        re[inRail === undefined ? IN_RAIL : inRail] = 1;
        var fields = [{ re: Float64Array.from(re), im: Float64Array.from(im) }];
        for (var col = 0; col < NCOLS; col++) {
            var list = COL_SLOTS[col];
            for (var q = 0; q < list.length; q++) {
                var k = list[q], m = SLOTS[k].m;
                var th = config.thetas[k], ph = config.phis[k];
                var c = Math.cos(th), s = Math.sin(th);
                var er = Math.cos(ph), ei = Math.sin(ph);
                var ar = re[m], ai = im[m], br = re[m + 1], bi = im[m + 1];
                var pr = er * ar - ei * ai, pi = er * ai + ei * ar;
                re[m] = c * pr - s * br;
                im[m] = c * pi - s * bi;
                re[m + 1] = s * pr + c * br;
                im[m + 1] = s * pi + c * bi;
            }
            fields.push({ re: Float64Array.from(re), im: Float64Array.from(im) });
        }
        for (var j = 0; j < N; j++) {
            var dr = Math.cos(config.deltas[j]), di = Math.sin(config.deltas[j]);
            var xr = re[j], xi = im[j];
            re[j] = dr * xr - di * xi;
            im[j] = dr * xi + di * xr;
        }
        fields.push({ re: Float64Array.from(re), im: Float64Array.from(im) });
        return fields;
    }

    // funnel solve: config with propagate(config, 3)[9] == u.
    // prev (optional) supplies theta / delta where they are undefined.
    function solve(u, prev) {
        var cfg = newConfig();
        var P = new Float64Array(N);
        for (var j = 0; j < N; j++) P[j] = u.re[j] * u.re[j] + u.im[j] * u.im[j];
        function pw(idx) { var s = 0; for (var q = 0; q < idx.length; q++) s += P[idx[q]]; return s; }
        for (var f = 0; f < FUNNEL.length; f++) {
            var fn = FUNNEL[f], stay = pw(fn.stay), hop = pw(fn.hop);
            cfg.thetas[fn.k] = (stay + hop < TINY_POW)
                ? (prev ? prev.thetas[fn.k] : 0)
                : Math.atan2(Math.sqrt(hop), Math.sqrt(stay));
        }
        var w = propagate(cfg, IN_RAIL)[NCOLS];   // D = identity so far
        for (var r = 0; r < N; r++) {
            if (Math.sqrt(P[r]) > EPS_AMP) {
                cfg.deltas[r] = wrap(Math.atan2(u.im[r], u.re[r]) - Math.atan2(w.im[r], w.re[r]));
            } else {
                cfg.deltas[r] = prev ? prev.deltas[r] : 0;
            }
        }
        return cfg;
    }

    // spherical interpolation between two unit fields (after phase alignment)
    function slerp(u0, u1, s) {
        var ipr = 0, ipi = 0, j;
        for (j = 0; j < N; j++) {                       // <u0, u1> = sum conj(u0) u1
            ipr += u0.re[j] * u1.re[j] + u0.im[j] * u1.im[j];
            ipi += u0.re[j] * u1.im[j] - u0.im[j] * u1.re[j];
        }
        var mag = Math.hypot(ipr, ipi);
        var cr = 1, ci = 0;                             // rotate u1 by conj(ip)/|ip| so <u0,u1> >= 0
        if (mag > 1e-12) { cr = ipr / mag; ci = -ipi / mag; }
        var omega = Math.acos(Math.min(1, mag));
        var a, b;
        if (omega < 1e-6) { a = 1 - s; b = s; }
        else { var so = Math.sin(omega); a = Math.sin((1 - s) * omega) / so; b = Math.sin(s * omega) / so; }
        var out = newVec(), norm = 0;
        for (j = 0; j < N; j++) {
            var vr = cr * u1.re[j] - ci * u1.im[j], vi = cr * u1.im[j] + ci * u1.re[j];
            out.re[j] = a * u0.re[j] + b * vr;
            out.im[j] = a * u0.im[j] + b * vi;
            norm += out.re[j] * out.re[j] + out.im[j] * out.im[j];
        }
        if (omega < 1e-6) {
            norm = Math.sqrt(norm) || 1;
            for (j = 0; j < N; j++) { out.re[j] /= norm; out.im[j] /= norm; }
        }
        return out;
    }

    var api = {
        N: N, IN_RAIL: IN_RAIL, NCOLS: NCOLS, RETUNE_MS: RETUNE_MS,
        SLOTS: SLOTS, SLOT_AT: SLOT_AT,
        solve: solve, propagate: propagate, slerp: slerp, smoothstep: smoothstep,
        targetForGroup: targetForGroup, targetForPort: targetForPort,
        newConfig: newConfig
    };

    var root = typeof window !== "undefined" ? window : globalThis;
    root.MZIRouter = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;

    if (typeof document === "undefined" || !document.getElementById("mzi-canvas")) return;

    // ============================================================
    // Page: skills, geometry, drawing, interaction
    // ============================================================

    // ---------- skill groups (group g owns ports 2g, 2g+1) ----------
    var GROUPS = [
        { name: "Hardware", rgb: [255, 190, 77] },
        { name: "Quantum", rgb: [95, 216, 232] },
        { name: "Software", rgb: [126, 227, 154] },
        { name: "ML & Data", rgb: [180, 154, 255] }
    ];

    // port r carries SKILLS[r*4 .. r*4+3]; group of port r = r >> 1
    var SKILLS = [
        // Hardware (ports 0–1)
        "FPGA design (VHDL)", "Verilog & RTL", "Embedded & microcontrollers", "Digital electronics",
        "Analog electronics", "Lab instrumentation", "LabVIEW", "PCB & prototyping",
        // Quantum (ports 2–3)
        "Photonic quantum computing", "GBS systems", "MZI interferometry", "Single-photon detection",
        "Qiskit", "Quantum error correction", "Quantum simulation", "Quantum optics",
        // Software (ports 4–5)
        "Python", "C & low-level", "JavaScript & creative coding", "Django & REST APIs",
        "Node.js", "MATLAB", "R & statistics", "Linux & shell",
        // ML & Data (ports 6–7)
        "TensorFlow & deep learning", "Graph neural networks", "Computer vision (OpenCV)", "NLP & language modeling",
        "Local LLMs & agents", "Signal processing", "Scientific computing", "Data viz & dashboards"
    ];

    // ---------- geometry (logical px) ----------
    var W = 800, RAILS = N;
    var TOP_PAD = 38, RAIL_GAP = 70;
    var H = TOP_PAD * 2 + (RAILS - 1) * RAIL_GAP;   // 566
    var IN_X = 30;                                  // laser emitter / rail start
    var COL_X0 = 96, COL_SPAN = 78;                 // MZI centre of column 0, column pitch
    var D_X = 676;                                  // output phase screen
    var PORT_X = 706;                               // output ports
    var BAR_MAX = 84;                               // bar length at power 1
    var ARM_OFF = 22;                               // arm offset from the rail at an MZI
    var CONV_HALF = 38, CONV_FLAT = 30;
    var COUPLER_DX = 14, ZONE = 16;

    var railY0 = [], colX = [];
    var i;
    for (i = 0; i < RAILS; i++) railY0.push(TOP_PAD + i * RAIL_GAP);
    for (i = 0; i < NCOLS; i++) colX.push(COL_X0 + i * COL_SPAN);

    // slot -> {xc, m}; rails converge toward each MZI they enter
    function railY(rail, x) {
        var y = railY0[rail];
        for (var c = 0; c < NCOLS; c++) {
            var dx = Math.abs(x - colX[c]);
            if (dx >= CONV_HALF) continue;
            var m = -1;
            var list = COL_SLOTS[c];
            for (var q = 0; q < list.length; q++) {
                var mm = SLOTS[list[q]].m;
                if (rail === mm || rail === mm + 1) { m = mm; break; }
            }
            if (m < 0) continue;
            var t = dx <= CONV_FLAT ? 1 : smoothstep((CONV_HALF - dx) / (CONV_HALF - CONV_FLAT));
            y += (rail === m) ? ARM_OFF * t : -ARM_OFF * t;
        }
        return y;
    }

    // ---------- DOM ----------
    var canvas = document.getElementById("mzi-canvas");
    var ctx = canvas.getContext("2d");
    var tip = document.getElementById("mesh-tip");
    var labelsEl = document.getElementById("port-labels");
    var buttons = Array.prototype.slice.call(document.querySelectorAll("#channel-row .ch-btn"));
    var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // output-port skill labels (DOM, so they can sit beside or below the mesh)
    var portEls = [], skillEls = [];
    (function () {
        var existing = labelsEl.querySelectorAll(".port");
        for (var r = 0; r < RAILS; r++) {
            var btn = existing[r];
            if (!btn) {                       // markup is static in skills.html; this is the fallback
                var g = GROUPS[r >> 1];
                btn = document.createElement("button");
                btn.type = "button";
                btn.className = "port";
                btn.setAttribute("data-port", r);
                btn.style.setProperty("--pc", "rgb(" + g.rgb.join(",") + ")");
                btn.style.setProperty("--py", (railY0[r] / H * 100).toFixed(3) + "%");
                var names = [];
                for (var s = 0; s < 4; s++) {
                    var span = document.createElement("span");
                    span.className = "sk";
                    span.setAttribute("data-group", r >> 1);
                    span.textContent = SKILLS[r * 4 + s];
                    names.push(SKILLS[r * 4 + s]);
                    btn.appendChild(span);
                }
                btn.setAttribute("aria-label", "Send all light to output " + (r + 1) + ": " + names.join(", "));
                labelsEl.appendChild(btn);
            }
            var sks = btn.querySelectorAll(".sk");
            for (var q = 0; q < 4; q++) skillEls.push(sks[q]);
            (function (rr) { btn.addEventListener("click", function () { selectPort(rr, true); }); })(r);
            portEls.push(btn);
        }
    })();

    function rgba(c, a) { return "rgba(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + "," + a + ")"; }
    function lerpRgb(a, b, s) { return [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s]; }

    // heater colour: dark at phase 0, warm orange at 2*pi
    var HEAT_COLD = [24, 30, 46], HEAT_HOT = [255, 138, 61];
    function heatColor(ph) {
        var t = Math.max(0, Math.min(1, ph / TWO_PI));
        return "rgb(" + Math.round(HEAT_COLD[0] + (HEAT_HOT[0] - HEAT_COLD[0]) * t) + "," +
            Math.round(HEAT_COLD[1] + (HEAT_HOT[1] - HEAT_COLD[1]) * t) + "," +
            Math.round(HEAT_COLD[2] + (HEAT_HOT[2] - HEAT_COLD[2]) * t) + ")";
    }

    // ---------- state ----------
    var target = { kind: "group", idx: 0 };
    var uCur = targetForGroup(0), uFrom = uCur, uTo = uCur;
    var colFrom = GROUPS[0].rgb, colTo = GROUPS[0].rgb;
    var cfg = solve(uCur, null);
    var fields = propagate(cfg, IN_RAIL);
    var inten = [];                       // |field|^2 per stage
    var outP = new Float64Array(RAILS);
    var tStart = 0, progress = 1;         // progress 0..1 (raw time fraction)
    var lightRgb = GROUPS[0].rgb;
    var pulses = [];
    var lastPulse = -1e9, lastDraw = 0, lastTs = 0;
    var holdUntil = 0, nextCycle = 0;
    var raf = 0;
    var hover = null;                     // {kind:'mzi', k} | {kind:'d', j}
    var pointer = { x: 0, y: 0 };
    var litCache = new Array(RAILS).fill(-1);
    var introActive = false;              // intro running: no idle loop, no cycling
    var intro = null;                     // per-frame intro state (see introFrame)

    function targetColor(t) { return GROUPS[t.kind === "group" ? t.idx : t.idx >> 1].rgb; }

    function updateButtons() {
        for (var b = 0; b < buttons.length; b++) {
            var on = target.kind === "group" && target.idx === b;
            buttons[b].classList.toggle("active", on);
            buttons[b].setAttribute("aria-pressed", on ? "true" : "false");
            buttons[b].style.borderColor = on ? rgba(GROUPS[b].rgb, 1) : "";
            buttons[b].style.color = on ? rgba(GROUPS[b].rgb, 1) : "";
        }
    }

    function retune(t, manual) {
        var now = performance.now();
        target = t;
        uFrom = uCur;
        uTo = t.kind === "group" ? targetForGroup(t.idx) : targetForPort(t.idx);
        colFrom = lightRgb;
        colTo = targetColor(t);
        tStart = now;
        progress = reducedMotion ? 1 : 0;
        if (manual) holdUntil = now + HOLD_MS;
        nextCycle = now + CYCLE_MS;
        updateButtons();
        if (reducedMotion) { evaluate(1); renderOnce(); }
        else startLoop();
    }
    function selectGroup(g, manual) { retune({ kind: "group", idx: g }, manual); }
    function selectPort(p, manual) { retune({ kind: "port", idx: p }, manual); }

    buttons.forEach(function (btn, g) {
        btn.addEventListener("click", function () { selectGroup(g, true); });
    });

    // recompute uCur, cfg, fields and intensities for raw progress f
    function powersOf(fs) {
        return fs.map(function (v) {
            var p = new Float64Array(N);
            for (var j = 0; j < N; j++) p[j] = v.re[j] * v.re[j] + v.im[j] * v.im[j];
            return p;
        });
    }
    function evaluate(f) {
        var s = smoothstep(f);
        uCur = f >= 1 ? uTo : slerp(uFrom, uTo, s);
        cfg = solve(uCur, cfg);
        fields = propagate(cfg, IN_RAIL);
        inten = powersOf(fields);
        for (var r = 0; r < RAILS; r++) outP[r] = inten[NCOLS][r];
        lightRgb = lerpRgb(colFrom, colTo, s);
        applyLabels();
    }

    function portOp(r) {
        var t = smoothstep((outP[r] - 0.02) / 0.06);
        if (t < 0.01) t = 0; else if (t > 0.99) t = 1;
        return DIM_ALPHA + (1 - DIM_ALPHA) * t;
    }

    function applyLabels() {
        if (introActive) return;      // the intro drives label opacity itself
        for (var r = 0; r < RAILS; r++) {
            var op = portOp(r);
            var key = Math.round(op * 1e4);
            if (litCache[r] === key) continue;
            litCache[r] = key;
            portEls[r].classList.toggle("lit", op > 0.99);
            // dim by colour, not opacity: --lit (0..1) mixes the port colour over the dim grey in CSS
            var litT = (op - DIM_ALPHA) / (1 - DIM_ALPHA);
            for (var s = 0; s < 4; s++) {
                var el = skillEls[r * 4 + s];
                el.style.opacity = "";
                el.style.setProperty("--lit", litT.toFixed(3));
            }
        }
    }

    // intensity on rail j at logical x, interpolated across each MZI's couplers
    function intensityAt(j, x) {
        for (var c = 0; c < NCOLS; c++) {
            var xa = colX[c] - ZONE, xb = colX[c] + ZONE;
            if (x < xa) return inten[c][j];
            if (x < xb) {
                var s = smoothstep((x - xa) / (xb - xa));
                return inten[c][j] + (inten[c + 1][j] - inten[c][j]) * s;
            }
        }
        return inten[NCOLS][j];
    }

    // ---------- canvas sizing + static layer ----------
    var dpr = 1, scale = 2, staticLayer = null;
    var railPaths = [];

    function buildRailPaths() {
        railPaths = [];
        for (var r = 0; r < RAILS; r++) {
            var p = new Path2D();
            p.moveTo(IN_X, railY(r, IN_X));
            for (var x = IN_X + 4; x <= PORT_X; x += 4) p.lineTo(x, railY(r, x));
            railPaths.push(p);
        }
    }

    function rr(c, x, y, w, h, r) {
        c.beginPath();
        c.moveTo(x + r, y);
        c.arcTo(x + w, y, x + w, y + h, r);
        c.arcTo(x + w, y + h, x, y + h, r);
        c.arcTo(x, y + h, x, y, r);
        c.arcTo(x, y, x + w, y, r);
        c.closePath();
    }

    function heaterRects(k) {
        var s = SLOTS[k], xc = colX[s.col], ya = railY0[s.m] + ARM_OFF;
        return {
            theta: { x: xc - 8, y: ya - 3.5, w: 16, h: 7 },
            phi: { x: xc - 29, y: ya - 3.5, w: 8, h: 7 }
        };
    }

    function buildStatic() {
        var cssW = canvas.clientWidth || W;
        dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
        var cw = Math.max(1, Math.round(cssW * dpr));
        var ch = Math.max(1, Math.round(cssW * dpr * H / W));
        if (canvas.width !== cw) canvas.width = cw;
        if (canvas.height !== ch) canvas.height = ch;
        scale = cw / W;
        staticLayer = document.createElement("canvas");
        staticLayer.width = cw; staticLayer.height = ch;
        var c = staticLayer.getContext("2d");
        c.setTransform(scale, 0, 0, scale, 0, 0);

        // rails
        c.strokeStyle = "rgba(130, 160, 210, 0.26)";
        c.lineWidth = 1.4;
        for (var r = 0; r < RAILS; r++) c.stroke(railPaths[r]);

        // MZIs: two couplers + heaters on the top arm
        for (var k = 0; k < SLOTS.length; k++) {
            var s = SLOTS[k], xc = colX[s.col];
            var ya = railY0[s.m] + ARM_OFF, yb = railY0[s.m + 1] - ARM_OFF;
            c.strokeStyle = "rgba(170, 200, 255, 0.5)";
            c.lineWidth = 2.4;
            for (var side = -1; side <= 1; side += 2) {
                c.beginPath();
                c.moveTo(xc + side * COUPLER_DX, ya);
                c.lineTo(xc + side * COUPLER_DX, yb);
                c.stroke();
            }
            var hr = heaterRects(k);
            c.strokeStyle = "rgba(170, 200, 255, 0.55)";
            c.lineWidth = 0.9;
            rr(c, hr.theta.x, hr.theta.y, hr.theta.w, hr.theta.h, 1.5); c.stroke();
            rr(c, hr.phi.x, hr.phi.y, hr.phi.w, hr.phi.h, 1.5); c.stroke();
        }

        // output phase screen outlines + ports
        for (var j = 0; j < RAILS; j++) {
            c.strokeStyle = "rgba(170, 200, 255, 0.55)";
            c.lineWidth = 0.9;
            rr(c, D_X - 7, railY0[j] - 3.5, 14, 7, 1.5); c.stroke();
            c.fillStyle = "rgba(140, 170, 220, 0.16)";
            rr(c, PORT_X + 4, railY0[j] - 3, BAR_MAX, 6, 3); c.fill();
            c.fillStyle = "rgba(170, 200, 255, 0.6)";
            c.beginPath(); c.arc(PORT_X, railY0[j], 3, 0, TWO_PI); c.fill();
        }

        // laser emitter on the input rail
        c.fillStyle = "#0A0E16";
        c.strokeStyle = "rgba(220, 235, 255, 0.85)";
        c.lineWidth = 1.4;
        c.beginPath(); c.arc(IN_X - 6, railY0[IN_RAIL], 5, 0, TWO_PI); c.fill(); c.stroke();
    }

    function resize() {
        buildStatic();
        renderOnce();
    }

    // ---------- drawing ----------
    function draw(now) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(staticLayer, 0, 0);
        ctx.setTransform(scale, 0, 0, scale, 0, 0);

        var rgb = lightRgb, r, c, j;

        // intro: rails, heaters and phase screen exist only behind the pulse front
        if (intro) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, intro.front, H);
            ctx.clip();
        }

        // steady CW glow on each rail: gradient stops from the propagated field
        ctx.lineCap = "butt";
        for (r = 0; r < RAILS; r++) {
            var gGlow = ctx.createLinearGradient(0, 0, W, 0);
            var gCore = ctx.createLinearGradient(0, 0, W, 0);
            var add = function (x, I) {
                var o = Math.max(0, Math.min(1, x / W)), a = Math.min(1, I * 1.1);
                gGlow.addColorStop(o, rgba(rgb, (a * 0.22).toFixed(3)));
                gCore.addColorStop(o, rgba(rgb, a.toFixed(3)));
            };
            add(0, inten[0][r]);
            for (c = 0; c < NCOLS; c++) {
                add(colX[c] - ZONE, inten[c][r]);
                add(colX[c] + ZONE, inten[c + 1][r]);
            }
            add(W, inten[NCOLS][r]);
            ctx.strokeStyle = gGlow; ctx.lineWidth = 8; ctx.stroke(railPaths[r]);
            ctx.strokeStyle = gCore; ctx.lineWidth = 2.2; ctx.stroke(railPaths[r]);
        }

        // heaters (phase -> colour)
        var k;
        for (k = 0; k < SLOTS.length; k++) {
            var hr = heaterRects(k);
            ctx.fillStyle = heatColor(2 * cfg.thetas[k]);       // internal phase is 2*theta
            ctx.fillRect(hr.theta.x + 1, hr.theta.y + 1, hr.theta.w - 2, hr.theta.h - 2);
            ctx.fillStyle = heatColor(cfg.phis[k]);
            ctx.fillRect(hr.phi.x + 1, hr.phi.y + 1, hr.phi.w - 2, hr.phi.h - 2);
        }
        for (j = 0; j < RAILS; j++) {
            ctx.fillStyle = heatColor(cfg.deltas[j]);
            ctx.fillRect(D_X - 6, railY0[j] - 2.5, 12, 5);
        }
        if (intro) {
            ctx.restore();
            // the pulse head: a bright packet on every rail that carries light at the front
            for (r = 0; r < RAILS; r++) {
                var Ih = intensityAt(r, intro.front);
                if (Ih < 0.02 || intro.front <= IN_X) continue;
                ctx.globalAlpha = Math.min(1, Ih);
                ctx.fillStyle = "rgba(255,255,255,0.95)";
                ctx.beginPath(); ctx.arc(intro.front, railY(r, intro.front), 1.4 + 2.6 * Math.sqrt(Ih), 0, TWO_PI); ctx.fill();
            }
            ctx.globalAlpha = 1;
        }

        // hover ring
        if (hover) {
            ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
            ctx.lineWidth = 1.2;
            if (hover.kind === "mzi") {
                var s = SLOTS[hover.k], xc = colX[s.col];
                rr(ctx, xc - 34, railY0[s.m] + ARM_OFF - 9, 68, railY0[s.m + 1] - railY0[s.m] - 2 * ARM_OFF + 18, 5);
                ctx.stroke();
            } else {
                rr(ctx, D_X - 10, railY0[hover.j] - 7, 20, 14, 4);
                ctx.stroke();
            }
        }

        // pulses: one packet crosses every rail; alpha = local intensity
        for (var n = 0; n < pulses.length; n++) {
            var px = pulses[n];
            for (r = 0; r < RAILS; r++) {
                var I = intensityAt(r, px);
                if (I < 0.02) continue;
                var y = railY(r, px), x0 = Math.max(IN_X, px - 16);
                ctx.globalAlpha = Math.min(1, I);
                ctx.strokeStyle = rgba(rgb, 1);
                ctx.lineWidth = 0.8 + 2.4 * I;
                ctx.beginPath(); ctx.moveTo(x0, railY(r, x0)); ctx.lineTo(px, y); ctx.stroke();
                ctx.fillStyle = "rgba(255,255,255,0.95)";
                ctx.beginPath(); ctx.arc(px, y, 1.4 + 2.2 * Math.sqrt(I), 0, TWO_PI); ctx.fill();
            }
        }
        ctx.globalAlpha = 1;

        // output bars + port glow, in each port's own group colour
        for (r = 0; r < RAILS; r++) {
            var P = outP[r] * (intro ? intro.portT : 1);
            if (P < 0.003) continue;
            var col = GROUPS[r >> 1].rgb;
            ctx.fillStyle = rgba(col, 0.95);
            rr(ctx, PORT_X + 4, railY0[r] - 3, Math.max(4, BAR_MAX * P), 6, 3);
            ctx.fill();
            ctx.fillStyle = rgba(col, Math.min(1, 0.25 + P));
            ctx.beginPath(); ctx.arc(PORT_X, railY0[r], 3 + 4 * P, 0, TWO_PI); ctx.fill();
        }

        // laser emitter glow
        var em = intro ? intro.emit : 1;
        if (em > 0) {
            ctx.fillStyle = rgba(rgb, 0.95 * em);
            ctx.beginPath(); ctx.arc(IN_X - 6, railY0[IN_RAIL], 2.6 + 5 * (1 - em), 0, TWO_PI); ctx.fill();
        }

        if (hover) updateTip();
    }

    function renderOnce() {
        if (!staticLayer) return;
        draw(performance.now());
    }

    // ---------- hover / click ----------
    function localPoint(ev) {
        var rect = canvas.getBoundingClientRect();
        return { x: (ev.clientX - rect.left) * W / rect.width, y: (ev.clientY - rect.top) * H / rect.height, rect: rect };
    }

    function hitTest(p) {
        var k;
        for (k = 0; k < SLOTS.length; k++) {
            var s = SLOTS[k], xc = colX[s.col];
            var y0 = railY0[s.m] + ARM_OFF - 9, y1 = railY0[s.m + 1] - ARM_OFF + 9;
            if (Math.abs(p.x - xc) <= 34 && p.y >= y0 && p.y <= y1) return { kind: "mzi", k: k };
        }
        for (var j = 0; j < RAILS; j++) {
            if (Math.abs(p.x - D_X) <= 10 && Math.abs(p.y - railY0[j]) <= 8) return { kind: "d", j: j };
        }
        return null;
    }

    function portAt(p) {
        if (p.x < PORT_X - 10) return -1;
        var r = Math.round((p.y - TOP_PAD) / RAIL_GAP);
        if (r < 0 || r >= RAILS) return -1;
        return Math.abs(p.y - railY0[r]) <= RAIL_GAP / 2 - 4 ? r : -1;
    }

    function fmt(x) { return x.toFixed(3); }
    function updateTip() {
        if (!hover) { tip.hidden = true; return; }
        var txt;
        if (hover.kind === "mzi") {
            var s = SLOTS[hover.k], th = cfg.thetas[hover.k], ph = cfg.phis[hover.k];
            txt = "MZI col " + s.col + ", modes " + s.m + "/" + (s.m + 1) +
                "\nθ " + fmt(th) + " rad (" + (th * 180 / Math.PI).toFixed(1) + "°)" +
                "\nφ " + fmt(ph) + " rad" +
                "\ncos²θ " + fmt(Math.cos(th) * Math.cos(th));
        } else {
            txt = "Output phase, rail " + hover.j + "\nδ " + fmt(cfg.deltas[hover.j]) + " rad";
        }
        if (tip.textContent !== txt) tip.textContent = txt;
        tip.hidden = false;
        var stageRect = tip.parentNode.getBoundingClientRect();
        var w = tip.offsetWidth, h = tip.offsetHeight;
        var x = pointer.x - stageRect.left + 14, y = pointer.y - stageRect.top + 14;
        if (x + w > stageRect.width) x = pointer.x - stageRect.left - w - 14;
        if (y + h > stageRect.height) y = pointer.y - stageRect.top - h - 14;
        tip.style.left = Math.max(0, x) + "px";
        tip.style.top = Math.max(0, y) + "px";
    }

    canvas.addEventListener("pointermove", function (ev) {
        var p = localPoint(ev);
        pointer.x = ev.clientX; pointer.y = ev.clientY;
        var h = hitTest(p);
        var changed = (!h) !== (!hover) || (h && hover && (h.kind !== hover.kind || h.k !== hover.k || h.j !== hover.j));
        hover = h;
        canvas.style.cursor = h ? "help" : (portAt(p) >= 0 ? "pointer" : "");
        if (changed || h) { if (!h) tip.hidden = true; if (reducedMotion || !raf) renderOnce(); }
    });
    canvas.addEventListener("pointerleave", function () {
        hover = null; tip.hidden = true; canvas.style.cursor = "";
        if (reducedMotion || !raf) renderOnce();
    });
    canvas.addEventListener("click", function (ev) {
        var p = localPoint(ev), r = portAt(p);
        if (r >= 0) selectPort(r, true);
    });

    // ---------- loop ----------
    function frame(ts) {
        raf = requestAnimationFrame(frame);
        var busy = progress < 1;
        if (!busy && ts - lastDraw < IDLE_FRAME_MS) return;
        var dt = lastTs ? Math.min(100, ts - lastTs) : 16.7;
        lastTs = ts; lastDraw = ts;

        if (busy) {
            progress = Math.min(1, (ts - tStart) / RETUNE_MS);
            evaluate(progress);
        } else if (ts > nextCycle && ts > holdUntil) {
            selectGroup(target.kind === "group" ? (target.idx + 1) % GROUPS.length : (target.idx >> 1), false);
        }

        if (ts - lastPulse >= PULSE_EVERY_MS) { lastPulse = ts; pulses.push(IN_X); }
        var adv = PULSE_SPEED * dt / 1000;
        for (var n = 0; n < pulses.length; n++) pulses[n] += adv;
        pulses = pulses.filter(function (x) { return x < PORT_X; });

        draw(ts);
    }

    function startLoop() {
        if (raf || reducedMotion || document.hidden || introActive) return;
        lastTs = 0;
        raf = requestAnimationFrame(frame);
    }
    function stopLoop() {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
    }
    document.addEventListener("visibilitychange", function () {
        if (document.hidden) stopLoop(); else startLoop();
    });

    // page-visible state for tests and tooling
    api.getState = function () {
        return {
            kind: target.kind, idx: target.idx, progress: progress,
            out: Array.prototype.slice.call(outP),
            total: Array.prototype.reduce.call(outP, function (a, b) { return a + b; }, 0),
            settled: progress >= 1
        };
    };

    // ============================================================
    // Intro: the arrival point becomes a laser pulse on rail 3 and runs
    // the mesh.  Every rail's intensity is MZIRouter.propagate for the
    // initially selected group's configuration (the same cfg the idle
    // state uses); the pulse only reveals it, column by column.
    // ============================================================
    var T = window.SiteTransition || null;
    var rootEl = document.documentElement;
    var COVER_VARS = ["--arrival-s", "--arrival-op", "--arrival-ox", "--arrival-oy"];
    var introCfg = null, introHandle = null, introOff = null, introMode = "skip";
    var finalRgb = GROUPS[0].rgb;

    function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
    function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

    // stages the pulse has reached: 0 = input, c+1 = after column c, NCOLS+1 = after D
    function reachedStage(front) {
        if (front >= D_X + 7) return NCOLS + 1;
        var n = 0;
        for (var c = 0; c < NCOLS; c++) if (front >= colX[c] + ZONE) n = c + 1;
        return n;
    }

    function setSkillClip(span, k) {
        if (k >= 1) { span.style.clipPath = ""; return; }
        var len = span.textContent.length || 1;
        var shown = Math.floor(k * len) / len;          // monospace: a character is a fixed step
        span.style.clipPath = "inset(0 " + ((1 - shown) * 100).toFixed(2) + "% 0 0)";
    }

    function introLabels(q) {
        var n = 0, lines = 0, r, s;
        for (r = 0; r < RAILS; r++) if (portOp(r) > 0.99) lines += 4;
        var dim = easeOutCubic(clamp01((q - INTRO_DIM_START) / (1 - INTRO_DIM_START)));
        for (r = 0; r < RAILS; r++) {
            var lit = portOp(r) > 0.99;
            for (s = 0; s < 4; s++) {
                var el = skillEls[r * 4 + s];
                if (lit) {
                    var t0 = 0.1 + (lines > 1 ? INTRO_TYPE_SPAN * n / (lines - 1) : 0);
                    n++;
                    var k = clamp01((q - t0) / INTRO_TYPE_LEN);
                    el.style.opacity = k > 0 ? "1" : "0";
                    el.style.setProperty("--lit", "1");
                    setSkillClip(el, k);
                } else {
                    el.style.opacity = String(dim);
                    el.style.setProperty("--lit", "0");
                    el.style.clipPath = "";
                }
            }
        }
    }

    function introFrame(t, done) {
        var c = introCfg, first = introMode === "first";
        // fresh propagation for the active configuration on every frame
        fields = propagate(cfg, IN_RAIL);
        inten = powersOf(fields);
        var p = clamp01((t - c.lead) / (c.propEnd - c.lead));
        var q = clamp01((t - c.propEnd) / (c.total - c.propEnd));
        var lead = clamp01(t / c.lead);
        intro.t = t;
        intro.front = IN_X + (PORT_X - IN_X) * p;
        intro.emit = easeOutCubic(lead);
        intro.portT = easeOutCubic(clamp01(q / INTRO_BARS_END));
        lightRgb = lerpRgb(intro.starRgb, finalRgb, smoothstep(p));
        if (first) canvas.style.opacity = String(easeOutCubic(lead));
        if (introMode === "arrival") {
            rootEl.style.setProperty("--arrival-s", String(1 - easeInOutCubic(lead)));
        }
        introLabels(q);
        renderOnce();
    }

    function endIntro() {
        if (introOff) { introOff(); introOff = null; }
        var was = introActive;
        introActive = false;
        intro = null;
        introHandle = null;
        rootEl.classList.remove("arriving", "mesh-cover");
        COVER_VARS.forEach(function (k) { rootEl.style.removeProperty(k); });
        canvas.style.opacity = "";
        skillEls.forEach(function (el) { el.style.clipPath = ""; });
        lightRgb = finalRgb;
        litCache.fill(-1);
        applyLabels();
        renderOnce();
        if (was) {
            var now = performance.now();
            nextCycle = now + CYCLE_MS;       // idle cycling starts only now
            lastPulse = now;                  // first idle pulse one period later
        }
        if (!reducedMotion) startLoop();
    }

    function emitterScreen() {
        var rect = canvas.getBoundingClientRect();
        var x = rect.left + (IN_X - 6) / W * rect.width;
        var y = rect.top + railY0[IN_RAIL] / H * rect.height;
        var m = 24;
        return {
            x: Math.max(m, Math.min(window.innerWidth - m, x)),
            y: Math.max(m, Math.min(window.innerHeight - m, y))
        };
    }

    // mode: 'arrival' | 'first' | 'skip'; arrival: {star, rgb, starRgb, ts} or null
    function playIntro(mode, arrival) {
        if (introHandle) { introHandle.cancel(); introHandle = null; }
        if (introOff) { introOff(); introOff = null; }
        if (mode === "skip" || !T) { introActive = false; endIntro(); return; }
        T.markSeen("skills");
        if (reducedMotion) {
            // reduced motion: the mesh is already at its idle state; only the arrival fill fades
            introActive = false;
            rootEl.classList.remove("mesh-cover");
            if (mode === "arrival") {
                introHandle = T.run(REDUCED_FADE_MS, function (t) {
                    rootEl.style.setProperty("--arrival-op", String(1 - clamp01(t / REDUCED_FADE_MS)));
                }, function () { endIntro(); });
            } else endIntro();
            return;
        }
        introMode = mode;
        introCfg = INTRO[mode === "arrival" ? "arrival" : "first"];
        introActive = true;
        intro = { t: 0, front: IN_X, emit: 0, portT: 0, starRgb: (arrival && arrival.starRgb) || STAR_RGB_FALLBACK };
        if (mode === "arrival") {
            var e = emitterScreen();
            rootEl.style.setProperty("--arrival-ox", e.x.toFixed(1) + "px");
            rootEl.style.setProperty("--arrival-oy", e.y.toFixed(1) + "px");
        }
        introFrame(0);                        // first frame is set before paint
        rootEl.classList.remove("mesh-cover");
        introHandle = T.run(introCfg.total, introFrame, function () { endIntro(); });
        introOff = T.wireSkip(function () { if (introHandle) introHandle.finish(); });
    }
    window.playIntro = playIntro;

    // intro state for tests and tooling: the intensities the page is drawing
    api.getIntro = function () {
        var reached = intro ? reachedStage(intro.front) : NCOLS + 1;
        return {
            active: introActive, mode: introMode, t: intro ? intro.t : null,
            front: intro ? intro.front : null, reached: reached,
            inRail: IN_RAIL,
            config: {
                thetas: Array.prototype.slice.call(cfg.thetas),
                phis: Array.prototype.slice.call(cfg.phis),
                deltas: Array.prototype.slice.call(cfg.deltas)
            },
            inten: inten.slice(0, reached + 1).map(function (v) { return Array.prototype.slice.call(v); })
        };
    };

    // ---------- boot ----------
    railPaths = [];
    buildRailPaths();
    evaluate(1);
    updateButtons();
    nextCycle = performance.now() + CYCLE_MS;
    buildStatic();
    renderOnce();
    if (typeof ResizeObserver !== "undefined") {
        new ResizeObserver(function () { resize(); }).observe(canvas);
    } else {
        window.addEventListener("resize", resize);
    }
    playIntro(T ? T.getMode("skills") : "skip", window.__arrival || null);
})();
