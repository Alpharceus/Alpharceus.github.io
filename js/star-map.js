// ========================================================
// STAR MAP — Telescope → Orion intro, drawn from the real sky
//
// Sky data lives in js/orion-sky.js (window.ORION_SKY): Hipparcos-derived
// stars to V≈7.3 on a gnomonic projection centred on Orion, in degrees.
// Star size follows apparent magnitude, colour follows B−V, and every
// layer (background, figure, M42) shares one projection, so the figure
// keeps its true proportions on any screen.
// ========================================================

// ---- State Machine ----
let introState = "telescope"; // "telescope" | "zoom" | "draw" | "idle"
let introTimer = 0;
let introStartTime = 0;
let introSkipped = false;

// ---- Timing (ms) ----
const TELESCOPE_DURATION = 3000;
const ZOOM_DURATION = 2200;
const DRAW_DURATION = 3000;
const CTA_TYPING_SPEED = 55;

// ---- Star dive (timings live in js/transition.js) ----
const DIVE_TARGETS = [null, "projects.html", "papers.html", "skills.html", "blogs.html", "now/", "rigel.html"];
const DIVE_STREAK_ALPHA = 0.9;   // peak opacity of the radial streaks

// ---- Projection ----
const SKY = window.ORION_SKY;
const FIG_CENTER = { x: 0.02, y: 0.13 };   // middle of the seven-star figure, degrees
const FIG_W = 10.3, FIG_H = 17.3;          // figure extent, degrees
const TELESCOPE_SCALE = 0.45;              // eyepiece view: wide field, Orion small
let ppd = 30;                               // pixels per degree at the final view
let sizeK = 1;                              // figure-star size factor for small screens

// ---- Layers ----
let bgStars = [];      // faint stars, baked into skyLayer
let liveStars = [];    // brighter stars, drawn per frame with twinkle
let skyLayer = null;
let nebulaSprite = null;

// ---- Stars & Orion ----
let shootingStars = [];
let dustParticles = [];
let hoveredStar = null;
let orionStarScreenPos = [];
let drawProgress = 0;
let starIgnitions = [];
let ctaText = "Click Betelgeuse to begin ✦";
let ctaStartTime = 0;
let ctaVisible = false;
let ctaDismissed = false;
let betelgeuseOrbitAngle = 0;

// ---- Telescope vignette ----
let vignetteRadius = 0;
let vignetteTargetRadius = 0;
let lensFlareAngle = 0;

// ---- Zoom warp ----
let warpStars = [];

// page = where the star leads; label side keeps belt labels off each other and off the lines
const orionStars = [
    { name: "Betelgeuse", info: "Red supergiant, Alpha Orionis", page: "Terminal", desc: "Interactive terminal", side: "left" },
    { name: "Bellatrix", info: "Blue giant, Gamma Orionis", page: "Projects", desc: "Research and engineering projects", side: "right" },
    { name: "Alnilam", info: "Blue supergiant, Epsilon Orionis", page: "Papers", desc: "Journal publications", side: "below" },
    { name: "Mintaka", info: "Blue giant, Delta Orionis", page: "Skills", desc: "Skills, routed through an MZI mesh", side: "right" },
    { name: "Alnitak", info: "Blue supergiant, Zeta Orionis", page: "Blog", desc: "Essays on physics, computing, and AI", side: "left" },
    { name: "Saiph", info: "Blue supergiant, Kappa Orionis", page: "Now", desc: "What I'm working on this quarter", side: "left" },
    { name: "Rigel", info: "Blue supergiant, Beta Orionis", page: "Rigel", desc: "Quantum circuit simulator", side: "right" }
];
orionStars.forEach(function (s) {
    const d = SKY.main[s.name];
    s.x = d[0]; s.y = d[1]; s.mag = d[2]; s.bv = d[3];
    s.col = bvToRGB(s.bv, 0.12);
});

const orionLines = [
    [0, 4], [1, 3], [0, 1], [2, 3], [2, 4], [4, 5], [3, 6], [5, 6]
];

// ========== COLOUR & SIZE ==========

// B−V → blackbody temperature (Ballesteros 2012) → RGB (Helland's fit),
// then mixed toward white: the eye sees star colour faintly.
function bvToRGB(bv, whiteMix) {
    bv = Math.max(-0.4, Math.min(2.0, bv));
    const T = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
    const t = T / 100;
    let r, g, b;
    if (t <= 66) {
        r = 255;
        g = 99.4708025861 * Math.log(t) - 161.1195681661;
        b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    } else {
        r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
        g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
        b = 255;
    }
    const w = whiteMix === undefined ? 0.3 : whiteMix;
    return [r, g, b].map(function (v) {
        v = Math.max(0, Math.min(255, v));
        return Math.round(v * (1 - w) + 255 * w);
    });
}

function rgba(c, a) {
    return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + Math.max(0, Math.min(1, a)).toFixed(3) + ")";
}

// background point radius (px) and opacity from V magnitude
function pointRadius(m) { return Math.max(0.55, Math.min(3.4, 3.0 * Math.pow(10, -0.2 * (m - 1)) + 0.45)); }
function pointAlpha(m) { return Math.min(1, 0.26 + 0.74 * Math.pow(10, -0.2 * (m - 4))); }

