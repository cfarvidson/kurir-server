import { cn } from "@/lib/utils";

export type KurirMascotPose = "icon" | "imbox" | "feed" | "paper-trail";

const SRC: Record<KurirMascotPose, string> = {
  icon: "/mascot.png",
  imbox: "/mascot-imbox.png",
  feed: "/mascot-feed.png",
  "paper-trail": "/mascot-paper-trail.png",
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
  return (
    <img
      src={SRC[pose]}
      alt={alt}
      className={cn(isIcon && "rounded-2xl", className)}
      draggable={false}
    />
  );
}
