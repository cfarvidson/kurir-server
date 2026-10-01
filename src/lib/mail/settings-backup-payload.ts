import { z } from "zod";

export const SETTINGS_BACKUP_KIND = "kurir-settings-backup";
export const SETTINGS_BACKUP_VERSION = 1;
export const SETTINGS_BACKUP_SUBJECT_PREFIX = "Kurir settings backup - ";
export const SETTINGS_BACKUP_FILENAME_RE = /^kurir-settings-.*\.json$/;
export const SETTINGS_BACKUP_KEEP = 4;

const FORBIDDEN_TOP_LEVEL = ["messages", "threads", "drafts", "folders"] as const;

export type SettingsBackupSource = "manual" | "scheduled";

export type SettingsBackupPreferences = {
  theme: string;
  timezone: string;
  blockRemoteImages: boolean;
  blockTrackers: boolean;
  showImboxBadge: boolean;
  showScreenerBadge: boolean;
  showFeedBadge: boolean;
  showPaperTrailBadge: boolean;
  showFollowUpBadge: boolean;
  showReplyLaterBadge: boolean;
  showScheduledBadge: boolean;
  // Additive: older backups have none.
  calendarAvailability?: unknown;
};

export type SettingsBackupContactEmail = {
  email: string;
  label: string;
  isPrimary: boolean;
};

export type SettingsBackupContact = {
  name: string;
  notes: string;
  emails: SettingsBackupContactEmail[];
};

export type SettingsBackupGroup = {
  name: string;
  defaultTarget: "TO" | "BCC";
  members: string[];
};

export type SettingsBackupSender = {
  connectionEmail: string;
  email: string;
  domain: string;
  status: "APPROVED" | "REJECTED";
  category: "IMBOX" | "FEED" | "PAPER_TRAIL" | null;
  unthread: boolean;
  allowRemoteImages: boolean;
};

export type SettingsBackupDomainRule = {
  connectionEmail: string;
  pattern: string;
  includeSubdomains: boolean;
  status: "APPROVED" | "REJECTED";
  category: "IMBOX" | "FEED" | "PAPER_TRAIL" | null;
};

export type SettingsBackupSubjectRule = {
  connectionEmail: string;
  scope: "ADDRESS" | "DOMAIN" | "SUBDOMAINS";
  scopeValue: string;
  pattern: string;
  status: "APPROVED" | "REJECTED";
  category: "IMBOX" | "FEED" | "PAPER_TRAIL" | null;
};

export type SettingsBackupContentRuleSender = {
  scope: "ADDRESS" | "DOMAIN" | "SUBDOMAINS";
  scopeValue: string;
  since: string;
};

export type SettingsBackupContentRule = {
  // null = every connected inbox.
  connectionEmail: string | null;
  criterion: string;
  onMatch: "KEEP" | "IMBOX" | "FEED" | "PAPER_TRAIL" | "ARCHIVE";
  onNoMatch: "KEEP" | "IMBOX" | "FEED" | "PAPER_TRAIL" | "ARCHIVE";
  senders: SettingsBackupContentRuleSender[];
};

// Only CalDAV travels: OAuth tokens are bound to this server's client id.
// The password is in the clear, like the mail account that holds the backup.
export type SettingsBackupCalendarAccount = {
  provider: "CALDAV";
  displayName: string;
  url: string;
  username: string;
  password: string;
};

export type SettingsBackupSnooze = { messageId: string; until: string | null };
export type SettingsBackupFollowUp = { messageId: string; at: string };

export type SettingsBackupPayload = {
  kind: typeof SETTINGS_BACKUP_KIND;
  version: typeof SETTINGS_BACKUP_VERSION;
  exportedAt: string;
  source: SettingsBackupSource;
  preferences: SettingsBackupPreferences;
  contacts: SettingsBackupContact[];
  contactGroups: SettingsBackupGroup[];
  senders: SettingsBackupSender[];
  domainRules: SettingsBackupDomainRule[];
  subjectRules: SettingsBackupSubjectRule[];
  // Additive (Kurir 2.0 restores from this backup): AI rules, CalDAV
  // calendars and per-message state. Older backups have none.
  contentRules: SettingsBackupContentRule[];
  calendarAccounts: SettingsBackupCalendarAccount[];
  snoozes: SettingsBackupSnooze[];
  replyLater: string[];
  followUps: SettingsBackupFollowUp[];
};

export function serializeSettingsBackup(payload: SettingsBackupPayload): string {
  return JSON.stringify(payload);
}

const emailSchema = z
  .string()
  .trim()
  .min(3)
  .transform((value) => value.toLowerCase());

const categorySchema = z.enum(["IMBOX", "FEED", "PAPER_TRAIL"]).nullable();
const contentActionSchema = z.enum([
  "KEEP",
  "IMBOX",
  "FEED",
  "PAPER_TRAIL",
  "ARCHIVE",
]);

const decidedSchema = z
  .object({
    status: z.enum(["APPROVED", "REJECTED"]),
    category: categorySchema,
  })
  .superRefine((value, ctx) => {
    if (value.status === "APPROVED" && !value.category) {
      ctx.addIssue({
        code: "custom",
        path: ["category"],
        message: "Category required when status is APPROVED",
      });
    }
  });

