import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext.js";
import { api } from "../lib/api.js";
import { Check, Plus, CaretUpDown } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip.js";
import { CreateProjectModal } from "./CreateProjectModal.js";

interface Project {
  id: string;
  name: string;
}

export function ProjectSwitcher() {
  const { activeProjectId, setActiveProject } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    api
      .get<{ projects: Project[] }>("/api/projects")
      .then((r) => setProjects(r.projects))
      .catch(() => {});
  }, []);

  const activeProject = projects.find((p) => p.id === activeProjectId);
  const initial = activeProject?.name?.charAt(0)?.toUpperCase() || "?";

  const handleSwitch = async (projectId: string) => {
    await setActiveProject(projectId);
    window.location.reload();
  };

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground hover:text-foreground"
              >
                <div className="w-6 h-6 rounded bg-primary/15 text-primary flex items-center justify-center text-xs font-semibold">
                  {initial}
                </div>
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">Switch workspace</TooltipContent>
        </Tooltip>
        <DropdownMenuContent side="right" align="end" className="w-56">
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            Workspaces
          </div>
          {projects.map((p) => (
            <DropdownMenuItem key={p.id} onClick={() => handleSwitch(p.id)}>
              <div className="w-5 h-5 rounded bg-primary/15 text-primary flex items-center justify-center text-[10px] font-semibold shrink-0">
                {p.name.charAt(0).toUpperCase()}
              </div>
              <span className="truncate">{p.name}</span>
              {p.id === activeProjectId && (
                <Check size={14} className="ml-auto text-primary shrink-0" />
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setShowCreate(true)}>
            <Plus size={16} className="text-muted-foreground" />
            New workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreated={async (project) => {
            setShowCreate(false);
            setProjects((prev) => [...prev, project]);
            await setActiveProject(project.id);
            window.location.reload();
          }}
        />
      )}
    </>
  );
}
