// ------- MATRIX RAIN EFFECT -------
const matrixChars = [
    ..."RamanPandey",
    ..."रमनपाण्डे",
    ..."ラマンパンデイ",
    ..."РаманПандей",
    ..."拉曼潘德伊",
    ..."رامانباندى",
    ..."52616D616E50616E646579",
    ..."0101001001100001011011010110000101101110010100000110000101101110011001000110010101111001"
];

let matrixRain = {
    canvas: null,
    ctx: null,
    columns: [],
    fontSize: 22,
    animationId: null,
    theme: "dark"
};

function startMatrixRain() {
    matrixRain.canvas = document.getElementById("matrix-rain");
    matrixRain.ctx = matrixRain.canvas.getContext("2d");
    resizeMatrixRain();
    window.addEventListener("resize", resizeMatrixRain);

    const cols = Math.floor(window.innerWidth / matrixRain.fontSize);
    matrixRain.columns = new Array(cols).fill(0);

    matrixRain.animationId = requestAnimationFrame(drawMatrixRain);
}
function stopMatrixRain() {
    if (matrixRain.animationId) cancelAnimationFrame(matrixRain.animationId);
    window.removeEventListener("resize", resizeMatrixRain);
    if (matrixRain.ctx && matrixRain.canvas) {
        matrixRain.ctx.clearRect(0, 0, matrixRain.canvas.width, matrixRain.canvas.height);
    }
}
function resizeMatrixRain() {
    matrixRain.canvas.width = window.innerWidth;
    matrixRain.canvas.height = window.innerHeight;
    const cols = Math.floor(window.innerWidth / matrixRain.fontSize);
    matrixRain.columns = new Array(cols).fill(0);
}
function drawMatrixRain() {
    const ctx = matrixRain.ctx;
    const width = matrixRain.canvas.width;
    const height = matrixRain.canvas.height;
    ctx.fillStyle = matrixRain.theme === "dark" ? "rgba(10,12,20,0.28)" : "rgba(200,220,255,0.13)";
    ctx.fillRect(0, 0, width, height);

    ctx.font = `bold ${matrixRain.fontSize}px monospace`;
    ctx.textAlign = "center";
    for (let i = 0; i < matrixRain.columns.length; i++) {
        let x = i * matrixRain.fontSize + matrixRain.fontSize / 2;
        let y = matrixRain.columns[i] * matrixRain.fontSize;
        let char = matrixChars[Math.floor(Math.random()*matrixChars.length)];

        ctx.fillStyle = matrixRain.theme === "dark" ? "#2aff2a" : "#1c3e60";
        ctx.shadowColor = matrixRain.theme === "dark" ? "#11f911" : "#fff";
        ctx.shadowBlur = 8;
        ctx.fillText(char, x, y);

        ctx.shadowBlur = 0;

        if (y > height && Math.random() > 0.94) {
            matrixRain.columns[i] = 0;
        } else {
            matrixRain.columns[i]++;
        }
    }
    matrixRain.animationId = requestAnimationFrame(drawMatrixRain);
}

// ----------- TERMINAL LOGIC -----------
// === Put your admin password here ===
const ADMIN_PW = "yourSuperSecret123"; // <-- CHANGE THIS!
// -------- MOTD SUPPORT (from assets/motd.json) --------
let motdCache = null;

function loadMotds() {
    // returns a Promise that resolves to an array
    return fetch('assets/motd.json')
        .then(res => res.json())
        .then(list => {
            if (!Array.isArray(list) || list.length === 0) {
                throw new Error("Empty MOTD list");
            }
            motdCache = list;
            return list;
        });
}

function formatMotd(entry) {
    if (typeof entry === "string") {
        return entry;
    }
    if (entry && typeof entry === "object") {
        if (entry.author) {
            return `${entry.text} —${entry.author}`;
        }
        return entry.text || "";
    }
    return "";
}

