// ========================================================
// STAR DIVE — a ~3.5 s flight into the real system of a clicked star
//
// Phases: approach (parallax flight) -> system reveal (real hierarchy, log
// orbit/disc scales) -> close-up (limb-darkened, spinning down) -> hand-off
// (flood to the destination colour, then navigate).
//
// All astrophysical numbers come from .workers/specs/ref/orion-systems.md.
// Nothing here draws planets: none are known for any of these stars.
//
//   window.StarDive = { start(starIdx, screenXY, target, onDone), reset(), isActive() }
//   window.__dive   = test hook (phase, t, components, omega, finalRgb, ...)
// ========================================================
(function () {
    "use strict";

    // ---- Timeline (ms) — tune here ----
    var T_APPROACH_END = 700;
    var T_REVEAL_END = 1700;
    var T_CLOSE_END = 3000;
    var T_TOTAL = 3500;               // navigation instant
    var T_HARD_MAX = 4000;            // safety: navigate no later than this (real clock)
    var T_FLOOD_HOLD = 3480;          // flood is solid from here
    var SKIP_HANDOFF_MS = 180;        // skip: flood + navigate within this
    var SKIP_POINTER_GUARD_MS = 400;  // ignore the clicking gesture that started the dive

    var HUD_HEAD_IN = [700, 1050];
    var HUD_TAG_IN = [1100, 1450];
    var HUD_TAG_OUT = [1800, 2050];
    var HUD_READ_IN = [2050, 2350];
    var HUD_OUT = [2800, 2990];

    var TIME_FACTOR = 1e5;            // fast pairs advance at x10^5 real time
    var DPR_MAX = 2;
    var CLOSE_RADIUS_FRAC = 0.46;     // primary disc radius at the end of the close-up, x min(W,H)
    var DISC_SCALE = 1.35;            // gentle-log disc size multiplier
    var SPH = 384;                    // sphere render resolution (px)
    var TEX_W = 1024, TEX_H = 256;    // surface texture
    var TEX_AMP = 0.05;                // surface texture contrast (low on purpose)
    var SPIN_BASE = 3.2, SPIN_MIN = 1.2, SPIN_MAX = 3.6;   // sim rad/s at the start of the close-up
    var FIELD_STARS = 300;
    var ECLIPSE_DEPTH = 0.105;        // 0.12 mag
    var BG_HOME = [14, 16, 31], BG_DEEP = [6, 8, 17];

    // ---- Easings ----
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function smooth(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
    function ramp(t, r) { return clamp((t - r[0]) / (r[1] - r[0]), 0, 1); }
    function easeInOutCubic(t) { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    function easeOutCubic(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); }
    function easeInCubic(t) { t = clamp(t, 0, 1); return t * t * t; }

    function hexRgb(h) { return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)]; }
    function rgba(c, a) { return "rgba(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + "," + a.toFixed(3) + ")"; }
    function fmtInt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

    // =====================================================================
    // DATA — transcribed from .workers/specs/ref/orion-systems.md
    // =====================================================================
    var AU_PER_RSUN = 0.00465047;
    function S(id, sp, teff, R, M, hex, o) {
        o = o || {};
        return { kind: "star", id: id, sp: sp, teff: teff, R: R, Rshow: o.Rshow, M: M, Mshow: o.Mshow, hex: hex, col: hexRgb(hex), tags: o.tags || [], name: o.name || id };
    }
    function P(o) { o.kind = "pair"; return o; }

    var Aa1 = S("Aa1", "O9.5 II", 31400, 13.1, 17.8, "#B5C7FF");
    var Aa2 = S("Aa2", "B1 V", 25400, 4.2, 8.5, "#B7C9FF");
    var MintakaAa = P({
        a: 0.186, e: 0.08, Pd: 5.732476, q: 0.1891, real: true, rot: -0.28, nuOff: Math.PI / 2, advance: true, phase: "ephemeris",
        period: "P 5.732 d", tags: ["phase from published ephemeris"], c: [Aa1, Aa2]
    });
    var Ab = S("Ab", "B0 IV", 30250, 12.0, 8.8, "#B5C7FF");
    var MintakaAB = P({
        a: 93, e: 0.59, Pd: 55450, q: 0.5, rot: 0.5, M0: 2.6, advance: false,
        period: "P ≈ 150 yr", tags: ["position illustrative"], c: [MintakaAa, Ab]
    });
    var Ca = S("Ca", "B3 V", 18400, 5.7, 7, "#BDCEFF");
    var Cb = S("Cb", "A0 V", 10000, 2, 2.5, "#D6DFFF", { Rshow: "~2" });
    var MintakaC = P({
        a: 0.4, e: 0.32, Pd: 29.96, q: 0.6, rot: 0.9, M0: 0, advance: true,
        period: "P 29.96 d", tags: ["phase illustrative"], c: [Ca, Cb]
    });
    var MintakaRoot = P({
        a: 20000, e: 0, Pd: null, q: 0.6, rot: 0.14, M0: 0, advance: false, draw: "dotted",
        period: "52″ ≈ 20,000 AU projected", tags: [], c: [MintakaAB, MintakaC]
    });

    var AlnAa = S("Aa", "O9.5 Iab", 29500, 20, 14, "#B5C7FF", { Mshow: "14–33", tags: ["magnetic"] });
    var AlnAb = S("Ab", "B1 IV", 29000, 7.3, 7.4, "#B5C7FF", { tags: [] });
    var AlnitakAa = P({
        a: 12.2, e: 0.338, Pd: 2687, q: 0.55, rot: -0.5, M0: 0, nuOff: 0, advance: true, phase: "T0",
        period: "P 7.36 yr", tags: ["approx. phase"], c: [AlnAa, AlnAb]
    });
    var AlnB = S("B", "B0 III", 29000, 7.3, 16.7, "#B5C7FF", { Rshow: null });   // R not given: disc drawn no smaller than Ab
    var AlnitakRoot = P({
        a: 900, e: 0.3, Pd: 1500 * 365.25, q: 0.5, rot: 0.32, M0: 1.2, advance: false, draw: "dashed",
        period: "P ≈ 1,500 yr", tags: ["illustrative orbit"], c: [AlnitakAa, AlnB]
    });

    var RigA = S("A", "B8 Ia", 12100, 74, 21, "#CBD8FF");
    var RigBa = S("Ba", "B9 V", 10500, 2.5, 3.84, "#D6DFFF", { Rshow: "~2.5", Teffshow: "~10,500" });
    var RigBb = S("Bb", "B9 V", 10500, 2, 2.94, "#D6DFFF", { Rshow: "~2" });
    var RigBaBb = P({
        a: 0.17, e: 0.10, Pd: 9.860, q: 0.6, rot: -0.4, M0: 0, advance: true, nuOff: 0,
        period: "P 9.860 d", tags: ["phase illustrative"], c: [RigBa, RigBb]
    });
    var RigC = S("C", "B9 V", 10500, 2.5, 3.84, "#D6DFFF", { Rshow: null, tags: ["partly covered"] });
    var RigBC = P({
        a: 35, e: 0.2, Pd: 63 * 365.25, q: 0.5, rot: 0.8, M0: 0.8, advance: false,
        period: "P ≈ 63 yr", tags: ["position illustrative"], c: [RigBaBb, RigC]
    });
    var RigelRoot = P({
        a: 2500, e: 0.3, Pd: 24000 * 365.25, q: 0.45, rot: -0.16, M0: 1.0, advance: false, draw: "dashed",
        period: "P ≈ 24,000 yr (est.)", tags: ["illustrative orbit"], c: [RigA, RigBC]
    });

    // index = star-map orionStars index
    var SYS = {
        1: {
            name: "Bellatrix", bayer: "γ Orionis", type: "B2 III blue giant · single", dist: "77 ± 3 pc · 250 ly",
            note: "single star · GRAVITY: no companion", u: 0.32, hex: "#B9CBFF", root: S("A", "B2 III", 22000, 6.2, 8.4, "#B9CBFF"),
            primary: "A", incl: 60, inclTag: "illustrative", Prot: "3.7–5.8 d", Pd: 4.75, rotNote: "",
            wind: 0.4, spinTag: "v sin i 54 km/s"
        },
        2: {
            name: "Alnilam", bayer: "ε Orionis", type: "B0 Ia blue supergiant · single", dist: "384 ± 8 pc · 1,250 ly",
            note: "single star · strong wind", u: 0.28, hex: "#B7C9FF", root: S("A", "B0 Ia", 25000, 31, 34, "#B7C9FF", { Rshow: "28–34", Mshow: "28–40" }),
            primary: "A", incl: 45, inclTag: "VLTI 2025", Prot: "4.3 d", Pd: 4.3, oblate: 1.3,
            rotNote: "fast-rotator model", wind: 1.0, haze: "NGC 1990 · illustrative", spinTag: "v sin i 220 km/s"
        },
        3: {
            name: "Mintaka", bayer: "δ Orionis", type: "multiple star · eclipsing O+B pair", dist: "382 pc · 1,246 ly",
            note: "orbits: log distance · discs: log radius", u: 0.28, hex: "#B5C7FF", root: MintakaRoot,
            primary: "Aa1", incl: 79, inclTag: "orbit", Prot: "5.7 d", Pd: 5.732, rotNote: "synchronised", wind: 0.7, spinTag: "",
            eclipse: true
        },
        4: {
            name: "Alnitak", bayer: "ζ Orionis", type: "triple supergiant system", dist: "294–387 pc · ≈960–1,260 ly (uncertain)",
            note: "orbits: log distance · discs: log radius", u: 0.28, hex: "#B5C7FF", root: AlnitakRoot,
            primary: "Aa", incl: 60, inclTag: "illustrative", Prot: "6.8 d", Pd: 6.8, rotNote: "magnetic, ~60 G dipole", wind: 0.8, spinTag: "",
            backdrop: "alnitak", haze: "IC 434 · Horsehead · Flame — backdrop, not circumstellar"
        },
        5: {
            name: "Saiph", bayer: "κ Orionis", type: "B0.5 Ia blue supergiant · single", dist: "198 ± 9 pc · 650 ly",
            note: "single star · generic supergiant wind", u: 0.28, hex: "#B7C9FF", root: S("A", "B0.5 Ia", 25700, 13.5, 15.5, "#B7C9FF"),
            primary: "A", incl: 60, inclTag: "illustrative", Prot: "5.3–8.2 d", Pd: 6.7, wind: 0.6, spinTag: "v sin i 83 km/s"
        },
        6: {
            name: "Rigel", bayer: "β Orionis", type: "B8 Ia blue supergiant · triple companion", dist: "264 ± 24 pc · 860 ly",
            note: "orbits: log distance · discs: log radius", u: 0.40, hex: "#CBD8FF", root: RigelRoot,
            primary: "A", incl: 60, inclTag: "illustrative", Prot: "95–150 d", Pd: 120, wind: 0.7, spinTag: "v sin i 25 km/s, slow"
        }
    };

    // =====================================================================
    // ORBIT MATH
    // =====================================================================
    function trueAnomaly(M, e) {
        M = M % (2 * Math.PI); if (M < 0) M += 2 * Math.PI;
        var E = e < 0.8 ? M : Math.PI;
        for (var i = 0; i < 12; i++) E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
        return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
    }
    function aOf(pair, k) { return pair._fixedPx !== undefined ? pair._fixedPx : pair._aPx * (pair._boost || 1) * k; }
    function nodeMass(n) { return n.kind === "star" ? n.M : nodeMass(n.c[0]) + nodeMass(n.c[1]); }
    function allStars(n, out) { out = out || []; if (n.kind === "star") out.push(n); else { allStars(n.c[0], out); allStars(n.c[1], out); } return out; }
    function isFast(p) { return !!p.advance && p.Pd < 400; }
    function allPairs(n, out) { out = out || []; if (n.kind === "pair") { out.push(n); allPairs(n.c[0], out); allPairs(n.c[1], out); } return out; }

    function ephemerisPhase(jd) { var p = (jd - 2419068.20) / 5.732476; return p - Math.floor(p); }
    function jdNow(ms) { return ms / 86400000 + 2440587.5; }

    // starting mean anomaly (rad) of a pair at the dive epoch
    function startM(pair, jd) {
        if (pair.phase === "ephemeris") return 2 * Math.PI * ephemerisPhase(jd);
        if (pair.phase === "T0") { var f = (jd - 2452734) / pair.Pd; return 2 * Math.PI * (f - Math.floor(f)); }
        return pair.M0 || 0;
    }

    // =====================================================================
    // SURFACE TEXTURE (built once per page, deterministic)
    // =====================================================================
    var texData = null;
    function hash2(ix, iy) {
        var h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        h = h ^ (h >>> 16);
        return (h >>> 0) / 4294967295;
    }
    function vnoise(x, y, px) {
        var x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
        var xa = ((x0 % px) + px) % px, xb = (xa + 1) % px;
        var sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
        var a = hash2(xa, y0), b = hash2(xb, y0), c = hash2(xa, y0 + 1), d = hash2(xb, y0 + 1);
        return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
    }
    function buildTexture() {
        if (texData) return texData;
        var t = new Float32Array(TEX_W * TEX_H);
        var octs = [[56, 0.3], [120, 0.4], [250, 0.3]];
        for (var j = 0; j < TEX_H; j++) {
            for (var i = 0; i < TEX_W; i++) {
                var v = 0;
                for (var o = 0; o < octs.length; o++) {
                    var sc = octs[o][0];
                    v += octs[o][1] * vnoise(i / TEX_W * sc, j / TEX_H * sc * 0.5, sc);
                }
                t[j * TEX_W + i] = (v - 0.5) * 2;
            }
        }
        texData = t;
        return t;
    }

    // =====================================================================
    // STATE
    // =====================================================================
    var D = null;           // active dive
    var STYLE_ID = "star-dive-style";

    var testHook = {
        active: false, phase: "idle", t: 0, components: [], omega: 0, omegaPeak: 0, finalRgb: null, starRgb: null,
        mintakaPhase0: null, mintakaPhase: null, eclipse: 0,
        setTime: function (ms) { if (D) { D.override = ms; frame(); } },
        release: function () { if (D) D.override = null; },
        limbProfile: function (rs) { return D ? limbProfile(rs) : null; },
        textureContrast: function () {
            if (!D) return null;
            var sp = D.sph, a = new Uint8ClampedArray(sp.img.data);
            renderSphere(sp, 0.7, 0); var plain = new Uint8ClampedArray(sp.img.data);
            renderSphere(sp, 0.7, TEX_AMP); var tex = sp.img.data, mx = 0;
            for (var i = 0; i < sp.n; i++) { var o = sp.idx[i] + 2; if (plain[o] > 60) mx = Math.max(mx, Math.abs(tex[o] - plain[o]) / plain[o]); }
            return mx;
        },
        hudRects: function () { return D ? hudRects() : []; },
        leaders: function () { return D ? D.hud.tags.map(function (t) { return { ids: t.ids, p0: t.p0, p1: { x: t.p1w.x + D.C.x, y: t.p1w.y + D.C.y }, rect: t.rect ? { x: t.rect.x, y: t.rect.y, w: t.rect.w, h: t.rect.h } : null }; }) : []; },
        discs: function () { return D ? discList() : []; },
        droppedLabels: []
    };
    window.__dive = testHook;

    function now() { return performance.now(); }
    function reduced() { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }

    // =====================================================================
    // LAYOUT — piecewise-log orbits, gentle-log discs
    // =====================================================================
    function discRadius(R, sc) { return sc * DISC_SCALE * (2.5 + 9.5 * Math.log10(1 + R)); }

    function relLocal(pair, nu, aPx, rotAll) {
        var r = aPx * (1 - pair.e * pair.e) / (1 + pair.e * Math.cos(nu));
        var th = nu + (pair.nuOff || 0);
        var X = r * Math.cos(th), Y = r * Math.sin(th);
        var sx = X, sy = Y * pair.q, z = Y * Math.sqrt(Math.max(0, 1 - pair.q * pair.q));
        var R = pair.rot + rotAll, c = Math.cos(R), s = Math.sin(R);
        return { x: sx * c - sy * s, y: sx * s + sy * c, z: z };
    }

    // walk the tree; cb(star, x, y, z) for stars; pcb(pair, baseX, baseY, baseZ, rel) for pairs
    function walk(node, bx, by, bz, st, cb, pcb) {
        if (node.kind === "star") { cb(node, bx, by, bz); return; }
        var m0 = nodeMass(node.c[0]), m1 = nodeMass(node.c[1]), M = m0 + m1;
        var nu = trueAnomaly(node._Mt, node.e);
        var rel = relLocal(node, nu, aOf(node, st.k), st.rotAll);
        var f0 = m1 / M, f1 = m0 / M;
        if (pcb) pcb(node, bx, by, bz, rel);
        walk(node.c[0], bx - f0 * rel.x, by - f0 * rel.y, bz - f0 * rel.z, st, cb, pcb);
        walk(node.c[1], bx + f1 * rel.x, by + f1 * rel.y, bz + f1 * rel.z, st, cb, pcb);
    }

    function pathPts(pair, k, rotAll, n) {
        var m0 = nodeMass(pair.c[0]), m1 = nodeMass(pair.c[1]), M = m0 + m1;
        var f0 = m1 / M, f1 = m0 / M, a = [], b = [];
        for (var i = 0; i <= n; i++) {
            var nu = i / n * 2 * Math.PI;
            var rel = relLocal(pair, nu, aOf(pair, k), rotAll);
            a.push({ x: -f0 * rel.x, y: -f0 * rel.y });
            b.push({ x: f1 * rel.x, y: f1 * rel.y });
        }
        return [a, b];
    }

    function buildLayout(sys, W, H, jd, mobile) {
        var sc = clamp(Math.min(W, H) / 800, 0.55, 1.3);
        var stars = allStars(sys.root), pairs = allPairs(sys.root);
        var primary = stars.filter(function (s) { return s.id === sys.primary; })[0];
        var d0 = Math.max(0.5 * primary.R * AU_PER_RSUN, 0.01);
        var rotAll = (H > W * 1.1) ? Math.PI / 2 : 0;
        pairs.forEach(function (p) {
            p._aPx = Math.log10(1 + p.a / d0);
            p._boost = 1; p._fixedPx = undefined;
            p._M0 = startM(p, jd);
            p._Mt = p._M0;
        });
        var st = { k: 1, rotAll: rotAll };
        var L = { sc: sc, stars: stars, pairs: pairs, primary: primary, rotAll: rotAll, d0: d0, W: W, H: H };
        stars.forEach(function (s) { s._rpx = discRadius(s.R || 2.5, sc); });
        // Eclipsing pair (real geometry known): screen separation = real separation x (screen radii / real radii),
        // so the discs overlap on screen exactly when they overlap in the real projection.
        pairs.forEach(function (p) {
            if (p.real && p.c[0].kind === "star" && p.c[1].kind === "star") {
                var sRatio = (p.c[0]._rpx + p.c[1]._rpx) / (p.c[0].R + p.c[1].R);
                p._fixedPx = (p.a / AU_PER_RSUN) * sRatio;
            }
        });
        if (!pairs.length) { L.k = 1; L.cx = 0; L.cy = 0; st.k = 1; L.st = st; return L; }

        // bbox at k = 1 (paths + star centres), then fit k
        function bboxAt(k) {
            var b = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
            function inc(x, y) { b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); }
            st.k = k;
            walk(sys.root, 0, 0, 0, st, function (s, x, y) { inc(x, y); }, function (pair, bx, by) {
                var pp = pathPts(pair, k, rotAll, 72);
                for (var j = 0; j < 2; j++) for (var i = 0; i < pp[j].length; i++) inc(bx + pp[j][i].x, by + pp[j][i].y);
            });
            return b;
        }
        var availW = W * (mobile ? 0.74 : 0.62), availH = H * (mobile ? 0.52 : 0.50);
        var k = 1, b;
        function fit() {
            for (var it = 0; it < 6; it++) {
                var bb = bboxAt(k);
                k *= Math.min(availW / Math.max(1e-6, bb.x1 - bb.x0), availH / Math.max(1e-6, bb.y1 - bb.y0));
            }
        }
        // inner-orbit floor: a pair without a real eclipse never gets closer than 1.25 x the sum of its disc radii
        function floors() {
            pairs.forEach(function (p) {
                if (p._fixedPx !== undefined || p.c[0].kind !== "star" || p.c[1].kind !== "star") return;
                p._boost = 1;
                var a = aOf(p, k), mn = 1e9;
                for (var i = 0; i < 180; i++) {
                    var rel = relLocal(p, i / 180 * 2 * Math.PI, a, 0);
                    mn = Math.min(mn, Math.hypot(rel.x, rel.y));
                }
                var need = 1.25 * (p.c[0]._rpx + p.c[1]._rpx);
                p._boost = Math.max(1, need / Math.max(mn, 1e-6));
            });
        }
        fit(); floors(); fit(); floors();
        b = bboxAt(k);
        L.k = k; st.k = k;
        L.cx = (b.x0 + b.x1) / 2; L.cy = (b.y0 + b.y1) / 2;
        L.st = st;
        return L;
    }

    // evaluate star positions (world px, origin = canvas centre) at sim time tsec
    function evalStars(L, tsec, sys) {
        var out = [];
        var adv = tsec * TIME_FACTOR / 86400;   // simulated days
        L.pairs.forEach(function (p) { p._Mt = p._M0 + (p.advance ? 2 * Math.PI * adv / p.Pd : 0); });
        walk(sys.root, -L.cx, -L.cy, 0, L.st, function (s, x, y, z) { out.push({ n: s, x: x, y: y, z: z }); }, null);
        return out;
    }

    // =====================================================================
    // SPRITES
    // =====================================================================
    function discSprite(col, u, rpx, dpr) {
        var sr = Math.max(10, Math.ceil(rpx * dpr * 1.6));
        var c = document.createElement("canvas");
        c.width = c.height = sr * 2 + 4;
        var g = c.getContext("2d");
        var grad = g.createRadialGradient(sr + 2, sr + 2, 0, sr + 2, sr + 2, sr);
        var N = 11;
        for (var i = 0; i <= N; i++) {
            var r = i / N * 0.97;
            var mu = Math.sqrt(Math.max(0, 1 - r * r));
            var I = 1 - u * (1 - mu);
            grad.addColorStop(r, "rgb(" + Math.round(col[0] * I) + "," + Math.round(col[1] * I) + "," + Math.round(col[2] * I) + ")");
        }
        var Ie = 1 - u * (1 - Math.sqrt(1 - 0.97 * 0.97));
        grad.addColorStop(0.97, "rgb(" + Math.round(col[0] * Ie) + "," + Math.round(col[1] * Ie) + "," + Math.round(col[2] * Ie) + ")");
        grad.addColorStop(1, "rgba(" + Math.round(col[0] * Ie) + "," + Math.round(col[1] * Ie) + "," + Math.round(col[2] * Ie) + ",0)");
        g.fillStyle = grad;
        g.beginPath(); g.arc(sr + 2, sr + 2, sr, 0, 7); g.fill();
        return { c: c, half: sr + 2, r: sr };
    }

    // =====================================================================
    // SPHERE (primary close-up): linear limb darkening + advected texture
    // =====================================================================
    function buildSphere(sys, primary, plain) {
        var SR = SPH / 2 - 2;
        var incl = sys.incl * Math.PI / 180, PA = 0.35;
        var sinI = Math.sin(incl), cosI = Math.cos(incl);
        var obl = plain ? 1 : (sys.oblate || 1);
        var bp = obl > 1 ? Math.sqrt((1 / (obl * obl)) * sinI * sinI + cosI * cosI) : 1;   // projected polar semi-axis (units of Re)
        var sPA = Math.sin(PA), cPA = Math.cos(PA);
        var idx = [], tx0 = [], row = [], base = [], alpha = [], rho = [], tw = [];
        for (var py = 0; py < SPH; py++) {
            for (var px = 0; px < SPH; px++) {
                var x = (px + 0.5 - SPH / 2) / SR, y = -(py + 0.5 - SPH / 2) / SR;
                var xr = x * cPA - y * sPA, yr = x * sPA + y * cPA;
                var rh = Math.sqrt(xr * xr + (yr / bp) * (yr / bp));
                if (rh > 1 + 1.5 / SR) continue;
                var rc = Math.min(rh, 0.9999);
                var mu = Math.sqrt(1 - rc * rc);
                var ny = yr / bp;
                var np = ny * sinI + mu * cosI;
                var ne2 = ny * cosI - mu * sinI;
                var lat = Math.asin(clamp(np, -1, 1));
                var lon = Math.atan2(ne2, xr);
                var I = 1 - sys.u * (1 - mu);
                var cl = Math.cos(lat);
                if (sys.oblate && !plain) I *= 1 - 0.20 * cl * cl;      // gravity darkening: equator darker
                idx.push((py * SPH + px) * 4);
                tx0.push(lon / (2 * Math.PI) * TEX_W);
                row.push(clamp(Math.round((lat + Math.PI / 2) / Math.PI * (TEX_H - 1)), 0, TEX_H - 1));
                base.push(I);
                tw.push(1 - smooth((Math.abs(lat) - 1.1) / 0.4));   // texture fades toward the poles (no pinching)
                alpha.push(clamp((1 - rh) * SR + 0.5, 0, 1));
                rho.push(rh);
            }
        }
        var cv = document.createElement("canvas");
        cv.width = cv.height = SPH;
        var g = cv.getContext("2d");
        var img = g.createImageData(SPH, SPH);
        return {
            cv: cv, g: g, img: img, SR: SR, n: idx.length,
            idx: Int32Array.from(idx), tx0: Float32Array.from(tx0), row: Int16Array.from(row),
            base: Float32Array.from(base), tw: Float32Array.from(tw), alpha: Float32Array.from(alpha), col: primary.col
        };
    }

    function renderSphere(sp, angle, amp) {
        var tex = buildTexture();
        var data = sp.img.data, col = sp.col;
        var cr = col[0], cg = col[1], cb = col[2];
        var shift = angle / (2 * Math.PI) * TEX_W;
        var n = sp.n, idx = sp.idx, tx0 = sp.tx0, row = sp.row, base = sp.base, al = sp.alpha, tw = sp.tw;
        for (var i = 0; i < n; i++) {
            var x = tx0[i] + shift;
            var fl = Math.floor(x), f = x - fl;
            var i0 = ((fl % TEX_W) + TEX_W) % TEX_W, i1 = (i0 + 1) % TEX_W, ro = row[i] * TEX_W;
            var v = tex[ro + i0] * (1 - f) + tex[ro + i1] * f;
            var vv = v > 0.8 ? 0.8 : (v < -0.8 ? -0.8 : v);   // luminance variation capped at amp x 0.8 = 4%
            var I = base[i] * (1 + amp * vv * tw[i]);
            var o = idx[i];
            data[o] = cr * I; data[o + 1] = cg * I; data[o + 2] = cb * I; data[o + 3] = al[i] * 255;
        }
        sp.g.putImageData(sp.img, 0, 0);
    }

    function limbProfile(rs) {
        // the u-law itself: same code path, with the Alnilam fast-rotator model (oblateness, gravity darkening) off
        var sp = D.sphPlain || (D.sphPlain = buildSphere(D.sys, D.primaryNode, true));
        renderSphere(sp, 0, 0);
        var data = sp.img.data, SR = sp.SR, u = D.sys.u, out = [];
        var cy = Math.floor(SPH / 2);
        var o0 = (cy * SPH + Math.floor(SPH / 2)) * 4;
        var c0 = data[o0 + 2];
        rs.forEach(function (r) {
            var px = Math.floor(SPH / 2 + r * SR);
            var o = (cy * SPH + px) * 4;
            var x = (px + 0.5 - SPH / 2) / SR, y = -(cy + 0.5 - SPH / 2) / SR;
            var rho = Math.sqrt(x * x + y * y);
            var x0 = (Math.floor(SPH / 2) + 0.5 - SPH / 2) / SR, y0 = -(cy + 0.5 - SPH / 2) / SR;
            var rho0 = Math.sqrt(x0 * x0 + y0 * y0);
            var mu = Math.sqrt(Math.max(0, 1 - rho * rho)), mu0 = Math.sqrt(Math.max(0, 1 - rho0 * rho0));
            out.push({ r: r, rho: rho, obs: data[o + 2] / c0, exp: (1 - u * (1 - mu)) / (1 - u * (1 - mu0)) });
        });
        return out;
    }

    // =====================================================================
    // BACKDROPS (offscreen, soft painted light)
    // =====================================================================
    function rng(seed) { var s = seed >>> 0; return function () { s = (s + 0x6D2B79F5) >>> 0; var t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

    function blob(g, x, y, r, rgb, a) {
        var gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, rgba(rgb, a));
        gr.addColorStop(0.5, rgba(rgb, a * 0.38));
        gr.addColorStop(1, rgba(rgb, 0));
        g.fillStyle = gr;
        g.fillRect(x - r, y - r, r * 2, r * 2);
    }

    function buildBackdrop(kind, W, H) {
        var s = 0.5, w = Math.ceil(W * s), h = Math.ceil(H * s);
        var c = document.createElement("canvas"); c.width = w; c.height = h;
        var g = c.getContext("2d"), R = rng(kind === "alnitak" ? 434 : 1990), m = Math.min(w, h);
        if (kind === "alnitak") {
            // IC 434: a diffuse H-alpha band; the Horsehead as a dark notch; the Flame as warm filaments
            var band = [168, 52, 78], warm = [212, 128, 70];
            for (var i = 0; i < 26; i++) {
                var t = i / 25;
                var x = lerp(w * 0.18, w * 0.98, t) + (R() - 0.5) * m * 0.08;
                var y = lerp(h * 0.95, h * 0.18, t) + (R() - 0.5) * m * 0.08;
                blob(g, x, y, m * (0.22 + R() * 0.18), band, 0.075 + R() * 0.04);
            }
            for (var j = 0; j < 14; j++) {
                var ft = j / 13;
                blob(g, w * (0.78 + ft * 0.14) + (R() - 0.5) * m * 0.06, h * (0.62 - ft * 0.34) + (R() - 0.5) * m * 0.06,
                    m * (0.08 + R() * 0.08), warm, 0.06 + R() * 0.04);
            }
            // dark Horsehead silhouette against the band
            g.globalCompositeOperation = "source-over";
            var hx = w * 0.46, hy = h * 0.64;
            var dark = [5, 6, 14];
            blob(g, hx, hy + m * 0.1, m * 0.16, dark, 0.55);
            blob(g, hx + m * 0.03, hy + m * 0.02, m * 0.1, dark, 0.6);
            blob(g, hx + m * 0.07, hy - m * 0.04, m * 0.075, dark, 0.6);
            blob(g, hx + m * 0.115, hy - m * 0.075, m * 0.05, dark, 0.55);
            blob(g, hx + m * 0.02, hy + m * 0.2, m * 0.2, dark, 0.45);
        } else {
            // NGC 1990: pale blue reflection haze (illustrative)
            var cx = w * 0.5, cy = h * 0.5;
            blob(g, cx, cy, m * 0.62, [96, 128, 214], 0.22);
            blob(g, cx, cy, m * 0.36, [128, 160, 240], 0.2);
            for (var q = 0; q < 8; q++) {
                var an = R() * 6.28, rr = R() * m * 0.3;
                blob(g, cx + Math.cos(an) * rr, cy + Math.sin(an) * rr * 0.8, m * (0.14 + R() * 0.14), [110, 140, 225], 0.07);
            }
        }
        return c;
    }

    // =====================================================================
    // HUD
    // =====================================================================
    function injectStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement("style");
        st.id = STYLE_ID;
        st.textContent =
            "#star-dive-canvas{position:fixed;inset:0;width:100vw;height:100vh;z-index:9000;display:block;background:#0e101f;pointer-events:auto;cursor:default}" +
            "#star-dive-hud{position:fixed;inset:0;z-index:9001;pointer-events:none;overflow:hidden;" +
            "font-family:'IBM Plex Mono',Menlo,Consolas,monospace;color:rgba(214,223,255,.92);text-shadow:0 0 6px rgba(5,7,16,.95),0 0 2px rgba(5,7,16,.9)}" +
            "#star-dive-hud .sd{position:absolute;opacity:0;font-size:11px;line-height:1.38;white-space:nowrap;font-weight:400;letter-spacing:.01em}" +
            "#star-dive-hud .sd b{font-weight:500;color:#eef2ff;letter-spacing:.02em}" +
            "#star-dive-hud .dim{color:rgba(176,190,235,.62)}" +
            "#star-dive-hud .tg{color:#d9b27a;font-style:italic}" +
            "#star-dive-hud .sd-head{left:22px;top:20px;font-size:12px}" +
            "#star-dive-hud .sd-head .nm{font-size:16px;font-weight:500;color:#f2f5ff;letter-spacing:.02em}" +
            "#star-dive-hud .sd-read{left:22px;bottom:22px}" +
            "#star-dive-hud .sd-skip{right:22px;bottom:22px;font-size:10px}" +
            "#star-dive-hud .sd-per{font-size:10px;color:rgba(176,190,235,.78)}" +
            "#star-dive-hud.mob .sd{font-size:9px}" +
            "#star-dive-hud.mob .sd-head{left:14px;top:14px;font-size:9.5px}" +
            "#star-dive-hud.mob .sd-head .nm{font-size:13px}" +
            "#star-dive-hud.mob .sd-read{left:14px;bottom:16px}" +
            "#star-dive-hud.mob .sd-per{font-size:8.5px}";
        document.head.appendChild(st);
    }

    function el(cls, html) {
        var d = document.createElement("div");
        d.className = "sd " + cls;
        d.innerHTML = html;      // static strings built from the data table above (no user input)
        return d;
    }
    function tg(s) { return '<span class="tg">' + s + "</span>"; }

    function compLines(n, mobile, pairPeriod) {
        var l1 = "<b>" + n.name + "</b> <span class='dim'>" + n.sp + "</span>";
        if (mobile) return l1 + (pairPeriod ? "<br><span class='dim'>" + pairPeriod + "</span>" : "");
        var bits = [];
        bits.push((n.Teffshow || fmtInt(n.teff)) + " K");
        var l2 = bits.join(" · ");
        var rm = [];
        var Rs = n.Rshow !== undefined ? n.Rshow : (n.R ? String(n.R) : null);
        if (Rs) rm.push(Rs + " R☉");
        var Ms = n.Mshow || (n.M ? String(n.M) : null);
        if (Ms) rm.push(Ms + " M☉");
        var html = l1 + "<br><span class='dim'>" + l2 + "</span>";
        if (rm.length) html += "<br><span class='dim'>" + rm.join(" · ") + "</span>";
        if (n.tags && n.tags.length) html += "<br>" + tg(n.tags.join(" · "));
        return html;
    }

    function buildHud(sys, L, mobile) {
        var hud = document.createElement("div");
        hud.id = "star-dive-hud";
        hud.setAttribute("aria-hidden", "true");
        if (mobile) hud.className = "mob";
        var head = el("sd-head",
            '<span class="nm">' + sys.name + " · " + sys.bayer + "</span><br><span>" + sys.type + "</span><br>" +
            "<span class='dim'>" + sys.dist + "</span>" +
            (mobile ? "" : "<br><span class='dim'>" + sys.note + "</span>") +
            (L.pairs.some(function (p) { return p.advance; }) ?
                "<br><span class='dim'>" + (mobile ? "log scale · " : "") + "×10⁵ real time</span>" : ""));
        var read = el("sd-read", "");
        var skip = el("sd-skip dim", mobile ? "" : "click or Esc to skip");
        hud.appendChild(head); hud.appendChild(read);
        if (!mobile) hud.appendChild(skip);
        document.body.appendChild(hud);
        return { root: hud, head: head, read: read, skip: skip, tags: [], pers: [] };
    }

    function readoutHtml(sys, f, mobile) {
        var w = (2 * Math.PI / sys.Pd) * f;
        var inc = sys.incl + "°" + (sys.inclTag === "illustrative" ? " " + tg("illustrative") : (sys.inclTag === "orbit" ? " <span class='dim'>(orbit)</span>" : " <span class='dim'>(" + sys.inclTag + ")</span>"));
        var lines = [];
        lines.push("<b>rotation</b> P " + sys.Prot + (mobile ? "" : " · i " + inc));
        lines.push("<b>ω</b> " + w.toFixed(2) + " rad/d" + (mobile ? "" : " <span class='dim'>eased to rest</span>"));
        var teff = D.primaryNode.teff;
        lines.push("<b>T<sub>eff</sub></b> " + fmtInt(teff) + " K · <b>u</b> " + sys.u.toFixed(2));
        if (!mobile) {
            if (sys.rotNote) lines.push(tg(sys.rotNote + (sys.oblate ? " · eq/polar ≈ 1.3 · equator ~20% darker" : "")));
            lines.push("<span class='dim'>surface texture: " + "</span>" + tg("illustrative"));
        } else if (sys.rotNote) {
            lines.push(tg(sys.rotNote));
        }
        return lines.join("<br>");
    }

    // ---- label placement (fixed stations, leader lines drawn on the canvas) ----
    function rectsOverlap(a, b, pad) {
        return !(a.x + a.w + pad <= b.x || b.x + b.w + pad <= a.x || a.y + a.h + pad <= b.y || b.y + b.h + pad <= a.y);
    }
    function circleRect(c, r, pad) {
        return { x: c.x - c.r - pad, y: c.y - c.r - pad, w: 2 * (c.r + pad), h: 2 * (c.r + pad), _c: true, cx: c.x, cy: c.y, r: c.r + pad };
    }
    function rectCircleHit(r, c) {
        var nx = clamp(c.x, r.x, r.x + r.w), ny = clamp(c.y, r.y, r.y + r.h);
        return (nx - c.x) * (nx - c.x) + (ny - c.y) * (ny - c.y) < c.r * c.r;
    }

    function placeLabels(D) {
        var W = D.W, H = D.H, C = D.C, mobile = D.mobile, hud = D.hud;
        var margin = mobile ? 6 : 10;
        var obstacles = [];     // rects
        var circles = [];       // static star discs
        var boxes = [];         // placed rects
        function addRect(r) { obstacles.push(r); }
        // measure fixed HUD blocks
        function domRect(e) { var b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }
        hud.head.style.opacity = "0.001"; hud.read.style.opacity = "0.001";
        hud.read.innerHTML = readoutHtml(D.sys, 1, mobile);
        addRect(domRect(hud.head)); addRect(domRect(hud.read));
        if (!mobile) addRect(domRect(hud.skip));
        hud.head.style.opacity = "0"; hud.read.style.opacity = "0";

        var ents = D.t0Ents.map(function (e) { return { e: e, x: C.x + e.x, y: C.y + e.y, r: e.n._rpx }; });
        ents.forEach(function (s) {
            var own = null;
            D.L.pairs.forEach(function (p) { if (isFast(p) && allStars(p).indexOf(s.e.n) >= 0 && (!own || allStars(p).length < allStars(own).length)) own = p; });
            circles.push({ x: s.x, y: s.y, r: s.r + 6, pair: own });
        });
        // fast pairs: obstacle = full path extent
        D.fastRects = [];
        var st = D.L.st;
        walk(D.sys.root, -D.L.cx, -D.L.cy, 0, st, function () { }, function (pair, bx, by) {
            if (!isFast(pair)) return;
            var pp = pathPts(pair, st.k, D.L.rotAll, 48), x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
            for (var j = 0; j < 2; j++) for (var i = 0; i < pp[j].length; i++) {
                x0 = Math.min(x0, bx + pp[j][i].x); x1 = Math.max(x1, bx + pp[j][i].x);
                y0 = Math.min(y0, by + pp[j][i].y); y1 = Math.max(y1, by + pp[j][i].y);
            }
            var rr = 0; allStars(pair).forEach(function (s) { rr = Math.max(rr, s._rpx); });
            var r = { x: C.x + x0 - rr - 4, y: C.y + y0 - rr - 4, w: x1 - x0 + 2 * rr + 8, h: y1 - y0 + 2 * rr + 8, pair: pair };
            D.fastRects.push(r);
            addRect(r);
        });

        function free(box, ignorePair) {
            if (box.x < margin || box.y < margin || box.x + box.w > W - margin || box.y + box.h > H - margin) return false;
            for (var i = 0; i < obstacles.length; i++) { if (ignorePair && obstacles[i].pair === ignorePair) continue; if (rectsOverlap(box, obstacles[i], 3)) return false; }
            for (var j = 0; j < boxes.length; j++) if (rectsOverlap(box, boxes[j], 4)) return false;
            for (var k = 0; k < circles.length; k++) { if (ignorePair && circles[k].pair === ignorePair) continue; if (rectCircleHit(box, circles[k])) return false; }
            return true;
        }
        // ---- geometry for leader routing ----
        function segSeg(p, q, r, t) {
            function cr(a, b, c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
            var d1 = cr(p, q, r), d2 = cr(p, q, t), d3 = cr(r, t, p), d4 = cr(r, t, q);
            return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
        }
        function segCircleDist(p, q, c) {
            var dx = q.x - p.x, dy = q.y - p.y, l2 = dx * dx + dy * dy || 1;
            var t = clamp(((c.x - p.x) * dx + (c.y - p.y) * dy) / l2, 0, 1);
            return Math.hypot(p.x + t * dx - c.x, p.y + t * dy - c.y);
        }
        function segRect(p, q, r) {
            if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return true;
            if (q.x >= r.x && q.x <= r.x + r.w && q.y >= r.y && q.y <= r.y + r.h) return true;
            var A = { x: r.x, y: r.y }, B = { x: r.x + r.w, y: r.y }, Cc = { x: r.x + r.w, y: r.y + r.h }, Dd = { x: r.x, y: r.y + r.h };
            return segSeg(p, q, A, B) || segSeg(p, q, B, Cc) || segSeg(p, q, Cc, Dd) || segSeg(p, q, Dd, A);
        }
        var leaders = [];      // placed leader segments (screen px)
        function leaderFor(box, item) {
            var bp = { x: clamp(item.cx, box.x, box.x + box.w), y: clamp(item.cy, box.y, box.y + box.h) };
            var q;
            if (item.rect) {
                q = { x: clamp(bp.x, item.rect.x, item.rect.x + item.rect.w), y: clamp(bp.y, item.rect.y, item.rect.y + item.rect.h) };
            } else {
                var dx = bp.x - item.cx, dy = bp.y - item.cy, d = Math.hypot(dx, dy) || 1;
                q = { x: item.cx + dx / d * (item.rr + 2), y: item.cy + dy / d * (item.rr + 2) };
            }
            return { p0: bp, p1: q };
        }
        // a leader may not cross another leader, touch another disc or group box, or run through any label
        function leaderOK(L0, item) {
            var i, k, j, m, o;
            for (i = 0; i < leaders.length; i++) if (segSeg(L0.p0, L0.p1, leaders[i].p0, leaders[i].p1)) return false;
            for (k = 0; k < ents.length; k++) {
                if (item.own.indexOf(ents[k].e.n) >= 0) continue;
                if (segCircleDist(L0.p0, L0.p1, ents[k]) < ents[k].r + 5) return false;
            }
            for (j = 0; j < D.fastRects.length; j++) {
                if (D.fastRects[j] === item.rect) continue;
                if (segRect(L0.p0, L0.p1, D.fastRects[j])) return false;
            }
            for (m = 0; m < boxes.length; m++) {
                if (segRect(L0.p0, L0.p1, { x: boxes[m].x - 2, y: boxes[m].y - 2, w: boxes[m].w + 4, h: boxes[m].h + 4 })) return false;
            }
            for (o = 0; o < obstacles.length; o++) {
                if (obstacles[o].pair) continue;
                if (segRect(L0.p0, L0.p1, obstacles[o])) return false;
            }
            return true;
        }
        function tryPlace(node, item, prefAng, maxD) {
            var w = node.offsetWidth, h = node.offsetHeight;
            for (var d = 0; d <= maxD; d += 8) {
                for (var ai = 0; ai < 24; ai++) {
                    var off = (ai % 2 ? 1 : -1) * Math.ceil(ai / 2) * (Math.PI / 12);
                    var a = prefAng + off;
                    var dx = Math.cos(a), dy = Math.sin(a);
                    var ax = item.cx + dx * (item.rr + 10 + d), ay = item.cy + dy * (item.rr + 10 + d);
                    var bx = dx > 0.35 ? ax : (dx < -0.35 ? ax - w : ax - w / 2);
                    var by = dy > 0.35 ? ay : (dy < -0.35 ? ay - h : ay - h / 2);
                    var box = { x: bx, y: by, w: w, h: h };
                    if (!free(box)) continue;
                    var L0 = leaderFor(box, item);
                    if (!leaderOK(L0, item)) continue;
                    return { box: box, leader: L0 };
                }
            }
            return null;
        }

        // ---- tag items: each static star on its own; each fast pair as one grouped tag ----
        // (a fast pair's discs swap sides every few seconds, so one bracketed tag keeps leaders from crossing)
        var items = [], grouped = [];
        D.fastRects.forEach(function (fr) {
            var ss = allStars(fr.pair);
            ss.forEach(function (n) { grouped.push(n); });
            items.push({ stars: ss, own: ss, rect: fr, cx: fr.x + fr.w / 2, cy: fr.y + fr.h / 2, rr: Math.hypot(fr.w, fr.h) / 2 - 2,
                primary: ss.some(function (n) { return n.id === D.sys.primary; }) });
        });
        ents.forEach(function (s) {
            if (grouped.indexOf(s.e.n) >= 0) return;
            items.push({ stars: [s.e.n], own: [s.e.n], rect: null, cx: s.x, cy: s.y, rr: s.r, primary: s.e.n.id === D.sys.primary });
        });
        items.sort(function (a, b) {
            if (a.primary !== b.primary) return a.primary ? -1 : 1;
            return Math.hypot(b.cx - C.x, b.cy - C.y) - Math.hypot(a.cx - C.x, a.cy - C.y);
        });
        var count = 0;
        items.forEach(function (it) {
            var gap = "<div style='height:" + (mobile ? 3 : 6) + "px'></div>";
            var html = it.stars.map(function (n) { return "<div>" + compLines(n, mobile, null) + "</div>"; }).join(gap);
            var short = it.stars.map(function (n) { return "<div><b>" + n.name + "</b> <span class='dim'>" + n.sp + "</span></div>"; }).join("");
            var node = el("sd-tag", html);
            hud.root.appendChild(node);
            var pref = Math.atan2(it.cy - C.y, it.cx - C.x);
            if (Math.hypot(it.cx - C.x, it.cy - C.y) < 8) pref = -2.2;
            var pl = tryPlace(node, it, pref, 260);
            if (!pl) { node.innerHTML = short; pl = tryPlace(node, it, pref, 420); }
            if (!pl) { node.parentNode.removeChild(node); testHook.droppedLabels.push(it.stars.map(function (n) { return n.id; }).join("+")); return; }
            node.style.left = pl.box.x + "px"; node.style.top = pl.box.y + "px";
            boxes.push(pl.box);
            leaders.push(pl.leader);
            hud.tags.push({
                el: node, ids: it.stars.map(function (n) { return n.id; }), box: pl.box, order: count++, rect: it.rect,
                // leader end in world coordinates (origin = canvas centre), so it follows the camera
                p0: pl.leader.p0, p1w: { x: pl.leader.p1.x - C.x, y: pl.leader.p1.y - C.y }
            });
        });

        // orbit period / separation labels, placed on the orbit path
        if (!mobile || true) {
            D.L.pairs.forEach(function (pair) {
                if (!pair.period) return;
                var node = el("sd-per", pair.period + (pair.tags.length && !mobile ? "" : ""));
                hud.root.appendChild(node);
                var w = node.offsetWidth, h = node.offsetHeight;
                var baseW = null;
                walk(D.sys.root, -D.L.cx, -D.L.cy, 0, D.L.st, function () { }, function (p, bx, by) { if (p === pair) baseW = { x: bx, y: by }; });
                var pp = pathPts(pair, st.k, D.L.rotAll, 48);
                var placed = null;
                // sample candidate points on both child paths, preferring the far side from the origin
                var cands = [];
                for (var j = 0; j < 2; j++) for (var i = 0; i < pp[j].length; i += 2) cands.push({ x: C.x + baseW.x + pp[j][i].x, y: C.y + baseW.y + pp[j][i].y });
                cands.sort(function (a, b) { return Math.hypot(b.x - C.x, b.y - C.y) - Math.hypot(a.x - C.x, a.y - C.y); });
                if (pair.draw === "dotted") {   // projected separation: label at the connector midpoint
                    var m0 = nodeMass(pair.c[0]), m1 = nodeMass(pair.c[1]);
                    var r0 = pp[0][0], r1 = pp[1][0];
                    cands = [0.5, 0.4, 0.6, 0.3, 0.7].map(function (tt) {
                        return { x: C.x + baseW.x + lerp(r0.x, r1.x, tt), y: C.y + baseW.y + lerp(r0.y, r1.y, tt) };
                    });
                }
                var fr0 = null;
                D.fastRects.forEach(function (r) { if (r.pair === pair) fr0 = r; });
                if (fr0) {   // a fast pair's discs sweep its whole orbit: put the period just outside that box
                    var mx = fr0.x + fr0.w / 2, my = fr0.y + fr0.h / 2;
                    cands = [{ x: mx, y: fr0.y }, { x: mx, y: fr0.y + fr0.h }, { x: fr0.x + fr0.w, y: my }, { x: fr0.x, y: my },
                    { x: fr0.x + fr0.w, y: fr0.y }, { x: fr0.x, y: fr0.y }, { x: fr0.x + fr0.w, y: fr0.y + fr0.h }, { x: fr0.x, y: fr0.y + fr0.h }];
                }
                for (var c = 0; c < cands.length && !placed; c++) {
                    var p = cands[c];
                    var outs = [[0, -1], [0, 1], [1, 0], [-1, 0], [0.7, -0.7], [-0.7, -0.7], [0.7, 0.7], [-0.7, 0.7]];
                    for (var o = 0; o < outs.length && !placed; o++) {
                        var dx = outs[o][0], dy = outs[o][1];
                        var bx = p.x + (dx > 0.3 ? 5 : dx < -0.3 ? -5 - w : -w / 2), by = p.y + (dy > 0.3 ? 4 : dy < -0.3 ? -4 - h : -h / 2);
                        var box = { x: bx, y: by, w: w, h: h };
                        if (free(box)) placed = box;
                    }
                }
                if (!placed) { node.parentNode.removeChild(node); testHook.droppedLabels.push("period:" + pair.period); return; }
                node.style.left = placed.x + "px"; node.style.top = placed.y + "px";
                boxes.push(placed);
                hud.pers.push({ el: node, box: placed });
            });
        }

        // backdrop tag (nebula haze), bottom right, clear of everything
        if (D.sys.haze) {
            var hn = el("sd-per", tg(D.sys.haze));
            hud.root.appendChild(hn);
            var w2 = hn.offsetWidth, h2 = hn.offsetHeight, hb = null;
            var spots = mobile ? [[W - w2 - 14, H - 62 - h2], [W - w2 - 14, 92], [14, H - 100 - h2]] : [[W - w2 - 24, H - 56 - h2], [W - w2 - 24, 24], [W - w2 - 24, H * 0.5]];
            for (var q = 0; q < spots.length && !hb; q++) { var b2 = { x: spots[q][0], y: spots[q][1], w: w2, h: h2 }; if (free(b2)) hb = b2; }
            if (!hb) { hn.parentNode.removeChild(hn); testHook.droppedLabels.push("haze"); }
            else { hn.style.left = hb.x + "px"; hn.style.top = hb.y + "px"; hud.pers.push({ el: hn, box: hb, haze: true }); }
        }
    }

    function hudRects() {
        var out = [];
        function add(id, e) {
            if (!e || !e.parentNode) return;
            var b = e.getBoundingClientRect();
            out.push({ id: id, x: b.left, y: b.top, w: b.width, h: b.height });
        }
        add("head", D.hud.head); add("read", D.hud.read); if (!D.mobile) add("skip", D.hud.skip);
        D.hud.tags.forEach(function (t) { add("tag:" + t.ids.join("+"), t.el); });
        D.hud.pers.forEach(function (t, i) { add("per:" + i, t.el); });
        return out;
    }

    // =====================================================================
    // START
    // =====================================================================
    function start(starIdx, xy, target, onDone) {
        var sys = SYS[starIdx];
        if (D || !sys) return false;
        var ST = window.SiteTransition;
        var plan = ST.prepare({ star: sys.name, target: target, rgb: hexRgb(sys.hex) });
        if (plan.reduced) {
            // reduced motion: the existing 150 ms colour fade, then navigate
            return ST.startDive({ star: sys.name, target: target, rgb: hexRgb(sys.hex), x: xy.x, y: xy.y });
        }
        ST.prefetch(target);
        injectStyle();
        var W = window.innerWidth, H = window.innerHeight;
        var dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX);
        var mobile = W < 520;
        var epoch = Date.now();
        var jd = jdNow(epoch);

        var src = document.querySelector("canvas.p5Canvas") || document.querySelector("canvas");
        var snap = null;
        try {
            snap = document.createElement("canvas");
            snap.width = src.width; snap.height = src.height;
            snap.getContext("2d").drawImage(src, 0, 0);
        } catch (e) { snap = null; }

        var cv = document.createElement("canvas");
        cv.id = "star-dive-canvas";
        cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
        document.body.appendChild(cv);
        var ctx = cv.getContext("2d");

        var L = buildLayout(sys, W, H, jd, mobile);
        var primaryNode = L.primary;
        var C = { x: W / 2, y: H / 2 };
        D = {
            idx: starIdx, sys: sys, plan: plan, W: W, H: H, dpr: dpr, C: C, mobile: mobile, cv: cv, ctx: ctx, snap: snap,
            L: L, primaryNode: primaryNode, epoch: epoch, jd: jd, xy: { x: xy.x, y: xy.y }, target: target, onDone: onDone,
            t0: now(), override: null, raf: 0, timer: 0, done: false, skipAt: null, skipTs: 0,
            sprites: {}, glows: {}, lastOmega: 0, listeners: []
        };
        // sphere + texture (the heavy bits, once per dive)
        D.sph = buildSphere(sys, primaryNode);
        // pre-position (t = 0 .. reveal): positions at reveal start for the star glide target
        D.t0Ents = evalStars(L, 0, sys);
        D.hud = buildHud(sys, L, mobile);
        D.primaryAt = function (tms) { var es = evalStars(L, tms / 1000, sys); for (var i = 0; i < es.length; i++) if (es[i].n === primaryNode) return es[i]; return es[0]; };
        D.Fr = D.primaryAt(T_APPROACH_END);
        placeLabels(D);

        // static layers
        D.orbitLayer = buildOrbitLayer(D);
        if (sys.backdrop === "alnitak") D.backdrop = buildBackdrop("alnitak", W, H);
        else if (sys.haze) D.backdrop = buildBackdrop("ngc1990", W, H);
        D.field = buildField(W, H);

        // spin
        var Pd = sys.Pd;
        D.omega0 = clamp(SPIN_BASE * Math.pow(5 / Pd, 0.35), SPIN_MIN, SPIN_MAX);
        D.Sfinal = (CLOSE_RADIUS_FRAC * Math.min(W, H)) / primaryNode._rpx;

        // hook
        testHook.active = true; testHook.components = L.stars.map(function (s) { return (sys.name === "Mintaka" || sys.name === "Alnitak" || sys.name === "Rigel") ? s.id : s.id; });
        testHook.omegaPeak = D.omega0; testHook.finalRgb = plan.finalRgb.slice(); testHook.starRgb = plan.rgb.slice();
        testHook.droppedLabels = testHook.droppedLabels || [];
        testHook.mintakaPhase0 = sys.eclipse ? ephemerisPhase(jd) : null;
        testHook.system = sys.name;

        wireInput();
        D.timer = setTimeout(function () { if (D && D.override === null) finish(); }, T_HARD_MAX - 250);
        D.raf = requestAnimationFrame(loop);
        document.documentElement.classList.add("star-diving");
        frame();
        return true;
    }

    function buildOrbitLayer(D) {
        var W = D.W, H = D.H, dpr = D.dpr, L = D.L, sys = D.sys, C = D.C;
        var c = document.createElement("canvas");
        c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
        var g = c.getContext("2d");
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        var st = L.st, col = [150, 170, 230];
        walk(sys.root, -L.cx, -L.cy, 0, st, function () { }, function (pair, bx, by) {
            var pp = pathPts(pair, st.k, L.rotAll, 120);
            var dash = pair.draw === "dashed", dotted = pair.draw === "dotted";
            if (dotted) {
                g.save(); g.setLineDash([2, 5]); g.strokeStyle = rgba(col, 0.35); g.lineWidth = 1;
                g.beginPath();
                g.moveTo(C.x + bx + pp[0][0].x, C.y + by + pp[0][0].y);
                g.lineTo(C.x + bx + pp[1][0].x, C.y + by + pp[1][0].y);
                g.stroke(); g.restore();
                return;
            }
            for (var j = 0; j < 2; j++) {
                g.save();
                if (dash) g.setLineDash([6, 6]);
                g.strokeStyle = rgba(col, dash ? 0.42 : 0.5);
                g.lineWidth = pair.advance ? 1.1 : 1;
                g.beginPath();
                for (var i = 0; i < pp[j].length; i++) {
                    var x = C.x + bx + pp[j][i].x, y = C.y + by + pp[j][i].y;
                    if (i) g.lineTo(x, y); else g.moveTo(x, y);
                }
                g.closePath(); g.stroke(); g.restore();
            }
        });
        return c;
    }

    function buildField(W, H) {
        var R = rng(77), out = [], Rmax = Math.hypot(W, H) / 2 * 1.05;
        for (var i = 0; i < FIELD_STARS; i++) {
            var z0 = 0.25 + 0.75 * Math.pow(R(), 0.8);
            out.push({
                ang: R() * Math.PI * 2, r0: 0.04 + 0.96 * R(), z0: z0, a: 0.25 + R() * 0.6,
                sz: 0.5 + R() * 1.1, hue: R()
            });
        }
        return { stars: out, Rmax: Rmax };
    }

    // =====================================================================
    // FRAME
    // =====================================================================
    function loop() {
        if (!D) return;
        D.raf = requestAnimationFrame(loop);
        var el = D.override !== null ? D.override : now() - D.t0;
        if (D.override === null) {
            if (D.skipAt !== null) { if (now() - D.skipAt >= SKIP_HANDOFF_MS) { frame(); finish(); return; } }
            else if (el >= T_TOTAL) { frame(); finish(); return; }
        }
        frame();
    }

    function phaseName(t) {
        if (D.skipAt !== null) return "skip";
        return t < T_APPROACH_END ? "approach" : t < T_REVEAL_END ? "reveal" : t < T_CLOSE_END ? "closeup" : "handoff";
    }

    function omegaAt(t) {
        if (t < T_REVEAL_END) return D.omega0;
        if (t >= T_CLOSE_END) return 0;
        var u = (t - T_REVEAL_END) / (T_CLOSE_END - T_REVEAL_END);
        return D.omega0 * (1 - u) * (1 - u);
    }
    function angleAt(t) {
        var tc = T_REVEAL_END / 1000, dur = (T_CLOSE_END - T_REVEAL_END) / 1000;
        if (t < T_REVEAL_END) return D.omega0 * t / 1000;
        var u = clamp((t - T_REVEAL_END) / (T_CLOSE_END - T_REVEAL_END), 0, 1);
        return D.omega0 * (tc + dur * (1 - Math.pow(1 - u, 3)) / 3);
    }

    function frame() {
        if (!D) return;
        var real = now() - D.t0;
        var tSim = D.override !== null ? D.override : Math.min(real, D.skipAt !== null ? D.skipTs : T_TOTAL);
        if (D.skipAt !== null && D.override === null) tSim = D.skipTs;
        render(tSim);
    }

    function starCenterWorld(t) {
        return D.primaryAt(t);
    }

    function render(t) {
        var ctx = D.ctx, W = D.W, H = D.H, dpr = D.dpr, C = D.C, sys = D.sys, L = D.L;
        var ph = phaseName(t);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;

        // ---- background ----
        var bgk = smooth(t / 500);
        ctx.fillStyle = "rgb(" + Math.round(lerp(BG_HOME[0], BG_DEEP[0], bgk)) + "," + Math.round(lerp(BG_HOME[1], BG_DEEP[1], bgk)) + "," + Math.round(lerp(BG_HOME[2], BG_DEEP[2], bgk)) + ")";
        ctx.fillRect(0, 0, W, H);

        // ---- timeline scalars ----
        var a = clamp(t / T_APPROACH_END, 0, 1);
        var u = clamp((t - T_APPROACH_END) / (T_REVEAL_END - T_APPROACH_END), 0, 1);
        var uc = clamp((t - T_REVEAL_END) / (T_CLOSE_END - T_REVEAL_END), 0, 1);
        var h = clamp((t - T_CLOSE_END) / (T_TOTAL - T_CLOSE_END), 0, 1);
        var e = easeInOutCubic(uc);
        var Aflight = flightAt(t);

        // ---- backdrop (screen-fixed, slow parallax) ----
        if (D.backdrop) {
            var bAlpha = smooth((t - 800) / 600) * (1 - smooth((t - 1900) / 700));
            if (bAlpha > 0.002) {
                var bs = 1 + 0.05 * e;
                ctx.save(); ctx.globalAlpha = bAlpha * 0.9;
                ctx.translate(C.x, C.y); ctx.scale(bs, bs); ctx.translate(-C.x, -C.y);
                ctx.drawImage(D.backdrop, 0, 0, W, H);
                ctx.restore();
            }
        }

        // ---- field of stars with depth parallax ----
        drawField(ctx, D, t, Aflight, a, h);

        // ---- home snapshot, flying past ----
        var Pst = D.xy;
        var Ptarget = { x: C.x + D.Fr.x, y: C.y + D.Fr.y };
        var glide = easeOutCubic(a);
        var Pc = { x: lerp(Pst.x, Ptarget.x, glide), y: lerp(Pst.y, Ptarget.y, glide) };
        if (D.snap && t < T_APPROACH_END) {
            var sAlpha = 1 - smooth((a - 0.04) / 0.5);
            if (sAlpha > 0.003) {
                var sS = 1 + 2.4 * easeInCubic(a);
                ctx.save();
                ctx.globalAlpha = sAlpha;
                ctx.translate(Pc.x, Pc.y); ctx.scale(sS, sS); ctx.translate(-Pst.x, -Pst.y);
                ctx.drawImage(D.snap, 0, 0, W, H);
                ctx.restore();
            }
        }

        // ---- camera for the world layers ----
        var zs = lerp(0.55, 1, easeOutCubic(u));
        var Fs, Fa, Z;
        var live = D.primaryAt(t);
        if (t < T_REVEAL_END) { Fs = { x: D.Fr.x, y: D.Fr.y }; Fa = Fs; Z = zs; }
        else {
            Fs = { x: 0, y: 0 };
            Fa = { x: live.x * e, y: live.y * e };
            Z = Math.exp(Math.log(D.Sfinal) * e);
        }
        function toScreen(x, y) { return { x: C.x + Fs.x + (x - Fa.x) * Z, y: C.y + Fs.y + (y - Fa.y) * Z }; }

        var worldAlpha = smooth(u / 0.55);                 // orbits and companions arrive
        var others = (t < T_REVEAL_END ? 1 : 1 - smooth(uc / 0.35));

        // ---- orbit layer ----
        if (t >= T_APPROACH_END - 100 && D.orbitLayer) {
            var oA = worldAlpha * others;
            if (oA > 0.003) {
                ctx.save();
                ctx.globalAlpha = oA;
                var tx = C.x + Fs.x - (C.x + Fa.x) * Z, ty = C.y + Fs.y - (C.y + Fa.y) * Z;
                ctx.setTransform(dpr * Z, 0, 0, dpr * Z, dpr * tx, dpr * ty);
                ctx.drawImage(D.orbitLayer, 0, 0, W, H);
                ctx.restore();
            }
        }

        // ---- stars ----
        var ents = evalStars(L, t / 1000, sys);
        var phiNow = null, eclipseNow = 0;
        if (sys.eclipse) {
            var pair0 = L.pairs.filter(function (p) { return p.phase === "ephemeris"; })[0];
            var phi = (pair0._Mt / (2 * Math.PI)); phi = phi - Math.floor(phi);
            phiNow = phi;
            var dphi = Math.min(phi, 1 - phi);
            eclipseNow = dphi < 0.062 ? Math.cos(dphi / 0.062 * Math.PI / 2) : 0;
        }
        ents.sort(function (p, q) { return p.z - q.z; });
        var drawn = [];
        var primAlphaApproach = smooth((t - 380) / 520);
        ents.forEach(function (en) {
            var n = en.n, isP = n === D.primaryNode;
            var sp = toScreen(en.x, en.y);
            var rpx = n._rpx * Z;
            var al;
            if (isP) al = primAlphaApproach;
            else {
                var idxOrder = L.stars.indexOf(n);
                al = smooth((u - 0.06 - idxOrder * 0.04) / 0.4) * others;
            }
            if (isP && ph !== "approach") al = Math.max(al, 0);
            if (n === L.stars[0] && false) al = 1;
            var dim = 1;
            if (sys.eclipse && n.id === "Aa1") dim = 1 - ECLIPSE_DEPTH * eclipseNow;
            en._sp = sp; en._r = rpx; en._al = al * dim;
            if (al > 0.003) {
                drawGlowAndDisc(ctx, D, en, t, uc, h, e);
                drawn.push(n.id);
            }
        });
        // approach: the star itself, a glowing point on its way to the centre
        if (t < T_APPROACH_END + 200) {
            var gl = glowSprite(D, sys.hex);
            var rg = lerp(10, 54, easeInCubic(a));
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = (1 - smooth((t - 600) / 300)) * 0.9;
            ctx.drawImage(gl, Pc.x - rg, Pc.y - rg, rg * 2, rg * 2);
            ctx.restore();
        }

        // ---- leaders ----
        var tagA = ramp(t, HUD_TAG_IN) * (1 - ramp(t, HUD_TAG_OUT)) * (1 - ramp(t, HUD_OUT));
        if (tagA > 0.01 && D.skipAt === null) drawLeaders(ctx, D, ents, toScreen, tagA);

        // ---- hand-off flood ----
        var primEn = ents.filter(function (x) { return x.n === D.primaryNode; })[0];
        var R = D.Sfinal * D.primaryNode._rpx;
        if (h > 0 || t >= T_CLOSE_END) drawFlood(ctx, D, h, R);
        if (D.skipAt !== null) {
            var sk = clamp((now() - D.skipAt) / SKIP_HANDOFF_MS, 0, 1);
            if (D.override !== null) sk = 0;
            drawFlood(ctx, D, easeInOutCubic(sk), R, true);
        }

        // ---- HUD ----
        updateHud(D, t);

        // ---- test hook ----
        testHook.phase = phaseName(t);
        testHook.t = t;
        testHook.omega = omegaAt(t);
        testHook.omegaFrac = omegaAt(t) / D.omega0;
        testHook.drawn = drawn;
        testHook.mintakaPhase = phiNow;
        testHook.eclipse = eclipseNow;
        testHook.floodAlpha = h;
        testHook.zoom = Z;
        testHook.primary = { x: primEn ? primEn._sp.x : null, y: primEn ? primEn._sp.y : null, r: primEn ? primEn._r : null };
        D.lastEnts = ents;
        // star-star pairs: does the screen overlap match the real projected overlap?
        testHook.pairs = L.pairs.filter(function (p) { return p.c[0].kind === "star" && p.c[1].kind === "star"; }).map(function (p) {
            var e0 = ents.filter(function (x) { return x.n === p.c[0]; })[0], e1 = ents.filter(function (x) { return x.n === p.c[1]; })[0];
            var nu = trueAnomaly(p._Mt, p.e);
            var real = relLocal(p, nu, p.a / AU_PER_RSUN, 0);
            return {
                a: p.c[0].id, b: p.c[1].id, aliveAlpha: Math.min(e0._al, e1._al),
                screenSep: Math.hypot(e0._sp.x - e1._sp.x, e0._sp.y - e1._sp.y), screenSum: e0._r + e1._r,
                realSep: Math.hypot(real.x, real.y), realSum: p.c[0].R + p.c[1].R
            };
        });
    }

    function discList() {
        return (D.lastEnts || []).filter(function (e) { return e._al > 0.05; }).map(function (e) { return { id: e.n.id, x: e._sp.x, y: e._sp.y, r: e._r, R: e.n.R }; });
    }

    function glowSprite(D, hex) {
        if (D.glows[hex]) return D.glows[hex];
        var c = document.createElement("canvas"); c.width = c.height = 256;
        var g = c.getContext("2d"), col = hexRgb(hex);
        var gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
        gr.addColorStop(0, rgba([255, 255, 255], 0.95));
        gr.addColorStop(0.08, rgba(col, 0.85));
        gr.addColorStop(0.28, rgba(col, 0.28));
        gr.addColorStop(0.6, rgba(col, 0.07));
        gr.addColorStop(1, rgba(col, 0));
        g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
        D.glows[hex] = c;
        return c;
    }

    // Camera flight distance: fast through the approach, decelerating to a crawl by the reveal,
    // then only a gentle parallax drift (no streaks) through the close-up and hand-off.
    function flightAt(t) {
        var a = clamp(t / T_APPROACH_END, 0, 1), u = clamp((t - T_APPROACH_END) / (T_REVEAL_END - T_APPROACH_END), 0, 1);
        var uc = clamp((t - T_REVEAL_END) / (T_CLOSE_END - T_REVEAL_END), 0, 1), h = clamp((t - T_CLOSE_END) / (T_TOTAL - T_CLOSE_END), 0, 1);
        return 6.0 * easeOutCubic(a) + 0.05 * easeOutCubic(u) + 0.012 * easeInOutCubic(uc) + 0.01 * h;
    }

    function drawField(ctx, D, t, A, a, h) {
        var C = D.C, F = D.field, Rmax = F.Rmax;
        var Ap = A - (A - Math.max(0, (function () {   // previous flight position, for streak length
            return flightAt(Math.max(0, t - 34));
        })()));
        var fade = (1 - smooth((t - 3000) / 400)) * smooth(t / 260);
        if (fade < 0.003) return;
        // the field is centred on the flight target (the star's travelling position)
        var Pst = D.xy, Pt = { x: C.x + D.Fr.x, y: C.y + D.Fr.y }, cc;
        var glide = easeOutCubic(a);
        cc = { x: lerp(Pst.x, Pt.x, glide), y: lerp(Pst.y, Pt.y, glide) };
        if (t >= T_APPROACH_END) cc = Pt;
        var streakMax = 0;
        ctx.save();
        ctx.lineCap = "round";
        for (var i = 0; i < F.stars.length; i++) {
            var s = F.stars[i];
            var sc = 1 + A / s.z0, scp = 1 + Ap / s.z0;
            var r1 = s.r0 * Rmax * sc, r0 = s.r0 * Rmax * scp;
            var rw = r1 % Rmax; if (rw < r1 - Rmax * 0 && false) rw = r1;
            var wraps = Math.floor(r1 / Rmax);
            var rr = r1 - wraps * Rmax, rp = r0 - wraps * Rmax;
            if (rp < 0) rp = rr;   // wrapped between the two samples: no streak
            if (rr - rp > streakMax) streakMax = rr - rp;
            var cs = Math.cos(s.ang), sn = Math.sin(s.ang);
            var x1 = cc.x + cs * rr, y1 = cc.y + sn * rr;
            if (x1 < -20 || x1 > D.W + 20 || y1 < -20 || y1 > D.H + 20) continue;
            var near = 1 - s.z0;
            var edge = smooth(rr / (Rmax * 0.18));
            var al = s.a * (0.35 + 0.65 * near) * (0.55 + 0.45 * Math.min(1, rr / Rmax * 2)) * edge * fade * (0.7 + 0.3 * smooth(A / 2));
            var w = s.sz * (0.7 + 0.9 * near);
            var tint = s.hue < 0.25 ? [200, 215, 255] : s.hue < 0.8 ? [232, 236, 255] : [255, 236, 214];
            ctx.strokeStyle = rgba(tint, Math.min(0.95, al));
            ctx.lineWidth = w;
            ctx.beginPath();
            ctx.moveTo(cc.x + cs * rp, cc.y + sn * rp);
            ctx.lineTo(x1, y1);
            if (Math.abs(rr - rp) < 0.4) ctx.lineTo(x1 + 0.01, y1);
            ctx.stroke();
        }
        testHook.streakMax = streakMax;
        ctx.restore();
    }

    function drawGlowAndDisc(ctx, D, en, t, uc, h, e) {
        var sys = D.sys, n = en.n, isP = n === D.primaryNode, L0 = D.L;
        var sp = en._sp, r = en._r;
        ctx.save();
        ctx.globalAlpha = clamp(en._al, 0, 1);
        // wind glow + O-star bloom (additive, hue never changes)
        var windK = isP ? sys.wind : 0.35;
        var bloomK = clamp((n.teff - 20000) / 11000, 0, 1) * 0.85 + (n.teff >= 22000 ? 0.1 : 0);
        var boost = 1 + 1.2 * smooth(h * 1.4);
        var gl = glowSprite(D, "#" + [n.col[0], n.col[1], n.col[2]].map(function (v) { return ("0" + v.toString(16)).slice(-2); }).join(""));
        ctx.globalCompositeOperation = "lighter";
        var single = isP && L0.pairs.length === 0;
        var rw = r * (1.5 + 0.35 * windK + (single ? (1.1 + 1.6 * windK) * (1 - smooth((r - 30) / 140)) : 0));
        ctx.globalAlpha = clamp(en._al, 0, 1) * (0.16 + 0.22 * windK) * (isP ? 1 : 0.8) * boost;
        ctx.drawImage(gl, sp.x - rw, sp.y - rw, rw * 2, rw * 2);
        if (bloomK > 0.05) {
            var rb = r * (2.6 + 1.2 * bloomK);
            ctx.globalAlpha = clamp(en._al, 0, 1) * 0.2 * bloomK * boost;
            ctx.drawImage(gl, sp.x - rb, sp.y - rb, rb * 2, rb * 2);
        }
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = clamp(en._al, 0, 1);

        if (isP && r > 40) {
            renderSphere(D.sph, angleAt(t), TEX_AMP);
            var half = r * (SPH / 2) / D.sph.SR;
            ctx.drawImage(D.sph.cv, sp.x - half, sp.y - half, half * 2, half * 2);
            // thin corona hugging the limb
            var cg = ctx.createRadialGradient(sp.x, sp.y, r * 0.985, sp.x, sp.y, r * 1.22);
            var col = n.col;
            cg.addColorStop(0, rgba(col, 0.22 * (0.6 + 0.4 * windK)));
            cg.addColorStop(1, rgba(col, 0));
            ctx.globalCompositeOperation = "lighter";
            ctx.fillStyle = cg;
            ctx.beginPath(); ctx.arc(sp.x, sp.y, r * 1.22, 0, 7); ctx.fill();
        } else {
            var key = n.id + "|" + Math.round(n._rpx);
            var spr = D.sprites[key] || (D.sprites[key] = discSprite(n.col, sys.u, n._rpx, D.dpr));
            var hf = r * spr.half / spr.r;
            if (isP && sys.oblate) {
                ctx.translate(sp.x, sp.y); ctx.rotate(0.35 * 0);
                ctx.drawImage(spr.c, -hf, -hf * 0.9, hf * 2, hf * 1.8);
            } else ctx.drawImage(spr.c, sp.x - hf, sp.y - hf, hf * 2, hf * 2);
        }
        ctx.restore();
    }

    function drawLeaders(ctx, D, ents, toScreen, alpha) {
        ctx.save();
        ctx.lineWidth = 1;
        D.hud.tags.forEach(function (tag) {
            var q = toScreen(tag.p1w.x, tag.p1w.y);
            ctx.strokeStyle = rgba([170, 190, 240], 0.38 * alpha);
            ctx.beginPath(); ctx.moveTo(tag.p0.x, tag.p0.y); ctx.lineTo(q.x, q.y); ctx.stroke();
            if (tag.rect) {   // grouped tag: a faint bracket marks the orbit region it refers to
                var r = tag.rect, tl = toScreen(r.x - D.C.x, r.y - D.C.y), br = toScreen(r.x + r.w - D.C.x, r.y + r.h - D.C.y);
                ctx.strokeStyle = rgba([170, 190, 240], 0.16 * alpha);
                ctx.setLineDash([2, 3]);
                ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
                ctx.setLineDash([]);
            }
        });
        ctx.restore();
    }

    function drawFlood(ctx, D, h, R, skip) {
        var W = D.W, H = D.H, fin = D.plan.finalRgb, star = D.plan.rgb, diag = Math.hypot(W, H) / 2;
        var k = easeInCubic(clamp(h / 0.8, 0, 1));
        var ri = lerp(0.55 * R, diag * 1.25, skip ? h : k);
        var soft = Math.max(20, 0.35 * R);
        var ro = ri + soft;
        // the bloom starts as the star's own colour and settles into the destination colour
        var cm = skip ? 1 : smooth((h - 0.45) / 0.45);
        var col = [lerp(star[0], fin[0], cm), lerp(star[1], fin[1], cm), lerp(star[2], fin[2], cm)];
        var gr = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, ro);
        var f = clamp(ri / ro, 0, 0.999);
        var a0 = skip ? 1 : smooth(h * 4);
        gr.addColorStop(0, rgba(col, a0));
        gr.addColorStop(f, rgba(col, a0));
        gr.addColorStop(1, rgba(col, 0));
        ctx.save();
        ctx.setTransform(D.dpr, 0, 0, D.dpr, 0, 0);
        ctx.fillStyle = gr;
        ctx.fillRect(0, 0, W, H);
        if (h >= (skip ? 0.999 : 0.85)) { ctx.fillStyle = rgba(fin, 1); ctx.fillRect(0, 0, W, H); }
        ctx.restore();
    }

    function updateHud(D, t) {
        var hud = D.hud, mobile = D.mobile;
        var outK = 1 - ramp(t, HUD_OUT);
        if (D.skipAt !== null) outK = 1 - clamp((now() - D.skipAt) / (SKIP_HANDOFF_MS * 0.6), 0, 1);
        function op(e, v) {
            var s = v.toFixed(2);
            if (e._op !== s) { e.style.opacity = s; e._op = s; }
        }
        var hv = smooth(ramp(t, HUD_HEAD_IN));
        op(hud.head, hv * outK);
        var tagK = smooth(ramp(t, HUD_TAG_IN)) * (1 - smooth(ramp(t, HUD_TAG_OUT))) * outK;
        hud.tags.forEach(function (tg2, i) {
            var stag = clamp(ramp(t, [HUD_TAG_IN[0] + i * 60, HUD_TAG_IN[1] + i * 60]), 0, 1);
            op(tg2.el, smooth(stag) * (1 - smooth(ramp(t, HUD_TAG_OUT))) * outK);
        });
        hud.pers.forEach(function (p, i) {
            var stag = clamp(ramp(t, [HUD_TAG_IN[0] + 120 + i * 40, HUD_TAG_IN[1] + 120 + i * 40]), 0, 1);
            op(p.el, smooth(stag) * (1 - smooth(ramp(t, HUD_TAG_OUT))) * outK);
        });
        var rv = smooth(ramp(t, HUD_READ_IN)) * outK;
        if (rv > 0.01) {
            var f = omegaAt(t) / D.omega0;
            var html = readoutHtml(D.sys, f, mobile);
            if (hud.read._html !== html) { hud.read.innerHTML = html; hud.read._html = html; }
        }
        op(hud.read, rv);
        if (!mobile) op(hud.skip, smooth(ramp(t, [500, 900])) * outK * 0.8);
    }

    // =====================================================================
    // INPUT / FINISH / RESET
    // =====================================================================
    function wireInput() {
        function doSkip() {
            if (!D || D.done || D.skipAt !== null || D.override !== null) return;
            D.skipTs = Math.min(now() - D.t0, T_TOTAL);
            D.skipAt = now();
        }
        function onKey(e) {
            if (e.key === "Escape" || e.key === " " || e.code === "Space") { e.preventDefault(); e.stopPropagation(); doSkip(); }
        }
        function onPointer(e) {
            if (!D) return;
            if (now() - D.t0 < SKIP_POINTER_GUARD_MS) return;
            doSkip();
        }
        document.addEventListener("keydown", onKey, true);
        document.addEventListener("click", onPointer, true);
        document.addEventListener("touchstart", onPointer, { capture: true, passive: true });
        D.listeners = [["keydown", onKey, true], ["click", onPointer, true], ["touchstart", onPointer, { capture: true, passive: true }]];
    }

    function finish() {
        if (!D || D.done) return;
        D.done = true;
        if (D.raf) cancelAnimationFrame(D.raf);
        clearTimeout(D.timer);
        var cb = D.onDone;
        window.SiteTransition.commit(D.plan);
        if (typeof cb === "function") { try { cb(D.plan); } catch (e) { } }
    }

    function reset() {
        if (!D) return;
        if (D.raf) cancelAnimationFrame(D.raf);
        clearTimeout(D.timer);
        D.listeners.forEach(function (l) { document.removeEventListener(l[0], l[1], l[2]); });
        if (D.cv && D.cv.parentNode) D.cv.parentNode.removeChild(D.cv);
        if (D.hud && D.hud.root && D.hud.root.parentNode) D.hud.root.parentNode.removeChild(D.hud.root);
        document.documentElement.classList.remove("star-diving");
        D.done = true;
        D = null;
        testHook.active = false; testHook.phase = "idle";
    }

    window.StarDive = {
        start: start,
        reset: reset,
        isActive: function () { return !!D; }
    };

    if (window.SiteTransition) window.SiteTransition.onReset(reset);
    window.addEventListener("pageshow", function (e) { if (e.persisted) reset(); });
}());
