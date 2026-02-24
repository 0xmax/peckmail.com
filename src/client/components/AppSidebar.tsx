import { useState, useEffect } from "react";
import {
  House,
  Tray,
  UsersThree,
  ChatCircle,
  Database,
  Wrench,
  CaretUpDown,
  Check,
  Plus,
  Sun,
  Moon,
  Monitor,
  GearSix,
  SignOut,
} from "@phosphor-icons/react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { UserAvatar } from "./UserAvatar.js";
import { Logo } from "./Logo.js";
import { useAuth } from "../context/AuthContext.js";
import { useTheme } from "../context/ThemeContext.js";
import { api } from "../lib/api.js";

export type NavItem = "dashboard" | "inbox" | "senders" | "chat" | "data" | "workspace" | "settings";

interface Project {
  id: string;
  name: string;
}

const NAV_ITEMS: { id: NavItem; label: string; icon: typeof House }[] = [
  { id: "dashboard", label: "Dashboard", icon: House },
  { id: "inbox", label: "Inbox", icon: Tray },
  { id: "senders", label: "Senders", icon: UsersThree },
  { id: "chat", label: "Chat", icon: ChatCircle },
  { id: "data", label: "Data", icon: Database },
  { id: "workspace", label: "Workspace", icon: Wrench },
];

export function AppSidebar({
  activeNav,
  onNavigate,
  onCreateWorkspace,
}: {
  activeNav: NavItem;
  onNavigate: (item: NavItem) => void;
  onCreateWorkspace?: () => void;
}) {
  const { user, activeProjectId, setActiveProject, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    api
      .get<{ projects: Project[] }>("/api/projects")
      .then((r) => setProjects(r.projects))
      .catch(() => {});
  }, []);

  const displayName =
    user?.user_metadata?.display_name ||
    user?.user_metadata?.full_name ||
    user?.email ||
    "User";
  const avatarSrc =
    user?.user_metadata?.avatar_url || user?.user_metadata?.picture;

  const handleSwitchProject = async (projectId: string) => {
    await setActiveProject(projectId);
    window.location.reload();
  };

  const handleNavigateSettings = () => {
    onNavigate("settings");
  };

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" className="pointer-events-none">
                <div className="flex aspect-square size-8 items-center justify-center">
                  <Logo className="size-6" />
                </div>
                <span className="font-semibold text-base">Peckmail</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarTrigger className="w-full" />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton
                      isActive={activeNav === id}
                      tooltip={label}
                      onClick={() => onNavigate(id)}
                    >
                      <Icon
                        size={18}
                        weight={activeNav === id ? "fill" : "regular"}
                      />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    size="lg"
                    className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                  >
                    <div className="flex aspect-square size-8 items-center justify-center shrink-0">
                      <UserAvatar src={avatarSrc} name={displayName} size={24} />
                    </div>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">
                        {displayName}
                      </span>
                    </div>
                    <CaretUpDown size={16} className="ml-auto" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-[--radix-dropdown-menu-trigger-width] min-w-56"
                  side="top"
                  align="end"
                  sideOffset={4}
                >
                  {/* User info */}
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col gap-1">
                      <p className="text-sm font-medium leading-none">
                        {displayName}
                      </p>
                      {user?.email && (
                        <p className="text-xs leading-none text-muted-foreground">
                          {user.email}
                        </p>
                      )}
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />

                  {/* Settings */}
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={handleNavigateSettings}>
                      <GearSix size={16} />
                      Settings
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />

                  {/* Theme */}
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-xs text-muted-foreground">
                      Theme
                    </DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => setTheme("light")}>
                      <Sun size={16} />
                      Light
                      {theme === "light" && (
                        <Check
                          size={14}
                          className="ml-auto text-primary shrink-0"
                        />
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setTheme("dark")}>
                      <Moon size={16} />
                      Dark
                      {theme === "dark" && (
                        <Check
                          size={14}
                          className="ml-auto text-primary shrink-0"
                        />
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setTheme("system")}>
                      <Monitor size={16} />
                      System
                      {theme === "system" && (
                        <Check
                          size={14}
                          className="ml-auto text-primary shrink-0"
                        />
                      )}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />

                  {/* Workspaces */}
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-xs text-muted-foreground">
                      Workspaces
                    </DropdownMenuLabel>
                    {projects.map((p) => (
                      <DropdownMenuItem
                        key={p.id}
                        onClick={() => handleSwitchProject(p.id)}
                      >
                        <div className="w-5 h-5 rounded bg-primary/15 text-primary flex items-center justify-center text-[10px] font-semibold shrink-0">
                          {p.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="truncate">{p.name}</span>
                        {p.id === activeProjectId && (
                          <Check
                            size={14}
                            className="ml-auto text-primary shrink-0"
                          />
                        )}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuItem onClick={() => onCreateWorkspace?.()}>
                      <Plus size={16} className="text-muted-foreground" />
                      New workspace
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />

                  {/* Sign out */}
                  <DropdownMenuItem onClick={() => signOut()}>
                    <SignOut size={16} />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

    </>
  );
}