function echoRandomMotd(term) {
    if (motdCache && motdCache.length) {
        const idx = Math.floor(Math.random() * motdCache.length);
        const msg = formatMotd(motdCache[idx]);
        if (msg) term.echo(msg);
        else term.echo("No MOTD found.");
        return;
    }

    // first-time load
    loadMotds()
        .then(list => {
            const idx = Math.floor(Math.random() * list.length);
            const msg = formatMotd(list[idx]);
            if (msg) term.echo(msg);
            else term.echo("No MOTD found.");
        })
        .catch(() => {
            // fallback if JSON missing/broken
            const fallback = "The universe is under no obligation to make sense to you. —NDT";
            term.echo(fallback);
        });
}
// -------- COMMAND DEFINITIONS --------
const terminalCommands = {
    "help": {
        desc: "List all commands",
        action: function(term) {
            term.echo(
                "Available commands:\n" +
                " about, resume, contact, github, linkedin, twitter, email, theme, schedule, admin, logout, clear, exit\n" +
                " [Also try: projects, papers, blog, motd, whoami]"
            );
        }
    },
    "about": {
        desc: "Show about info",
        action: function(term) {
            term.echo("Raman Pandey, ECE & Astrophysics @ UNM. Quantum/ML nerd, Linux fan.\nType 'resume' for credentials or visit my GitHub.");
        }
    },
    "projects": {
        desc: "Open projects page",
        action: function(term) {
            window.location.href = "projects.html";
        }
    },
    "papers": {
        desc: "Open papers page",
        action: function(term) {
            window.location.href = "papers.html";
        }
    },


    "blog": {
        desc: "Visit my blog (from file)",
        action: function(term) {
            fetch('assets/blogs.json')
              .then(res => res.json())
              .then(blogs => {
                  blogs.forEach(blog =>
                      term.echo(`- ${blog.title}: ${blog.link || "Coming soon!"}`)
                  );
              })
              .catch(() => term.echo("No blog posts available."));
        }
    },
    "motd": {
        desc: "Message of the day",
        action: function(term) {
            echoRandomMotd(term);
        }
    },

    "email": {
        desc: "Show email addresses",
        action: function(term) {
            term.echo(
              "Institutional: ramanpandey01@unm.edu\nPersonal: alpharceus@gmail.com"
            );
        }
    },
    "whoami": {
        desc: "Identify user",
        action: function(term) {
            term.echo("raman@portfolio:~$ " + "human (or are you?)");
        }
    },
    "resume": {
        desc: "Show/download resume",
        action: function(term) {
            term.echo("Opening resume...");
            window.open("assets/resume.pdf", "_blank");
        }
    },
    "contact": {
        desc: "Contact me (send a message via terminal form)",
        action: function(term) {
            term.startContactForm();
        }
    },
    "github": {
        desc: "Open GitHub",
        action: function(term) {
            window.open("https://github.com/Alpharceus", "_blank");
            term.echo("Opening GitHub...");
        }
    },
    "linkedin": {
        desc: "Open LinkedIn",
        action: function(term) {
            window.open("https://linkedin.com/in/alpha-arceus", "_blank");
            term.echo("Opening LinkedIn...");
        }
    },
    "twitter": {
        desc: "Open Twitter/X",
        action: function(term) {
            window.open("https://twitter.com/alpha_arceus", "_blank");
            term.echo("Opening Twitter/X...");
        }
    },
    "theme": {
        desc: "theme [0|1] — dark(0) or light(1)",
        action: function(term, arg) {
            if (arg === "0") {
                term.setTheme("dark");
            } else if (arg === "1") {
                term.setTheme("light");
            } else {
                term.echo("You're too early for this feature!");
            }
        }
    },
    "schedule": {
        desc: "Show your schedule (admin only)",
        action: function(term) {
            if (localStorage.getItem("admin") === "true") {
                fetch('assets/schedule.json')
                  .then(res => res.json())
                  .then(schedule => {
                      term.echo("Your Private Schedule:");
                      schedule.forEach(ev =>
                        term.echo(`- ${ev.day} ${ev.time}: ${ev.activity}`)
                      );
                  })
                  .catch(() => term.echo("Could not load schedule."));
            } else {
                term.echo("Admin only.");
            }
        }
    },
    "admin": {
        desc: "Login as admin to view private data",
        action: function(term) {
            term.echo("Enter admin password:");
            term.awaitAdminLogin = true;
        }
    },
    "logout": {
        desc: "Logout admin",
        action: function(term) {
            localStorage.removeItem("admin");
            term.echo("Logged out.");
        }
    },
    "clear": {
        desc: "Clear terminal",
        action: function(term) { term.clear(); }
    },
    "exit": {
        desc: "Close terminal",
        action: function(term) { term.close(); }
    }
};

