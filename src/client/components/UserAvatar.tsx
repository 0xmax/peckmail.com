import { useEffect, useRef, useState } from "react";

export function UserAvatar({
  src,
  name,
  size = 28,
  className = "",
}: {
  src?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
}) {
  // Debounce src changes to avoid flickering on auth refreshes
  const [stableSrc, setStableSrc] = useState(src);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStableSrc(src), 30_000);
    // Update immediately on first mount or when going from null to a value
    if (!stableSrc && src) setStableSrc(src);
    return () => clearTimeout(timer.current);
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  const initials = (name || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  if (stableSrc) {
    return (
      <img
        src={stableSrc}
        alt={name || "Avatar"}
        className={`rounded-full object-cover shrink-0 ${className}`}
        style={{ width: size, height: size }}
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <div
      className={`rounded-full bg-accent/15 text-accent flex items-center justify-center shrink-0 font-medium ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials}
    </div>
  );
}
