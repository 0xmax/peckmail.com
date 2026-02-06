import { promises as fs } from "fs";
import { join, dirname } from "path";
import { PROJECTS_DIR } from "./files.js";

export interface TemplateFile {
  path: string;
  content: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  files: TemplateFile[];
}

const TEMPLATES: Record<string, Template> = {
  screenplay: {
    id: "screenplay",
    name: "Screenplay",
    description: "Write screenplays with scene breakdowns and character sheets",
    files: [
      {
        path: "AGENTS.md",
        content: `# Email Agent Instructions

When an email arrives at this workspace, follow these rules:

1. **Scene ideas or dialogue**: Save to \`scenes/\` with a descriptive filename (e.g., \`scenes/rooftop-chase.md\`). Format with scene heading, action lines, and dialogue.

2. **Character notes**: If about a character, update or create a file in \`characters/\` (e.g., \`characters/detective-mora.md\`).

3. **Everything else**: Save a summary in \`inbox/\` with sender, date, and key points.

Always format screenplay content using standard screenplay conventions (INT./EXT., character names in caps, etc.).
`,
      },
      {
        path: "treatment.md",
        content: `# Treatment

## Logline

_A one-sentence summary of your story._

## Synopsis

Write a brief overview of your screenplay here — the beginning, middle, and end.

## Themes

- Theme 1
- Theme 2

## Tone & Style

Describe the feel of the film (e.g., gritty noir, lighthearted comedy).
`,
      },
      {
        path: "scenes/opening-scene.md",
        content: `# Opening Scene

## INT. APARTMENT - MORNING

_A small, cluttered apartment. Morning light filters through half-closed blinds._

ALEX (30s, disheveled) sits at a kitchen table covered in papers, staring at a cold cup of coffee.

**ALEX**
(muttering)
One more day.

_A phone BUZZES on the counter. Alex glances at it but doesn't move._
`,
      },
      {
        path: "characters/protagonist.md",
        content: `# Alex Chen

## Basics
- **Age**: 32
- **Occupation**: Journalist
- **Location**: Downtown apartment

## Personality
- Determined but scattered
- Dry sense of humor
- Avoids confrontation until pushed

## Arc
_Where does this character start, and where do they end up?_

## Key Relationships
- **Morgan**: Best friend and colleague
- **Detective Ruiz**: Reluctant ally
`,
      },
      { path: "inbox/.gitkeep", content: "" },
    ],
  },

  blog: {
    id: "blog",
    name: "Blog",
    description: "Plan and write blog posts with a content calendar",
    files: [
      {
        path: "AGENTS.md",
        content: `# Email Agent Instructions

When an email arrives at this workspace, follow these rules:

1. **Blog post ideas**: If the email contains a topic idea or outline, save it to \`ideas/\` with a descriptive filename.

2. **Draft content**: If it contains a full or partial draft, save it to \`drafts/\` and add an entry to \`content-calendar.md\`.

3. **Everything else**: Save a summary in \`inbox/\` with sender, date, and key points.

When saving drafts, include front matter with title, date, status (draft/review/ready), and tags.
`,
      },
      {
        path: "content-calendar.md",
        content: `# Content Calendar

## Upcoming

| Date | Title | Status | Tags |
|------|-------|--------|------|
| TBD | First post idea | Draft | getting-started |

## Published

_Nothing published yet — get writing!_
`,
      },
      {
        path: "drafts/first-post.md",
        content: `---
title: My First Post
date: ${new Date().toISOString().split("T")[0]}
status: draft
tags: [introduction]
---

# My First Post

Start writing your first blog post here. A few tips:

- **Hook your reader** in the first paragraph
- **Use subheadings** to break up long sections
- **End with a takeaway** or call to action

## Introduction

## Main Point

## Conclusion
`,
      },
      {
        path: "ideas/topic-ideas.md",
        content: `# Topic Ideas

Jot down future post ideas here. When one is ready, move it to \`drafts/\`.

- [ ] Idea 1: _describe it briefly_
- [ ] Idea 2: _describe it briefly_
- [ ] Idea 3: _describe it briefly_
`,
      },
      { path: "published/.gitkeep", content: "" },
      { path: "inbox/.gitkeep", content: "" },
    ],
  },

  recipes: {
    id: "recipes",
    name: "Recipe Book",
    description: "Organize recipes by category with a favorites list",
    files: [
      {
        path: "AGENTS.md",
        content: `# Email Agent Instructions

When an email arrives at this workspace, follow these rules:

1. **Recipes**: If the email contains a recipe, extract it and save to the appropriate category folder:
   - Breakfast items → \`breakfast/\`
   - Main courses, dinners, lunches → \`mains/\`
   - Desserts, sweets, baked goods → \`desserts/\`
   Format with ingredients list, steps, prep time, and servings.

2. **Favorites**: If the sender says it's a favorite or "must try", also add it to \`favorites.md\`.

3. **Everything else**: Save a summary in \`inbox/\`.

Always use lowercase-kebab-case filenames (e.g., \`mains/chicken-tikka-masala.md\`).
`,
      },
      {
        path: "favorites.md",
        content: `# Favorites

A quick-reference list of your best recipes.

- [ ] _Add your first favorite here_
`,
      },
      {
        path: "mains/pasta-aglio-e-olio.md",
        content: `# Pasta Aglio e Olio

**Prep time**: 5 min | **Cook time**: 15 min | **Servings**: 2

## Ingredients

- 200g spaghetti
- 4 cloves garlic, thinly sliced
- 1/4 cup olive oil
- 1/2 tsp red pepper flakes
- Fresh parsley, chopped
- Salt to taste
- Parmesan (optional)

## Steps

1. Cook spaghetti in salted boiling water until al dente. Reserve 1/2 cup pasta water.
2. In a large pan, heat olive oil over medium-low. Add garlic and red pepper flakes. Cook until garlic is golden (not brown).
3. Toss in drained pasta, adding pasta water a splash at a time until silky.
4. Finish with parsley, salt, and parmesan if using.
`,
      },
      { path: "breakfast/.gitkeep", content: "" },
      { path: "desserts/.gitkeep", content: "" },
      { path: "inbox/.gitkeep", content: "" },
    ],
  },

  research: {
    id: "research",
    name: "Research",
    description: "Organize literature reviews, experiments, and research notes",
    files: [
      {
        path: "AGENTS.md",
        content: `# Email Agent Instructions

When an email arrives at this workspace, follow these rules:

1. **Papers or articles**: If the email contains or references a paper, create a literature note in \`literature/\` with title, authors, key findings, and your notes.

2. **Experiment ideas or results**: Save to \`experiments/\` with hypothesis, method, and findings sections.

3. **General notes**: Save to \`notes/\` with a descriptive filename.

4. **Everything else**: Save a summary in \`inbox/\`.

Use the format: \`literature/lastname-year-keyword.md\` for lit notes.
`,
      },
      {
        path: "overview.md",
        content: `# Research Overview

## Research Question

_What are you investigating?_

## Hypothesis

_What do you expect to find?_

## Key References

- _Add references as you go_

## Progress

- [ ] Literature review
- [ ] Define methodology
- [ ] Collect data
- [ ] Analysis
- [ ] Write up
`,
      },
      {
        path: "literature/sample-lit-note.md",
        content: `# Sample Literature Note

**Title**: _Paper title here_
**Authors**: _Author names_
**Year**: _Year_
**Source**: _Journal or URL_

## Summary

_2-3 sentence summary of the paper._

## Key Findings

- Finding 1
- Finding 2

## Relevance to My Research

_How does this connect to your work?_

## Quotes & Notes

> _Notable quotes from the paper._
`,
      },
      { path: "experiments/.gitkeep", content: "" },
      { path: "notes/.gitkeep", content: "" },
      { path: "inbox/.gitkeep", content: "" },
    ],
  },

  travel: {
    id: "travel",
    name: "Travel Journal",
    description: "Plan trips, keep packing lists, and journal your adventures",
    files: [
      {
        path: "AGENTS.md",
        content: `# Email Agent Instructions

When an email arrives at this workspace, follow these rules:

1. **Trip plans or itineraries**: Save to \`trips/\` with the destination as filename (e.g., \`trips/tokyo-2025.md\`). Include dates, accommodations, and activities.

2. **Packing lists**: Save to or update files in \`packing/\`.

3. **Bucket list items**: Append to \`bucket-list.md\`.

4. **Everything else**: Save a summary in \`inbox/\`.
`,
      },
      {
        path: "bucket-list.md",
        content: `# Travel Bucket List

Places and experiences you want to explore.

## Places
- [ ] _Add a destination_

## Experiences
- [ ] _Add an experience_
`,
      },
      {
        path: "trips/sample-trip.md",
        content: `# Sample Trip

**Destination**: _Where are you going?_
**Dates**: _When?_
**Budget**: _How much?_

## Itinerary

### Day 1
- Arrive, check in
- Explore the neighborhood

### Day 2
- _Plan your day_

## Accommodations

- **Hotel/Airbnb**: _Name and address_
- **Confirmation**: _Booking reference_

## Notes

_Restaurant recommendations, transport tips, etc._
`,
      },
      {
        path: "packing/essentials.md",
        content: `# Packing Essentials

A reusable packing checklist.

## Documents
- [ ] Passport
- [ ] Tickets / boarding passes
- [ ] Travel insurance

## Clothing
- [ ] Underwear & socks
- [ ] T-shirts
- [ ] Pants / shorts
- [ ] Jacket

## Toiletries
- [ ] Toothbrush & toothpaste
- [ ] Sunscreen
- [ ] Medications

## Tech
- [ ] Phone charger
- [ ] Adapter / converter
- [ ] Headphones
`,
      },
      { path: "inbox/.gitkeep", content: "" },
    ],
  },

  meetings: {
    id: "meetings",
    name: "Meeting Notes",
    description: "Track meeting notes, action items, and one-on-ones",
    files: [
      {
        path: "AGENTS.md",
        content: `# Email Agent Instructions

When an email arrives at this workspace, follow these rules:

1. **Meeting notes or minutes**: Save to \`weekly/\` with the date as filename (e.g., \`weekly/2025-02-03.md\`). Extract attendees, discussion points, and decisions.

2. **One-on-one notes**: Save to \`one-on-ones/\` with the person's name (e.g., \`one-on-ones/sarah.md\`). Append if the file already exists.

3. **Action items**: Extract any action items and append them to \`action-items.md\` with owner and due date.

4. **Everything else**: Save a summary in \`inbox/\`.
`,
      },
      {
        path: "action-items.md",
        content: `# Action Items

Track follow-ups across all your meetings.

| Item | Owner | Due | Status |
|------|-------|-----|--------|
| _Example: Send proposal_ | _You_ | _Feb 10_ | Open |
`,
      },
      {
        path: "weekly/sample-meeting.md",
        content: `# Weekly Meeting — ${new Date().toISOString().split("T")[0]}

**Attendees**: _List participants_
**Duration**: 30 min

## Agenda

1. _Topic 1_
2. _Topic 2_
3. _Topic 3_

## Discussion

### Topic 1
_Notes here._

### Topic 2
_Notes here._

## Action Items

- [ ] _Action item 1_ — Owner: ___
- [ ] _Action item 2_ — Owner: ___

## Next Meeting

_Date and topics to revisit._
`,
      },
      { path: "one-on-ones/.gitkeep", content: "" },
      { path: "inbox/.gitkeep", content: "" },
    ],
  },

  novel: {
    id: "novel",
    name: "Novel",
    description: "Outline your novel with chapters, characters, and worldbuilding",
    files: [
      {
        path: "AGENTS.md",
        content: `# Email Agent Instructions

When an email arrives at this workspace, follow these rules:

1. **Chapter drafts or scenes**: Save to \`chapters/\` with a chapter number or name (e.g., \`chapters/01-the-beginning.md\`).

2. **Character ideas**: Save to or update files in \`characters/\`.

3. **Worldbuilding notes**: Save to \`worldbuilding/\` (locations, history, magic systems, etc.).

4. **Everything else**: Save a summary in \`inbox/\`.

Maintain consistent formatting: chapters start with a \`# Chapter N: Title\` heading.
`,
      },
      {
        path: "outline.md",
        content: `# Novel Outline

## Working Title

_Your title here_

## Genre

_e.g., Literary fiction, Sci-fi, Fantasy, Mystery_

## Premise

_A 2-3 sentence pitch for your story._

## Structure

### Act I — Setup
- Chapter 1: _Brief description_
- Chapter 2: _Brief description_

### Act II — Confrontation
- Chapter 3: _Brief description_
- Chapter 4: _Brief description_

### Act III — Resolution
- Chapter 5: _Brief description_

## Themes

- _Theme 1_
- _Theme 2_
`,
      },
      {
        path: "chapters/01-the-beginning.md",
        content: `# Chapter 1: The Beginning

_Start writing your first chapter here._

---

The story begins...
`,
      },
      {
        path: "characters/main-character.md",
        content: `# Main Character

## Name
_Character name_

## Appearance
_Physical description_

## Background
_Where they come from, key life events_

## Motivation
_What do they want? What drives them?_

## Flaws
_What holds them back?_

## Voice
_How do they speak? Any verbal tics or patterns?_
`,
      },
      { path: "worldbuilding/.gitkeep", content: "" },
      { path: "inbox/.gitkeep", content: "" },
    ],
  },

  startup: {
    id: "startup",
    name: "Startup",
    description: "Pitch decks, user stories, and product research",
    files: [
      {
        path: "AGENTS.md",
        content: `# Email Agent Instructions

When an email arrives at this workspace, follow these rules:

1. **Product feedback or user insights**: Save to \`research/\` with a descriptive filename. Tag with source and date.

2. **Feature requests or user stories**: Append to \`user-stories.md\` in the standard format.

3. **Meeting notes or investor updates**: Save to \`docs/\`.

4. **Everything else**: Save a summary in \`inbox/\`.

Use the user story format: "As a [type of user], I want [goal] so that [reason]."
`,
      },
      {
        path: "pitch.md",
        content: `# Pitch

## One-Liner

_Explain your product in one sentence._

## Problem

_What pain point are you solving?_

## Solution

_How does your product solve it?_

## Target Market

_Who are your users?_

## Business Model

_How will you make money?_

## Traction

_Any progress, users, or milestones?_

## Team

_Who's building this?_

## Ask

_What do you need? (Funding, advisors, users?)_
`,
      },
      {
        path: "user-stories.md",
        content: `# User Stories

## Backlog

- As a **new user**, I want to sign up quickly so that I can start using the product right away.
- As a **returning user**, I want to see my recent activity so that I can pick up where I left off.

## In Progress

_Move stories here when you start working on them._

## Done

_Move stories here when complete._
`,
      },
      { path: "research/.gitkeep", content: "" },
      { path: "docs/.gitkeep", content: "" },
      { path: "inbox/.gitkeep", content: "" },
    ],
  },

  study: {
    id: "study",
    name: "Study Guide",
    description: "Organize courses, flashcards, and study schedules",
    files: [
      {
        path: "AGENTS.md",
        content: `# Email Agent Instructions

When an email arrives at this workspace, follow these rules:

1. **Course materials or lecture notes**: Save to \`courses/\` under the appropriate course name (e.g., \`courses/biology-101/week-3.md\`).

2. **Flashcard content**: If it contains Q&A pairs or key terms, append to the relevant file in \`flashcards/\`.

3. **Schedule updates**: Update \`schedule.md\` with new dates or deadlines.

4. **Everything else**: Save a summary in \`inbox/\`.
`,
      },
      {
        path: "schedule.md",
        content: `# Study Schedule

## This Week

| Day | Subject | Task | Done? |
|-----|---------|------|-------|
| Mon | _Subject_ | _What to study_ | [ ] |
| Tue | _Subject_ | _What to study_ | [ ] |
| Wed | _Subject_ | _What to study_ | [ ] |
| Thu | _Subject_ | _What to study_ | [ ] |
| Fri | _Subject_ | _What to study_ | [ ] |

## Upcoming Exams & Deadlines

| Date | Subject | Details |
|------|---------|---------|
| _Date_ | _Subject_ | _Exam/assignment details_ |
`,
      },
      {
        path: "courses/sample-course/notes.md",
        content: `# Sample Course — Notes

## Week 1: Introduction

### Key Concepts
- Concept 1: _Definition_
- Concept 2: _Definition_

### Summary
_Summarize the main takeaways from this week._

### Questions
- _What didn't you understand?_
`,
      },
      {
        path: "flashcards/sample-flashcards.md",
        content: `# Flashcards — Sample Subject

**Q**: What is the capital of France?
**A**: Paris

**Q**: _Your question here_
**A**: _Your answer here_

**Q**: _Your question here_
**A**: _Your answer here_
`,
      },
      { path: "inbox/.gitkeep", content: "" },
    ],
  },

  journal: {
    id: "journal",
    name: "Journal",
    description: "Daily entries, goals, and writing prompts",
    files: [
      {
        path: "AGENTS.md",
        content: `# Email Agent Instructions

When an email arrives at this workspace, follow these rules:

1. **Journal entries or reflections**: Save to \`entries/\` with the date as filename (e.g., \`entries/2025-02-03.md\`). Preserve the personal tone.

2. **Goals or intentions**: Append to or update files in \`goals/\`.

3. **Everything else**: Save a summary in \`inbox/\`.

Keep entries warm and personal. Don't over-edit the sender's voice.
`,
      },
      {
        path: "prompts.md",
        content: `# Writing Prompts

Pick one when you're not sure what to write about.

1. What made you smile today?
2. What's something you've been putting off? Why?
3. Describe your perfect morning.
4. Write about a person who changed your perspective.
5. What would you tell your younger self?
6. What are you grateful for right now?
7. Describe a place that feels like home.
8. What's a lesson you learned the hard way?
9. What does your ideal day look like one year from now?
10. Write about something small that made a big difference.
`,
      },
      {
        path: `entries/sample-entry.md`,
        content: `# ${new Date().toISOString().split("T")[0]}

_Today's prompt: What made you smile today?_

Write your thoughts here. Don't worry about grammar or structure — this is your space.

---

`,
      },
      { path: "goals/.gitkeep", content: "" },
      { path: "inbox/.gitkeep", content: "" },
    ],
  },

  dnd: {
    id: "dnd",
    name: "D&D Campaign",
    description: "Track sessions, characters, and world lore for your campaign",
    files: [
      {
        path: "AGENTS.md",
        content: `# Email Agent Instructions

When an email arrives at this workspace, follow these rules:

1. **Session recaps**: Save to \`sessions/\` with session number (e.g., \`sessions/session-05.md\`). Include date, party members, key events, and loot.

2. **Character sheets or updates**: Save to \`characters/\` with the character name.

3. **World lore**: Save to \`world/\` — locations, factions, NPCs, history, etc.

4. **Everything else**: Save a summary in \`inbox/\`.

Use a fun, narrative tone for session recaps.
`,
      },
      {
        path: "campaign-overview.md",
        content: `# Campaign Overview

## Campaign Name
_Your campaign name_

## Setting
_Describe the world — time period, geography, tone._

## Party Members

| Character | Player | Class | Level |
|-----------|--------|-------|-------|
| _Name_ | _Player_ | _Class_ | _1_ |

## Story So Far

_Summarize what's happened in the campaign._

## Current Quest

_What's the party working on right now?_

## House Rules

- _Any custom rules go here_
`,
      },
      {
        path: "sessions/session-01.md",
        content: `# Session 1 — The Beginning

**Date**: _Session date_
**Players present**: _List players_

## Recap

_What happened this session? Write it as a story or bullet points._

## Key Events

- The party met at a tavern (as is tradition)
- _Event 2_
- _Event 3_

## Loot & Rewards

- _Item or gold earned_

## Notes for Next Session

- _Loose threads to follow up on_
`,
      },
      { path: "characters/.gitkeep", content: "" },
      { path: "world/.gitkeep", content: "" },
      { path: "inbox/.gitkeep", content: "" },
    ],
  },

  content: {
    id: "content",
    name: "Content Creator",
    description: "Plan video scripts, content ideas, and publishing calendar",
    files: [
      {
        path: "AGENTS.md",
        content: `# Email Agent Instructions

When an email arrives at this workspace, follow these rules:

1. **Video or content ideas**: Save to \`ideas/\` with a descriptive filename. Include the hook, format, and target audience.

2. **Scripts or outlines**: Save to \`scripts/\` with the title as filename.

3. **Calendar updates**: Update or append to the relevant file in \`calendar/\`.

4. **Everything else**: Save a summary in \`inbox/\`.

Format scripts with clear sections: Hook, Intro, Main Points, CTA, Outro.
`,
      },
      {
        path: "content-calendar.md",
        content: `# Content Calendar

## This Week

| Day | Platform | Topic | Status |
|-----|----------|-------|--------|
| Mon | _Platform_ | _Topic_ | Draft |
| Wed | _Platform_ | _Topic_ | Idea |
| Fri | _Platform_ | _Topic_ | Idea |

## Ideas Queue

- _Idea 1_
- _Idea 2_
- _Idea 3_
`,
      },
      {
        path: "scripts/sample-script.md",
        content: `# Sample Script

**Platform**: YouTube / TikTok / Blog
**Length**: _Target duration_
**Topic**: _What's it about?_

## Hook (0:00 - 0:15)

_Open with something attention-grabbing._

## Intro (0:15 - 0:45)

_Set context. Why should the viewer care?_

## Main Content

### Point 1
_Explain the first key idea._

### Point 2
_Explain the second key idea._

### Point 3
_Explain the third key idea._

## Call to Action

_What should the viewer do next?_

## Outro

_Wrap up and tease next video._
`,
      },
      { path: "ideas/.gitkeep", content: "" },
      { path: "calendar/.gitkeep", content: "" },
      { path: "inbox/.gitkeep", content: "" },
    ],
  },
};

