import { Sparkles } from "lucide-react";

interface Props {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  title,
  description,
  icon,
  actionLabel,
  onAction,
}: Props) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center px-8 text-center">
      <div
        className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl"
        style={{
          background: "var(--surface-card)",
          color: "var(--text-secondary)",
          border: "1px solid var(--border)",
        }}
      >
        <span>{icon ?? <Sparkles size={20} />}</span>
      </div>
      <h3 className="text-sm font-semibold text-strong">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-xs text-secondary">
          {description}
        </p>
      )}
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-5 inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors duration-150"
          style={{
            background: "var(--accent)",
            color: "#fff",
            border: "1px solid var(--accent)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--accent-2)";
            e.currentTarget.style.borderColor = "var(--accent-2)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--accent)";
            e.currentTarget.style.borderColor = "var(--accent)";
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
