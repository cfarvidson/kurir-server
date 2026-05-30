/**
 * Coarse file-type grouping used by the Files library for filtering and icons.
 * Pure module — no I/O, no Prisma — so it can be unit-tested in isolation and
 * shared between the server query and the client UI.
 */

export type FileGroup = "image" | "document" | "archive" | "other";

/** MIME prefixes that define each group. Checked with case-insensitive startsWith. */
export const GROUP_PREFIXES: Record<Exclude<FileGroup, "other">, string[]> = {
  image: ["image/"],
  archive: [
    "application/zip",
    "application/x-tar",
    "application/gzip",
    "application/x-gzip",
    "application/x-rar",
    "application/vnd.rar",
    "application/x-7z-compressed",
    "application/x-bzip",
  ],
  document: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/vnd.oasis.opendocument",
    "application/rtf",
    "text/",
  ],
};

/** The non-"other" groups, in the order the UI presents them. */
export const FILE_GROUPS: Exclude<FileGroup, "other">[] = [
  "image",
  "document",
  "archive",
];

/** Map a MIME type to its coarse group. Unknown/garbage → "other". */
export function fileGroup(contentType: string | null | undefined): FileGroup {
  const ct = (contentType ?? "").trim().toLowerCase();
  if (!ct) return "other";
  // Check archive before document so e.g. application/zip is never mistaken
  // for a generic application document.
  if (GROUP_PREFIXES.image.some((p) => ct.startsWith(p))) return "image";
  if (GROUP_PREFIXES.archive.some((p) => ct.startsWith(p))) return "archive";
  if (GROUP_PREFIXES.document.some((p) => ct.startsWith(p))) return "document";
  return "other";
}

/** True when a content type belongs to the given group. */
export function contentTypeMatchesGroup(
  contentType: string | null | undefined,
  group: FileGroup,
): boolean {
  return fileGroup(contentType) === group;
}

/** Human label for a group (used in filter tabs and empty states). */
export const FILE_GROUP_LABEL: Record<FileGroup, string> = {
  image: "Images",
  document: "Documents",
  archive: "Archives",
  other: "Other",
};

/** Parse an arbitrary query-string value into a known FileGroup, or null. */
export function parseFileGroup(value: string | null | undefined): FileGroup | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (v === "image" || v === "document" || v === "archive" || v === "other") {
    return v;
  }
  return null;
}
