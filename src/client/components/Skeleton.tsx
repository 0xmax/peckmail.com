export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function SkeletonLine({ className = "" }: { className?: string }) {
  return <div className={`skeleton h-3 rounded-full ${className}`} />;
}

export function SkeletonCircle({ size = 32 }: { size?: number }) {
  return (
    <div
      className="skeleton rounded-full shrink-0"
      style={{ width: size, height: size }}
    />
  );
}
