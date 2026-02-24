import { useState } from "react";
import {
  ArrowLeft,
  Plus,
  Trash,
  Check,
  CircleNotch,
  X,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Card, CardContent } from "@/components/ui/card.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover.js";
import { Logo } from "./Logo.js";
import { api } from "../lib/api.js";
import {
  TAG_COLORS,
  INDUSTRY_PRESETS,
  type PresetTag,
  type IndustryPreset,
} from "../lib/presets.js";

interface WizardTag {
  name: string;
  color: string;
  condition: string;
}

type CreationStatus =
  | { phase: "project"; done: false }
  | { phase: "project"; done: true }
  | { phase: "tags"; total: number; completed: number; failed: number }
  | { phase: "done"; failed: number };

export function OnboardingWizard({
  onComplete,
  onCancel,
}: {
  onComplete: (project: { id: string; name: string }) => void;
  onCancel?: () => void;
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [tags, setTags] = useState<WizardTag[]>([]);
  const [creationStatus, setCreationStatus] = useState<CreationStatus | null>(null);
  const [error, setError] = useState("");

  // --- Step navigation ---
  const goToPresets = () => {
    if (!name.trim()) return;
    setStep(2);
  };

  const goToTags = () => {
    if (!selectedPreset) return;
    setStep(3);
  };

  const selectPreset = (preset: IndustryPreset) => {
    setSelectedPreset(preset.id);
    setTags(preset.tags.map((t) => ({ ...t })));
  };

  // --- Tag editing ---
  const updateTag = (index: number, field: keyof WizardTag, value: string) => {
    setTags((prev) =>
      prev.map((t, i) => (i === index ? { ...t, [field]: value } : t))
    );
  };

  const removeTag = (index: number) => {
    setTags((prev) => prev.filter((_, i) => i !== index));
  };

  const addTag = () => {
    setTags((prev) => [
      ...prev,
      { name: "", color: TAG_COLORS[prev.length % TAG_COLORS.length], condition: "" },
    ]);
  };

  // --- Creation ---
  const handleCreate = async () => {
    setStep(4);
    setError("");
    setCreationStatus({ phase: "project", done: false });

    let project: { id: string; name: string };
    try {
      const data = await api.post<{ project: { id: string; name: string } }>(
        "/api/projects",
        { name: name.trim(), mode: "empty" }
      );
      project = data.project;
    } catch (err: any) {
      setError(err.message || "Failed to create workspace");
      setCreationStatus(null);
      return;
    }

    setCreationStatus({ phase: "project", done: true });

    // Create tags
    const validTags = tags.filter((t) => t.name.trim() && t.condition.trim());
    if (validTags.length === 0) {
      setCreationStatus({ phase: "done", failed: 0 });
      setTimeout(() => onComplete(project), 500);
      return;
    }

    let completed = 0;
    let failed = 0;
    setCreationStatus({ phase: "tags", total: validTags.length, completed: 0, failed: 0 });

    for (const tag of validTags) {
      try {
        await api.post(`/api/projects/${project.id}/tags`, {
          name: tag.name.trim(),
          condition: tag.condition.trim(),
          color: tag.color,
        });
        completed++;
      } catch {
        failed++;
      }
      setCreationStatus({ phase: "tags", total: validTags.length, completed, failed });
    }

    setCreationStatus({ phase: "done", failed });

    if (failed === 0) {
      setTimeout(() => onComplete(project), 500);
    }
  };

  // --- Render ---
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 py-12">
      {/* Cancel button */}
      {onCancel && (
        <button
          onClick={onCancel}
          className="fixed top-4 right-4 z-50 p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        >
          <X size={20} />
        </button>
      )}

      {step === 1 && <StepName name={name} setName={setName} onContinue={goToPresets} onCancel={onCancel} />}
      {step === 2 && (
        <StepPreset
          selectedPreset={selectedPreset}
          onSelect={selectPreset}
          onContinue={goToTags}
          onBack={() => setStep(1)}
        />
      )}
      {step === 3 && (
        <StepTags
          tags={tags}
          onUpdateTag={updateTag}
          onRemoveTag={removeTag}
          onAddTag={addTag}
          onCreate={handleCreate}
          onBack={() => setStep(2)}
        />
      )}
      {step === 4 && (
        <StepCreating
          status={creationStatus}
          error={error}
          onRetry={handleCreate}
          onContinue={() => {
            // "Continue anyway" for partial failures — we still have the project
            if (creationStatus?.phase === "done") {
              // Project was created, just proceed
              // We need the project ref; re-derive from creation
            }
          }}
        />
      )}
    </div>
  );
}

// --- Step 1: Name ---

function StepName({
  name,
  setName,
  onContinue,
  onCancel,
}: {
  name: string;
  setName: (v: string) => void;
  onContinue: () => void;
  onCancel?: () => void;
}) {
  return (
    <div className="w-full max-w-md">
      <div className="text-center mb-8">
        <Logo className="h-12 w-auto mx-auto mb-4" />
        <h1 className="text-2xl font-semibold text-foreground mb-2">
          Create your workspace
        </h1>
        <p className="text-muted-foreground text-sm">
          Give your workspace a name to get started.
        </p>
      </div>

      <Card>
        <CardContent className="p-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onContinue();
            }}
          >
            <label className="text-sm font-medium text-foreground mb-1.5 block">
              Workspace name
            </label>
            <Input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Tech Newsletters"
              className="h-11"
            />
            <div className="flex justify-end gap-3 mt-6">
              {onCancel && (
                <Button type="button" variant="ghost" onClick={onCancel}>
                  Cancel
                </Button>
              )}
              <Button type="submit" disabled={!name.trim()}>
                Continue
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// --- Step 2: Industry Preset ---

