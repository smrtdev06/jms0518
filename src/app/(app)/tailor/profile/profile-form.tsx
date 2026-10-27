"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LoaderCircle, Plus, Trash2 } from "lucide-react";
import { PageTitle } from "@/components/page-title";

type Experience = { jobTitle: string; companyName: string; companyAddress: string; startDate: string; endDate: string };
type Education = { universityName: string; universityLocation: string; startDate: string; endDate: string; degree: string };

const blankExperience = (): Experience => ({ jobTitle: "", companyName: "", companyAddress: "", startDate: "", endDate: "" });
const blankEducation = (): Education => ({ universityName: "", universityLocation: "", startDate: "", endDate: "", degree: "" });

type ProfileFormValues = {
  fullName: string;
  phone: string;
  email: string;
  address: string;
  linkedin: string;
  experiences: Experience[];
  education: Education[];
};

export function ProfileForm({ initial }: { initial?: ProfileFormValues }) {
  const editing = Boolean(initial);
  const [fullName, setFullName] = useState(initial?.fullName ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [linkedin, setLinkedin] = useState(initial?.linkedin ?? "");
  const [experiences, setExperiences] = useState<Experience[]>(initial?.experiences.length ? initial.experiences : [blankExperience()]);
  const [education, setEducation] = useState<Education[]>(initial?.education.length ? initial.education : [blankEducation()]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [focusTarget, setFocusTarget] = useState<"experience" | "education" | null>(null);
  const experienceList = useRef<HTMLDivElement>(null);
  const educationList = useRef<HTMLDivElement>(null);

  // After a card is added, bring it into view and focus its first field.
  useEffect(() => {
    if (!focusTarget) return;
    const list = focusTarget === "experience" ? experienceList.current : educationList.current;
    const card = list?.lastElementChild as HTMLElement | null;
    if (card) {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      card.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      card.querySelector("input")?.focus({ preventScroll: true });
    }
    setFocusTarget(null);
  }, [focusTarget, experiences.length, education.length]);

  const patchExperience = (index: number, patch: Partial<Experience>) =>
    setExperiences((items) => items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  const patchEducation = (index: number, patch: Partial<Education>) =>
    setEducation((items) => items.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/tailor/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, phone, email, address, linkedin, experiences, education }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        setError(data.error || "Could not save the profile.");
        setBusy(false);
        return;
      }
      window.location.href = "/tailor";
    } catch {
      setError("Could not reach the server.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-3xl space-y-5">
      <PageTitle
        title={editing ? "Edit profile" : "Your profile"}
        subtitle={
          editing
            ? "Changes apply to the next packages you generate."
            : "This profile is used for every resume and cover letter. List the most recent role first."
        }
      />

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold">Personal information</h2>
        <Field label="Full name" hint={editing ? "The full name cannot be changed." : undefined}>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Alexandra Croitoru" required disabled={editing} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone number" hint="+ and the country code">
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 512 660 4596" required />
          </Field>
          <Field label="Email address">
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@email.com" required />
          </Field>
          <Field label="Address" hint="City, Country">
            <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Austin, United States" required />
          </Field>
          <Field label="LinkedIn profile URL">
            <input className="input" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="https://www.linkedin.com/in/…" required />
          </Field>
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <SectionHead
          title="Work experience"
          hint="Dates look like Sep 2015. Use Present for a current role. Address is a city and country, or Remote."
          action="Add role"
          onAdd={() => {
            setExperiences((items) => [...items, blankExperience()]);
            setFocusTarget("experience");
          }}
        />
        <div className="space-y-3" ref={experienceList}>
          {experiences.map((experience, index) => (
            <div key={index} className="space-y-3 rounded-lg border border-line bg-surface-2/60 p-4">
              <CardHead
                label={`Role ${index + 1}`}
                onRemove={experiences.length > 1 ? () => setExperiences((items) => items.filter((_, i) => i !== index)) : undefined}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Job title">
                  <input className="input" value={experience.jobTitle} onChange={(e) => patchExperience(index, { jobTitle: e.target.value })} required />
                </Field>
                <Field label="Company name">
                  <input className="input" value={experience.companyName} onChange={(e) => patchExperience(index, { companyName: e.target.value })} required />
                </Field>
              </div>
              <Field label="Company address">
                <input className="input" value={experience.companyAddress} onChange={(e) => patchExperience(index, { companyAddress: e.target.value })} placeholder="Austin, United States or Remote" required />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Start date">
                  <input className="input" value={experience.startDate} onChange={(e) => patchExperience(index, { startDate: e.target.value })} placeholder="Sep 2015" required />
                </Field>
                <Field label="End date">
                  <input className="input" value={experience.endDate} onChange={(e) => patchExperience(index, { endDate: e.target.value })} placeholder="Apr 2023 or Present" required />
                </Field>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <SectionHead
          title="Education"
          hint="Dates look like Aug 2008 and Dec 2013."
          action="Add school"
          onAdd={() => {
            setEducation((items) => [...items, blankEducation()]);
            setFocusTarget("education");
          }}
        />
        <div className="space-y-3" ref={educationList}>
          {education.map((school, index) => (
            <div key={index} className="space-y-3 rounded-lg border border-line bg-surface-2/60 p-4">
              <CardHead
                label={`School ${index + 1}`}
                onRemove={education.length > 1 ? () => setEducation((items) => items.filter((_, i) => i !== index)) : undefined}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="University name">
                  <input className="input" value={school.universityName} onChange={(e) => patchEducation(index, { universityName: e.target.value })} required />
                </Field>
                <Field label="Degree">
                  <input className="input" value={school.degree} onChange={(e) => patchEducation(index, { degree: e.target.value })} required />
                </Field>
              </div>
              <Field label="University location">
                <input className="input" value={school.universityLocation} onChange={(e) => patchEducation(index, { universityLocation: e.target.value })} placeholder="Austin, United States" required />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Start date">
                  <input className="input" value={school.startDate} onChange={(e) => patchEducation(index, { startDate: e.target.value })} placeholder="Aug 2008" required />
                </Field>
                <Field label="End date">
                  <input className="input" value={school.endDate} onChange={(e) => patchEducation(index, { endDate: e.target.value })} placeholder="Dec 2013" required />
                </Field>
              </div>
            </div>
          ))}
        </div>
      </section>

      {error && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button type="submit" className="btn btn-primary h-9 text-sm" disabled={busy}>
          {busy && <LoaderCircle className="size-4 animate-spin" />}
          {editing ? "Save changes" : "Save and continue"}
        </button>
        {editing && (
          <Link href="/tailor" className="btn btn-ghost h-9">
            Cancel
          </Link>
        )}
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-faint">{hint}</span>}
    </label>
  );
}

function SectionHead({ title, hint, action, onAdd }: { title: string; hint: string; action: string; onAdd: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-0.5 text-xs text-muted">{hint}</p>
      </div>
      <button type="button" className="btn btn-secondary shrink-0" onClick={onAdd}>
        <Plus className="size-3.5" /> {action}
      </button>
    </div>
  );
}

function CardHead({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</span>
      {onRemove && (
        <button type="button" className="btn btn-ghost px-2 hover:text-rose-300" onClick={onRemove}>
          <Trash2 className="size-3.5" /> Remove
        </button>
      )}
    </div>
  );
}
