"use client";

import { useRef, useState } from "react";
import { Download, FileText, LoaderCircle, Mail, Upload } from "lucide-react";
import { FormError, Pill, useApi } from "@/components/admin-ui";
import { formatDateTime } from "@/lib/format";

type Template = {
  kind: "resume" | "cover";
  file: string;
  uploadedAt: string | null;
  summary: Record<string, string> | null;
};

const LABELS = {
  resume: { title: "Resume template", icon: FileText, needs: "A name, a contact line and sections such as Summary, Skills, Experience and Education with sample content." },
  cover: { title: "Cover letter template", icon: Mail, needs: "A name and contact line, a date or Re: line, body paragraphs and a closing such as Sincerely,." },
};

export function TemplatesManager({ templates }: { templates: Template[] }) {
  return (
    <div className="space-y-4">
      <div className="card p-4 text-sm text-muted">
        Generated resumes and cover letters copy the design of these PDFs: page size and margins, fonts, sizes, colors, divider lines, bullet
        symbol, section order and spacing. Upload a filled-in example; its style is read without AI and applies to every package generated
        afterwards. A PDF that does not look like a resume or cover letter is rejected and the current template stays.
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {templates.map((t) => (
          <TemplateCard key={t.kind} template={t} />
        ))}
      </div>
    </div>
  );
}

function TemplateCard({ template }: { template: Template }) {
  const { call, pending, error } = useApi();
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const { title, icon: Icon, needs } = LABELS[template.kind];

  async function upload(file: File | undefined) {
    if (!file) return;
    setMessage("");
    const body = new FormData();
    body.set("file", file);
    const result = await call<{ ok: boolean }>(`/api/admin/templates/${template.kind}`, "PUT", body);
    if (result?.ok) setMessage(`${file.name} is now the ${title.toLowerCase()}.`);
    if (input.current) input.current.value = "";
  }

  return (
    <section className="card flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-surface-3 text-muted">
            <Icon className="size-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">{title}</h2>
            <p className="text-xs text-faint">{template.uploadedAt ? `Uploaded ${formatDateTime(template.uploadedAt)}` : "Default template (templates/ folder)"}</p>
          </div>
        </div>
        <Pill tone={template.uploadedAt ? "accent" : "neutral"}>{template.file}</Pill>
      </div>

      {template.summary ? (
        <dl className="grid gap-x-4 gap-y-1.5 rounded-lg border border-line bg-surface-2/60 p-3 text-xs sm:grid-cols-[8rem_1fr]">
          {Object.entries(template.summary).map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-faint">{key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}</dt>
              <dd className="break-words text-muted">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-xs text-amber-200">No style could be read; built-in defaults are used.</p>
      )}

      <p className="text-[11px] text-faint">Needs: {needs}</p>
      <FormError error={error} />
      {message && <p className="text-xs text-emerald-300">{message}</p>}
      <div className="mt-auto flex gap-2">
        <button className="btn btn-primary" disabled={pending} onClick={() => input.current?.click()}>
          {pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
          {pending ? "Reading style…" : "Upload new PDF"}
        </button>
        <a className="btn btn-secondary" href={`/api/admin/templates/${template.kind}`}>
          <Download className="size-3.5" /> Download current
        </a>
        <input ref={input} type="file" accept="application/pdf" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
      </div>
    </section>
  );
}
