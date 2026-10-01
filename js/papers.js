// Papers list rendering lives inline in papers.html (single renderer with a
// graceful empty state). This file draws the particle background and the
// black-hole intro (bottom of file) that hands over to it.

const canvas = document.getElementById('particles-bg');
const ctx = canvas.getContext('2d');
let w = window.innerWidth, h = window.innerHeight;
canvas.width = w; canvas.height = h;
window.addEventListener('resize', () => {
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = w; canvas.height = h;
});

// Particle flavors and correct symbols
const flavors = [
    { name: "Electron",  symbol: "e⁻", antiSymbol: "e⁺", color: "#5df9f3", r: 18 },
    { name: "Muon",      symbol: "μ⁻", antiSymbol: "μ⁺", color: "#f7e46e", r: 18 },
    { name: "Tau",       symbol: "τ⁻", antiSymbol: "τ⁺", color: "#c27dff", r: 19 },
    { name: "Up",        symbol: "u",  antiSymbol: "ū",  color: "#b0ff87", r: 13 },
    { name: "Down",      symbol: "d",  antiSymbol: "d̄", color: "#ffb05c", r: 13 },
    { name: "Strange",   symbol: "s",  antiSymbol: "s̄", color: "#ff64b0", r: 14 }
];
function randomFlavor() {
    const idx = Math.floor(Math.random()*flavors.length);
    const anti = Math.random() > 0.5;
    const base = flavors[idx];
    return {
        ...base,
        isAnti: anti,
        label: anti ? base.antiSymbol : base.symbol,
        r: base.r
    };
}

let particles = [];
let fieldDrawn = 0;      // particles drawn by the field in its last frame (test hook)
let introHold = document.documentElement.classList.contains('bh-cover');   // the intro owns the field: particles drift but are not drawn, age or annihilate
let explosions = [];
let photons = [];

// --- Make more, slower, and longer-lived particles for more annihilations
const PARTICLE_COUNT = 44;
const PARTICLE_VEL = 0.8;
const PARTICLE_LIFE = 620;
const PARTICLE_R = 1.05; // radius scaling

function spawnParticle() {
    let flavor = randomFlavor();
    particles.push({
        x: Math.random()*w, y: Math.random()*h,
        vx: (Math.random()-0.5)*PARTICLE_VEL, vy: (Math.random()-0.5)*PARTICLE_VEL,
        r: flavor.r * PARTICLE_R, life: 0, maxLife: PARTICLE_LIFE + Math.random()*80, flavor
    });
}

// Initial population
for (let i = 0; i < PARTICLE_COUNT; i++) spawnParticle();

// --- Annihilation Check (with explosion and photon production)
function checkAnnihilations() {
    for (let i = 0; i < particles.length; i++) {
        let a = particles[i];
        for (let j = i+1; j < particles.length; j++) {
            let b = particles[j];
            if (
                a.flavor.symbol === b.flavor.symbol && // "type" match (could also use name)
                a.flavor.isAnti !== b.flavor.isAnti &&
                Math.hypot(a.x - b.x, a.y - b.y) < (a.r + b.r) * 0.8
            ) {
                // Mark both for removal, trigger explosion
                a.life = -9999; b.life = -9999;
                let exX = (a.x + b.x)/2, exY = (a.y + b.y)/2;
                explosions.push({
                    x: exX, y: exY,
                    t: 0, maxT: 46 + Math.random()*22,
                    color: a.flavor.color
                });
                // Create 1 or 2 photons per annihilation
                let nPhotons = 1 + Math.floor(Math.random()*2);
                for (let k = 0; k < nPhotons; k++) {
                    let angle = Math.random() * 2 * Math.PI;
                    let speed = 2.7 + Math.random()*2.3;
                    photons.push({
                        x: exX, y: exY,
                        vx: Math.cos(angle) * speed,
                        vy: Math.sin(angle) * speed,
                        life: 0, maxLife: 45 + Math.random()*14
                    });
                }
            }
        }
    }
}

// --- Animate Explosions ---
function drawExplosions() {
    for (let ex of explosions) {
        let pct = ex.t / ex.maxT;
        let rad = 28 + pct * 68;
        let alpha = 0.35 * (1 - pct);
        ctx.save();
        ctx.beginPath();
        ctx.arc(ex.x, ex.y, rad, 0, 2*Math.PI);
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = ex.color;
        ctx.lineWidth = 4 + 19 * (1-pct);
        ctx.shadowColor = "#ffe2d6";
        ctx.shadowBlur = 18 * (1-pct);
        ctx.stroke();
        ctx.globalAlpha = alpha * 0.69;
        ctx.beginPath();
        ctx.arc(ex.x, ex.y, 13 + 36*pct, 0, 2*Math.PI);
        ctx.fillStyle = "#fffbc1";
        ctx.fill();
        ctx.restore();
        ex.t++;
    }
    // Remove finished explosions
    explosions = explosions.filter(ex => ex.t < ex.maxT);
}