// figure-star core diameter (px): radius ∝ √flux ∝ 10^(−0.2 m)
function coreD(i) {
    return (10 + 11 * Math.pow(10, -0.2 * (orionStars[i].mag - 0.2))) * sizeK;
}

// ========== PROJECTION ==========
function computeScale() {
    ppd = Math.min(height * 0.70 / FIG_H, (width - 160) / FIG_W, width * 0.62 / FIG_W);
    sizeK = constrain(ppd / 36, 0.7, 1.2);
}

function toScreen(x, y, view) {
    return {
        x: width / 2 + (x - view.cx) * ppd * view.s,
        y: height / 2 + (y - view.cy) * ppd * view.s
    };
}

const FINAL_VIEW = { s: 1, cx: FIG_CENTER.x, cy: FIG_CENTER.y };

// ========== SETUP ==========
function setup() {
    let canvas = createCanvas(window.innerWidth, window.innerHeight);
    canvas.position(0, 0);
    canvas.style('z-index', '100');
    canvas.style('position', 'fixed');
    frameRate(60);
    computeScale();

    introStartTime = millis();

    // Safety net: reveal nav/footer even if the intro stalls (e.g. tab
    // backgrounded mid-animation) — full intro runs ~8.2s
    setTimeout(function () { document.body.classList.add('intro-done'); }, 9000);

    // Split the catalogue: faint stars get baked once, brighter ones twinkle live
    const bg = SKY.bg;
    for (let i = 0; i < bg.length; i += 4) {
        const m = bg[i + 2];
        const s = {
            x: bg[i], y: bg[i + 1], m: m,
            r: pointRadius(m), a: pointAlpha(m),
            col: bvToRGB(bg[i + 3], 0.35),
            seed: Math.random() * 1000,
            speed: 0.0012 + Math.random() * 0.0018
        };
        (m < 4.6 ? liveStars : bgStars).push(s);
    }
    liveStars.sort(function (a, b) { return b.m - a.m; }); // faint first, bright on top

    buildNebulaSprite();
    buildSkyLayer();

    // Check for returning visitor; respect OS reduced-motion preference
    if (sessionStorage.getItem('introPlayed') ||
        (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
        skipIntro();
    }

    // Warp stars for zoom effect
    for (let i = 0; i < 150; i++) {
        warpStars.push({
            angle: random(TWO_PI),
            dist: random(0.01, 0.5),
            speed: random(0.3, 1.2),
            size: random(1, 3),
            alpha: random(100, 255)
        });
    }

    // Cosmic dust particles
    for (let i = 0; i < 60; i++) {
        dustParticles.push({
            x: random(width),
            y: random(height),
            size: random(0.5, 2.5),
            alpha: random(15, 50),
            vx: random(-0.15, 0.15),
            vy: random(-0.1, 0.1),
            noiseSeed: random(10000)
        });
    }

    // Star ignition state
    for (let i = 0; i < orionStars.length; i++) {
        starIgnitions.push({ ignited: false, igniteTime: 0 });
    }

    // Telescope vignette sizing
    vignetteRadius = min(width, height) * 0.35;
    vignetteTargetRadius = vignetteRadius;

    noStroke();

    // Skip button listener
    let skipBtn = document.getElementById('skip-intro');
    if (skipBtn) {
        skipBtn.addEventListener('click', function () {
            skipIntro();
        });
    }
}

// ========== SKY RENDERING ==========

// Faint stars at the final view, rendered once per resize
function buildSkyLayer() {
    if (skyLayer) skyLayer.remove();
    skyLayer = createGraphics(width, height);
    const ctx = skyLayer.drawingContext;
    ctx.clearRect(0, 0, width, height);
    for (const s of bgStars) {
        const p = toScreen(s.x, s.y, FINAL_VIEW);
        if (p.x < -4 || p.x > width + 4 || p.y < -4 || p.y > height + 4) continue;
        plotPoint(ctx, p.x, p.y, s.r, s.col, s.a);
    }
}

function plotPoint(ctx, x, y, r, col, a) {
    ctx.fillStyle = rgba(col, a);
    if (r < 1.1) {
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
    } else {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }
}

// Orion Nebula: H-alpha red outer shell, teal-white core, Trapezium at the heart.
// Seeded so it looks the same every visit.
function buildNebulaSprite() {
    const N = 512;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    let seed = 42;
    const rnd = function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const gauss = function () { return (rnd() + rnd() + rnd() - 1.5) / 1.5; };
    const blob = function (x, y, r, col, a) {
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, rgba(col, a));
        gr.addColorStop(1, rgba(col, 0));
        g.fillStyle = gr;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    };
    g.globalCompositeOperation = 'lighter';
    // outer hydrogen shell, skewed like the real wings
    for (let i = 0; i < 90; i++) {
        const ang = rnd() * Math.PI * 2;
        const rad = Math.abs(gauss()) * N * 0.34;
        const x = N / 2 + Math.cos(ang) * rad * 1.1 + N * 0.03;
        const y = N / 2 + Math.sin(ang) * rad * 0.9 + N * 0.02;
        const warm = rnd();
        const col = warm < 0.72 ? [200, 95 + warm * 30, 125] : [125, 115, 190];
        blob(x, y, N * (0.07 + rnd() * 0.14), col, 0.022 + rnd() * 0.026);
    }
    // ionised core
    for (let i = 0; i < 40; i++) {
        const x = N / 2 + gauss() * N * 0.07;
        const y = N / 2 + gauss() * N * 0.06;
        blob(x, y, N * (0.03 + rnd() * 0.06), rnd() < 0.6 ? [110, 200, 205] : [220, 230, 245], 0.028 + rnd() * 0.035);
    }
    // dark bay ("fish mouth") cutting in from the east
    g.globalCompositeOperation = 'destination-out';
    const bay = g.createRadialGradient(N * 0.38, N * 0.44, 0, N * 0.38, N * 0.44, N * 0.11);
    bay.addColorStop(0, 'rgba(0,0,0,0.55)');
    bay.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = bay;
    g.beginPath(); g.arc(N * 0.38, N * 0.44, N * 0.11, 0, Math.PI * 2); g.fill();
    // Trapezium
    g.globalCompositeOperation = 'lighter';
    [[0, 0], [5, -3], [-4, 3], [2, 6]].forEach(function (o) {
        blob(N / 2 + o[0], N / 2 + o[1], 6, [235, 242, 255], 0.55);
    });
    nebulaSprite = c;
}