function StepPreset({
  selectedPreset,
  onSelect,
  onContinue,
  onBack,
}: {
  selectedPreset: string | null;
  onSelect: (preset: IndustryPreset) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  return (
    <div className="w-full max-w-lg">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-semibold text-foreground mb-2">
          Choose a starting point
        </h1>
        <p className="text-muted-foreground text-sm">
          Pick an industry preset to pre-fill classification tags, or start from scratch.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-8">
        {INDUSTRY_PRESETS.map((preset) => {
          const Icon = preset.icon;
          const isSelected = selectedPreset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onSelect(preset)}
              className={`text-left p-4 rounded-xl border-2 transition-all ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/30 bg-card"
              }`}
            >
              <div className="flex items-center gap-2.5 mb-2">
                <Icon
                  size={20}
                  className={isSelected ? "text-primary" : "text-muted-foreground"}
                />
                <span className="font-medium text-sm text-foreground">
                  {preset.name}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {preset.description}
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1.5">
                {preset.tags.length === 0
                  ? "No tags"
                  : `${preset.tags.length} tag${preset.tags.length !== 1 ? "s" : ""}`}
              </p>
            </button>
          );
        })}
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={16} />
          Back
        </Button>
        <Button onClick={onContinue} disabled={!selectedPreset}>
          Continue
        </Button>
      </div>
    </div>
  );
}

// --- Step 3: Customize Tags ---

function StepTags({
  tags,
  onUpdateTag,
  onRemoveTag,
  onAddTag,
  onCreate,
  onBack,
}: {
  tags: WizardTag[];
  onUpdateTag: (index: number, field: keyof WizardTag, value: string) => void;
  onRemoveTag: (index: number) => void;
  onAddTag: () => void;
  onCreate: () => void;
  onBack: () => void;
}) {
  return (
    <div className="w-full max-w-2xl">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-semibold text-foreground mb-2">
          Customize your tags
        </h1>
        <p className="text-muted-foreground text-sm">
          Tags automatically classify incoming emails using AI. Edit, add, or remove as needed.
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          {tags.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-muted-foreground mb-1">No tags yet</p>
              <p className="text-xs text-muted-foreground">
                Add tags to auto-classify your emails.
              </p>
            </div>
          ) : (
            <div className="max-h-[400px] overflow-y-auto pr-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {tags.map((tag, i) => (
                <div key={i} className="border border-border rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="w-7 h-7 rounded-md border border-border shrink-0 transition-colors hover:border-foreground/30"
                          style={{ backgroundColor: tag.color }}
                          title="Change color"
                        />
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-2" align="start">
                        <div className="grid grid-cols-5 gap-1.5">
                          {TAG_COLORS.map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => onUpdateTag(i, "color", c)}
                              className={`w-6 h-6 rounded-full border-2 transition-colors ${
                                tag.color === c
                                  ? "border-foreground scale-110"
                                  : "border-transparent hover:border-foreground/30"
                              }`}
                              style={{ backgroundColor: c }}
                            />
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                    <Input
                      value={tag.name}
                      onChange={(e) => onUpdateTag(i, "name", e.target.value)}
                      placeholder="Tag name"
                      className="flex-1 h-8 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => onRemoveTag(i)}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                  <Input
                    value={tag.condition}
                    onChange={(e) => onUpdateTag(i, "condition", e.target.value)}
                    placeholder="AI condition (e.g. 'promotional emails with discounts')"
                    className="h-8 text-sm"
                  />
                </div>
              ))}
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            className="w-full mt-3"
            onClick={onAddTag}
          >
            <Plus size={14} />
            Add tag
          </Button>
        </CardContent>
      </Card>

      <div className="flex justify-between mt-6">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={16} />
          Back
        </Button>
        <Button onClick={onCreate}>Create workspace</Button>
      </div>
    </div>
  );
}

// --- Step 4: Creating ---

function StepCreating({
  status,
  error,
  onRetry,
  onContinue,
}: {
  status: CreationStatus | null;
  error: string;
  onRetry: () => void;
  onContinue: () => void;
}) {
  if (error) {
    return (
      <div className="w-full max-w-md text-center">
        <div className="text-destructive mb-4 text-sm">{error}</div>
        <Button onClick={onRetry}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-semibold text-foreground mb-2">
          Setting up your workspace
        </h1>
        <p className="text-muted-foreground text-sm">
          This will only take a moment.
        </p>
      </div>

      <Card>
        <CardContent className="p-6 space-y-4">
          {/* Project creation step */}
          <div className="flex items-center gap-3">
            {status?.phase === "project" && !status.done ? (
              <CircleNotch size={18} className="text-primary animate-spin shrink-0" />
            ) : (
              <Check size={18} className="text-green-500 shrink-0" />
            )}
            <span className="text-sm text-foreground">Creating workspace</span>
          </div>

          {/* Tags creation step */}
          {status && status.phase !== "project" && (
            <div className="flex items-center gap-3">
              {status.phase === "tags" ? (
                <CircleNotch size={18} className="text-primary animate-spin shrink-0" />
              ) : status.phase === "done" && status.failed === 0 ? (
                <Check size={18} className="text-green-500 shrink-0" />
              ) : (
                <Check size={18} className="text-yellow-500 shrink-0" />
              )}
              <span className="text-sm text-foreground">
                {status.phase === "tags"
                  ? `Creating tags (${status.completed}/${status.total})`
                  : status.phase === "done" && status.failed > 0
                    ? `Tags created (${status.failed} failed)`
                    : "Tags created"}
              </span>
            </div>
          )}

          {/* Partial failure actions */}
          {status?.phase === "done" && status.failed > 0 && (
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <Button variant="ghost" size="sm" onClick={onContinue}>
                Continue anyway
              </Button>
              <Button size="sm" onClick={onRetry}>
                Retry
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
