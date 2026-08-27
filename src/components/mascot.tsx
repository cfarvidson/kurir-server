import { cn } from "@/lib/utils";

export type KurirMascotPose = "icon" | "imbox" | "feed" | "paper-trail";

const SRC: Record<KurirMascotPose, string> = {
  icon: "/mascot.png",
  imbox: "/mascot-imbox.png",
  feed: "/mascot-feed.png",
  "paper-trail": "/mascot-paper-trail.png",
};

const SRC_DARK: Record<Exclude<KurirMascotPose, "icon">, string> = {
  imbox: "/mascot-imbox-dark.png",
  feed: "/mascot-feed-dark.png",
  "paper-trail": "/mascot-paper-trail-dark.png",
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
