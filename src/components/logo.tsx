export function KurirLogo({ className }: { className?: string }) {
  return (
    <img
      src="/logo.png"
      alt="Kurir"
      className={`rounded-xl ${className ?? ""}`}
      draggable={false}
    />
  );
}
