import { cn } from "@/lib/utils";

/** The Kurir courier mascot. Decorative by default (`alt=""`). */
export function KurirMascot({
  className,
  alt = "",
}: {
  className?: string;
  alt?: string;
}) {
  return (
    <img
      src="/mascot.png"
      alt={alt}
      className={cn("rounded-2xl", className)}
      draggable={false}
    />
  );
}