const payloadSchema = z.object({
  kind: z.literal(SETTINGS_BACKUP_KIND),
  version: z.literal(SETTINGS_BACKUP_VERSION),
  exportedAt: z.string().min(1),
  source: z.enum(["manual", "scheduled"]),
  preferences: z.object({
    theme: z.enum(["light", "dark", "system"]),
    timezone: z.string().min(1),
    blockRemoteImages: z.boolean(),
    blockTrackers: z.boolean(),
    showImboxBadge: z.boolean(),
    showScreenerBadge: z.boolean(),
    showFeedBadge: z.boolean(),
    showPaperTrailBadge: z.boolean(),
    showFollowUpBadge: z.boolean(),
    showReplyLaterBadge: z.boolean(),
    showScheduledBadge: z.boolean(),
    calendarAvailability: z.unknown().optional(),
  }),
  contacts: z.array(
    z.object({
      name: z.string().min(1),
      notes: z.string(),
      emails: z
        .array(
          z.object({
            email: emailSchema,
            label: z.string().min(1),
            isPrimary: z.boolean(),
          }),
        )
        .min(1),
    }),
  ),
  contactGroups: z.array(
    z.object({
      name: z.string().min(1),
      defaultTarget: z.enum(["TO", "BCC"]),
      members: z.array(emailSchema),
    }),
  ),
  senders: z.array(
    decidedSchema.and(
      z.object({
        connectionEmail: emailSchema,
        email: emailSchema,
        domain: z.string().min(1),
        unthread: z.boolean(),
        allowRemoteImages: z.boolean(),
      }),
    ),
  ),
  domainRules: z.array(
    decidedSchema.and(
      z.object({
        connectionEmail: emailSchema,
        pattern: z.string().min(1),
        includeSubdomains: z.boolean(),
      }),
    ),
  ),
  // Additive (kurir-ios#50): backups written before subject rules existed
  // simply have none.
  subjectRules: z
    .array(
      decidedSchema.and(
        z.object({
          connectionEmail: emailSchema,
          scope: z.enum(["ADDRESS", "DOMAIN", "SUBDOMAINS"]),
          scopeValue: z.string().min(1),
          pattern: z.string().min(1),
        }),
      ),
    )
    .default([]),
  contentRules: z
    .array(
      z.object({
        connectionEmail: emailSchema.nullable(),
        criterion: z.string().min(1),
        onMatch: contentActionSchema,
        onNoMatch: contentActionSchema,
        senders: z.array(
          z.object({
            scope: z.enum(["ADDRESS", "DOMAIN", "SUBDOMAINS"]),
            scopeValue: z.string().min(1),
            since: z.string().min(1),
          }),
        ),
      }),
    )
    .default([]),
  calendarAccounts: z
    .array(
      z.object({
        provider: z.literal("CALDAV"),
        displayName: z.string(),
        url: z.string().min(1),
        username: z.string().min(1),
        password: z.string().min(1),
      }),
    )
    .default([]),
  snoozes: z
    .array(z.object({ messageId: z.string().min(1), until: z.string().nullable() }))
    .default([]),
  replyLater: z.array(z.string().min(1)).default([]),
  followUps: z
    .array(z.object({ messageId: z.string().min(1), at: z.string().min(1) }))
    .default([]),
});

export function parseSettingsBackup(input: unknown): SettingsBackupPayload {
  const value = typeof input === "string" ? JSON.parse(input) : input;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid settings backup");
  }

  const record = value as Record<string, unknown>;
  for (const key of FORBIDDEN_TOP_LEVEL) {
    if (key in record) {
      throw new Error(`Settings backup must not contain ${key}`);
    }
  }

  if (record.kind !== SETTINGS_BACKUP_KIND) {
    throw new Error("Invalid settings backup kind");
  }
  if (record.version !== SETTINGS_BACKUP_VERSION) {
    throw new Error("Unsupported settings backup version");
  }

  const parsed = payloadSchema.safeParse(record);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") || "payload";
    throw new Error(
      `Invalid settings backup: ${path} ${issue?.message ?? ""}`.trim(),
    );
  }
  return parsed.data;
}

/** Oldest-first victims once we keep the newest `keep` backups. */
export function backupsToPrune<T extends { sentAt: Date }>(
  backups: T[],
  keep = SETTINGS_BACKUP_KEEP,
): T[] {
  return [...backups]
    .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
    .slice(keep);
}

export function isSettingsBackupMessage(
  subject: string | null | undefined,
  filenames: string[],
): boolean {
  if (!subject?.startsWith(SETTINGS_BACKUP_SUBJECT_PREFIX)) return false;
  return filenames.some((name) => SETTINGS_BACKUP_FILENAME_RE.test(name));
}

function zonedDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
  };
}

export function settingsBackupFilename(date: Date, timeZone: string): string {
  const { year, month, day } = zonedDateParts(date, timeZone);
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `kurir-settings-${year}-${mm}-${dd}.json`;
}

export function settingsBackupSubject(date: Date, timeZone: string): string {
  const { year, month, day } = zonedDateParts(date, timeZone);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${SETTINGS_BACKUP_SUBJECT_PREFIX}${day} ${months[month - 1]} ${year}`;
}
