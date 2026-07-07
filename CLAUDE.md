# CLAUDE.md — hard constraints for this repo

This repo is `Alpharceus/Alpharceus.github.io`, deployed via IONOS Deploy Now to
**ramanpandey.com** — Raman Pandey's public portfolio. Everything committed here is
public the moment it deploys. The rules below are hard constraints, not suggestions.

## 1. QCAP compliance (most important rule)

Any text describing **MZI, GBS, quantum-dot driving, SNSPD readout, or QCAP work**
may ONLY use language from these public sources:

- (a) NSF award #2531569 public abstract
- (b) the approved SLE poster (R. Pandey et al., "Systems-Level Engineering for
  Quantum Computing Applications of Photonics: Control, Timing, and Readout in a
  GBS Sampler") — sanctioned vocabulary: electrically driven QD emitters,
  electrically tuned MZI mesh / tunable photonic unitary, FPGA readout, dynamic
  SPAD biasing
- (c) QCAP public web pages

**NEVER elaborate, infer, or add technical detail beyond these sources — even if
asked to "improve" or "expand" the text.** If asked to improve QCAP-related copy,
rephrase within the sanctioned vocabulary only, or flag that new detail needs
advisor (Osinski) approval. SNSPD project code is not releasable; never suggest
publishing it or describing its internals.

## 2. IONOS workflows

- **Never edit `.github/workflows/deploy-to-ionos.yaml`** — IONOS-managed; its
  header says so.
- Custom build steps go in `.github/workflows/Alpharceus.github.io-build.yaml`
  (between checkout and the "Store deployment content" step), per
  https://docs.ionos.space/docs/github-actions-customization/. Do not touch the
  artifact-upload action itself.

## 3. papers.json stays empty

`assets/papers.json` holds **journal papers only** and there are none yet — it
stays `[]`. Never add template/placeholder data (the file is publicly fetchable
raw). Conference papers and posters belong on the projects page and the UNM page.
The schema example lives in a readme comment, not as live data.

## 4. Privacy

No content may encode Raman's physical schedule, location patterns, or home
network details (static IPs, Tailscale hostnames, device names, weekly routines).
`assets/schedule.json`, if present, must contain only explicitly fictional content.

## 5. File conventions

- UTF-8 encoding, consistent line endings (LF preferred).
- Validate every JSON-LD block after editing (schema.org properties only, no
  invented fields; keep descriptions honest and short).
- Machine-facing content must be static HTML with plain `<a href>` links —
  crawlers do not execute JS. Anything rendered client-side from JSON needs a
  static-HTML or `<noscript>` equivalent if it matters for search/LLM indexing.