// --- Animate Photons ---
function drawPhotons() {
    for (let ph of photons) {
        let pct = ph.life / ph.maxLife;
        ctx.save();
        ctx.globalAlpha = 0.62 * (1-pct);
        ctx.beginPath();
        ctx.arc(ph.x, ph.y, 8 + 20*pct, 0, 2*Math.PI);
        ctx.fillStyle = "#ffe864";
        ctx.shadowColor = "#fff";
        ctx.shadowBlur = 16 * (1-pct);
        ctx.fill();
        ctx.font = "bold 16px monospace";
        ctx.fillStyle = "#fff";
        ctx.globalAlpha = 0.82 * (1-pct);
        ctx.fillText("γ", ph.x, ph.y);
        ctx.restore();

        ph.x += ph.vx;
        ph.y += ph.vy;
        ph.life++;
    }
    photons = photons.filter(ph => ph.life < ph.maxLife);
}

// One particle, exactly as the field draws it. The intro reuses this for the condensing sprites.
function drawParticle(c, p, x, y, a, k, la) {
    c.save();
    c.globalAlpha = a;
    c.beginPath();
    c.arc(x, y, p.r * k, 0, 2*Math.PI);
    c.fillStyle = p.flavor.isAnti ? "#fff" : p.flavor.color;
    c.shadowColor = p.flavor.isAnti ? "#fff" : p.flavor.color;
    c.shadowBlur = p.flavor.isAnti ? 16 : 11;
    c.fill();
    c.globalAlpha = la;
    c.font = "bold 18px serif";
    c.fillStyle = p.flavor.isAnti ? "#f43" : "#fff";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(p.flavor.label, x, y);
    c.restore();
}

function animate() {
    ctx.clearRect(0,0,w,h);
    fieldDrawn = 0;
    // Fade trails for smooth effect
    ctx.globalAlpha = 0.11;
    ctx.fillStyle = "#191631";
    ctx.fillRect(0,0,w,h);
    ctx.globalAlpha = 1.0;

    // Animate and draw particles
    for (let p of particles) {
        let alpha = Math.min(1, Math.min(p.life/45, (p.maxLife-p.life)/45));
        if (!introHold) { fieldDrawn++; drawParticle(ctx, p, p.x, p.y, 0.93*alpha, 1, 1); }

        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) { p.x = 0; p.vx *= -1; }
        if (p.x > w) { p.x = w; p.vx *= -1; }
        if (p.y < 0) { p.y = 0; p.vy *= -1; }
        if (p.y > h) { p.y = h; p.vy *= -1; }
        if (!introHold) p.life++; else if (p.life < 1) p.life = 1;
    }
    // Remove dead particles
    particles = particles.filter(p => p.life > 0 && p.life < p.maxLife);

    // Refill for stable density and collision rate
    while (particles.length < PARTICLE_COUNT) spawnParticle();

    // Draw photons and explosions
    if (!introHold) {
        drawPhotons();
        drawExplosions();

        // Check for annihilations
        checkAnnihilations();
    }

    requestAnimationFrame(animate);
}
animate();




