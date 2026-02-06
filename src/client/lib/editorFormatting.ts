import type { EditorView } from "@codemirror/view";

export function wrapSelection(
  view: EditorView,
  before: string,
  after: string
) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);

  // Toggle off if already wrapped
  if (
    selected.startsWith(before) &&
    selected.endsWith(after) &&
    selected.length >= before.length + after.length
  ) {
    const inner = selected.slice(before.length, selected.length - after.length);
    view.dispatch({
      changes: { from, to, insert: inner },
      selection: { anchor: from, head: from + inner.length },
    });
    view.focus();
    return;
  }

  // Also check if the surrounding text already wraps
  const beforeStart = from - before.length;
  const afterEnd = to + after.length;
  if (
    beforeStart >= 0 &&
    afterEnd <= view.state.doc.length &&
    view.state.sliceDoc(beforeStart, from) === before &&
    view.state.sliceDoc(to, afterEnd) === after
  ) {
    view.dispatch({
      changes: [
        { from: beforeStart, to: from, insert: "" },
        { from: to, to: afterEnd, insert: "" },
      ],
      selection: { anchor: beforeStart, head: beforeStart + selected.length },
    });
    view.focus();
    return;
  }

  // Wrap or insert
  if (from === to) {
    view.dispatch({
      changes: { from, to, insert: before + after },
      selection: { anchor: from + before.length },
    });
  } else {
    view.dispatch({
      changes: { from, to, insert: before + selected + after },
      selection: {
        anchor: from + before.length,
        head: from + before.length + selected.length,
      },
    });
  }
  view.focus();
}

export function toggleHeading(view: EditorView, level: number) {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;
  const fromLine = doc.lineAt(from);
  const toLine = doc.lineAt(to);
  const prefix = "#".repeat(level) + " ";

  const changes: { from: number; to: number; insert: string }[] = [];

  for (let i = fromLine.number; i <= toLine.number; i++) {
    const line = doc.line(i);
    const text = line.text;
    const match = text.match(/^(#{1,6})\s+/);
    if (match && match[1].length === level) {
      // Remove heading
      changes.push({ from: line.from, to: line.from + match[0].length, insert: "" });
    } else if (match) {
      // Replace with different level
      changes.push({ from: line.from, to: line.from + match[0].length, insert: prefix });
    } else {
      // Add heading
      changes.push({ from: line.from, to: line.from, insert: prefix });
    }
  }

  view.dispatch({ changes });
  view.focus();
}

export function toggleList(view: EditorView, ordered: boolean) {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;
  const fromLine = doc.lineAt(from);
  const toLine = doc.lineAt(to);

  const changes: { from: number; to: number; insert: string }[] = [];

  for (let i = fromLine.number; i <= toLine.number; i++) {
    const line = doc.line(i);
    const text = line.text;

    if (ordered) {
      const match = text.match(/^(\s*)\d+\.\s+/);
      if (match) {
        changes.push({ from: line.from, to: line.from + match[0].length, insert: match[1] });
      } else {
        // Remove bullet if present, then add ordered
        const bulletMatch = text.match(/^(\s*)[-+*]\s+/);
        if (bulletMatch) {
          changes.push({
            from: line.from,
            to: line.from + bulletMatch[0].length,
            insert: bulletMatch[1] + `${i - fromLine.number + 1}. `,
          });
        } else {
          changes.push({ from: line.from, to: line.from, insert: `${i - fromLine.number + 1}. ` });
        }
      }
    } else {
      const match = text.match(/^(\s*)[-+*]\s+/);
      if (match) {
        changes.push({ from: line.from, to: line.from + match[0].length, insert: match[1] });
      } else {
        // Remove ordered if present, then add bullet
        const orderedMatch = text.match(/^(\s*)\d+\.\s+/);
        if (orderedMatch) {
          changes.push({
            from: line.from,
            to: line.from + orderedMatch[0].length,
            insert: orderedMatch[1] + "- ",
          });
        } else {
          changes.push({ from: line.from, to: line.from, insert: "- " });
        }
      }
    }
  }

  view.dispatch({ changes });
  view.focus();
}

export function toggleBlockquote(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;
  const fromLine = doc.lineAt(from);
  const toLine = doc.lineAt(to);

  const changes: { from: number; to: number; insert: string }[] = [];

  for (let i = fromLine.number; i <= toLine.number; i++) {
    const line = doc.line(i);
    const match = line.text.match(/^>\s?/);
    if (match) {
      changes.push({ from: line.from, to: line.from + match[0].length, insert: "" });
    } else {
      changes.push({ from: line.from, to: line.from, insert: "> " });
    }
  }

  view.dispatch({ changes });
  view.focus();
}

export function insertLink(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);

  if (selected) {
    const insert = `[${selected}](url)`;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + selected.length + 3, head: from + selected.length + 6 },
    });
  } else {
    const insert = "[text](url)";
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + 1, head: from + 5 },
    });
  }
  view.focus();
}

export function insertHorizontalRule(view: EditorView) {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const prefix = line.text.length > 0 ? "\n" : "";
  const insert = prefix + "---\n";
  view.dispatch({
    changes: { from: line.to, to: line.to, insert },
    selection: { anchor: line.to + insert.length },
  });
  view.focus();
}
