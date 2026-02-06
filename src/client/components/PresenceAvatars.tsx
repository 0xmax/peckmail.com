import { useState } from "react";
import type { PresenceUser } from "../hooks/usePresence.js";
import { UserAvatar } from "./UserAvatar.js";

const MAX_VISIBLE = 3;

export function PresenceAvatars({ users }: { users: PresenceUser[] }) {
  const [showTooltip, setShowTooltip] = useState(false);

  if (users.length === 0) return null;

  const visible = users.slice(0, MAX_VISIBLE);
  const overflow = users.length - MAX_VISIBLE;

  return (
    <div
      className="relative flex items-center"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className="flex items-center -space-x-1.5">
        {visible.map((u) => (
          <div
            key={u.userId}
            className="rounded-full ring-2 ring-surface"
          >
            <UserAvatar
              src={u.avatarUrl}
              name={u.displayName}
              size={22}
            />
          </div>
        ))}
        {overflow > 0 && (
          <div className="w-[22px] h-[22px] rounded-full bg-surface-alt ring-2 ring-surface flex items-center justify-center text-[10px] font-medium text-text-muted">
            +{overflow}
          </div>
        )}
      </div>

      {showTooltip && (
        <div className="absolute right-0 top-full mt-2 w-52 bg-surface border border-border rounded-xl shadow-lg py-2 z-50">
          <div className="px-3 pb-1.5 text-[11px] font-medium text-text-muted uppercase tracking-wider">
            Online now
          </div>
          {users.map((u) => (
            <div
              key={u.userId}
              className="px-3 py-1.5 flex items-center gap-2"
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: u.color }}
              />
              <span className="text-sm text-text truncate flex-1">
                {u.displayName}
              </span>
              {u.openFilePath && (
                <span className="text-[11px] text-text-muted truncate max-w-[80px]">
                  {u.openFilePath.replace(/\.[^.]+$/, "")}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
