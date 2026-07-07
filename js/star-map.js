// ========================================================
// STAR MAP — Telescope → Orion Intro Animation
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

// ---- Stars & Orion ----
let stars = [];
let shootingStars = [];
let dustParticles = [];
let hoveredStar = null;
let orionStarScreenPos = [];
let drawProgress = 0;
let starIgnitions = [];
let ctaText = "Click Betelgeuse to begin ✦";
let ctaCharsRevealed = 0;
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

const orionStars = [
    { name: "Betelgeuse", ra: 5.92, dec: 7.4, type: "M2", info: "Red supergiant, Alpha Orionis" },
    { name: "Bellatrix", ra: 5.42, dec: 6.3, type: "B2", info: "Blue giant, Gamma Orionis" },
    { name: "Alnilam", ra: 5.60, dec: -1.2, type: "B0", info: "Blue supergiant, Epsilon Orionis" },
    { name: "Mintaka", ra: 5.53, dec: -0.3, type: "O9", info: "Blue giant, Delta Orionis" },
    { name: "Alnitak", ra: 5.68, dec: -1.9, type: "O9", info: "Blue supergiant, Zeta Orionis" },
    { name: "Saiph", ra: 5.80, dec: -9.7, type: "B2", info: "Blue supergiant, Kappa Orionis" },
    { name: "Rigel", ra: 5.24, dec: -8.2, type: "B8", info: "Blue supergiant, Beta Orionis" }
];

const orionLines = [
    [0, 4], [1, 3], [0, 1], [2, 3], [2, 4], [4, 5], [3, 6], [5, 6]
];

// ---- Color helpers ----
function randomColorFromType(type) {
    switch (type) {
        case "M2": return color(255, 136, 76);
        case "B2": return color(153, 217, 255);
        case "B0":
        case "O9":
        case "B8": return color(170, 210, 255);
        default: return color(220, 220, 255);
    }
}

function getNormalizedCoords(star) {
    let x = map(star.ra, 5.2, 5.92, 1, 0);
    let y = map(star.dec, -10, 8, 1, 0);
    return createVector(x, y);
}

function skyToScreenFlat(normVec, scale, centerX, centerY) {
    if (centerX === undefined) centerX = width / 2;
    if (centerY === undefined) centerY = height / 2;
    let px = (normVec.x - 0.5) * scale * width * 0.6 + centerX;
    let py = (normVec.y - 0.5) * scale * width * 0.6 + centerY;
    return createVector(px, py);
}

