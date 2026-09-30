// Papers list rendering lives inline in papers.html (single renderer with a
// graceful empty state). This file draws the particle background and the
// spectrograph intro / header band (bottom of file).

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

function animate() {
    ctx.clearRect(0,0,w,h);
    // Fade trails for smooth effect
    ctx.globalAlpha = 0.11;
    ctx.fillStyle = "#191631";
    ctx.fillRect(0,0,w,h);
    ctx.globalAlpha = 1.0;

    // Animate and draw particles
    for (let p of particles) {
        let alpha = Math.min(1, Math.min(p.life/45, (p.maxLife-p.life)/45));
        ctx.save();
        ctx.globalAlpha = 0.93*alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 2*Math.PI);
        ctx.fillStyle = p.flavor.isAnti ? "#fff" : p.flavor.color;
        ctx.shadowColor = p.flavor.isAnti ? "#fff" : p.flavor.color;
        ctx.shadowBlur = p.flavor.isAnti ? 16 : 11;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.font = "bold 18px serif";
        ctx.fillStyle = p.flavor.isAnti ? "#f43" : "#fff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(p.flavor.label, p.x, p.y);
        ctx.restore();

        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) { p.x = 0; p.vx *= -1; }
        if (p.x > w) { p.x = w; p.vx *= -1; }
        if (p.y < 0) { p.y = 0; p.vy *= -1; }
        if (p.y > h) { p.y = h; p.vy *= -1; }
        p.life++;
    }
    // Remove dead particles
    particles = particles.filter(p => p.life > 0 && p.life < p.maxLife);

    // Refill for stable density and collision rate
    while (particles.length < PARTICLE_COUNT) spawnParticle();

    // Draw photons and explosions
    drawPhotons();
    drawExplosions();

    // Check for annihilations
    checkAnnihilations();

    requestAnimationFrame(animate);
}
animate();


