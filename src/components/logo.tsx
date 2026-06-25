export function KurirLogo({ className }: { className?: string }) {
  return (
    <img
      src="/logo.png"
      alt="Kurir"
      className={`rounded-lg ${className ?? ""}`}
      draggable={false}
    />
  );
}