export function getTemplate(id: string): Template | undefined {
  return TEMPLATES[id];
}

export function getAllTemplateIds(): string[] {
  return Object.keys(TEMPLATES);
}

export async function seedFromTemplate(
  projectId: string,
  templateId: string
): Promise<void> {
  const template = TEMPLATES[templateId];
  if (!template) {
    console.warn(`[templates] Unknown template: ${templateId}, falling back to legacy`);
    // Caller should handle fallback
    return;
  }

  const projectDir = join(PROJECTS_DIR, projectId);
  await fs.mkdir(projectDir, { recursive: true });

  for (const file of template.files) {
    const filePath = join(projectDir, file.path);
    await fs.mkdir(dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, file.content, "utf-8");
  }

  console.log(
    `[templates] Seeded project ${projectId} with template "${templateId}" (${template.files.length} files)`
  );
}

export async function seedEmpty(projectId: string): Promise<void> {
  const projectDir = join(PROJECTS_DIR, projectId);
  await fs.mkdir(projectDir, { recursive: true });

  // Minimal AGENTS.md
  const agentsMd = `# Email Agent Instructions

When an email arrives at this workspace, save it as a new file in \`inbox/\` with a descriptive filename based on the subject. Include the sender, date, and a brief summary at the top.
`;
  await fs.writeFile(join(projectDir, "AGENTS.md"), agentsMd, "utf-8");
  await fs.mkdir(join(projectDir, "inbox"), { recursive: true });
  await fs.writeFile(join(projectDir, "inbox/.gitkeep"), "", "utf-8");

  console.log(`[templates] Seeded empty project ${projectId}`);
}

export async function seedFromFiles(
  projectId: string,
  files: TemplateFile[]
): Promise<void> {
  const projectDir = join(PROJECTS_DIR, projectId);
  await fs.mkdir(projectDir, { recursive: true });

  for (const file of files) {
    // Validate path - no traversal
    if (file.path.includes("..") || file.path.startsWith("/")) {
      console.warn(`[templates] Skipping invalid path: ${file.path}`);
      continue;
    }
    const filePath = join(projectDir, file.path);
    await fs.mkdir(dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, file.content, "utf-8");
  }

  console.log(
    `[templates] Seeded project ${projectId} from AI-generated files (${files.length} files)`
  );
}
