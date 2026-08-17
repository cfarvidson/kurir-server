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
};

export function serializeSettingsBackup(payload: SettingsBackupPayload): string {
  return JSON.stringify(payload);
}

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

  if (
    typeof record.exportedAt !== "string" ||
    (record.source !== "manual" && record.source !== "scheduled") ||
    !record.preferences ||
    typeof record.preferences !== "object" ||
    !Array.isArray(record.contacts) ||
    !Array.isArray(record.contactGroups) ||
    !Array.isArray(record.senders) ||
    !Array.isArray(record.domainRules)
  ) {
    throw new Error("Invalid settings backup");
  }

  return value as SettingsBackupPayload;
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
