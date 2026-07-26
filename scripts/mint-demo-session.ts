/**
 * Mint a NextAuth JWT session cookie for the demo screenshot user.
 * Prints the cookie value for authjs.session-token.
 *   DATABASE_URL=...kurir_demo NEXTAUTH_SECRET=... pnpm exec tsx scripts/mint-demo-session.ts
 */
import { encode } from "next-auth/jwt";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const user = await db.user.findFirstOrThrow();
  const cookieName = "authjs.session-token";
  const token = await encode({
    token: { id: user.id, role: user.role },
    secret: process.env.NEXTAUTH_SECRET!,
    salt: cookieName,
    maxAge: 24 * 60 * 60,
  });
  console.log(token);
}

main().finally(() => db.$disconnect());
