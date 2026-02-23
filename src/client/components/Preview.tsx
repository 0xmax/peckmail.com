import { useMemo } from "react";
import { marked } from "marked";

/** Parse a single CSV line respecting quoted fields */
function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

function parseCsv(content: string): { headers: string[]; rows: string[][] } {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvRow(lines[0]);
  const rows = lines.slice(1).map(parseCsvRow);
  return { headers, rows };
}

function CsvPreview({ content }: { content: string }) {
  const { headers, rows } = useMemo(() => parseCsv(content), [content]);

  if (headers.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto bg-white">
        <div className="max-w-[960px] mx-auto px-6 py-8 text-muted-foreground">
          Empty CSV file
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-white">
      <div className="max-w-[960px] mx-auto px-6 py-8">
        <table className="csv-table">
          <thead>
            <tr>
              <th className="csv-row-num">#</th>
              {headers.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                <td className="csv-row-num">{ri + 1}</td>
                {headers.map((_, ci) => (
                  <td key={ci}>{row[ci] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 text-sm text-muted-foreground">
          {rows.length} {rows.length === 1 ? "row" : "rows"} · {headers.length}{" "}
          {headers.length === 1 ? "column" : "columns"}
        </div>
      </div>
    </div>
  );
}

function MarkdownPreview({ content }: { content: string }) {
  const html = useMemo(() => marked.parse(content, { async: false }) as string, [content]);

  return (
    <div className="flex-1 overflow-y-auto bg-white">
      <article
        className="rendered-markdown max-w-[760px] mx-auto px-6 py-8"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

export function Preview({
  content,
  filePath,
}: {
  content: string;
  filePath?: string;
}) {
  const isCsv = filePath?.toLowerCase().endsWith(".csv");

  if (isCsv) {
    return <CsvPreview content={content} />;
  }

  return <MarkdownPreview content={content} />;
}
