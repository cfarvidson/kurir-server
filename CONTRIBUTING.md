# Contributing to Kurir

Thanks for your interest in Kurir. This document covers how to set up a development environment, the conventions we follow, and how to get a change merged.

## Code of Conduct

This project follows our [Code of Conduct](CODE_OF_CONDUCT.md). Be kind, be useful, and treat everyone with respect.

## Getting Started

### Prerequisites

- Node.js 22+ (see `.nvmrc`)
- pnpm 9.15+ (`corepack enable && corepack prepare pnpm@9.15.0 --activate`)
- Docker (for PostgreSQL and Redis)

### Local Development

```bash
git clone https://github.com/cfarvidson/kurir-server.git
cd kurir-server
pnpm install
docker compose up postgres redis -d
cp .env.example .env
pnpm db:generate
pnpm db:push
pnpm dev
```

The dev server runs at <http://localhost:3000>.

Create a user with `pnpm add-user` and follow the prompts to connect IMAP/SMTP.

## Project Structure

```
src/
  app/                  # Next.js App Router
    (auth)/             # Login, setup wizard (unprotected)
    (mail)/             # Mail pages (protected by middleware)
    api/                # API routes
  actions/              # Server actions
  components/           # React components
    mail/               # Email UI
    layout/             # Sidebar, navigation, tab bar
    ui/                 # shadcn-style primitives
  lib/
    mail/               # IMAP sync, threads, search
    auth.ts             # NextAuth (Node runtime)
    auth.config.ts      # NextAuth (edge-safe, used by middleware)
    db.ts               # Prisma client
prisma/
  schema.prisma         # Data model
scripts/                # CLI utilities (add-user, sync-user, backup)
```

See `CLAUDE.md` for architectural notes and gotchas.

## Making Changes

### Workflow

1. **Open an issue first** for anything non-trivial — features, UX changes, or refactors. This avoids wasted work if the direction doesn't fit.
2. **Fork and branch** from `main`. Use a descriptive branch name.
3. **Keep PRs focused.** One change per PR. If you find unrelated issues, open a separate PR.
4. **Write clear commit messages** in the conventional commit style we use (lowercase, imperative):
   ```
   fix: prevent duplicate sync when imap connection drops
   feat: add bulk archive shortcut
   docs: clarify oauth setup for outlook
   ```
5. **Test your change.** No automated test framework is configured yet, so manually verify the affected flows.

### Code Style

- **TypeScript everywhere**, strict mode.
- **Format with Prettier** before committing: `npx prettier --write .`
- **Lint with ESLint**: `pnpm lint`
- **Tailwind CSS** with HSL variables and shadcn-style components (CVA for variants).
- **File naming:** `kebab-case.ts` for files, `PascalCase` for component exports.
- **Path alias:** import from `@/` (maps to `src/`).
- **Multi-tenancy:** every database query must filter by `userId`.
- **Mutations** that affect sidebar counts must call `revalidateTag("sidebar-counts")`.
- **All UI text in English** for now.

### Server Actions

Server actions follow this pattern:

```ts
"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function archiveMessage(messageId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  // Verify ownership
  const message = await db.message.findFirst({
    where: { id: messageId, userId: session.user.id },
  });
  if (!message) throw new Error("Not found");

  // Mutate
  await db.message.update({
    where: { id: messageId },
    data: { isArchived: true },
  });

  revalidateTag("sidebar-counts");
}
```

Auth check → ownership verification → mutation → revalidate.

## Submitting a Pull Request

1. Push your branch and open a PR against `main`.
2. Fill in the PR description: **Why** the change is needed, **what** it does, and **how** to test it.
3. Link the related issue (`Fixes #123`).
4. Be patient and responsive to review feedback.

## Reporting Bugs

Open an issue with:

- A clear title and description
- Steps to reproduce
- Expected vs actual behavior
- Your environment (browser, OS, deployment method)
- Relevant logs (`docker compose logs app` or `kamal app logs`)

For security vulnerabilities, see [SECURITY.md](SECURITY.md) — please do **not** open a public issue.

## License

By contributing, you agree that your contributions will be licensed under the [O'Saasy License](LICENSE).
