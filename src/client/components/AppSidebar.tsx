import { House, Tray, ChatCircle, Database } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.js";
import { ThemeToggle } from "./ThemeToggle.js";
import { UserAvatar } from "./UserAvatar.js";
import { ProjectSwitcher } from "./ProjectSwitcher.js";
import { useAuth } from "../context/AuthContext.js";

export type NavItem = "dashboard" | "inbox" | "chat" | "data";

const NAV_ITEMS: { id: NavItem; label: string; icon: typeof House }[] = [
  { id: "dashboard", label: "Dashboard", icon: House },
  { id: "inbox", label: "Inbox", icon: Tray },
  { id: "chat", label: "Chat", icon: ChatCircle },
  { id: "data", label: "Data", icon: Database },
];

export function AppSidebar({
  activeNav,
  onNavigate,
  onOpenSettings,
}: {
  activeNav: NavItem;
  onNavigate: (item: NavItem) => void;
  onOpenSettings: () => void;
}) {
  const { user } = useAuth();

  return (
    <TooltipProvider>
      <div className="w-14 h-full bg-card border-r border-border flex flex-col items-center py-3 shrink-0">
        {/* Logo */}
        <div className="mb-4">
          <img src="/assets/logo.png" alt="Peckmail" className="h-7 w-7" />
        </div>

        {/* Nav items */}
        <nav className="flex-1 flex flex-col items-center gap-1">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-9 w-9 ${
                    activeNav === id
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => onNavigate(id)}
                >
                  <Icon size={20} weight={activeNav === id ? "fill" : "regular"} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{label}</TooltipContent>
            </Tooltip>
          ))}
        </nav>

        {/* Bottom section */}
        <div className="flex flex-col items-center gap-1.5">
          <ProjectSwitcher />
          <ThemeToggle />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onOpenSettings}
                className="rounded-full hover:opacity-80 transition-opacity"
              >
                <UserAvatar
                  src={user?.user_metadata?.avatar_url || user?.user_metadata?.picture}
                  name={user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.email}
                  size={28}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Settings</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
