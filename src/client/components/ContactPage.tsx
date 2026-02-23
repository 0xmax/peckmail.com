import { useState } from "react";
import { Envelope, SpinnerGap, CheckCircle, ArrowLeft } from "@phosphor-icons/react";
import { Input } from "@/components/ui/input.js";
import { Textarea } from "@/components/ui/textarea.js";
import { Button } from "@/components/ui/button.js";
import { Label } from "@/components/ui/label.js";
import { ThemeToggle } from "./ThemeToggle.js";

export function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const canSubmit = name.trim() && email.trim() && message.trim() && status !== "sending";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setStatus("sending");
    setErrorMsg("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), message: message.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to send message");
      }
      setStatus("sent");
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err.message || "Something went wrong");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="fixed top-4 right-4 z-50">
        <ThemeToggle />
      </div>

      <header className="bg-card border-b border-border px-6 py-4 flex items-center gap-3">
        <a href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <img src="/assets/logo.png" alt="Peckmail" className="h-7 w-auto" />
          <span className="text-2xl font-semibold text-foreground -tracking-[0.01em]">Peckmail</span>
        </a>
      </header>

      <div className="max-w-xl mx-auto px-6 py-16 sm:px-8">
        <a href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8">
          <ArrowLeft size={14} />
          Back
        </a>

        {status === "sent" ? (
          <div className="text-center py-12">
            <CheckCircle size={48} weight="duotone" className="mx-auto mb-4 text-green-600" />
            <h1 className="text-2xl font-bold text-foreground mb-2">Message sent!</h1>
            <p className="text-muted-foreground">Thanks for reaching out. We'll get back to you soon.</p>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-foreground mb-2">Get in touch</h1>
              <p className="text-muted-foreground">Have a question or feedback? We'd love to hear from you.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <Label htmlFor="name" className="block text-sm font-medium text-foreground mb-1.5">Name</Label>
                <Input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                />
              </div>

              <div>
                <Label htmlFor="email" className="block text-sm font-medium text-foreground mb-1.5">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <Label htmlFor="message" className="block text-sm font-medium text-foreground mb-1.5">Message</Label>
                <Textarea
                  id="message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  placeholder="What's on your mind?"
                />
              </div>

              {status === "error" && (
                <p className="text-sm text-red-600">{errorMsg}</p>
              )}

              <Button className="w-full h-12" disabled={!canSubmit}>
                {status === "sending" ? (
                  <>
                    <SpinnerGap size={18} className="animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Envelope size={18} />
                    Send message
                  </>
                )}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
