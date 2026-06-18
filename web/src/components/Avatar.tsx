import { avatarGradient, initials } from "../lib/format";

interface AvatarProps {
  id: string;
  label: string;
  size?: number;
  ring?: boolean;
}

export function Avatar({ id, label, size = 28, ring = false }: AvatarProps) {
  const g = avatarGradient(id);
  const fontSize = Math.max(10, Math.round(size * 0.4));
  return (
    <div
      className="relative inline-flex shrink-0 items-center justify-center select-none"
      style={{
        width: size,
        height: size,
        borderRadius: "9999px",
        background: `linear-gradient(135deg, ${g.from} 0%, ${g.to} 100%)`,
        color: "white",
        fontWeight: 600,
        fontSize,
        letterSpacing: "0.01em",
        boxShadow: ring
          ? "0 0 0 2px var(--bg), 0 0 0 3px var(--border-strong)"
          : "none",
      }}
      aria-hidden
    >
      {initials(label)}
    </div>
  );
}