function drawNebula(view, alphaMul) {
    if (!nebulaSprite) return;
    const p = toScreen(SKY.m42[0], SKY.m42[1], view);
    // true size is ~1°; drawn larger so it reads at this scale
    const size = 3.6 * ppd * view.s;
    const ctx = drawingContext;
    const breathe = 0.82 + 0.1 * Math.sin(millis() * 0.0006);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alphaMul * breathe;
    ctx.translate(p.x, p.y);
    ctx.rotate(0.35 + 0.02 * Math.sin(millis() * 0.00015));
    ctx.drawImage(nebulaSprite, -size / 2, -size / 2, size, size);
    ctx.restore();
}

function drawBrightGlow(ctx, x, y, r, col, a) {
    const R = r * 6;
    const gr = ctx.createRadialGradient(x, y, 0, x, y, R);
    gr.addColorStop(0, rgba(col, 0.35 * a));
    gr.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
}

// Whole sky at an arbitrary view; the final view uses the baked layer
function drawSky(view, alphaMul) {
    const ctx = drawingContext;
    const t = millis();
    const baked = view.s === 1 && view.cx === FINAL_VIEW.cx && view.cy === FINAL_VIEW.cy;

    ctx.save();
    ctx.globalAlpha = alphaMul;
    if (baked) {
        image(skyLayer, 0, 0, width, height);
    } else {
        for (const s of bgStars) {
            const p = toScreen(s.x, s.y, view);
            if (p.x < -4 || p.x > width + 4 || p.y < -4 || p.y > height + 4) continue;
            plotPoint(ctx, p.x, p.y, s.r, s.col, s.a);
        }
    }
    ctx.restore();

    drawNebula(view, alphaMul);

    ctx.save();
    for (const s of liveStars) {
        const p = toScreen(s.x, s.y, view);
        if (p.x < -30 || p.x > width + 30 || p.y < -30 || p.y > height + 30) continue;
        const tw = 0.8 + 0.13 * Math.sin(t * s.speed + s.seed) + 0.07 * Math.sin(t * s.speed * 2.7 + s.seed * 3);
        const a = s.a * tw * alphaMul;
        if (s.m < 2.3) {
            ctx.globalCompositeOperation = 'lighter';
            drawBrightGlow(ctx, p.x, p.y, s.r, s.col, a);
            ctx.globalCompositeOperation = 'source-over';
        }
        plotPoint(ctx, p.x, p.y, s.r, s.col, a);
    }
    ctx.restore();
}

// ========== MAIN DRAW LOOP ==========
function draw() {
    background(14, 16, 31);
    introTimer = millis() - introStartTime;

    // Star dive: the whole sky scales about the clicked star
    const dv = window.SiteTransition ? SiteTransition.diveFrame() : null;
    if (dv) {
        drawingContext.save();
        drawingContext.translate(dv.x, dv.y);
        drawingContext.scale(dv.scale, dv.scale);
        drawingContext.translate(-dv.x, -dv.y);
    }

    switch (introState) {
        case "telescope":
            drawTelescopePhase();
            break;
        case "zoom":
            drawZoomPhase();
            break;
        case "draw":
            drawConstellationDrawPhase();
            break;
        case "idle":
            drawIdlePhase();
            break;
    }

    if (dv) drawingContext.restore();

    // Cosmic dust always on
    drawCosmicDust();

    if (dv) drawDiveOverlay(dv);
}

// Radial streaks from the star, then the flat colour flood
function drawDiveOverlay(dv) {
    const ctx = drawingContext;
    if (dv.scale > 1) drawWarpStreaks(dv.zoom, dv.x, dv.y, DIVE_STREAK_ALPHA);
    if (dv.flood > 0) {
        ctx.save();
        ctx.fillStyle = rgba(SiteTransition.diveColor(dv), dv.flood);
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
    }
}

// ========== PHASE 1: TELESCOPE ==========
function drawTelescopePhase() {
    let t = introTimer / TELESCOPE_DURATION;
    if (t > 1) {
        transitionToZoom();
        return;
    }

    // Wide field through the eyepiece: Orion small, Sirius and Aldebaran in view
    const view = { s: TELESCOPE_SCALE, cx: FIG_CENTER.x, cy: FIG_CENTER.y };
    drawSky(view, 0.7 + t * 0.3);
    drawFigurePoints(view, 0.7 + t * 0.3);

    drawTelescopeVignette(vignetteRadius, 1.0);
    drawLensRefraction(vignetteRadius, t);
    lensFlareAngle += 0.008;
    drawLensFlare(width / 2, height / 2, vignetteRadius, lensFlareAngle, t);
}

