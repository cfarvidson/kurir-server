import { cn } from "@/lib/utils";

export type KurirMascotPose =
  | "icon"
  | "imbox"
  | "feed"
  | "paper-trail"
  | "screener"
  | "scheduled"
  | "reply-later"
  | "drafts"
  | "files"
  | "contacts"
  | "groups"
  | "sender"
  | "calendar";

const SRC: Record<KurirMascotPose, string> = {
  icon: "/mascot.png",
  imbox: "/mascot-imbox.png",
  feed: "/mascot-feed.png",
  "paper-trail": "/mascot-paper-trail.png",
  screener: "/mascot-screener.png",
  scheduled: "/mascot-scheduled.png",
  "reply-later": "/mascot-reply-later.png",
  drafts: "/mascot-drafts.png",
  files: "/mascot-files.png",
  contacts: "/mascot-contacts.png",
  groups: "/mascot-groups.png",
  sender: "/mascot-sender.png",
  calendar: "/mascot-calendar.png",
};

const SRC_DARK: Record<Exclude<KurirMascotPose, "icon">, string> = {
  imbox: "/mascot-imbox-dark.png",
  feed: "/mascot-feed-dark.png",
  "paper-trail": "/mascot-paper-trail-dark.png",
  screener: "/mascot-screener-dark.png",
  scheduled: "/mascot-scheduled-dark.png",
  "reply-later": "/mascot-reply-later-dark.png",
  drafts: "/mascot-drafts-dark.png",
  files: "/mascot-files-dark.png",
  contacts: "/mascot-contacts-dark.png",
  groups: "/mascot-groups-dark.png",
  sender: "/mascot-sender-dark.png",
  calendar: "/mascot-calendar-dark.png",
};

/** The Kurir courier mascot. Decorative by default (`alt=""`). */
export function KurirMascot({
  pose = "icon",
  className,
  alt = "",
}: {
  pose?: KurirMascotPose;
  className?: string;
  alt?: string;
}) {
  const isIcon = pose === "icon";
  if (isIcon) {
    return (
      <img
        src={SRC.icon}
        alt={alt}
        className={cn("rounded-2xl", className)}
        draggable={false}
      />
    );
  }
  return (
    <>
      <img
        src={SRC[pose]}
        alt={alt}
        className={cn("dark:hidden", className)}
        draggable={false}
      />
      <img
        src={SRC_DARK[pose]}
        alt={alt}
        className={cn("hidden dark:block", className)}
        draggable={false}
      />
    </>
  );
}
