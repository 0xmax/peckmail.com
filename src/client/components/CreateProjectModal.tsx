import { useState } from "react";
import { api } from "../lib/api.js";
import { TEMPLATES, type TemplateMeta } from "../lib/templates.js";
import {
  ArrowLeft,
  Sparkle,
  FileText,
  SpinnerGap,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Textarea } from "@/components/ui/textarea.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog.js";
import { Label } from "@/components/ui/label.js";

type Mode = "template" | "empty" | "ai";
type Step = "pick" | "configure";

interface Selection {
  mode: Mode;
  template?: TemplateMeta;
}

export function CreateProjectModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (project: { id: string; name: string }) => void;
}) {
  const [step, setStep] = useState<Step>("pick");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const pickTemplate = (template: TemplateMeta) => {
    setSelection({ mode: "template", template });
    setName(`My ${template.name}`);
    setStep("configure");
  };

  const pickEmpty = () => {
    setSelection({ mode: "empty" });
    setName("");
    setStep("configure");
  };

  const pickAi = () => {
    setSelection({ mode: "ai" });
    setName("");
    setPrompt("");
    setStep("configure");
  };

  const goBack = () => {
    setStep("pick");
    setSelection(null);
    setError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (selection?.mode === "ai" && !prompt.trim()) return;
    setLoading(true);
    setError("");
    try {
      const body: any = { name: name.trim() };
      if (selection?.mode === "template" && selection.template) {
        body.mode = "template";
        body.templateId = selection.template.id;
      } else if (selection?.mode === "empty") {
        body.mode = "empty";
      } else if (selection?.mode === "ai") {
        body.mode = "ai";
        body.prompt = prompt.trim();
      }
      const data = await api.post<{
        project: { id: string; name: string };
        warning?: string;
      }>("/api/projects", body);
      onCreated(data.project);
    } catch (err: any) {
      setError(err.message || "Failed to create workspace");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl p-0" showCloseButton={false}>
        {step === "pick" ? (
          <>
            <div className="px-6 pt-6 pb-4">
              <h2 className="text-lg font-semibold text-text">
                New workspace
              </h2>
              <p className="text-sm text-text-muted mt-1">
                Choose a starting point for your workspace
              </p>
            </div>

            <div className="px-6 pb-2">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {TEMPLATES.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      onClick={() => pickTemplate(t)}
                      className="flex items-center gap-3 p-3 rounded-xl border border-border hover:border-accent/50 hover:bg-accent/5 transition-all text-left group"
                    >
                      <div className="shrink-0 w-9 h-9 rounded-lg bg-surface-alt flex items-center justify-center text-text-muted group-hover:text-accent transition-colors">
                        <Icon size={20} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-text truncate">
                          {t.name}
                        </div>
                        <div className="text-xs text-text-muted truncate">
                          {t.description}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="px-6 pb-6 pt-3">
              <div className="flex gap-2">
                <button
                  onClick={pickEmpty}
                  className="flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed border-border hover:border-accent/50 hover:bg-accent/5 transition-all text-sm text-text-muted hover:text-text"
                >
                  <FileText size={18} />
                  Empty workspace
                </button>
                <button
                  onClick={pickAi}
                  className="flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed border-border hover:border-accent/50 hover:bg-accent/5 transition-all text-sm text-text-muted hover:text-text"
                >
                  <Sparkle size={18} />
                  Generate with AI
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="px-6 pt-5 pb-4 flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={goBack}
                className="-ml-1.5"
              >
                <ArrowLeft size={18} />
              </Button>
              <div>
                <h2 className="text-lg font-semibold text-text">
                  {selection?.mode === "ai"
                    ? "Generate with AI"
                    : selection?.mode === "empty"
                      ? "Empty workspace"
                      : selection?.template?.name}
                </h2>
                {selection?.template && (
                  <p className="text-sm text-text-muted">
                    {selection.template.description}
                  </p>
                )}
              </div>
            </div>

            <form onSubmit={handleSubmit} className="px-6 pb-6">
              <Label className="mb-1.5">Workspace name</Label>
              <Input
                autoFocus
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  selection?.mode === "ai"
                    ? "My AI workspace"
                    : "My writing project"
                }
              />

              {selection?.mode === "ai" && (
                <>
                  <Label className="mt-4 mb-1.5">
                    Describe your workspace
                  </Label>
                  <Textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="e.g., A workspace for planning my wedding — guest lists, vendor contacts, budget tracking, and timeline..."
                    rows={3}
                  />
                </>
              )}

              {error && (
                <p className="text-sm text-danger mt-3">{error}</p>
              )}

              <div className="flex justify-end gap-3 mt-5">
                <Button type="button" variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    !name.trim() ||
                    (selection?.mode === "ai" && !prompt.trim()) ||
                    loading
                  }
                >
                  {loading ? (
                    <>
                      <SpinnerGap size={16} className="animate-spin" />
                      {selection?.mode === "ai"
                        ? "Generating..."
                        : "Creating..."}
                    </>
                  ) : (
                    "Create workspace"
                  )}
                </Button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
