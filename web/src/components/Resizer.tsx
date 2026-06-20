import { useEffect, useRef } from "react";

/**
 * A thin vertical drag handle for resizing a neighbouring column. Reports the
 * pointer's clientX on each drag move; the parent decides how to map that to a
 * width (left column = clientX - offset; right column = viewport - clientX).
 * Desktop-only (md+); columns stack on mobile so resizing makes no sense there.
 */
export function Resizer({ onResize, ariaLabel }: { onResize: (clientX: number) => void; ariaLabel?: string }) {
  const draggingRef = useRef(false);
  const cbRef = useRef(onResize);
  cbRef.current = onResize;

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (draggingRef.current) cbRef.current(e.clientX);
    };
    const up = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      onMouseDown={(e) => {
        e.preventDefault();
        draggingRef.current = true;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onDoubleClick={() => cbRef.current(-1)}
      className="hidden md:block w-1 shrink-0 cursor-col-resize transition-colors"
      style={{ background: "transparent" }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--accent-soft)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    />
  );
}
