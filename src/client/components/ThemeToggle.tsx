import { Sun, Moon, Monitor } from "@phosphor-icons/react";
import { useTheme } from "../context/ThemeContext.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.js";
import { Button } from "./ui/button.js";

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          {resolvedTheme === "dark" ? (
            <Moon size={16} />
          ) : (
            <Sun size={16} />
          )}
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          <Sun size={16} />
          Light
          {theme === "light" && <span className="ml-auto text-xs text-muted-foreground">Active</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <Moon size={16} />
          Dark
          {theme === "dark" && <span className="ml-auto text-xs text-muted-foreground">Active</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <Monitor size={16} />
          System
          {theme === "system" && <span className="ml-auto text-xs text-muted-foreground">Active</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