// ========================================================
// BLACK-HOLE INTRO (portfolio-motion-brief.md, "Papers"; spec alnilam-blackhole)
// Alnilam's colour collapses to a star -> black hole (shadow, photon ring, lensed
// background stars) -> Hawking evaporation (T ~ 1/M, so the quanta heat up as it
// shrinks) -> exposed singularity -> a bang whose cooling plasma condenses the
// particle field above, which then carries on exactly as before.
// Every frame is a pure function of t (no accumulated state), so skipping to the
// end is exact.
// ========================================================
(function () {
    "use strict";

    // ---- Timing (ms), tune here ----
    var TOTAL_MS = 5000;
    var STAR_MS = 350;            // arrival fill collapses to the star / first-mode point swells to it
    var IMPLODE_MS = 800;         // star contracts into the horizon; shadow, ring and lensing grow in
    var EVAP0_MS = 900;           // collapse -> evaporation
    var EVAP1_MS = 2600;          // evaporation -> singularity (and the final burst)
    var SING1_MS = 3000;          // singularity -> new universe
    var UNIV1_MS = 4300;          // new universe -> content
    var BANG_MS = 550;            // inflation of the plasma ball to cover the screen
    var COOL0_MS = 3000, COOL1_MS = 4100;   // plasma cools white -> gold -> amber -> deep red-brown -> dark
    var PLASMA_FADE0_MS = 3500;   // plasma dims from here to a faint residual (PLASMA_RESIDUAL) at UNIV1_MS ...
    var PLASMA_END_MS = 4700;     // ... and is gone here
    var PLASMA_RESIDUAL = 0.08;
    var BG_FADE0_MS = 3700;
    var SPRITE0_MS = 3350, SPRITE_STAGGER_MS = 300, SPRITE_FLY_MS = 620;
    var CONTENT_MS = 700;         // content fade-up length, ends at TOTAL_MS
    var REDUCED_FADE_MS = 150;
    var HUD_FADE_MS = 250;
    var HUD_WINDOWS = [[100, 1900], [1000, 2900], [2600, 3500], [3100, 4400]];   // collapse, evaporation, singularity, new universe

    // ---- Geometry and physics (stylised) ----
    var SHADOW_PER_RS = 2.6;      // shadow radius = photon ring radius = 2.6 r_s
    var STAR_R_PER_RS = 3.4;      // initial star radius in horizon radii
    var K0 = 2000;                // displayed Hawking temperature at full mass (K); T ~ 1/M
    var K_MAX = 20000;
    var N_QUANTA = 240, N_BURST = 80;
    var N_STARS = 340, N_STARS_NEAR = 210;
    var DPR_CAP = 2;
    var DEFAULT_STAR_RGB = [183, 201, 255];   // Alnilam, #B7C9FF
    var BG = "#04060b";

    var T = window.SiteTransition;
    var root = document.documentElement;
    var cv = document.getElementById("bh-fx");
    if (!cv) return;
    var g = cv.getContext("2d");
    var hud = Array.prototype.slice.call(document.querySelectorAll("#bh-hud .bh-tag"));

    var B = window.__bh = {
        mode: null, total: TOTAL_MS, t0: 0, done: false, phase: "", phases: [], samples: [],
        rH: 0, K: 0, rH0: 0, particleCount: PARTICLE_COUNT, fieldReleased: false
    };
    window.__field = { get drawn() { return fieldDrawn; }, get particles() { return particles; }, get width() { return w; }, get height() { return h; } };

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
    function easeInCubic(t) { return t * t * t; }
    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
    function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    function hash(n) { n = Math.sin(n * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); }
    function rng(seed) {
        var a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) >>> 0;
            var t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function rgba(c, a) { return "rgba(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + "," + (Math.round(a * 1000) / 1000) + ")"; }
    function mix(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
    function ramp(stops, x) {
        x = clamp(x, 0, 1);
        for (var i = 1; i < stops.length; i++) {
            if (x <= stops[i][0]) return mix(stops[i - 1][1], stops[i][1], (x - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
        }
        return stops[stops.length - 1][1];
    }

    // thermal colour: deep red -> orange -> white -> blue-white, keyed on log temperature
    var HAWK = [[0, [255, 62, 38]], [0.2, [255, 110, 56]], [0.38, [255, 178, 112]], [0.58, [255, 247, 238]], [0.78, [208, 224, 255]], [1, [160, 192, 255]]];
    var LOG_K_LO = Math.log(1500), LOG_K_HI = Math.log(16000);
    function hawkColor(K) { return ramp(HAWK, (Math.log(Math.max(K, 1500)) - LOG_K_LO) / (LOG_K_HI - LOG_K_LO)); }
    var PLASMA = [[0, [255, 252, 240]], [0.2, [255, 236, 170]], [0.4, [255, 196, 90]], [0.6, [230, 130, 40]], [0.8, [120, 40, 20]], [1, [14, 6, 5]]];

    // ---- layout (per resize) ----
    var vw = 0, vh = 0, d = 1, cx = 0, cy = 0, rH0 = 0, stars = [], noiseCv = null, playing = false;
    var quanta = [], sprites = [];

    function buildStars() {
        var r = rng(7), R0 = SHADOW_PER_RS * rH0, tints = [[190, 205, 255], [255, 244, 230], [255, 226, 190], [214, 228, 255]];
        stars = [];
        for (var i = 0; i < N_STARS + N_STARS_NEAR; i++) {
            var near = i >= N_STARS, x, y;
            if (near) {
                var ang = r() * 6.2832, rad = R0 * (1.12 + Math.pow(r(), 1.3) * 5.5);
                x = Math.cos(ang) * rad; y = Math.sin(ang) * rad;
            } else { x = (r() - 0.5) * vw * 1.04; y = (r() - 0.5) * vh * 1.04; }
            var b = Math.max(1, Math.hypot(x, y));
            var mag = Math.pow(r(), 3);
            stars.push({ x: x, y: y, b: b, ux: x / b, uy: y / b, s: 0.6 + mag * 1.3, a: (near ? 0.4 : 0.28) + mag * 0.58, c: tints[Math.floor(r() * tints.length)] });
        }
    }

    function buildQuanta() {
        var r = rng(11), D = EVAP1_MS - EVAP0_MS;
        quanta = [];
        for (var k = 0; k < N_QUANTA; k++) {
            var m = 1 - k / N_QUANTA;                       // M at emission: N(t) = N_tot (1 - M/M0)
            var tk = EVAP0_MS + D * (1 - m * m * m);        // M^3 ~ (t_end - t)
            quanta.push({ t0: tk, m: m, ang: r() * 6.2832, v: 0.45 + r() * 0.75, life: 0.55 + r() * 0.5, s: 0.7 + r() * 1.0,
                          spark: k % 5 === 0, rgb: hawkColor(Math.min(K_MAX, K0 / Math.max(m, 0.02))), burst: false, a: 0.5 + r() * 0.5 });
        }
        for (var j = 0; j < N_BURST; j++) {
            quanta.push({ t0: EVAP1_MS - 25 + r() * 30, m: 0, ang: r() * 6.2832, v: 2.4 + r() * 2.6, life: 0.28 + r() * 0.2, s: 0.9 + r() * 1.3,
                          spark: j % 2 === 0, rgb: mix([180, 205, 255], [255, 255, 255], r() * 0.7), burst: true, a: 0.7 + r() * 0.3 });
        }
    }

    // CMB-like anisotropy: fine, low-contrast mottles (cells ~1-3% of the viewport), warm and cool
    function buildNoise() {
        var nw = Math.min(800, Math.ceil(vw / 2)), nh = Math.min(500, Math.ceil(vh / 2));
        noiseCv = document.createElement("canvas");
        noiseCv.width = nw; noiseCv.height = nh;
        var n = noiseCv.getContext("2d"), img = n.createImageData(nw, nh), r = rng(23);
        function grid(gw, gh) { var a = new Float32Array(gw * gh); for (var i = 0; i < a.length; i++) a[i] = r() * 2 - 1; return { a: a, gw: gw, gh: gh }; }
        function sample(G, u, v) {
            var x = u * (G.gw - 1), y = v * (G.gh - 1), x0 = Math.floor(x), y0 = Math.floor(y);
            var x1 = Math.min(G.gw - 1, x0 + 1), y1 = Math.min(G.gh - 1, y0 + 1), fx = x - x0, fy = y - y0;
            fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
            var a = lerp(G.a[y0 * G.gw + x0], G.a[y0 * G.gw + x1], fx), b = lerp(G.a[y1 * G.gw + x0], G.a[y1 * G.gw + x1], fx);
            return lerp(a, b, fy);
        }
        var big = Math.max(vw, vh);
        function cells(frac) { return [Math.max(4, Math.round(vw / (frac * big))), Math.max(4, Math.round(vh / (frac * big)))]; }
        var c1 = cells(0.03), c2 = cells(0.015), c3 = cells(0.008);
        var g1 = grid(c1[0], c1[1]), g2 = grid(c2[0], c2[1]), g3 = grid(c3[0], c3[1]);
        for (var y = 0; y < nh; y++) for (var x = 0; x < nw; x++) {
            var u = x / (nw - 1), v = y / (nh - 1), q = (0.4 * sample(g1, u, v) + 0.4 * sample(g2, u, v) + 0.2 * sample(g3, u, v)) * 1.6;
            var i = (y * nw + x) * 4;
            if (q > 0) { img.data[i] = 255; img.data[i + 1] = 226; img.data[i + 2] = 160; img.data[i + 3] = Math.min(1, q) * 0.45 * 255; }
            else { img.data[i] = 120; img.data[i + 1] = 40; img.data[i + 2] = 20; img.data[i + 3] = Math.min(1, -q) * 0.45 * 255; }
        }
        n.putImageData(img, 0, 0);
    }

    function layout() {
        vw = window.innerWidth; vh = window.innerHeight;
        d = Math.min(window.devicePixelRatio || 1, DPR_CAP);
        cv.width = Math.round(vw * d); cv.height = Math.round(vh * d);
        cx = vw / 2; cy = vh / 2;
        rH0 = Math.min(vw, vh) * (vw < 600 ? 0.075 : 0.06);
        B.rH0 = rH0;
        buildStars(); buildQuanta(); buildNoise();
    }

    // ---- physical state as a function of time ----
    function massOf(t) { return t <= EVAP0_MS ? 1 : t >= EVAP1_MS ? 0 : Math.pow(1 - (t - EVAP0_MS) / (EVAP1_MS - EVAP0_MS), 1 / 3); }
    function horizonOf(t) {
        if (t < STAR_MS) return 0;
        if (t < IMPLODE_MS) return rH0 * easeOutCubic((t - STAR_MS) / (IMPLODE_MS - STAR_MS));
        return rH0 * massOf(t);
    }
    function tempOf(t) { return Math.min(K_MAX, K0 / Math.max(massOf(t), 0.01)); }
    function phaseOf(t) { return t < EVAP0_MS ? "collapse" : t < EVAP1_MS ? "evaporate" : t < SING1_MS ? "singularity" : t < UNIV1_MS ? "universe" : "content"; }

    // ---- drawing ----
    // Background stars, lensed: a point-mass lens with Einstein radius = the shadow radius R.
    // The primary image sits at (b + sqrt(b^2 + 4R^2)) / 2, stretched tangentially by theta/b.
    function drawStars(R, alpha) {
        if (alpha <= 0) return;
        for (var i = 0; i < stars.length; i++) {
            var s = stars[i], px = cx + s.x, py = cy + s.y, maj = s.s, mnr = s.s, ang = 0, a = s.a * alpha;
            if (R > 0.8) {
                var q = Math.sqrt(s.b * s.b + 4 * R * R), th = (s.b + q) / 2, k = th / s.b, rad = 0.5 * (1 + s.b / q);
                px = cx + s.ux * th; py = cy + s.uy * th;
                maj = s.s * Math.min(k, 9); mnr = s.s * Math.max(rad, 0.4);
                ang = Math.atan2(s.uy, s.ux) + Math.PI / 2;
                a *= Math.min(1.6, 0.7 + 0.3 * k * rad);
            }
            if (px < -12 || px > vw + 12 || py < -12 || py > vh + 12) continue;
            g.fillStyle = rgba(s.c, Math.min(1, a));
            g.beginPath();
            if (maj < 1.3 && mnr < 1.3) g.arc(px, py, Math.max(mnr, 0.5), 0, 6.2832);
            else g.ellipse(px, py, maj, mnr, ang, 0, 6.2832);
            g.fill();
        }
    }

    function glow(x, y, r0, r1, col, a) {
        if (a <= 0 || r1 <= 0) return;
        var gr = g.createRadialGradient(x, y, r0, x, y, r1);
        gr.addColorStop(0, rgba(col, a)); gr.addColorStop(1, rgba(col, 0));
        g.fillStyle = gr;
        g.beginPath(); g.arc(x, y, r1, 0, 6.2832); g.fill();
    }

    function drawQuanta(t) {
        var scale = Math.min(vw, vh) / 900 + 0.25;
        g.save();
        g.globalCompositeOperation = "lighter";
        for (var i = 0; i < quanta.length; i++) {
            var q = quanta[i], age = (t - q.t0) / 1000;
            if (age < 0 || age > q.life) continue;
            var f = age / q.life, r0 = q.burst ? 0 : SHADOW_PER_RS * rH0 * q.m * 1.04;
            var dist = r0 + q.v * 150 * scale * age, ca = Math.cos(q.ang), sa = Math.sin(q.ang);
            var x = cx + ca * dist, y = cy + sa * dist, al = Math.pow(1 - f, 1.5) * q.a;
            if (q.spark) {
                var tail = q.v * 150 * scale * 0.05;
                g.strokeStyle = rgba(q.rgb, al * 0.9); g.lineWidth = q.s * 0.9; g.lineCap = "round";
                g.beginPath(); g.moveTo(x, y); g.lineTo(x - ca * tail, y - sa * tail); g.stroke();
            } else {
                g.fillStyle = rgba(q.rgb, al);
                g.beginPath(); g.arc(x, y, q.s, 0, 6.2832); g.fill();
            }
        }
        g.restore();
    }

    function plasmaAlpha(t) {
        if (t < PLASMA_FADE0_MS) return 1;
        if (t < UNIV1_MS) return lerp(1, PLASMA_RESIDUAL, smooth(PLASMA_FADE0_MS, UNIV1_MS, t));
        return PLASMA_RESIDUAL * (1 - smooth(UNIV1_MS, PLASMA_END_MS, t));
    }

    function drawSpritesAndPlasma(t) {
        // plasma ball: white-hot core, a front that inflates fast then slows, cooling outward and over time
        var s = clamp((t - SING1_MS) / BANG_MS, 0, 1);
        var Rfull = Math.hypot(vw, vh) / 2 * 1.12;
        var Rp = Rfull * (1 - Math.pow(1 - s, 5)) * (1 + 0.3 * smooth(SING1_MS, PLASMA_END_MS, t));
        var pA = plasmaAlpha(t);
        if (t >= SING1_MS && Rp > 0.5 && pA > 0) {
            var u2 = clamp((t - COOL0_MS) / (COOL1_MS - COOL0_MS), 0, 1);
            var Rg = Math.max(Rp, 3);
            if (s < 1) glow(cx, cy, 0, Rg * 1.4 + 30, [255, 244, 225], 0.45 * (1 - s) * pA);
            var gr = g.createRadialGradient(cx, cy, 0, cx, cy, Rg);
            var stops = [0, 0.2, 0.45, 0.7, 0.92];
            for (var k = 0; k < stops.length; k++) gr.addColorStop(stops[k], rgba(ramp(PLASMA, u2 + stops[k] * 0.5), pA));
            gr.addColorStop(1, rgba(ramp(PLASMA, u2 + 0.55), 0));
            g.fillStyle = gr;
            g.beginPath(); g.arc(cx, cy, Rg, 0, 6.2832); g.fill();
            // expanding front
            if (s < 1) {
                g.strokeStyle = rgba([255, 240, 205], 0.55 * (1 - s) * pA); g.lineWidth = 2 + 6 * (1 - s);
                g.beginPath(); g.arc(cx, cy, Rg * 0.985, 0, 6.2832); g.stroke();
            }
            // fine anisotropy speckle, stronger as it cools
            var amp = (0.4 - 0.15 * u2) * pA * smooth(0.05, 0.35, s);
            if (amp > 0.01 && noiseCv) {
                var sc = 1 + 0.25 * easeOutCubic(clamp((t - SING1_MS) / (PLASMA_END_MS - SING1_MS), 0, 1));
                g.save();
                g.beginPath(); g.arc(cx, cy, Rg * 0.96, 0, 6.2832); g.clip();
                g.globalAlpha = Math.min(1, amp);
                g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
                g.drawImage(noiseCv, cx - vw * sc / 2, cy - vh * sc / 2, vw * sc, vh * sc);
                g.restore();
            }
        }
        // field particles condensing out of the plasma, flying to their live drift positions
        B.spritesDrawn = 0;
        if (t >= SPRITE0_MS && t < UNIV1_MS) {
            for (var i = 0; i < particles.length; i++) {
                var p = particles[i], sp = sprites[i];
                if (!sp || t < sp.t0) continue;
                var f = clamp((t - sp.t0) / SPRITE_FLY_MS, 0, 1);
                var e = easeOutCubic(f), x = lerp(sp.x, p.x, e), y = lerp(sp.y, p.y, e), fa = smooth(0, 0.35, f);
                B.spritesDrawn++;
                drawParticle(g, p, x, y, 0.93 * fa, 0.35 + 0.65 * smooth(0, 0.5, f), fa);
            }
        }
    }

    function buildSprites() {
        var r = rng(31);
        sprites = [];
        for (var i = 0; i < particles.length; i++) {
            var ang = r() * 6.2832, rad = r() * 0.07 * Math.min(vw, vh);
            sprites.push({ x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad, t0: SPRITE0_MS + r() * SPRITE_STAGGER_MS });
        }
    }

    function frame(t, startRgb, arrivalRgb, isArrival) {
        var phase = phaseOf(t), final = t >= TOTAL_MS;
        if (B.phase !== phase) { B.phase = phase; B.phases.push({ name: phase, t: Math.round(t) }); }
        var rH = horizonOf(t), K = tempOf(t);
        B.rH = rH; B.K = K;
        if (B.samples.length < 800) B.samples.push({ t: Math.round(t * 10) / 10, p: phase, rH: rH, K: K });

        // content and HUD
        root.style.setProperty("--bh-content", smooth(UNIV1_MS, UNIV1_MS + CONTENT_MS, t).toFixed(4));
        for (var h2 = 0; h2 < hud.length; h2++) {
            var win = HUD_WINDOWS[h2];
            hud[h2].style.opacity = final ? "0" : Math.min(smooth(win[0], win[0] + HUD_FADE_MS, t), 1 - smooth(win[1] - HUD_FADE_MS, win[1], t)).toFixed(3);
        }
        if (t >= UNIV1_MS) releaseField();

        g.setTransform(d, 0, 0, d, 0, 0);
        g.clearRect(0, 0, vw, vh);
        root.classList.remove("arriving");      // the canvas draws the fill from here on
        if (t >= UNIV1_MS) { B.spritesDrawn = 0; if (t < PLASMA_END_MS) drawSpritesAndPlasma(t); return; }

        g.globalAlpha = 1 - smooth(BG_FADE0_MS, UNIV1_MS, t); g.fillStyle = BG; g.fillRect(0, 0, vw, vh); g.globalAlpha = 1;

        var R = SHADOW_PER_RS * rH;
        var c = clamp((t - STAR_MS) / (IMPLODE_MS - STAR_MS), 0, 1);
        var m = massOf(t), hot = t >= EVAP0_MS ? 1 - m : 0;
        drawStars(R, isArrival ? 1 : smooth(0, 220, t));

        if (rH > 0.5) {
            var ringRgb = mix([255, 246, 232], hawkColor(K), 0.35 * hot);
            var ringA = smooth(0.45, 1, c);
            // haze just outside the ring, a little thermal glow as it evaporates
            glow(cx, cy, R * 0.95, R * 2.3, ringRgb, (0.1 + 0.22 * hot * hot) * ringA);
            // brief faint accretion light: an equatorial streak, cut by the shadow
            var acc = smooth(600, 850, t) * (1 - smooth(900, 1700, t)) * 0.38;
            if (acc > 0.005) {
                g.save();
                g.globalCompositeOperation = "lighter";
                g.translate(cx, cy); g.scale(1, 0.09);
                var ag = g.createRadialGradient(0, 0, 0, 0, 0, R * 3.4);
                ag.addColorStop(0, rgba([255, 220, 170], acc)); ag.addColorStop(0.45, rgba([255, 150, 84], acc * 0.45)); ag.addColorStop(1, rgba([255, 120, 60], 0));
                g.fillStyle = ag; g.beginPath(); g.arc(0, 0, R * 3.4, 0, 6.2832); g.fill();
                g.restore();
            }
            // shadow
            var sg = g.createRadialGradient(cx, cy, 0, cx, cy, R * 1.02);
            sg.addColorStop(0, "#000"); sg.addColorStop(0.94, "#000"); sg.addColorStop(1, "rgba(0,0,0,0)");
            g.fillStyle = sg; g.beginPath(); g.arc(cx, cy, R * 1.02, 0, 6.2832); g.fill();
            // photon ring: thin and bright, with a soft bloom and a brighter limb on one side
            g.save();
            g.lineCap = "round";
            g.strokeStyle = rgba(ringRgb, 0.10 * ringA); g.lineWidth = 0.14 * R; g.beginPath(); g.arc(cx, cy, R, 0, 6.2832); g.stroke();
            g.strokeStyle = rgba(ringRgb, 0.2 * ringA); g.lineWidth = 0.06 * R; g.beginPath(); g.arc(cx, cy, R, 0, 6.2832); g.stroke();
            g.strokeStyle = rgba(ringRgb, 0.8 * ringA); g.lineWidth = Math.max(1.1, 0.026 * R); g.beginPath(); g.arc(cx, cy, R, 0, 6.2832); g.stroke();
            g.strokeStyle = rgba([255, 255, 255], 0.9 * ringA); g.lineWidth = Math.max(1.2, 0.034 * R); g.beginPath(); g.arc(cx, cy, R, 2.3, 3.9); g.stroke();
            g.restore();
        }

        if (t >= EVAP0_MS && t < EVAP1_MS + 600) drawQuanta(t);

        // the star: arrival fill collapses to it, or (first mode) a point swells to it; then it implodes and reddens
        var rStar0 = STAR_R_PER_RS * rH0;
        if (t < IMPLODE_MS) {
            var f1 = clamp(t / STAR_MS, 0, 1), rStar, col, lum;
            if (t < STAR_MS) rStar = isArrival ? rStar0 : lerp(1.5, rStar0, easeInOut(f1));
            else rStar = lerp(rStar0, rH0, easeInCubic(c));
            col = mix(startRgb, [255, 86, 40], easeInCubic(c));      // gravitational redshift
            lum = 1 - Math.pow(c, 2.2);
            if (isArrival && t < STAR_MS) {
                var Rf = lerp(Math.hypot(vw, vh) / 2 + 2, rStar0, easeInOut(f1));
                var fg2 = g.createRadialGradient(cx, cy, 0, cx, cy, Rf);
                fg2.addColorStop(0, rgba(mix(arrivalRgb, [255, 255, 255], easeInOut(f1) * 0.6), 1));
                fg2.addColorStop(Math.max(0.01, 1 - Math.min(0.06 * Rf, 24) / Rf), rgba(arrivalRgb, 1));
                fg2.addColorStop(1, rgba(arrivalRgb, 0));
                g.fillStyle = fg2; g.beginPath(); g.arc(cx, cy, Rf, 0, 6.2832); g.fill();
                glow(cx, cy, 0, rStar0 * 2.4, startRgb, 0.5 * easeInOut(f1));
            } else {
                glow(cx, cy, rStar * 0.6, rStar * 2.4 + 6, col, 0.55 * lum);
                var bg2 = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rStar, 1));
                bg2.addColorStop(0, rgba(mix(col, [255, 255, 255], 0.75 * lum), lum));
                bg2.addColorStop(0.7, rgba(col, lum));
                bg2.addColorStop(1, rgba(mix(col, [20, 10, 20], 0.5), lum * 0.8));
                g.fillStyle = bg2; g.beginPath(); g.arc(cx, cy, Math.max(rStar, 1), 0, 6.2832); g.fill();
            }
        }

        // the burst that ends the evaporation, then the lone flickering point
        if (t >= EVAP1_MS - 40 && t < SING1_MS + 120) {
            var sA = smooth(EVAP1_MS - 40, EVAP1_MS + 40, t) * (1 - smooth(SING1_MS, SING1_MS + 120, t));
            var fl = hash(Math.floor(t / 42)), flick = fl > 0.86 ? 0.12 : 0.55 + 0.45 * hash(Math.floor(t / 42) + 9);
            glow(cx, cy, 0, 40 + 20 * flick, [215, 228, 255], 0.55 * flick * sA);
            g.fillStyle = rgba([255, 255, 255], Math.min(1, flick * 1.4) * sA);
            g.beginPath(); g.arc(cx, cy, 1.5 + 1.4 * flick, 0, 6.2832); g.fill();
        }
        if (t >= EVAP1_MS - 30 && t < EVAP1_MS + 420) {
            var bs = clamp((t - EVAP1_MS) / 400, 0, 1), sq = Math.min(vw, vh);
            glow(cx, cy, 0, 0.5 * sq * (0.3 + 0.7 * easeOutCubic(bs)), [190, 212, 255], 0.5 * Math.pow(1 - bs, 2) * smooth(EVAP1_MS - 30, EVAP1_MS + 10, t));
            if (bs > 0) {
                g.strokeStyle = rgba([210, 228, 255], 0.7 * Math.pow(1 - bs, 2)); g.lineWidth = 1 + 2.5 * (1 - bs);
                g.beginPath(); g.arc(cx, cy, 0.03 * sq + easeOutCubic(bs) * 0.3 * sq, 0, 6.2832); g.stroke();
            }
        }

        drawSpritesAndPlasma(t);
    }

    // hand the particles back to the field; idempotent
    function releaseField() {
        if (B.fieldReleased) return;
        B.fieldReleased = true;
        introHold = false;
        for (var i = 0; i < particles.length; i++) particles[i].life = Math.max(particles[i].life, 45);
    }

    function finishIntro() {
        root.classList.remove("arriving", "bh-cover");
        root.style.removeProperty("--arrival-op");
        root.style.removeProperty("--bh-content");
        hud.forEach(function (e) { e.style.opacity = ""; });
        releaseField();
        cv.width = 1; cv.height = 1;
        playing = false;
        B.done = true;
    }

    // mode: 'arrival' | 'first' | 'skip'; arrival: {star, rgb, starRgb, ts} or null
    function playIntro(mode, arrival) {
        B.mode = mode;
        B.done = false;
        if (mode === "skip" || !T) { B.total = 0; finishIntro(); return; }
        T.markSeen("papers");
        if (T.reducedMotion()) {
            // reduced motion: at most a short fade of the arrival fill; the field runs as it always has
            B.total = REDUCED_FADE_MS;
            T.run(REDUCED_FADE_MS, function (t) { root.style.setProperty("--arrival-op", String(1 - clamp(t / REDUCED_FADE_MS, 0, 1))); }, finishIntro);
            return;
        }
        var isArrival = mode === "arrival";
        var starRgb = (arrival && arrival.starRgb) || DEFAULT_STAR_RGB;
        var arrRgb = (arrival && arrival.rgb) || starRgb;
        B.total = TOTAL_MS;
        playing = true;
        introHold = true;
        B.fieldReleased = false;
        for (var i = 0; i < particles.length; i++) particles[i].life = 1;
        layout();
        buildSprites();
        B.renderAt = function (t) { frame(t, starRgb, arrRgb, isArrival); };   // test hook: draw one frame at t ms
        B.t0 = performance.now();
        var off = null;
        var handle = T.run(TOTAL_MS, function (t) { frame(t, starRgb, arrRgb, isArrival); }, function () {
            if (off) off();
            finishIntro();
        });
        off = T.wireSkip(function () { handle.finish(); });
    }
    window.playIntro = playIntro;

    var resizeTimer = 0;
    window.addEventListener("resize", function () {
        if (!playing) return;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () { layout(); buildSprites(); }, 60);
    });

    playIntro(T ? T.getMode("papers") : "skip", window.__arrival || null);
}());
