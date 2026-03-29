title: feat: Landing Page and Documentation Site
type: feat
date: 2026-03-29

# Landing Page and Documentation Site (ARV-764)

## Overview

Create a standalone static landing page and documentation site for Kurir. The site serves two audiences: **prospective users** discovering Kurir for the first time (landing page) and **existing users** needing setup/troubleshooting help (docs). The aesthetic targets Once.com — clean, confident, minimal, no-nonsense.

## Problem Statement / Motivation

Kurir has a comprehensive README but no public-facing website. Prospective users have no way to evaluate the product without reading a GitHub repository. The documentation is scattered across README.md, DEPLOY.md, and inline comments. A dedicated site would:

- Give Kurir a professional public presence
- Provide a clear installation funnel (discover → install → configure)
- Centralize documentation in a browsable, searchable format
- Match the product's positioning as a premium, self-hosted email experience

## Proposed Solution

A standalone Astro static site in a `site/` directory at the project root, deployed to GitHub Pages via GitHub Actions.

### Why Astro?

- **Content-focused** — Built for content sites with first-class Markdown support
- **Zero JS by default** — Ships pure HTML/CSS, perfect for a docs site
- **Tailwind native** — Consistent with the main Kurir project's styling approach
- **Content Collections** — Type-safe Markdown with frontmatter schemas, ideal for docs
- **Island architecture** — Can add interactive components (copy button, mobile nav) without JS bloat
- **GitHub Pages** — First-class support, simple deployment

### Why not alternatives?

- **VitePress** — Great for pure docs but limited for custom landing page design
- **Plain HTML** — Too much boilerplate, no Markdown support, hard to maintain
- **Next.js static export** — Overkill, would blur the boundary with the main app

## Technical Approach

### Architecture

```
site/                          # Standalone Astro project
├── astro.config.mjs           # Astro config (Tailwind, site URL)
├── package.json               # Astro + Tailwind deps
├── tsconfig.json
├── public/
│   ├── favicon.svg            # Kurir favicon
│   └── screenshots/           # Product screenshots (placeholder initially)
├── src/
│   ├── layouts/
│   │   ├── BaseLayout.astro   # HTML shell, meta, fonts
│   │   └── DocsLayout.astro   # Docs page with sidebar nav
│   ├── pages/
│   │   ├── index.astro        # Landing page
│   │   └── docs/
│   │       ├── index.astro    # Docs home (redirects to getting-started)
│   │       └── [...slug].astro # Dynamic docs pages from content collection
│   ├── content/
│   │   ├── config.ts          # Content collection schema
│   │   └── docs/
│   │       ├── getting-started.md
│   │       ├── installation.md
│   │       ├── configuration.md
│   │       ├── email-accounts.md
│   │       ├── backup-restore.md
│   │       ├── updating.md
│   │       ├── troubleshooting.md
│   │       └── faq.md
│   ├── components/
│   │   ├── Header.astro       # Top nav (logo + docs link + GitHub)
│   │   ├── Footer.astro       # Minimal footer
│   │   ├── Hero.astro         # Landing hero section
│   │   ├── Features.astro     # Feature highlights grid
│   │   ├── InstallSnippet.astro # curl command with copy button
│   │   ├── SystemRequirements.astro
│   │   └── DocsSidebar.astro  # Docs navigation sidebar
│   └── styles/
│       └── global.css         # Tailwind directives + custom styles
└── tailwind.config.mjs
```

### Implementation Phases

#### Phase 1: Astro Project Scaffold

- [ ] Initialize Astro project in `site/` with Tailwind integration
- [ ] Set up `package.json` with build/dev scripts
- [ ] Configure `astro.config.mjs` for GitHub Pages (base URL, site URL)
- [ ] Set up `tailwind.config.mjs` with custom theme (Once.com-inspired palette)
- [ ] Create `BaseLayout.astro` with HTML shell, system font stack, meta tags

**Files:** `site/package.json`, `site/astro.config.mjs`, `site/tailwind.config.mjs`, `site/tsconfig.json`, `site/src/layouts/BaseLayout.astro`, `site/src/styles/global.css`

#### Phase 2: Landing Page

- [ ] **Header** (`Header.astro`) — Logo/wordmark, "Docs" link, GitHub icon link. Sticky, minimal.
- [ ] **Hero** (`Hero.astro`) — Headline ("Your email, your server, your rules" or similar), subheadline explaining Hey.com-style + self-hosted, one-command install snippet with copy button, screenshot/placeholder
- [ ] **Features** (`Features.astro`) — Grid of 4-6 feature cards:
  - Screener: "First-time senders don't reach your inbox"
  - Imbox: "Only emails from people you care about"
  - The Feed: "Newsletters in a browsable feed"
  - Paper Trail: "Receipts and notifications, separate"
  - Search: "Full-text search across all your email"
  - Self-hosted: "Own your data, run on your server"
- [ ] **Install Snippet** (`InstallSnippet.astro`) — Prominent `curl` command with copy-to-clipboard, brief "What this does" explanation
- [ ] **System Requirements** (`SystemRequirements.astro`) — Ubuntu 22.04+/Debian 12+, Docker, 1GB RAM, ports 80/443
- [ ] **Footer** (`Footer.astro`) — MIT license, GitHub link, "Built with Astro"
- [ ] **Responsive** — Mobile-first, looks good on all breakpoints

