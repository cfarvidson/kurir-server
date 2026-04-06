# Security Policy

Kurir handles email — one of the most sensitive things on a person's computer. We take security reports seriously.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please report privately via one of:

1. **GitHub Security Advisories** (preferred): [Open a private advisory](https://github.com/cfarvidson/kurir-server/security/advisories/new)
2. **Email**: `carl-fredrik@arvidson.io` (PGP key available on request)

Please include:

- A description of the issue and its potential impact
- Steps to reproduce, or a proof-of-concept
- The version of Kurir affected (commit SHA or release tag)
- Your name and contact details (if you'd like credit)

## What to Expect

- **Acknowledgement** within 72 hours
- **Initial assessment** within one week
- **Coordinated disclosure**: we'll work with you on a timeline before public disclosure
- **Credit** in the release notes if you'd like (you can also stay anonymous)

## Scope

In scope:

- Authentication and session handling (passkeys, OAuth, NextAuth)
- IMAP/SMTP credential storage and encryption
- Multi-tenancy isolation (one user accessing another user's data)
- Server actions and API routes
- Email parsing and rendering (XSS, HTML injection)
- The setup wizard and admin dashboard
- Web Push subscription handling

Out of scope:

- Vulnerabilities in third-party dependencies that don't affect Kurir's actual usage (please report those upstream)
- Issues requiring physical access to a self-hosted server
- Issues in self-hosting infrastructure that the operator controls (Caddy config, server hardening, etc.)
- Social engineering or phishing of Kurir users
- Denial-of-service against single-user instances
- Missing security headers in development mode

## Supported Versions

Only the latest release receives security updates. Self-hosters are encouraged to update promptly when a release is published.

## Hardening Tips for Self-Hosters

- Run Kurir behind HTTPS (the installer sets up Caddy + Let's Encrypt automatically).
- Keep your `ENCRYPTION_KEY` and `AUTH_SECRET` secret and **never** commit them.
- Back up regularly using `pnpm backup` or the admin dashboard.
- Restrict database access to the application container.
- Keep your host OS, Docker, and Kurir up to date.

Thanks for helping keep Kurir and its users safe.
