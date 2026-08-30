import { cn } from "@/lib/utils";

export function KurirLogo({ className }: { className?: string }) {
  return (
    <img
      src="/logo.png"
      alt="Kurir"
      width={32}
      height={32}
      className={cn(
        "aspect-square shrink-0 object-cover rounded-lg",
        className,
      )}
      draggable={false}
    />
  );
}