// ========================================================
// SPECTROGRAPH INTRO + HEADER BAND (portfolio-motion-brief.md, "Papers")
// A point of light enters a vertical slit, disperses into a spectrum band, and
// the band settles at the top of the page with Alnilam's absorption lines.
// One line per paper, in order; extra lines stay decorative.
// ========================================================
(function () {
    "use strict";

    // ---- Timing (ms) and geometry, tune here ----
    var INTRO = {
        arrival: { total: 2400, collapse0: 0, collapse1: 500, slit0: 400, slit1: 800, disp0: 800, disp1: 1500,
                   lines0: 1400, lineStep: 90, lineFade: 250, settle0: 1700, settle1: 2400 },
        first:   { total: 3800, dotIn: 400, slit0: 400, slit1: 1000, disp0: 1000, disp1: 2000,
                   lines0: 1900, lineStep: 110, lineFade: 300, settle0: 2600, settle1: 3800 }
    };
    var REDUCED_FADE_MS = 150;
    var DROP_STEP_MS = 120;          // stagger between paper cards dropping from their lines
    var NM_MIN = 400, NM_MAX = 680;  // linear wavelength axis across the band
    var BAND_H = 10;                 // idle header band height (px)
    var BAND_INTRO_H = 56;           // band height while it is being dispersed
    var SLIT_X_PX = 8;               // slit x: at the band's 400 nm end, so nothing disperses left of it (matches --slit-x in papers.html)
    var SLIT_H_FRAC = 0.44;          // slit length as a fraction of viewport height
    var SLIT_PLATE_W = 26, SLIT_GAP_W = 3, DOT_R = 4;
    var LINE_ALPHA = 0.55, LINE_ALPHA_HOVER = 0.95;
    var DPR_CAP = 2;
    var DEFAULT_STAR_RGB = [176, 196, 255];   // Alnilam, blue-white

    var LINES = [
        { name: "Hδ", nm: 410.2 },
        { name: "Hγ", nm: 434.0 },
        { name: "He I",    nm: 447.1 },
        { name: "Hβ", nm: 486.1 },
        { name: "He I",    nm: 587.6 },
        { name: "Hα", nm: 656.3 }
    ];

    var T = window.SiteTransition;
    var root = document.documentElement;
    var band = document.getElementById("spectrum");
    var fx = document.getElementById("spectrum-fx");
    if (!band || !fx) return;
    var bg = band.getContext("2d");
    var fg = fx.getContext("2d");

    var S = window.__spectrum = {
        nmMin: NM_MIN, nmMax: NM_MAX, width: 0, bandHeight: BAND_H,
        lines: LINES.map(function (l) { return { name: l.name, nm: l.nm, x: 0, card: null }; }),
        hover: -1, cards: [], mode: null, done: false, t0: 0, total: 0,
        slitX: SLIT_X_PX, bandY: 0, bandH: 0, dispersing: false   // intro state, for tests
    };

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    function dpr() { return Math.min(window.devicePixelRatio || 1, DPR_CAP); }
    function setVar(k, v) { root.style.setProperty(k, v); }

    // visible-spectrum colour for a wavelength (Bruton), dimmed at the ends of the axis
    function nmRgb(nm) {
        var r = 0, g = 0, b = 0;
        if (nm < 440) { r = (440 - nm) / 40; b = 1; }
        else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
        else if (nm < 510) { g = 1; b = (510 - nm) / 20; }
        else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
        else if (nm < 645) { r = 1; g = (645 - nm) / 65; }
        else { r = 1; }
        var f = nm < 420 ? 0.35 + 0.65 * (nm - NM_MIN) / 20 : nm > 645 ? 0.35 + 0.65 * (NM_MAX - nm) / 35 : 1;
        f *= 0.8 * 255;
        return "rgb(" + Math.round(f * Math.pow(r, 0.8)) + "," + Math.round(f * Math.pow(g, 0.8)) + "," + Math.round(f * Math.pow(b, 0.8)) + ")";
    }
    var specStops = [];
    for (var nm = NM_MIN; nm <= NM_MAX; nm += 10) specStops.push([(nm - NM_MIN) / (NM_MAX - NM_MIN), nmRgb(nm)]);

    // ---- layout ----
    function layout() {
        var W = band.clientWidth || window.innerWidth;
        S.width = W;
        for (var i = 0; i < S.lines.length; i++) S.lines[i].x = (S.lines[i].nm - NM_MIN) / (NM_MAX - NM_MIN) * W;
        var d = dpr();
        band.width = Math.round(W * d);
        band.height = Math.round(BAND_H * d);
        fx.width = Math.round(window.innerWidth * d);
        fx.height = Math.round(window.innerHeight * d);
    }

    // The spectrum with its absorption lines at (0,y), W wide, h tall.
    // reveal(i) -> 0..1 per-line strength; clipL/clipR limit the dispersed span.
    function drawBand(g, y, h, W, reveal, clipL, clipR) {
        g.save();
        if (clipL !== undefined) { g.beginPath(); g.rect(clipL, y - 1, Math.max(0, clipR - clipL), h + 2); g.clip(); }
        var grad = g.createLinearGradient(0, 0, W, 0);
        for (var k = 0; k < specStops.length; k++) grad.addColorStop(specStops[k][0], specStops[k][1]);
        g.fillStyle = grad;
        g.fillRect(0, y, W, h);
        for (var i = 0; i < S.lines.length; i++) {
            var r = reveal(i);
            if (r <= 0) continue;
            var hov = S.hover === i;
            var a = (hov ? LINE_ALPHA_HOVER : LINE_ALPHA) * r;
            var cw = hov ? 3 : 2;
            var x = S.lines[i].x;
            g.fillStyle = "rgba(7,10,16," + (a * 0.25) + ")";
            g.fillRect(x - cw * 1.5, y, cw * 3, h);
            g.fillStyle = "rgba(7,10,16," + a + ")";
            g.fillRect(x - cw / 2, y, cw, h);
        }
        g.restore();
    }

    function drawIdle() {
        var d = dpr();
        bg.setTransform(d, 0, 0, d, 0, 0);
        bg.clearRect(0, 0, S.width, BAND_H);
        drawBand(bg, 0, BAND_H, S.width, function () { return 1; });
    }

    // ---- intro frame ----
    function frame(t, cfg, arrival, starRgb) {
        var vw = window.innerWidth, vh = window.innerHeight, d = dpr();
        var cy = vh / 2, half = vh * SLIT_H_FRAC / 2;
        var star = "rgb(" + starRgb.join(",") + ")";
        fg.setTransform(d, 0, 0, d, 0, 0);
        fg.clearRect(0, 0, vw, vh);

        var set = ease(clamp((t - cfg.settle0) / (cfg.settle1 - cfg.settle0), 0, 1));
        setVar("--spec-veil", set >= 1 ? 0 : 1 - set);
        if (arrival) {
            var c = clamp((t - cfg.collapse0) / (cfg.collapse1 - cfg.collapse0), 0, 1);
            setVar("--arrival-s", Math.max(0.0001, 1 - ease(c)));
            setVar("--arrival-op", c >= 1 ? 0 : 1);
        }
        var dotA = arrival ? 1 : clamp(t / cfg.dotIn, 0, 1);
        var u = ease(clamp((t - cfg.slit0) / (cfg.slit1 - cfg.slit0), 0, 1));
        var slitA = 1 - set;
        var slitX = lerp(SLIT_X_PX, 0, set);   // the slit slides onto the band's 400 nm end as it settles
        S.slitX = slitX;
        S.dispersing = false;

        // slit plates and the stretched point of light
        if (slitA > 0) {
            var hh = lerp(DOT_R, half, u);
            fg.globalAlpha = slitA * u;
            fg.fillStyle = "#11162a";
            fg.fillRect(slitX - SLIT_GAP_W / 2 - SLIT_PLATE_W, cy - half, SLIT_PLATE_W, half * 2);
            fg.fillRect(slitX + SLIT_GAP_W / 2, cy - half, SLIT_PLATE_W, half * 2);
            fg.globalAlpha = slitA * dotA;
            fg.fillStyle = star;
            fg.shadowColor = star;
            fg.shadowBlur = 16;
            fg.fillRect(slitX - SLIT_GAP_W / 2, cy - hh, SLIT_GAP_W, hh * 2);
            fg.shadowBlur = 0;
            fg.fillStyle = "#ffffff";
            fg.fillRect(slitX - SLIT_GAP_W / 2 + 0.5, cy - hh * 0.6, SLIT_GAP_W - 1, hh * 1.2);
            fg.globalAlpha = 1;
        }

        // dispersion: the spectrum emerges from the slit and fans out to the right only, then rises to the top edge
        var p = ease(clamp((t - cfg.disp0) / (cfg.disp1 - cfg.disp0), 0, 1));
        if (p > 0) {
            var bh = lerp(BAND_INTRO_H, BAND_H, set);
            var by = lerp(cy - BAND_INTRO_H / 2, 0, set);
            S.dispersing = true; S.bandY = by; S.bandH = bh;
            drawBand(fg, by, bh, S.width || vw, function (i) {
                return clamp((t - cfg.lines0 - i * cfg.lineStep) / cfg.lineFade, 0, 1);
            }, slitX, slitX + p * (vw - slitX));
        }
    }

    // ---- paper cards: line i <-> paper i ----
    function setHover(i) {
        if (S.hover === i) return;
        S.hover = i;
        S.cards.forEach(function (c, k) { if (c) c.classList.toggle("is-linked", k === i); });
        drawIdle();
    }

    function attachCards() {
        var nodes = document.querySelectorAll("#papers-list .paper-card[data-paper]");
        var cfg = INTRO[S.mode] || INTRO.first;
        Array.prototype.forEach.call(nodes, function (card, i) {
            if (i >= S.lines.length || card.hasAttribute("data-line")) return;   // extras stay decorative
            card.setAttribute("data-line", i);
            S.lines[i].card = card;
            S.cards[i] = card;
            card.addEventListener("mouseenter", function () { setHover(i); });
            card.addEventListener("mouseleave", function () { setHover(-1); });
            card.addEventListener("focusin", function () { setHover(i); });
            card.addEventListener("focusout", function () { setHover(-1); });
            if (S.mode !== "skip" && !(T && T.reducedMotion())) {
                // drop out of the line as it appears (or shortly after, if the data arrives late)
                var elapsed = S.done ? 0 : performance.now() - S.t0;
                var delay = S.done ? i * DROP_STEP_MS : Math.max(0, cfg.lines0 + i * cfg.lineStep - elapsed);
                card.style.setProperty("--drop-delay", Math.round(delay) + "ms");
                card.classList.add("dropping");
                card.addEventListener("animationend", function () { card.classList.remove("dropping"); }, { once: true });
            }
        });
    }
    window.addEventListener("papers:rendered", attachCards);

    // ---- intro control ----
    function finishIntro() {
        root.classList.remove("arriving", "spec-cover");
        ["--arrival-s", "--arrival-op", "--spec-veil"].forEach(function (k) { root.style.removeProperty(k); });
        fg.setTransform(1, 0, 0, 1, 0, 0);
        fg.clearRect(0, 0, fx.width, fx.height);
        drawIdle();
        S.done = true;
    }

    // mode: 'arrival' | 'first' | 'skip'; arrival: {star, rgb, starRgb, ts} or null
    function playIntro(mode, arrival) {
        S.mode = mode;
        S.done = false;
        if (mode === "skip" || !T) { finishIntro(); return; }
        T.markSeen("papers");
        if (T.reducedMotion()) {
            // reduced motion: at most a short fade of the arrival fill
            S.total = REDUCED_FADE_MS;
            T.run(REDUCED_FADE_MS, function (t) { setVar("--arrival-op", 1 - clamp(t / REDUCED_FADE_MS, 0, 1)); }, finishIntro);
            return;
        }
        var isArrival = mode === "arrival";
        var cfg = isArrival ? INTRO.arrival : INTRO.first;
        var starRgb = (arrival && arrival.starRgb) || DEFAULT_STAR_RGB;
        S.total = cfg.total;
        S.t0 = performance.now();
        var off = null;
        var handle = T.run(cfg.total, function (t) { frame(t, cfg, isArrival, starRgb); }, function () {
            if (off) off();
            finishIntro();
        });
        off = T.wireSkip(function () { handle.finish(); });
    }
    window.playIntro = playIntro;

    var resizeTimer = 0;
    window.addEventListener("resize", function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () { layout(); drawIdle(); }, 60);
    });

    layout();
    drawIdle();
    playIntro(T ? T.getMode("papers") : "skip", window.__arrival || null);
    // cards that rendered before this script ran
    if (document.querySelector("#papers-list .paper-card[data-paper]")) attachCards();
}());