class Terminal {
    constructor() {
        this.overlay = document.getElementById("terminal-overlay");
        this.window = document.getElementById("terminal-window");
        this.output = document.getElementById("terminal-output");
        this.input = document.getElementById("terminal-input");
        this.prompt = document.querySelector(".terminal-prompt");
        this.history = [];
        this.histPtr = 0;
        this.theme = "dark";
        this.opened = false;
        this.bindEvents();
    }
    open() {
        if (this.opened) return;
        this.overlay.classList.remove("hidden");
        this.theme = "dark";
        this.setTheme(this.theme);
        this.clear();
        setTimeout(() => {
            this.input.focus();
        }, 60);
        this.echo("Welcome to Raman's Portfolio Terminal!\nType 'help' to see available commands.");
        startMatrixRain();
        this.opened = true;
    }
    close() {
        this.overlay.classList.add("hidden");
        stopMatrixRain();
        this.opened = false;
    }
    clear() {
        this.output.innerHTML = "";
    }
    echo(txt) {
        let pre = document.createElement("pre");
        pre.textContent = txt;
        this.output.appendChild(pre);
        this.output.scrollTop = this.output.scrollHeight;
    }
    setTheme(mode) {
        this.theme = mode === "light" ? "light" : "dark";
        document.body.setAttribute('data-theme', this.theme);
        matrixRain.theme = this.theme;
        if (this.theme === "light") {
            this.overlay.classList.add("light");
            this.window.classList.add("light");
            this.input.style.color = "#222";
            this.prompt.style.color = "#0056c9";
        } else {
            this.overlay.classList.remove("light");
            this.window.classList.remove("light");
            this.input.style.color = "#fff";
            this.prompt.style.color = "#79b8ff";
        }
    }
    bindEvents() {
        this.overlay.addEventListener("mousedown", e => {
            if (e.target === this.overlay) this.close();
        });
        this.input.addEventListener("keydown", e => this.onKey(e));
        document.addEventListener("keydown", e => {
            if (!this.overlay.classList.contains("hidden") && e.key === "Escape") {
                this.close();
            }
        });
        this.input.addEventListener("focus", () => {
            if (this.overlay.classList.contains("hidden")) {
                this.open();
            }
        });
    }
    onKey(e) {
        if (e.key === "Enter") {
            const val = this.input.value.trim();
            if (!val) return;
            this.echo("raman@portfolio:~$ " + val);
            this.history.push(val);
            this.histPtr = this.history.length;
            this.input.value = "";
            this.handleCmd(val);
        } else if (e.key === "ArrowUp") {
            if (this.histPtr > 0) {
                this.histPtr--;
                this.input.value = this.history[this.histPtr] || "";
                setTimeout(() => this.input.setSelectionRange(this.input.value.length, this.input.value.length), 10);
            }
            e.preventDefault();
        } else if (e.key === "ArrowDown") {
            if (this.histPtr < this.history.length - 1) {
                this.histPtr++;
                this.input.value = this.history[this.histPtr] || "";
            } else {
                this.histPtr = this.history.length;
                this.input.value = "";
            }
            setTimeout(() => this.input.setSelectionRange(this.input.value.length, this.input.value.length), 10);
            e.preventDefault();
        } else if (e.key === "Tab") {
            e.preventDefault();
            this.handleAutocomplete();
        }
    }
    handleCmd(val) {
        // Admin login logic (static, client-only)
        if (this.awaitAdminLogin) {
            if (val.trim() === ADMIN_PW) {
                this.echo("Admin login successful!");
                localStorage.setItem("admin", "true");
                this.echo("Type 'schedule' to see your private schedule.");
            } else {
                this.echo("Wrong password.");
            }
            this.awaitAdminLogin = false;
            return;
        }
        // Contact form wizard
        if (this.awaitContactInput && this.contactForm) {
            if (val.trim().toLowerCase() === "cancel") {
                this.echo("Contact form cancelled.");
                this.awaitContactInput = false;
                this.contactForm = null;
                return;
            }
            if (this.contactForm.step === 0) {
                this.contactForm.name = val.trim();
                this.echo("Your Email:");
                this.contactForm.step = 1;
                return;
            }
            if (this.contactForm.step === 1) {
                this.contactForm.email = val.trim();
                this.echo("Your Message:");
                this.contactForm.step = 2;
                return;
            }
            if (this.contactForm.step === 2) {
                this.contactForm.msg = val.trim();
                this.echo("Submitting your message…");
                // EmailJS integration
                emailjs.send("service_x844p0t", "template_8n0fjwl", {
                    name: this.contactForm.name,
                    email: this.contactForm.email,
                    message: this.contactForm.msg
                }).then((response) => {
                    this.echo("Thank you! Your message has been sent.");
                }, (error) => {
                    this.echo("Oops! Something went wrong. Please try again later.");
                    console.error("EmailJS error:", error);
                });
                this.awaitContactInput = false;
                this.contactForm = null;
                return;
            }
        }

        // Normal command handling
        let [cmd, ...args] = val.split(" ");
        cmd = cmd.toLowerCase();
        if (terminalCommands[cmd]) {
            terminalCommands[cmd].action(this, ...args);
        } else {
            this.echo(`Command not found: ${cmd}. Type 'help' to see available commands.`);
        }
    }
    handleAutocomplete() {
        const prefix = this.input.value.trim().toLowerCase();
        const matches = Object.keys(terminalCommands).filter(cmd => cmd.startsWith(prefix));
        if (matches.length === 1) {
            this.input.value = matches[0];
        } else if (matches.length > 1) {
            this.echo(matches.join("    "));
        }
    }
    startContactForm() {
        this.contactForm = { step: 0, name: "", email: "", msg: "" };
        this.echo("Contact form (type 'cancel' anytime to exit):");
        this.echo("Your Name:");
        this.awaitContactInput = true;
    }
}
let terminal = new Terminal();

function openTerminal() {
    terminal.open();
}