// ---- Easing ----
function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function easeOutExpo(t) {
    return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

// ========== SETUP ==========
function setup() {
    let canvas = createCanvas(window.innerWidth, window.innerHeight);
    canvas.position(0, 0);
    canvas.style('z-index', '100');
    canvas.style('position', 'fixed');
    frameRate(60);

    introStartTime = millis();

    // Safety net: reveal nav/footer even if the intro stalls (e.g. tab
    // backgrounded mid-animation) — full intro runs ~8.2s
    setTimeout(function () { document.body.classList.add('intro-done'); }, 9000);

    // Check for returning visitor; respect OS reduced-motion preference
    if (sessionStorage.getItem('introPlayed') ||
        (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
        skipIntro();
    }

    // Background stars
    for (let i = 0; i < 350; i++) {
        let isMainStar = (i < 12);
        let colorType = random();
        let tint;
        if (colorType < 0.05) tint = color(255, 210, 210);
        else if (colorType < 0.15) tint = color(195, 210, 255);
        else if (colorType < 0.22) tint = color(255, 255, 180);
        else tint = color(255, 255, 230);

        stars.push({
            base: createVector(random(), random()),
            r: isMainStar ? random(4, 6) : random(1.8, 3.5),
            twinkleSeed: random(10000),
            noiseSeedX: random(10000),
            noiseSeedY: random(10000),
            color: tint,
            twinkleSpeed: isMainStar ? 0.008 : 0.012,
            maxAlpha: isMainStar ? 255 : 210 + random(0, 45)
        });
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
        starIgnitions.push({
            ignited: false,
            igniteTime: 0,
            burstRadius: 0,
            burstAlpha: 0
        });
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

// ========== MAIN DRAW LOOP ==========
function draw() {
    background(14, 16, 31);
    introTimer = millis() - introStartTime;

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

    // Cosmic dust always on
    drawCosmicDust();
}

// ========== PHASE 1: TELESCOPE ==========
function drawTelescopePhase() {
    let t = introTimer / TELESCOPE_DURATION;
    if (t > 1) {
        transitionToZoom();
        return;
    }

    // Deep space background with stars visible through eyepiece
    drawDeepSpaceBackground(0.7 + t * 0.3);

    // Telescope vignette — circular mask with dark outside
    drawTelescopeVignette(vignetteRadius, 1.0);

    // Lens refraction rings
    drawLensRefraction(vignetteRadius, t);

    // Lens flare
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

    // Stars are visible and start warping
    drawDeepSpaceBackground(0.5 + easedT * 0.5);

    // Warp speed star streaks
    drawWarpStreaks(easedT);

    // Vignette expands and fades
    let expandedRadius = lerp(vignetteRadius, max(width, height) * 1.5, easeOutExpo(t));
    let vignetteAlpha = 1.0 - easeOutExpo(t);
    if (vignetteAlpha > 0.02) {
        drawTelescopeVignette(expandedRadius, vignetteAlpha);
    }

    // Lens effects fade out
    if (t < 0.5) {
        drawLensRefraction(expandedRadius, 1 - t * 2);
        drawLensFlare(width / 2, height / 2, expandedRadius, lensFlareAngle, 1 - t * 2);
    }
    lensFlareAngle += 0.01;

    // Subtle ambient glow
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

    // Full starfield
    drawDeepSpaceBackground(1.0);
    drawGradient();

    // Shooting stars
    updateShootingStars();

    // Draw Orion with animated lines
    drawOrionAnimated(drawProgress);

    // Betelgeuse CTA
    if (ctaVisible && !ctaDismissed) {
        drawBetelgeuseCTA();
    }

    // Transition to idle after timeout
    if (ctaVisible && (millis() - ctaStartTime > 20000)) {
        transitionToIdle();
    }
}

// ========== PHASE 4: IDLE ==========
function drawIdlePhase() {
    drawDeepSpaceBackground(1.0);
    drawGradient();
    updateShootingStars();
    drawOrionFlat(0.65);

    // Periodic Betelgeuse hint
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

// ========== DRAWING HELPERS ==========

function drawDeepSpaceBackground(alphaMultiplier) {
    for (let s of stars) {
        let wanderX = s.base.x + (noise(s.noiseSeedX + millis() * 0.00005) - 0.5) * 0.02;
        let wanderY = s.base.y + (noise(s.noiseSeedY + millis() * 0.00005) - 0.5) * 0.02;
        let spos = skyToScreenFlat(createVector(wanderX, wanderY), 1.0, width / 2, height / 2);

        let t = millis() * 0.0003 + s.twinkleSeed;
        let alpha = s.maxAlpha +
            50 * (noise(t) - 0.5) +
            24 * sin(frameCount * s.twinkleSpeed + s.twinkleSeed * 5);
        alpha *= alphaMultiplier;

        fill(red(s.color), green(s.color), blue(s.color), alpha);
        noStroke();
        circle(spos.x, spos.y, s.r);
    }
}

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
function drawWarpStreaks(t) {
    let cx = width / 2;
    let cy = height / 2;

    push();
    for (let w of warpStars) {
        let speed = w.speed * (0.5 + t * 4);
        let currentDist = (w.dist + speed * t * 2) % 1.5;
        let streakLength = 2 + t * currentDist * 80;
        let x1 = cx + cos(w.angle) * currentDist * max(width, height);
        let y1 = cy + sin(w.angle) * currentDist * max(width, height);
        let x2 = cx + cos(w.angle) * (currentDist - streakLength / max(width, height)) * max(width, height);
        let y2 = cy + sin(w.angle) * (currentDist - streakLength / max(width, height)) * max(width, height);

        let alpha = w.alpha * t * (1 - currentDist * 0.5);
        stroke(220, 230, 255, alpha);
        strokeWeight(w.size * (0.5 + t));
        line(x1, y1, x2, y2);
    }
    noStroke();
    pop();
}

// ---- Animated Orion Drawing ----
function drawOrionAnimated(progress) {
    let centerX = width / 2;
    let centerY = height / 2;
    let normPos = orionStars.map(getNormalizedCoords);
    let starPositions = normPos.map(nv => skyToScreenFlat(nv, 0.65, centerX, centerY));
    orionStarScreenPos = starPositions;

    let totalLines = orionLines.length;
    let linesComplete = progress * totalLines;

    push();
    for (let li = 0; li < totalLines; li++) {
        if (li >= linesComplete) break;
        let [a, b] = orionLines[li];
        let lineProgress = constrain(linesComplete - li, 0, 1);

        let ax = starPositions[a].x;
        let ay = starPositions[a].y;
        let bx = lerp(ax, starPositions[b].x, lineProgress);
        let by = lerp(ay, starPositions[b].y, lineProgress);

        stroke(60, 120, 255, 40);
        strokeWeight(6);
        line(ax, ay, bx, by);
        stroke(90, 140, 240, 180);
        strokeWeight(2.1);
        line(ax, ay, bx, by);

        if (!starIgnitions[a].ignited) {
            starIgnitions[a].ignited = true;
            starIgnitions[a].igniteTime = millis();
        }
        if (lineProgress >= 0.95 && !starIgnitions[b].ignited) {
            starIgnitions[b].ignited = true;
            starIgnitions[b].igniteTime = millis();
        }
    }
    noStroke();
    pop();

    // Draw stars with ignition bursts
    for (let i = 0; i < orionStars.length; i++) {
        let sx = starPositions[i].x;
        let sy = starPositions[i].y;
        let baseCol = randomColorFromType(orionStars[i].type);

        if (starIgnitions[i].ignited) {
            let timeSinceIgnite = millis() - starIgnitions[i].igniteTime;

            if (timeSinceIgnite < 800) {
                let burstT = timeSinceIgnite / 800;
                let burstR = 5 + burstT * 45;
                let burstAlpha = 200 * (1 - easeOutExpo(burstT));
                push();
                noFill();
                stroke(red(baseCol), green(baseCol), blue(baseCol), burstAlpha);
                strokeWeight(2.5 * (1 - burstT));
                ellipse(sx, sy, burstR * 2, burstR * 2);
                noStroke();
                pop();
            }

            let growT = constrain(timeSinceIgnite / 400, 0, 1);
            let tw = (18 + 8 * sin(frameCount * 0.045 + i * 7)) * easeOutExpo(growT);

            for (let g = 3; g > 0; g--) {
                fill(red(baseCol), green(baseCol), blue(baseCol), 15 * g * growT);
                noStroke();
                ellipse(sx, sy, tw + g * 8, tw + g * 8);
            }
            fill(red(baseCol), green(baseCol), blue(baseCol), 230 * growT);
            ellipse(sx, sy, tw);
            fill(255, 255, 255, 120 * growT);
            ellipse(sx, sy, tw * 0.35);

            if (i === 0) {
                let pulseFactor = 0.7 + 0.3 * sin(millis() * 0.002);
                fill(255, 100, 40, 25 * pulseFactor * growT);
                ellipse(sx, sy, tw * 2.5 * pulseFactor);
                fill(255, 136, 76, 12 * pulseFactor * growT);
                ellipse(sx, sy, tw * 3.5 * pulseFactor);
            }
        }
    }
}

// ---- Betelgeuse CTA ----
function drawBetelgeuseCTA() {
    if (orionStarScreenPos.length === 0) return;
    let bx = orionStarScreenPos[0].x;
    let by = orionStarScreenPos[0].y;

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
        arc(bx, by, 65, 65, startAngle, endAngle);
    }

    let breathR = 65 + 8 * sin(millis() * 0.003);
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
        textFont('Space Mono, monospace');
        textSize(14);
        textAlign(CENTER, TOP);

        let tw_text = textWidth(ctaText) + 24;
        let th = 30;
        let tx = bx;
        let ty = by + 48;

        fill(14, 16, 31, 200 * fadeIn);
        noStroke();
        rect(tx - tw_text / 2, ty - 4, tw_text, th, 15);

        fill(255, 180, 100, 240 * fadeIn);
        text(displayText, tx, ty + 3);

        if (charsToShow < ctaText.length && cursorBlink) {
            let cursorX = tx - textWidth(ctaText) / 2 + textWidth(displayText);
            fill(255, 180, 100, 200 * fadeIn);
            rect(cursorX + 1, ty + 2, 2, 16);
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

    push();
    noFill();
    let radius = 32 + 3 * sin(millis() * 0.004);
    stroke(255, 160, 80, alpha * 0.5);
    strokeWeight(1.5);
    ellipse(bx, by, radius * 2, radius * 2);

    noStroke();
    fill(255, 180, 100, alpha);
    textFont('Space Mono, monospace');
    textSize(11);
    textAlign(CENTER, TOP);
    text("✦ start here", bx, by + 40);
    pop();
}

// ---- Original Orion Drawing (Idle State) ----
function drawOrionFlat(scale) {
    let centerX = width / 2;
    let centerY = height / 2;
    let normPos = orionStars.map(getNormalizedCoords);
    let starPositions = normPos.map(nv => skyToScreenFlat(nv, scale, centerX, centerY));
    orionStarScreenPos = starPositions;

    // Lines with glow
    push();
    stroke(60, 120, 255, 30);
    strokeWeight(6);
    for (let pair of orionLines) {
        let [a, b] = pair;
        line(starPositions[a].x, starPositions[a].y, starPositions[b].x, starPositions[b].y);
    }
    stroke(90, 140, 240, 140);
    strokeWeight(2.1);
    for (let pair of orionLines) {
        let [a, b] = pair;
        line(starPositions[a].x, starPositions[a].y, starPositions[b].x, starPositions[b].y);
    }
    noStroke();
    pop();

    // Stars
    hoveredStar = null;
    for (let i = 0; i < orionStars.length; i++) {
        let sx = starPositions[i].x, sy = starPositions[i].y;
        let tw = 18 + 8 * sin(frameCount * 0.045 + i * 7);
        let d = dist(mouseX, mouseY, sx, sy);
        let baseCol = randomColorFromType(orionStars[i].type);
        let isHovered = d < 28;

        for (let g = 3; g > 0; g--) {
            fill(red(baseCol), green(baseCol), blue(baseCol), 12 * g);
            noStroke();
            ellipse(sx, sy, (isHovered ? tw * 1.5 : tw) + g * 8);
        }
        fill(red(baseCol), green(baseCol), blue(baseCol), isHovered ? 255 : 215);
        ellipse(sx, sy, isHovered ? tw * 1.4 : tw);
        fill(255, 255, 255, isHovered ? 140 : 90);
        ellipse(sx, sy, tw * 0.3);

        if (i === 0) {
            let pulseFactor = 0.7 + 0.3 * sin(millis() * 0.002);
            fill(255, 100, 40, 20 * pulseFactor);
            ellipse(sx, sy, tw * 2.5 * pulseFactor);
            fill(255, 136, 76, 10 * pulseFactor);
            ellipse(sx, sy, tw * 3.5 * pulseFactor);
        }

        if (d < 23) hoveredStar = { ...orionStars[i], sx, sy, idx: i };
    }

    // Tooltip
    if (hoveredStar) {
        push();
        fill(20, 24, 42, 230);
        stroke(80, 120, 200, 60);
        strokeWeight(1);
        rect(mouseX + 16, mouseY - 32, 220, 60, 12);
        noStroke();
        fill(255, 255, 240);
        textFont('Inter, sans-serif');
        textSize(16);
        textStyle(BOLD);
        text(hoveredStar.name, mouseX + 26, mouseY - 12);
        textStyle(NORMAL);
        textSize(12);
        fill(180, 190, 220);
        text(hoveredStar.info, mouseX + 26, mouseY + 8);
        pop();
        cursor(HAND);
    } else {
        cursor(ARROW);
    }
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

// ========== INTERACTION ==========
function mousePressed() {
    // During telescope/zoom, do NOT skip — let animation play
    if (introState === "telescope" || introState === "zoom") {
        return;
    }

    // During draw phase, clicking Betelgeuse transitions to idle
    if (introState === "draw" && ctaVisible) {
        if (orionStarScreenPos.length > 0) {
            let bPos = orionStarScreenPos[0];
            if (dist(mouseX, mouseY, bPos.x, bPos.y) < 40) {
                ctaDismissed = true;
                transitionToIdle();
                openTerminal();
                return;
            }
        }
    }

    // Normal star click handling in idle
    if (introState === "idle" && orionStarScreenPos) {
        for (let i = 0; i < orionStarScreenPos.length; i++) {
            let pos = orionStarScreenPos[i];
            if (dist(mouseX, mouseY, pos.x, pos.y) < 24) {
                handleStarClick(i);
                break;
            }
        }
    }
}

function keyPressed() {
    // No-op during intro — only Skip button can skip
}

// ---- Star actions ----
function handleStarClick(idx) {
    switch (idx) {
        case 0: openTerminal(); break;
        case 1: openProjects(); break;
        case 2: openPapers(); break;
        case 3: openSkills(); break;
        case 4: openBlog(); break;
        case 5: openNow(); break;
        case 6: openRigel(); break;
    }
}

function openSkills() { window.location.href = "skills.html"; }
function openNow() { window.location.href = "now/"; }

function openProjects() { window.location.href = "projects.html"; }
function openPapers() { window.location.href = "papers.html"; }
function openBlog() { window.location.href = "blogs.html"; }
function openRigel() { window.location.href = "rigel.html"; }

function windowResized() {
    resizeCanvas(window.innerWidth, window.innerHeight);
    vignetteRadius = min(width, height) * 0.35;
}