import type { ComponentType } from "react";
import type { IconProps } from "@phosphor-icons/react";
import {
  FilmSlate,
  PenNib,
  CookingPot,
  Atom,
  Airplane,
  Notepad,
  BookOpen,
  RocketLaunch,
  GraduationCap,
  PencilLine,
  Sword,
  VideoCamera,
} from "@phosphor-icons/react";

export interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  icon: ComponentType<IconProps>;
}

export const TEMPLATES: TemplateMeta[] = [
  { id: "screenplay", name: "Screenplay", description: "Scenes, characters & treatments", icon: FilmSlate },
  { id: "blog", name: "Blog", description: "Drafts, ideas & content calendar", icon: PenNib },
  { id: "recipes", name: "Recipe Book", description: "Recipes organized by category", icon: CookingPot },
  { id: "research", name: "Research", description: "Literature, experiments & notes", icon: Atom },
  { id: "travel", name: "Travel Journal", description: "Trips, packing lists & bucket list", icon: Airplane },
  { id: "meetings", name: "Meeting Notes", description: "Minutes, action items & 1-on-1s", icon: Notepad },
  { id: "novel", name: "Novel", description: "Chapters, characters & worldbuilding", icon: BookOpen },
  { id: "startup", name: "Startup", description: "Pitch deck, user stories & research", icon: RocketLaunch },
  { id: "study", name: "Study Guide", description: "Courses, flashcards & schedules", icon: GraduationCap },
  { id: "journal", name: "Journal", description: "Daily entries, goals & prompts", icon: PencilLine },
  { id: "dnd", name: "D&D Campaign", description: "Sessions, characters & world lore", icon: Sword },
  { id: "content", name: "Content Creator", description: "Scripts, ideas & content calendar", icon: VideoCamera },
];