**Files:** `site/src/pages/index.astro`, `site/src/components/Header.astro`, `site/src/components/Hero.astro`, `site/src/components/Features.astro`, `site/src/components/InstallSnippet.astro`, `site/src/components/SystemRequirements.astro`, `site/src/components/Footer.astro`

#### Phase 3: Documentation Pages

- [ ] **Content collection** (`site/src/content/config.ts`) — Schema with `title`, `description`, `order` (for sidebar sort)
- [ ] **Docs layout** (`DocsLayout.astro`) — Sidebar nav + content area + mobile hamburger
- [ ] **Sidebar** (`DocsSidebar.astro`) — Auto-generated from content collection, sorted by `order`, highlights current page
- [ ] **Dynamic route** (`[...slug].astro`) — Renders any doc from content collection

Doc pages to create (content sourced from existing README.md, install.sh, .env.production.example):

| File | Content Source | Key Sections |
|------|---------------|-------------|
| `getting-started.md` | README Quick Start | Overview, prerequisites, 3 install options |
| `installation.md` | install.sh + README | One-command installer detail, Docker Compose manual, Kamal |
| `configuration.md` | .env.production.example | All env vars with descriptions, grouped by category |
| `email-accounts.md` | README Connecting Your Email | Provider table, OAuth setup (Microsoft/Google), custom IMAP |
| `backup-restore.md` | docs/BACKUP.md + scripts | Backup command, restore command, what's included |
| `updating.md` | New content | docker compose pull, Kamal deploy, checking for updates |
| `troubleshooting.md` | New + common IMAP issues | IMAP connection failures, firewall, DNS, sync stuck, OAuth |
| `faq.md` | New content | "Is it free?", "Which providers?", "Multiple users?", etc. |

**Files:** `site/src/content/config.ts`, `site/src/content/docs/*.md` (8 files), `site/src/layouts/DocsLayout.astro`, `site/src/components/DocsSidebar.astro`, `site/src/pages/docs/index.astro`, `site/src/pages/docs/[...slug].astro`

#### Phase 4: GitHub Pages Deployment

- [ ] Create `.github/workflows/deploy-site.yml` — Build Astro site and deploy to GitHub Pages
- [ ] Trigger on push to `main` (only when `site/` changes)
- [ ] Use `actions/deploy-pages` for deployment
- [ ] Add `site:dev`, `site:build`, `site:preview` convenience scripts to root `package.json`

**Files:** `.github/workflows/deploy-site.yml`, `package.json` (add scripts)

### Design System (Once.com-Inspired)

**Color palette:**
- Background: White (`#ffffff`) with very subtle warm gray sections (`#fafaf9`)
- Text: Near-black (`#1a1a1a`) for headings, dark gray (`#525252`) for body
- Accent: One bold color for CTAs and highlights (warm orange/coral or deep blue)
- Code blocks: Light gray background (`#f5f5f4`) with monospace font

**Typography:**
- System font stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- Large, confident headings (text-4xl to text-6xl)
- Generous line height and letter spacing
- Monospace for code: `'SF Mono', 'Fira Code', 'Cascadia Code', monospace`

**Layout principles:**
- Maximum content width: 720px for docs, 1120px for landing
- Generous whitespace (py-24 to py-32 between sections)
- No decorative borders or shadows — content speaks for itself
- Subtle transitions, no flashy animations

## Acceptance Criteria

### Functional Requirements

- [ ] Landing page loads at root URL with hero, features, install snippet, system requirements
- [ ] All 8 documentation pages render correctly from Markdown content
- [ ] Docs sidebar navigation works and highlights current page
- [ ] Copy-to-clipboard works on install snippet
- [ ] All pages are responsive (mobile, tablet, desktop)
- [ ] Internal links between docs pages work
- [ ] GitHub link in header points to the repository

### Non-Functional Requirements

- [ ] Lighthouse score > 95 for performance, accessibility, best practices, SEO
- [ ] Zero JavaScript shipped except for copy-to-clipboard island
- [ ] Full static output — no server-side rendering needed
- [ ] Pages load in < 1s on 3G
- [ ] Accessible: proper heading hierarchy, alt text, keyboard navigation, color contrast

### Quality Gates

- [ ] `astro build` completes without errors
- [ ] All links resolve (no 404s)
- [ ] Site matches Once.com aesthetic: clean, minimal, confident
- [ ] Documentation content is accurate and matches current install.sh / env config
- [ ] Mobile navigation works correctly

## Dependencies & Prerequisites

- None — this is a standalone static site with no dependency on the running Kurir app
- GitHub Pages must be enabled on the repository (Settings > Pages > Source: GitHub Actions)
- Screenshots will use placeholders initially (can be replaced with real screenshots later)

## Risk Analysis & Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Screenshots unavailable | Medium | Use styled placeholder boxes with feature descriptions |
| GitHub Pages base URL issues | Low | Configure `base` in astro.config.mjs correctly |
| Docs content drift from README | Medium | Docs are authoritative; README can link to site |

## References & Research

### Internal References

- `README.md` — Primary content source for features, installation, configuration
- `install.sh` — One-command installer details
- `.env.production.example` — Complete env var reference
- `docs/BACKUP.md` — Backup/restore documentation
- `.github/workflows/` — Existing CI/CD patterns

### External References

- Once.com — Design aesthetic target
- Astro docs: https://docs.astro.build
- GitHub Pages deployment: https://docs.astro.build/en/guides/deploy/github/
