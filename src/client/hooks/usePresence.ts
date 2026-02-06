import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase.js";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";

export interface PresenceUser {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  openFilePath: string | null;
  color: string;
}

const WARM_COLORS = [
  "#e57373", // red
  "#ffb74d", // orange
  "#fff176", // yellow
  "#aed581", // lime
  "#4dd0e1", // cyan
  "#7986cb", // indigo
  "#ba68c8", // purple
  "#f06292", // pink
  "#4db6ac", // teal
  "#ff8a65", // deep orange
];

function hashColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }
  return WARM_COLORS[Math.abs(hash) % WARM_COLORS.length];
}

export function usePresence(
  projectId: string,
  user: User | null,
  openFilePath: string | null,
): { onlineUsers: PresenceUser[] } {
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Create/destroy channel when projectId or user changes
  useEffect(() => {
    if (!projectId || !user) {
      setOnlineUsers([]);
      return;
    }

    const channel = supabase.channel(`workspace:${projectId}`, {
      config: { presence: { key: user.id } },
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      const seen = new Set<string>();
      const users: PresenceUser[] = [];

      for (const presences of Object.values(state)) {
        for (const p of presences as any[]) {
          const uid = p.userId as string;
          if (uid === user.id || seen.has(uid)) continue;
          seen.add(uid);
          users.push({
            userId: uid,
            displayName: p.displayName ?? "Anonymous",
            avatarUrl: p.avatarUrl ?? null,
            openFilePath: p.openFilePath ?? null,
            color: hashColor(uid),
          });
        }
      }

      setOnlineUsers(users);
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({
          userId: user.id,
          displayName:
            user.user_metadata?.display_name ||
            user.user_metadata?.full_name ||
            user.email ||
            "Anonymous",
          avatarUrl:
            user.user_metadata?.avatar_url ||
            user.user_metadata?.picture ||
            null,
          openFilePath: null,
        });
      }
    });

    channelRef.current = channel;

    return () => {
      clearTimeout(debounceRef.current);
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [projectId, user]);

  // Track openFilePath changes with debounce
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel || !user) return;

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      channel.track({
        userId: user.id,
        displayName:
          user.user_metadata?.display_name ||
          user.user_metadata?.full_name ||
          user.email ||
          "Anonymous",
        avatarUrl:
          user.user_metadata?.avatar_url ||
          user.user_metadata?.picture ||
          null,
        openFilePath: openFilePath ?? null,
      });
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [openFilePath, user]);

  return { onlineUsers };
}