// ========== PHASE 2: ZOOM ==========
function drawZoomPhase() {
    let elapsed = introTimer - TELESCOPE_DURATION;
    let t = constrain(elapsed / ZOOM_DURATION, 0, 1);
    let easedT = easeInOutCubic(t);

    if (t >= 1) {
        transitionToDraw();
        return;
    }

    // The field genuinely magnifies toward the final framing; streaks sell the speed
    const view = { s: lerp(TELESCOPE_SCALE, 1, easedT), cx: FIG_CENTER.x, cy: FIG_CENTER.y };
    drawSky(view, 1);
    drawFigurePoints(view, 1);
    drawWarpStreaks(easedT);

    let expandedRadius = lerp(vignetteRadius, max(width, height) * 1.5, easeOutExpo(t));
    let vignetteAlpha = 1.0 - easeOutExpo(t);
    if (vignetteAlpha > 0.02) {
        drawTelescopeVignette(expandedRadius, vignetteAlpha);
    }
    if (t < 0.5) {
        drawLensRefraction(expandedRadius, 1 - t * 2);
        drawLensFlare(width / 2, height / 2, expandedRadius, lensFlareAngle, 1 - t * 2);
    }
    lensFlareAngle += 0.01;
    drawGradient();
}

// ========== PHASE 3: CONSTELLATION DRAW ==========
function drawConstellationDrawPhase() {
    let elapsed = introTimer - TELESCOPE_DURATION - ZOOM_DURATION;
    let t = constrain(elapsed / DRAW_DURATION, 0, 1);
    drawProgress = easeInOutCubic(t);

    if (t >= 1 && !ctaVisible) {
        ctaVisible = true;
        ctaStartTime = millis();
        // constellation fully drawn → reveal nav/footer
        document.body.classList.add('intro-done');
    }

    drawSky(FINAL_VIEW, 1);
    drawGradient();
    updateShootingStars();
    drawOrion(drawProgress);

    if (ctaVisible && !ctaDismissed) {
        drawBetelgeuseCTA();
    }

    if (ctaVisible && (millis() - ctaStartTime > 20000)) {
        transitionToIdle();
    }
}

// ========== PHASE 4: IDLE ==========
function drawIdlePhase() {
    drawSky(FINAL_VIEW, 1);
    drawGradient();
    updateShootingStars();
    drawOrion(1);

    if (!ctaDismissed) {
        let terminalOpen = false;
        try { terminalOpen = typeof terminal !== 'undefined' && terminal && terminal.opened; } catch (e) { }
        if (!terminalOpen) {
            let timeSinceIdle = millis() - (introStartTime + TELESCOPE_DURATION + ZOOM_DURATION + DRAW_DURATION);
            let cyclePos = (timeSinceIdle % 15000);
            if (cyclePos < 5000) {
                drawBetelgeuseHint(map(cyclePos, 0, 5000, 0, 1));
            }
        }
    }
}

// ========== ORION ==========

// Figure stars as plain catalogue points (before they ignite)
function drawFigurePoints(view, alphaMul) {
    const ctx = drawingContext;
    for (let i = 0; i < orionStars.length; i++) {
        const s = orionStars[i];
        const p = toScreen(s.x, s.y, view);
        const r = pointRadius(s.mag) * (0.8 + 0.4 * view.s);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        drawBrightGlow(ctx, p.x, p.y, r, s.col, alphaMul);
        ctx.restore();
        plotPoint(ctx, p.x, p.y, r, s.col, alphaMul);
    }
}

