// --- Load and render papers
fetch('assets/papers.json')
    .then(resp => resp.json())
    .then(papers => {
        const list = document.getElementById('papers-list');
        list.innerHTML = papers.map(p =>
            `<div class="paper-card">
                <div class="paper-title">${p.title}</div>
                <div class="paper-authors">${p.authors || ""}</div>
                <div class="paper-journal">
                    ${p.journal || ""}${p.year ? " ("+p.year+")" : ""}
                    ${p.doi ? `<a href="https://doi.org/${p.doi}" target="_blank" style="color:#f1d8b3;">[DOI]</a>` : ''}
                    ${p.link ? `<a href="${p.link}" target="_blank" style="color:#80ffee;margin-left:1.1em;">[Read]</a>` : ''}
                </div>
                <div class="paper-abstract">${p.abstract || ""}</div>
            </div>`
        ).join('');
    });

// --- Load and render papers as before (keep your previous code) ---

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
