import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { db } from "./db";
import { encrypt, decrypt } from "./crypto";
import { z } from "zod";

// Provider presets for common email services
const PROVIDER_PRESETS: Record<
  string,
  { imapHost: string; imapPort: number; smtpHost: string; smtpPort: number }
> = {
  gmail: {
    imapHost: "imap.gmail.com",
    imapPort: 993,
    smtpHost: "smtp.gmail.com",
    smtpPort: 587,
  },
  outlook: {
    imapHost: "outlook.office365.com",
    imapPort: 993,
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
  },
  icloud: {
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    smtpHost: "smtp.mail.me.com",
    smtpPort: 587,
  },
  yahoo: {
    imapHost: "imap.mail.yahoo.com",
    imapPort: 993,
    smtpHost: "smtp.mail.yahoo.com",
    smtpPort: 587,
  },
};

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  imapHost: z.string().optional(),
  imapPort: z.coerce.number().optional(),
  smtpHost: z.string().optional(),
  smtpPort: z.coerce.number().optional(),
  provider: z.string().optional(),
});

async function verifyImapCredentials(
  email: string,
  password: string,
  host: string,
  port: number
): Promise<boolean> {
  // Dynamic import to avoid bundling Node.js modules in client
  const { verifyImapCredentials: verify } = await import("./mail/imap-verify");
  return verify(email, password, host, port);
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: "Email Account",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        imapHost: { label: "IMAP Host", type: "text" },
        imapPort: { label: "IMAP Port", type: "number" },
        smtpHost: { label: "SMTP Host", type: "text" },
        smtpPort: { label: "SMTP Port", type: "number" },
        provider: { label: "Provider", type: "text" },
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) {
          return null;
        }

        const { email, password, provider } = parsed.data;

        // Get server config from preset or custom values
        let imapHost = parsed.data.imapHost;
        let imapPort = parsed.data.imapPort ?? 993;
        let smtpHost = parsed.data.smtpHost;
        let smtpPort = parsed.data.smtpPort ?? 587;

        if (provider && PROVIDER_PRESETS[provider]) {
          const preset = PROVIDER_PRESETS[provider];
          imapHost = imapHost || preset.imapHost;
          imapPort = imapPort || preset.imapPort;
          smtpHost = smtpHost || preset.smtpHost;
          smtpPort = smtpPort || preset.smtpPort;
        }

        if (!imapHost || !smtpHost) {
          console.error("Missing IMAP/SMTP host configuration");
          return null;
        }

        // Verify IMAP credentials
        const isValid = await verifyImapCredentials(
          email,
          password,
          imapHost,
          imapPort
        );

        if (!isValid) {
          return null;
        }

        // Create or update user in database
        const encryptedPassword = encrypt(password);

        const user = await db.user.upsert({
          where: { email },
          create: {
            email,
            encryptedPassword,
            imapHost,
            imapPort,
            smtpHost,
            smtpPort,
          },
          update: {
            encryptedPassword,
            imapHost,
            imapPort,
            smtpHost,
            smtpPort,
          },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.displayName,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
});

// Helper to get current user with DB data
export async function getCurrentUser() {
  const session = await auth();
  if (!session?.user?.id) return null;

  return db.user.findUnique({
    where: { id: session.user.id },
  });
}

// Helper to get decrypted password for email operations
export async function getUserCredentials(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      encryptedPassword: true,
      imapHost: true,
      imapPort: true,
      smtpHost: true,
      smtpPort: true,
    },
  });

  if (!user) return null;

  return {
    email: user.email,
    password: decrypt(user.encryptedPassword),
    imap: {
      host: user.imapHost,
      port: user.imapPort,
    },
    smtp: {
      host: user.smtpHost,
      port: user.smtpPort,
    },
  };
}
