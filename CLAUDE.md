# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **stone material business management system** (石材業務管理システム) — a static, multi-page PWA for managing burial plots and engraving orders across multiple temple sites. It is deployed via Netlify with a catch-all SPA redirect to `index.html`.

## Development

No build step, no package manager, no test framework. All pages are standalone HTML files with inline CSS and JavaScript. To develop, open HTML files directly in a browser or serve them locally:

    ```bash
    # Simple local server (Python)
    python3 -m http.server 8080

    # Or with Node
    npx serve .
    ```

Deployment: push to `main` — Netlify auto-deploys.

## Architecture

### Pages

| File | Purpose |
|------|---------|
| `index.html` | Main SPA — login, search, list/detail views for all temple records |
| `map.html` | Interactive canvas-based cemetery plot map with PDF export |
| `uketsuke.html` | Print-optimized A4 engraving order receipt form |
| `envelope.html` | Japanese vertical-text envelope address printer |

### Data Files

`data_[temple].js` files each export a `MAP_DATA_[temple]` object containing cemetery plot records (row/col indices, status, family name). These are consumed by both `index.html` (record lookup) and `map.html` (plot rendering on a 25px grid).

`Data_jikoji_offline_20260414.js` is the offline snapshot for Jikoji used when network is unavailable.

`map_config.js` controls which temple's map is shown (`OFFLINE_MODE_TEMPLE`) and has a `FORCE_OFFLINE` flag for offline debugging.

### Authentication

`index.html` uses **MSAL browser v2.38.0** (loaded from CDN) for Microsoft Azure AD / Microsoft 365 authentication. Auth config (tenant ID, client ID, scopes) lives at the top of `index.html`.

### PWA / Offline

`sw.js` is the service worker that caches assets for offline use. `manifest.json` enables PWA installation. Offline map data is served from the `Data_jikoji_offline_*.js` snapshot files.

### Supported Temples

jikoji, chouzenji, fukujuin, komyoin, joiinzi, kugayama, soshuji, gansen, amanuma

## Key Constraints

- All logic is inline in each HTML file — no shared JS modules or external `.js` utility files.
- `map.html` renders plots on an HTML `<canvas>` using a fixed 25px grid; plot coordinates in data files match this grid size.
- Print layouts (`uketsuke.html`, `envelope.html`) use `@media print` CSS — test with browser print preview.
- Japanese text uses Google Fonts (Noto Sans JP / Noto Serif JP); `envelope.html` uses CSS `writing-mode: vertical-rl` for traditional vertical address layout.
