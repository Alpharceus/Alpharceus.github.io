let stars = [];
let shootingStars = [];
let hoveredStar = null;
let orionStarScreenPos = [];

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
    [0,4], [1,3], [0,1], [2,3], [2,4], [4,5], [3,6], [5,6]
];

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

function skyToScreenFlat(normVec, scale = 0.65, centerX = width/2, centerY = height/2) {
    let px = (normVec.x - 0.5) * scale * width * 0.6 + centerX;
    let py = (normVec.y - 0.5) * scale * width * 0.6 + centerY;
    return createVector(px, py);
}

function setup() {
    let canvas = createCanvas(window.innerWidth, window.innerHeight);
    canvas.position(0, 0);
    canvas.style('z-index', '-1');
    canvas.style('position', 'fixed');

    frameRate(48);

    // 120 larger stars
    for (let i = 0; i < 200; i++) {
        let isMainStar = (i < 7); // first 7 are the "main" bright stars
        let colorType = random();
        let tint;
        if (colorType < 0.05)       tint = color(255, 210, 210);   // faint red (~5%)
        else if (colorType < 0.15)  tint = color(195, 210, 255);   // blue/white (~10%)
        else if (colorType < 0.22)  tint = color(255, 255, 180);   // yellow/cream (~7%)
        else                        tint = color(255, 255, 220);   // mostly white/cream

        stars.push({
            base: createVector(random(), random()),
            r: isMainStar ? random(3.6, 5.3) : random(1.7, 2.9),
            twinkleSeed: random(10000),
            noiseSeedX: random(10000),
            noiseSeedY: random(10000),
            color: tint,
            twinkleSpeed: isMainStar ? 0.008 : 0.012,
            maxAlpha: isMainStar ? 250 : 195 + random(0, 50)
        });
    }
    noStroke();
}

function draw() {
    background(14, 16, 31);
    drawGradient();

    // Animated background stars (optimized)
    for (let s of stars) {
        let wanderX = s.base.x + (noise(s.noiseSeedX + millis() * 0.00005) - 0.5) * 0.02;
        let wanderY = s.base.y + (noise(s.noiseSeedY + millis() * 0.00005) - 0.5) * 0.02;
        let spos = skyToScreenFlat(createVector(wanderX, wanderY), 1.0, width/2, height/2);

        let t = millis() * 0.0003 + s.twinkleSeed;
        // Deeper, slower twinkle for main stars, more variation for faint stars
        let alpha = s.maxAlpha +
            50 * (noise(t) - 0.5) +
            24 * sin(frameCount * s.twinkleSpeed + s.twinkleSeed * 5);
        fill(red(s.color), green(s.color), blue(s.color), alpha);
        circle(spos.x, spos.y, s.r);
    }

    // Shooting stars with correct tail
    updateShootingStars();

    // Draw Orion
    drawOrionFlat(0.65);
}

function drawGradient() {
    let radius = sqrt(sq(width/2) + sq(height/2));
    for (let r = radius; r > 0; r -= 3) {
        let alpha = map(r, radius, 0, 0, 28);
        fill(30, 28, 40, alpha);
        ellipse(width/2, height/2, r*2);
    }
}