function drawMainStar(ctx, x, y, i, k, hovered) {
    const s = orionStars[i];
    const t = millis();
    let d = coreD(i) * (1 + 0.05 * Math.sin(t * 0.0027 + i * 7)) * (hovered ? 1.22 : 1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // halo
    let halo = d * 2.6;
    if (i === 0) halo *= 1 + 0.12 * Math.sin(t * 0.0011); // Betelgeuse: semiregular variable
    let g = ctx.createRadialGradient(x, y, 0, x, y, halo);
    g.addColorStop(0, rgba(s.col, 0.5 * k));
    g.addColorStop(0.22, rgba(s.col, 0.2 * k));
    g.addColorStop(1, rgba(s.col, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, halo, 0, Math.PI * 2); ctx.fill();

    // diffraction spikes on the two zero-magnitude stars
    if (s.mag < 1) {
        const L = d * 2.1;
        ctx.strokeStyle = rgba(s.col, 0.22 * k);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - L, y); ctx.lineTo(x + L, y);
        ctx.moveTo(x, y - L); ctx.lineTo(x, y + L);
        ctx.stroke();
    }

    // core
    g = ctx.createRadialGradient(x, y, 0, x, y, d * 0.55);
    g.addColorStop(0, "rgba(255,255,255," + (0.95 * k).toFixed(3) + ")");
    g.addColorStop(0.35, rgba(s.col, 0.85 * k));
    g.addColorStop(1, rgba(s.col, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, d * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
}

function drawLink(ctx, A, B, ga, gb, p, a) {
    const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy);
    const full = L - ga - gb;
    if (full <= 0) return;
    const ux = dx / L, uy = dy / L;
    const sx = A.x + ux * ga, sy = A.y + uy * ga;
    const ex = sx + ux * full * p, ey = sy + uy * full * p;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
    ctx.strokeStyle = "rgba(90,140,255," + (0.10 * a).toFixed(3) + ")";
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = "rgba(160,190,255," + (0.55 * a).toFixed(3) + ")";
    ctx.lineWidth = 1.3;
    ctx.stroke();
}

function hitRadius(i) { return Math.max(26, coreD(i) * 1.2); }

function diving() { return !!(window.SiteTransition && SiteTransition.isDiving()); }

function interactive() {
    return !diving() && (introState === "idle" || (introState === "draw" && ctaVisible));
}

function drawOrion(progress) {
    const ctx = drawingContext;
    const pos = orionStars.map(function (s) { return toScreen(s.x, s.y, FINAL_VIEW); });
    orionStarScreenPos = pos;
    const now = millis();

    // hover
    hoveredStar = null;
    if (interactive()) {
        for (let i = 0; i < pos.length; i++) {
            if (dist(mouseX, mouseY, pos[i].x, pos[i].y) < hitRadius(i)) {
                hoveredStar = { idx: i, sx: pos[i].x, sy: pos[i].y };
                break;
            }
        }
    }
    const hi = hoveredStar ? hoveredStar.idx : -1;
    // warm the destination before the click
    if (hi > 0 && window.SiteTransition) SiteTransition.prefetch(DIVE_TARGETS[hi]);

    // lines, drawn in sequence, stopping short of each star
    const total = orionLines.length;
    const done = progress * total;
    for (let li = 0; li < total; li++) {
        if (li >= done) break;
        const a = orionLines[li][0], b = orionLines[li][1];
        const lp = constrain(done - li, 0, 1);
        const lit = (a === hi || b === hi) ? 1 : 0.72;
        drawLink(ctx, pos[a], pos[b], coreD(a) * 0.9, coreD(b) * 0.9, lp, lit);

        if (!starIgnitions[a].ignited) { starIgnitions[a].ignited = true; starIgnitions[a].igniteTime = now; }
        if (lp >= 0.95 && !starIgnitions[b].ignited) { starIgnitions[b].ignited = true; starIgnitions[b].igniteTime = now; }
    }

    // stars: catalogue point until ignited, then grow into the full glow
    for (let i = 0; i < orionStars.length; i++) {
        const s = orionStars[i];
        const p = pos[i];
        const ig = starIgnitions[i];
        const growT = ig.ignited ? constrain((now - ig.igniteTime) / 500, 0, 1) : 0;

        if (growT < 1) {
            plotPoint(ctx, p.x, p.y, pointRadius(s.mag) * 1.2, s.col, 1 - growT);
        }
        if (ig.ignited) {
            const since = now - ig.igniteTime;
            if (since < 800) {
                const bt = since / 800;
                ctx.beginPath();
                ctx.arc(p.x, p.y, 5 + bt * 45, 0, Math.PI * 2);
                ctx.strokeStyle = rgba(s.col, 0.8 * (1 - easeOutExpo(bt)));
                ctx.lineWidth = 2.5 * (1 - bt);
                ctx.stroke();
            }
            drawMainStar(ctx, p.x, p.y, i, easeOutExpo(growT), i === hi);
        }
    }

    // page labels: always visible once the figure is drawn (touch has no hover)
    let labelA = 0;
    if (introState === "idle") labelA = 1;
    else if (ctaVisible) labelA = constrain((now - ctaStartTime) / 800, 0, 1);
    if (labelA > 0) drawLabels(ctx, pos, labelA, hi);

    if (hoveredStar) {
        drawTooltip(ctx, hi);
        cursor(HAND);
    } else {
        cursor(ARROW);
    }
}

function drawLabels(ctx, pos, a, hi) {
    const fs = width < 500 ? 10.5 : 12;
    ctx.save();
    ctx.font = "500 " + fs + "px 'IBM Plex Mono', Menlo, monospace";
    ctx.textBaseline = "middle";
    for (let i = 0; i < orionStars.length; i++) {
        const s = orionStars[i];
        let off = coreD(i) * 0.9 + 10;
        if (i === 0) off = Math.max(off, Math.max(48, coreD(0) * 3.4) / 2 + 8); // clear the CTA ring
        let x = pos[i].x, y = pos[i].y;
        let side = s.side;
        const tw = ctx.measureText(s.page).width;
        if (side === "left" && x - off - tw < 6) side = "above";
        if (side === "right" && x + off + tw > width - 6) side = "above";
        if (side === "left") { ctx.textAlign = "right"; x -= off; }
        else if (side === "right") { ctx.textAlign = "left"; x += off; }
        else if (side === "above") { ctx.textAlign = "center"; y -= off + fs * 0.4; }
        else { ctx.textAlign = "center"; y += off + fs * 0.4; }
        const base = i === hi ? 1 : 0.62;
        ctx.fillStyle = i === 0
            ? "rgba(255,180,110," + (base * a).toFixed(3) + ")"
            : "rgba(205,215,245," + (base * a).toFixed(3) + ")";
        ctx.fillText(s.page, x, y);
    }
    ctx.restore();
}

function drawTooltip(ctx, i) {
    const s = orionStars[i];
    const l1 = s.page, l2 = s.desc, l3 = s.name + " · " + s.info;
    ctx.save();
    ctx.font = "600 15px 'Space Grotesk', sans-serif";
    const w1 = ctx.measureText(l1).width;
    ctx.font = "400 12.5px 'Space Grotesk', sans-serif";
    const w2 = ctx.measureText(l2).width;
    ctx.font = "400 11px 'Space Grotesk', sans-serif";
    const w3 = ctx.measureText(l3).width;
    const w = Math.max(w1, w2, w3) + 24, h = 70;
    let x = mouseX + 18, y = mouseY - 34;
    if (x + w > width - 8) x = mouseX - 18 - w;
    y = constrain(y, 8, height - h - 8);

    ctx.fillStyle = "rgba(18,22,40,0.92)";
    ctx.strokeStyle = "rgba(110,140,220,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, h, 10) : ctx.rect(x, y, w, h);
    ctx.fill(); ctx.stroke();

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = i === 0 ? "rgb(255,190,120)" : "rgb(240,244,255)";
    ctx.font = "600 15px 'Space Grotesk', sans-serif";
    ctx.fillText(l1, x + 12, y + 22);
    ctx.fillStyle = "rgb(190,200,228)";
    ctx.font = "400 12.5px 'Space Grotesk', sans-serif";
    ctx.fillText(l2, x + 12, y + 41);
    ctx.fillStyle = "rgba(160,172,205,0.8)";
    ctx.font = "400 11px 'Space Grotesk', sans-serif";
    ctx.fillText(l3, x + 12, y + 59);
    ctx.restore();
}

// ---- Betelgeuse CTA ----
function drawBetelgeuseCTA() {
    if (orionStarScreenPos.length === 0) return;
    let bx = orionStarScreenPos[0].x;
    let by = orionStarScreenPos[0].y;
    const ringD = Math.max(48, coreD(0) * 3.4);

    betelgeuseOrbitAngle += 0.015;
    push();
    noFill();
    let cta_elapsed = millis() - ctaStartTime;
    let fadeIn = constrain(cta_elapsed / 800, 0, 1);

    let segments = 8;
    let gapAngle = TWO_PI / segments * 0.3;
    for (let s = 0; s < segments; s++) {
        let startAngle = betelgeuseOrbitAngle + (TWO_PI / segments) * s;
        let endAngle = startAngle + (TWO_PI / segments) - gapAngle;
        stroke(255, 160, 80, 180 * fadeIn);
        strokeWeight(2);
        arc(bx, by, ringD, ringD, startAngle, endAngle);
    }

    let breathR = ringD + 8 * sin(millis() * 0.003);
    stroke(255, 136, 76, 40 * fadeIn);
    strokeWeight(1);
    ellipse(bx, by, breathR, breathR);

    noStroke();
    pop();

    // Typing text effect
    let charsToShow = floor((millis() - ctaStartTime) / CTA_TYPING_SPEED);
    charsToShow = constrain(charsToShow, 0, ctaText.length);

    if (charsToShow > 0) {
        let displayText = ctaText.substring(0, charsToShow);
        let cursorBlink = (millis() % 1000) < 500;

        push();
        textFont('IBM Plex Mono, monospace');
        const fs = width < 500 ? 12 : 14;
        textSize(fs);
        textAlign(CENTER, TOP);

        let tw_text = textWidth(ctaText) + 24;
        let th = fs + 16;
        // keep the whole pill on screen (it used to clip on phones)
        let tx = constrain(bx, tw_text / 2 + 8, width - tw_text / 2 - 8);
        let ty = by + ringD / 2 + 14;

        fill(14, 16, 31, 200 * fadeIn);
        noStroke();
        rect(tx - tw_text / 2, ty - 4, tw_text, th, 15);

        fill(255, 180, 100, 240 * fadeIn);
        text(displayText, tx, ty + 3);

        if (charsToShow < ctaText.length && cursorBlink) {
            let cursorX = tx - textWidth(ctaText) / 2 + textWidth(displayText);
            fill(255, 180, 100, 200 * fadeIn);
            rect(cursorX + 1, ty + 2, 2, fs + 2);
        }

        pop();
    }
}

// ---- Betelgeuse Hint (idle state) ----
function drawBetelgeuseHint(cycleT) {
    if (orionStarScreenPos.length === 0) return;
    let bx = orionStarScreenPos[0].x;
    let by = orionStarScreenPos[0].y;
    let alpha = sin(cycleT * PI) * 180;
    const r0 = Math.max(24, coreD(0) * 1.7);

    push();
    noFill();
    let radius = r0 + 3 * sin(millis() * 0.004);
    stroke(255, 160, 80, alpha * 0.5);
    strokeWeight(1.5);
    ellipse(bx, by, radius * 2, radius * 2);

    noStroke();
    fill(255, 180, 100, alpha);
    textFont('IBM Plex Mono, monospace');
    textSize(11);
    textAlign(CENTER, TOP);
    text("✦ start here", bx, by + r0 + 8);
    pop();
}

// ========== TRANSITIONS ==========

function transitionToZoom() {
    introState = "zoom";
    let introText = document.getElementById('intro-text');
    if (introText) introText.style.display = 'none';
}

function transitionToDraw() {
    introState = "draw";
    let overlay = document.getElementById('intro-overlay');
    if (overlay) {
        overlay.classList.add('fade-out');
        setTimeout(() => overlay.classList.add('hidden'), 800);
    }
    let skipBtn = document.getElementById('skip-intro');
    if (skipBtn) skipBtn.style.display = 'none';
}

function transitionToIdle() {
    introState = "idle";
    ctaDismissed = false;
    sessionStorage.setItem('introPlayed', 'true');
    document.body.classList.add('intro-done');
    frameRate(30); // twinkle and drift don't need 60fps; saves laptop batteries
}

function skipIntro() {
    if (introSkipped) return;
    introSkipped = true;
    introState = "idle";
    drawProgress = 1;
    ctaDismissed = false;

    for (let ig of starIgnitions) {
        ig.ignited = true;
        ig.igniteTime = millis() - 1000;
    }

    let overlay = document.getElementById('intro-overlay');
    if (overlay) overlay.classList.add('hidden');
    let skipBtn = document.getElementById('skip-intro');
    if (skipBtn) skipBtn.style.display = 'none';

    sessionStorage.setItem('introPlayed', 'true');
    document.body.classList.add('intro-done');
    frameRate(30);
}

// ========== INTERACTION ==========
function mousePressed() {
    // During telescope/zoom, do NOT skip — let animation play
    if (introState === "telescope" || introState === "zoom") return;
    if (diving() || !interactive() || !orionStarScreenPos.length) return;

    for (let i = 0; i < orionStarScreenPos.length; i++) {
        const p = orionStarScreenPos[i];
        if (dist(mouseX, mouseY, p.x, p.y) < hitRadius(i)) {
            if (i === 0) {
                ctaDismissed = true;
                if (introState === "draw") transitionToIdle();
            }
            // every star is live as soon as the figure is drawn
            // (previously only Betelgeuse worked for the first 20s)
            handleStarClick(i);
            return;
        }
    }
}

function keyPressed() {
    // No-op during intro — only Skip button can skip
}

// ---- Star actions ----
function handleStarClick(idx) {
    if (idx === 0) { openTerminal(); return; }
    if (window.SiteTransition) {
        const p = orionStarScreenPos[idx];
        hoveredStar = null;
        cursor(ARROW);
        SiteTransition.startDive({
            star: orionStars[idx].name,
            target: DIVE_TARGETS[idx],
            rgb: orionStars[idx].col,
            x: p.x,
            y: p.y
        });
        return;
    }
    // fallback if transition.js failed to load: plain navigation
    window.location.href = DIVE_TARGETS[idx];
}

// bfcache restore (Back): drop hover state; the dive itself is reset by SiteTransition
if (window.SiteTransition) {
    SiteTransition.onReset(function () {
        hoveredStar = null;
        if (typeof cursor === "function") cursor(ARROW);
    });
}

function windowResized() {
    resizeCanvas(window.innerWidth, window.innerHeight);
    vignetteRadius = min(width, height) * 0.35;
    computeScale();
    buildSkyLayer();
}

// ---- Easing ----
function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function easeOutExpo(t) {
    return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

// ========== UNCHANGED HELPERS ==========

function drawGradient() {
    let ctx = drawingContext;
    ctx.save();
    let cx = width / 2;
    let cy = height / 2;
    let outerR = sqrt(sq(cx) + sq(cy));
    let grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, outerR);
    grad.addColorStop(0, 'rgba(25, 22, 45, 0.12)');
    grad.addColorStop(0.5, 'rgba(20, 18, 35, 0.04)');
    grad.addColorStop(1, 'rgba(10, 10, 20, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
}

function drawCosmicDust() {
    for (let d of dustParticles) {
        d.x += d.vx + (noise(d.noiseSeed + millis() * 0.0001) - 0.5) * 0.5;
        d.y += d.vy + (noise(d.noiseSeed + 500 + millis() * 0.0001) - 0.5) * 0.5;
        if (d.x < -10) d.x = width + 10;
        if (d.x > width + 10) d.x = -10;
        if (d.y < -10) d.y = height + 10;
        if (d.y > height + 10) d.y = -10;

        let flicker = d.alpha + 10 * sin(millis() * 0.002 + d.noiseSeed);
        fill(180, 190, 220, flicker);
        noStroke();
        circle(d.x, d.y, d.size);
    }
}

// ---- Telescope Vignette ----
// Uses Canvas2D composite path: full-screen rect with circular cutout
function drawTelescopeVignette(radius, alphaMultiplier) {
    let cx = width / 2;
    let cy = height / 2;
    let ctx = drawingContext;

    push();
    ctx.save();

    // Dark mask with circular hole (even/odd fill rule)
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.arc(cx, cy, radius, 0, Math.PI * 2, true); // counter-clockwise = hole
    ctx.closePath();
    ctx.fillStyle = `rgba(8, 10, 18, ${alphaMultiplier.toFixed(3)})`;
    ctx.fill('evenodd');

    // Feathered inner edge (soft glow rings just inside the rim)
    let steps = 15;
    for (let i = 0; i < steps; i++) {
        let t = i / steps;
        let r = radius + t * 20;
        let a = 120 * (1 - t) * alphaMultiplier;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.lineWidth = 4;
        ctx.strokeStyle = `rgba(8, 10, 18, ${(a / 255).toFixed(3)})`;
        ctx.stroke();
    }

    ctx.restore();

    // Eyepiece inner glow (blue rings)
    noFill();
    for (let i = 0; i < 4; i++) {
        let ringAlpha = (55 - i * 13) * alphaMultiplier;
        stroke(80, 120, 200, ringAlpha);
        strokeWeight(2.5 - i * 0.4);
        ellipse(cx, cy, (radius - i * 3) * 2, (radius - i * 3) * 2);
    }

    // Metallic eyepiece rim
    stroke(120, 140, 195, 230 * alphaMultiplier);
    strokeWeight(3.5);
    ellipse(cx, cy, radius * 2, radius * 2);
    stroke(70, 85, 120, 190 * alphaMultiplier);
    strokeWeight(6);
    ellipse(cx, cy, (radius + 5) * 2, (radius + 5) * 2);
    stroke(45, 50, 80, 130 * alphaMultiplier);
    strokeWeight(10);
    ellipse(cx, cy, (radius + 12) * 2, (radius + 12) * 2);

    noStroke();
    pop();
}

// ---- Lens Refraction Rings ----
function drawLensRefraction(radius, intensity) {
    let cx = width / 2;
    let cy = height / 2;
    push();
    noFill();

    let ringColors = [
        [255, 100, 100, 12],
        [100, 255, 100, 8],
        [100, 100, 255, 10],
        [255, 200, 100, 6],
        [200, 100, 255, 7]
    ];

    for (let i = 0; i < ringColors.length; i++) {
        let rc = ringColors[i];
        let ringR = radius * (0.5 + i * 0.1) + sin(millis() * 0.001 + i) * 5;
        stroke(rc[0], rc[1], rc[2], rc[3] * intensity);
        strokeWeight(1.5);
        ellipse(cx, cy, ringR * 2, ringR * 2);
    }

    noStroke();
    pop();
}

// ---- Lens Flare ----
function drawLensFlare(cx, cy, radius, angle, intensity) {
    if (intensity < 0.01) return;
    push();
    let flareX = cx + cos(angle) * radius * 0.6;
    let flareY = cy + sin(angle) * radius * 0.6;

    for (let r = 30; r > 0; r -= 3) {
        let a = map(r, 30, 0, 0, 35 * intensity);
        fill(200, 220, 255, a);
        noStroke();
        ellipse(flareX, flareY, r * 2, r * 2);
    }
    fill(255, 255, 255, 60 * intensity);
    ellipse(flareX, flareY, 8, 8);

    let flare2X = cx - cos(angle) * radius * 0.3;
    let flare2Y = cy - sin(angle) * radius * 0.3;
    for (let r = 15; r > 0; r -= 3) {
        let a = map(r, 15, 0, 0, 18 * intensity);
        fill(180, 200, 255, a);
        ellipse(flare2X, flare2Y, r * 2, r * 2);
    }
    pop();
}

// ---- Warp Speed Streaks ----
// Centred on the screen by default; the star dive centres them on the star.
function drawWarpStreaks(t, cx, cy, peak) {
    if (cx === undefined) { cx = width / 2; cy = height / 2; }
    if (peak === undefined) peak = 1;

    push();
    for (let w of warpStars) {
        let speed = w.speed * (0.5 + t * 4);
        let currentDist = (w.dist + speed * t * 2) % 1.5;
        let streakLength = 2 + t * currentDist * 80;
        let x1 = cx + cos(w.angle) * currentDist * max(width, height);
        let y1 = cy + sin(w.angle) * currentDist * max(width, height);
        let x2 = cx + cos(w.angle) * (currentDist - streakLength / max(width, height)) * max(width, height);
        let y2 = cy + sin(w.angle) * (currentDist - streakLength / max(width, height)) * max(width, height);

        let alpha = w.alpha * t * (1 - currentDist * 0.5) * peak;
        stroke(220, 230, 255, alpha);
        strokeWeight(w.size * (0.5 + t));
        line(x1, y1, x2, y2);
    }
    noStroke();
    pop();
}

// ========== SHOOTING STARS ==========
function updateShootingStars() {
    if (random(1) < 0.010 && shootingStars.length < 2) {
        shootingStars.push({
            x: random(width * 0.4, width),
            y: random(0, height * 0.4),
            vx: -random(2.5, 5.5),
            vy: random(1.0, 2.5),
            trail: [],
            life: 0,
            maxLife: random(65, 110)
        });
    }
    for (let i = shootingStars.length - 1; i >= 0; i--) {
        let s = shootingStars[i];
        s.x += s.vx * 0.7;
        s.y += s.vy * 0.7;
        s.trail.push({ x: s.x, y: s.y });
        if (s.trail.length > 18) s.trail.shift();

        s.life++;
        let headAlpha = map(s.life, 0, s.maxLife, 220, 0);
        let headSize = 4.5 + 1.8 * sin(frameCount * 0.11 + i * 11);

        for (let j = 0; j < s.trail.length; j++) {
            let pct = j / (s.trail.length - 1);
            let alpha = 64 * pow(pct, 1.8);
            let size = headSize * (0.45 + pct * 0.8);
            fill(255, 255, 255, alpha);
            noStroke();
            ellipse(s.trail[j].x, s.trail[j].y, size, size * 0.7);
        }
        fill(255, 255, 255, headAlpha);
        ellipse(s.x, s.y, headSize);

        if (s.life > s.maxLife) shootingStars.splice(i, 1);
    }
}