function drawOrionFlat(scale = 0.65) {
    let centerX = width / 2;
    let centerY = height / 2;
    let normPos = orionStars.map(getNormalizedCoords);
    let starPositions = normPos.map(nv => skyToScreenFlat(nv, scale, centerX, centerY));
    orionStarScreenPos = starPositions;

    // Lines
    stroke(90,140,240,120);
    strokeWeight(2.1);
    for (let pair of orionLines) {
        let [a, b] = pair;
        line(starPositions[a].x, starPositions[a].y, starPositions[b].x, starPositions[b].y);
    }
    noStroke();

    // Twinkling Orion stars
    hoveredStar = null;
    for (let i=0; i<orionStars.length; i++) {
        let sx = starPositions[i].x, sy = starPositions[i].y;
        let tw = 18 + 8*sin(frameCount*0.045 + i*7);
        let d = dist(mouseX, mouseY, sx, sy);
        let baseCol = randomColorFromType(orionStars[i].type);
        fill(red(baseCol), green(baseCol), blue(baseCol), d<28 ? 255 : 215);
        ellipse(sx, sy, d<28 ? tw*1.4 : tw);
        if (d < 23) hoveredStar = { ...orionStars[i], sx, sy, idx: i };
    }
    if (hoveredStar) {
        fill(24, 28, 40, 250);
        rect(mouseX+16, mouseY-28, 210, 56, 10);
        fill(255, 255, 240);
        textSize(17);
        text(hoveredStar.name, mouseX+24, mouseY-10);
        textSize(12);
        text(hoveredStar.info, mouseX+24, mouseY+8);
        cursor(HAND);
    } else {
        cursor(ARROW);
    }
}

// Shooting Stars with Correct Tapered Tail
function updateShootingStars() {
    if (random(1) < 0.010 && shootingStars.length < 2) {
        shootingStars.push({
            x: random(width * 0.4, width),
            y: random(0, height * 0.4),
            vx: -random(2.5, 5.5),
            vy: random(1.0,2.5),
            trail: [],
            life: 0,
            maxLife: random(65,110)
        });
    }
    for (let i = shootingStars.length-1; i >= 0; i--) {
        let s = shootingStars[i];

        // Update position
        s.x += s.vx * 0.7;
        s.y += s.vy * 0.7;
        s.trail.push({x: s.x, y: s.y});
        if (s.trail.length > 18) s.trail.shift();

        s.life++;
        let headAlpha = map(s.life, 0, s.maxLife, 220, 0);
        let headSize = 4.5 + 1.8 * sin(frameCount*0.11 + i*11);

        // Draw tail from oldest to newest: thinnest, faintest at start, thickest, brightest at head
        for (let j = 0; j < s.trail.length; j++) {
            let pct = j / (s.trail.length-1); // 0 = tail, 1 = head
            let alpha = 64 * pow(pct, 1.8); // fades out fast at tail
            let size = headSize * (0.45 + pct*0.8); // thickest at head, thinnest at tail
            fill(255, 255, 255, alpha);
            ellipse(s.trail[j].x, s.trail[j].y, size, size*0.7);
        }
        // Head
        fill(255, 255, 255, headAlpha);
        ellipse(s.x, s.y, headSize);

        if (s.life > s.maxLife) shootingStars.splice(i, 1);
    }
}

// --- Star click interaction ---
function mousePressed() {
    if (!orionStarScreenPos) return;
    for (let i = 0; i < orionStarScreenPos.length; i++) {
        let pos = orionStarScreenPos[i];
        if (dist(mouseX, mouseY, pos.x, pos.y) < 24) {
            handleStarClick(i);
            break;
        }
    }
}

// --- Star actions (customized as requested) ---
function handleStarClick(idx) {
    switch(idx) {
        case 0: openTerminal(); break;
        case 1: openProjects(); break;
        case 2: openPapers(); break;
        case 3: openSkills(); break;
        case 4: openBlog(); break;
        case 5: placeholderAction(); break;
        case 6: openRigel(); break;
    }
}
//function openTerminal()   { alert("Terminal (Linux shell) overlay coming soon!"); }
//function openProjects()   { alert("Projects section coming soon!"); }
//function openPapers()     { alert("Papers/Publications section coming soon!"); }
function openSkills()     { alert("Skills/Tech Stack section coming soon!"); }
function openBlog()       { alert("Blog section coming soon!"); }
function placeholderAction() { alert("This feature will be available soon!"); }

function windowResized() {
    resizeCanvas(window.innerWidth, window.innerHeight);
}

function openProjects() {
    window.location.href = "projects.html";
}
function openPapers() {
    window.location.href = "papers.html";
}
function openBlog() {
    window.location.href = "blogs.html";
}
function openRigel() {
    window.location.href = "rigel.html";
}