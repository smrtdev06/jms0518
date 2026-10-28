import Link from "next/link";
import clsx from "clsx";
import { can, requirePageUser } from "@/lib/auth";
import { accessibleProfiles } from "@/lib/access";
import { loadDashboard, workDaily, type TeamActivity, type WorkDay } from "@/lib/dashboard";
import type { SearchParams } from "@/lib/jobs";
import { formatInterviewRange } from "@/lib/timezones";
import { PageTitle } from "@/components/page-title";
import { DashboardFilters } from "./filters";
import { ActivityChart, PipelineChart, FunnelBars, WorkChart } from "./charts";

export const metadata = { title: "Dashboard" };

const RANGES = ["7", "30", "90", "365", "all"];
const pct = (num: number, den: number) => (den ? `${Math.round((num / den) * 100)}%` : "—");

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageUser(can.viewDashboard);
  const sp = await searchParams;
  const range = RANGES.includes(String(sp.range)) ? String(sp.range) : "30";
  // A boss sees every member and can narrow to one profile; a member always sees their own profile and team.
  const boss = user.role === "boss";
  const profiles = boss ? await accessibleProfiles(user) : [];
  const profileId = boss ? (profiles.some((p) => String(p.id) === sp.profile) ? Number(sp.profile) : null) : user.id;
  const selected = boss && profileId ? profiles.find((p) => p.id === profileId) : null;

  const days = range === "all" ? null : Number(range);
  // The member's own work: on their dashboard, or for the member a boss picked.
  const [data, memberDaily] = await Promise.all([loadDashboard({ days, profileId }), profileId ? workDaily(days, profileId) : null]);
  const { kpis } = data;
  const members = data.team.filter((t) => t.role === "member");
  const helpers = data.team.filter((t) => t.role !== "member");
  const focused = profileId ? members.find((m) => m.id === profileId) : undefined;
  // Interviews held = results recorded (every round counts); rates use the jobs that had an interview.
  const interviewed = kpis.interviewed_jobs;
  const rangeLabel = range === "all" ? "all time" : `last ${range} days`;
  const scopeLabel = boss ? (selected ? `${selected.name}${selected.label ? ` (${selected.label})` : ""}` : "All members") : "Your profile and team";

  const tiles: { label: string; value: number; hint: string; title?: string }[] = [
    { label: "Jobs generated", value: kpis.received, hint: rangeLabel },
    { label: "Applied", value: kpis.applied, hint: `${pct(kpis.applied, kpis.received)} of generated` },
    { label: "Waiting to apply", value: kpis.waiting, hint: "right now" },
    { label: "Apply failed", value: kpis.apply_failed, hint: rangeLabel },
    {
      label: "Interviews",
      value: kpis.interviews,
      hint: `${interviewed} ${interviewed === 1 ? "job" : "jobs"} · ${pct(interviewed, kpis.applied)}`,
      title: `${kpis.interviews} interviews held (every round) for ${interviewed} jobs · ${pct(interviewed, kpis.applied)} of applied jobs · ${rangeLabel}`,
    },
    { label: "Offers", value: kpis.offered, hint: `${pct(kpis.offered, interviewed)} of interviews` },
    { label: "Rejected", value: kpis.rejected, hint: rangeLabel },
    {
      label: "Scheduled",
      value: kpis.scheduled_now,
      hint: kpis.needs_result ? `+${kpis.needs_result} need a result` : `${kpis.upcoming} in next 7 days`,
      title:
        `${kpis.scheduled_now} interviews scheduled right now (upcoming or in progress) · ${kpis.upcoming} in the next 7 days` +
        (kpis.needs_result ? ` · ${kpis.needs_result} more already ended and need a result` : ""),
    },
  ];

  return (
    <div className="space-y-6">
      <PageTitle
        title="Dashboard"
        subtitle={`${scopeLabel} · applying, interview and team analytics · ${rangeLabel}`}
        actions={<DashboardFilters profiles={profiles} showProfiles={boss} profile={boss && profileId ? String(profileId) : "all"} range={range} />}
      />

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        {tiles.map((t) => (
          <div key={t.label} className="card px-4 py-3" title={t.title ?? `${t.label}: ${t.hint}`}>
            <div className="text-xs text-muted">{t.label}</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight">{t.value.toLocaleString()}</div>
            <div className="mt-0.5 truncate text-[11px] text-faint">{t.hint}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <Panel title="Daily activity" subtitle={`Jobs generated, applied and interviews scheduled per day${range === "all" || Number(range) > 90 ? " (last 90 days)" : ""}`} className="xl:col-span-2">
          <ActivityChart data={data.daily} />
        </Panel>
        <Panel title="Conversion funnel" subtitle={`Jobs moving through each stage · ${rangeLabel}`}>
          <FunnelBars
            stages={[
              { label: "Generated", value: kpis.received },
              { label: "Applied", value: kpis.applied },
              { label: "Interviewed", value: interviewed },
              { label: "Offered", value: kpis.offered },
            ]}
          />
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <Panel title="Interview steps by profile" subtitle={`Current interview status of jobs applied · ${rangeLabel}`} className="xl:col-span-2">
          <PipelineChart profiles={data.profiles.filter((p) => p.applied > 0)} />
        </Panel>
        <Panel title="Upcoming interviews" subtitle="Next scheduled interviews">
          {data.upcoming.length === 0 ? (
            <p className="py-8 text-center text-xs text-faint">No upcoming interviews</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.upcoming.map((u) => (
                <li key={u.id} className="py-2.5">
                  <div className="truncate text-sm font-medium">
                    {u.company_name} <span className="text-faint">–</span> {u.job_title}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {formatInterviewRange(u.interview_date, u.interview_start, u.interview_end, u.interview_timezone)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-faint">
                    {u.profile_name}
                    {u.interview_note ? ` · ${u.interview_note}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Link href="/interviews?status=scheduled" className="mt-2 inline-block text-xs text-accent hover:underline">
            Open interview schedule →
          </Link>
        </Panel>
      </section>

      <Panel
        title={boss ? "Members" : "Your profile"}
        subtitle={boss ? `Applying and interview results per member (profile) · ${rangeLabel}` : `Applying and interview results · ${rangeLabel}`}
      >
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <Th>Profile</Th>
                {boss && <Th right>Team</Th>}
                <Th right>Generated</Th>
                <Th right>Waiting</Th>
                <Th right>Applied</Th>
                <Th right>Apply rate</Th>
                <Th right>Scheduled</Th>
                <Th right>Interviews</Th>
                <Th right>Interview rate</Th>
                <Th right>Offers</Th>
                <Th right>Offer rate</Th>
                <Th right>Rejected</Th>
                <Th right>Last applied</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70 tabular-nums">
              {data.profiles.map((p) => (
                <tr key={p.id} className="hover:bg-surface-2/50">
                  <Td>
                    <span className="font-medium">{p.name}</span>
                    {p.label && <span className="ml-1.5 text-xs text-faint">({p.label})</span>}
                  </Td>
                  {boss && <Td right>{p.team_size}</Td>}
                  <Td right>{p.received}</Td>
                  <Td right>{p.waiting}</Td>
                  <Td right>{p.applied}</Td>
                  <Td right>{pct(p.applied, p.received)}</Td>
                  <Td right>{p.scheduled_now}</Td>
                  <Td right>{p.interviews}</Td>
                  <Td right>{pct(p.interviewed, p.applied)}</Td>
                  <Td right>{p.offered}</Td>
                  <Td right>{pct(p.offered, p.interviewed)}</Td>
                  <Td right>{p.rejected}</Td>
                  <Td right className="text-xs text-muted">
                    {p.last_applied ? new Date(p.last_applied).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                  </Td>
                </tr>
              ))}
              {data.profiles.length === 0 && (
                <tr>
                  <td colSpan={13} className="py-8 text-center text-xs text-faint">
                    {boss ? "No members with a profile yet" : "Save your profile in Resume Tailor to see results"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {focused && memberDaily ? (
        <MemberWork
          title={boss ? `Work of ${focused.name}` : "Your work"}
          me={focused}
          team={helpers.filter((t) => t.member_id === focused.id)}
          daily={memberDaily}
          rangeLabel={rangeLabel}
          longRange={range === "all" || Number(range) > 90}
          self={!boss}
        />
      ) : (
        boss && <MembersWork members={members} helpers={helpers} range={range} rangeLabel={rangeLabel} />
      )}

      <Panel
        title={boss ? "Work by bidder and caller" : "Your team's work"}
        subtitle={`What each ${boss ? "bidder and caller" : "bidder and caller on your team"} did · recorded on every job by who did it · ${rangeLabel}`}
      >
        <TeamSummary team={helpers} />
        <div className="-mx-4 mt-3 overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <Th>Person</Th>
                <Th>Role</Th>
                {boss && <Th>Member</Th>}
                <Th right>Applied</Th>
                <Th right>Apply failed</Th>
                <Th right>Interview results</Th>
                <Th right>Total</Th>
                <Th right>Today</Th>
                <Th right>Last activity</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70 tabular-nums">
              {helpers.map((t) => (
                <tr key={t.id} className={t.is_active ? "hover:bg-surface-2/50" : "opacity-50"}>
                  <Td>
                    <span className="font-medium">{t.name}</span>
                    {!t.is_active && <span className="ml-1.5 text-[11px] text-faint">(disabled)</span>}
                  </Td>
                  <Td className={clsx("text-xs", ROLE_TONE[t.role])}>{ROLE_NAME[t.role]}</Td>
                  {boss && (
                    <Td className="text-xs text-muted">
                      {t.role === "member" ? <span className="text-faint">—</span> : t.member_name ?? <span className="text-amber-300">No member</span>}
                    </Td>
                  )}
                  <Td right>{num(t.applied)}</Td>
                  <Td right>{t.apply_failed ? <span className="text-rose-300">{t.apply_failed}</span> : num(0)}</Td>
                  <Td right>{num(t.results)}</Td>
                  <Td right className="font-semibold">{t.total}</Td>
                  <Td right>{t.today}</Td>
                  <Td right className="text-xs text-muted">
                    {t.last_active ? new Date(t.last_active).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}
                  </Td>
                </tr>
              ))}
              {helpers.length === 0 && (
                <tr>
                  <td colSpan={boss ? 9 : 8} className="py-8 text-center text-xs text-faint">
                    {boss ? "No bidders or callers yet" : "No bidders or callers yet — add them on the Team page"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <section>
        <Panel title="Resume Tailor" subtitle={`Links submitted for tailoring · ${rangeLabel}`}>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {[
              { label: "Links submitted", value: data.tailoring.submitted },
              { label: "Generated", value: data.tailoring.generated },
              { label: "Skipped: duplicate link", value: data.tailoring.duplicate_link },
              { label: "Skipped: same company", value: data.tailoring.duplicate_company },
              { label: "Failed / need input", value: data.tailoring.failed },
              { label: "AI tokens used", value: data.tailoring.tokens },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-line bg-surface-2/60 px-3 py-2">
                <dt className="truncate text-[11px] text-muted">{s.label}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{typeof s.value === "number" ? s.value.toLocaleString() : s.value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </section>
    </div>
  );
}

const shortTime = (iso: string | null, empty: string) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : empty;

// A member's own work: what they did themselves, per kind and per day, and their share of the work on their profile.
function MemberWork({ title, me, team, daily, rangeLabel, longRange, self }: {
  title: string;
  me: TeamActivity;
  team: TeamActivity[];
  daily: WorkDay[];
  rangeLabel: string;
  longRange: boolean;
  self: boolean;
}) {
  const teamOf = (role: "bidder" | "caller") => team.filter((t) => t.role === role).reduce((n, t) => n + t.total, 0);
  const share = [
    { label: self ? "You" : me.name, value: me.total, tone: "bg-violet-400" },
    { label: "Bidders", value: teamOf("bidder"), tone: "bg-indigo-400" },
    { label: "Callers", value: teamOf("caller"), tone: "bg-sky-400" },
  ];
  const all = share.reduce((n, s) => n + s.value, 0);
  const tiles = [
    { label: "Resumes generated", value: me.generated },
    { label: "Assigned to team", value: me.assigned },
    { label: "Applied", value: me.applied },
    { label: "Apply failed", value: me.apply_failed },
    { label: "Interviews scheduled", value: me.scheduled },
    { label: "Results recorded", value: me.results },
    { label: "Offer / reject decisions", value: me.decisions },
    { label: "Done today", value: me.today },
  ];
  return (
    <Panel
      title={title}
      subtitle={`${self ? "What you did yourself" : "What this member did themselves"} — tailoring, assigning, applying and interviews · ${rangeLabel}`}
    >
      <div className="grid gap-5 xl:grid-cols-5">
        <div className="space-y-4 xl:col-span-2">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-lg border border-line bg-surface-2/60 px-3 py-2">
                <dt className="truncate text-[11px] text-muted">{t.label}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{t.value.toLocaleString()}</dd>
              </div>
            ))}
          </dl>
          <div>
            <div className="mb-1.5 flex items-baseline justify-between text-xs">
              <span className="text-muted">Who did the work on this profile</span>
              <span className="tabular-nums text-faint">{all.toLocaleString()} actions</span>
            </div>
            <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-surface-3">
              {share
                .filter((s) => s.value)
                .map((s) => (
                  <div key={s.label} className={s.tone} style={{ width: `${(s.value / all) * 100}%` }} title={`${s.label}: ${s.value}`} />
                ))}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              {share.map((s) => (
                <li key={s.label} className="flex items-center gap-1.5">
                  <span className={clsx("size-2 rounded-full", s.tone)} />
                  {s.label}
                  <span className="tabular-nums text-fg">{s.value.toLocaleString()}</span>
                  <span className="tabular-nums text-faint">{pct(s.value, all)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-faint">
              Last activity {shortTime(me.last_active, "—")} · last sign-in {shortTime(me.last_login_at, "never")}
            </p>
          </div>
        </div>
        <div className="xl:col-span-3">
          <div className="mb-2 text-xs text-muted">Work per day{longRange ? " (last 90 days)" : ""}</div>
          <WorkChart data={daily} />
        </div>
      </div>
    </Panel>
  );
}

// Boss, all members: each member's own work next to what their team did. A name opens that member's dashboard.
function MembersWork({ members, helpers, range, rangeLabel }: { members: TeamActivity[]; helpers: TeamActivity[]; range: string; rangeLabel: string }) {
  const teamOf = (id: number) => helpers.filter((t) => t.member_id === id);
  return (
    <Panel title="Work by member" subtitle={`What each member did themselves, next to their team's total · ${rangeLabel} · click a member for their daily work`}>
      <div className="-mx-4 overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <Th>Member</Th>
              <Th right>Generated</Th>
              <Th right>Assigned</Th>
              <Th right>Applied</Th>
              <Th right>Apply failed</Th>
              <Th right>Scheduled</Th>
              <Th right>Results</Th>
              <Th right>Decisions</Th>
              <Th right>Own total</Th>
              <Th right>Team total</Th>
              <Th right>Today</Th>
              <Th right>Last activity</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70 tabular-nums">
            {members.map((m) => {
              const team = teamOf(m.id);
              return (
                <tr key={m.id} className={m.is_active ? "hover:bg-surface-2/50" : "opacity-50"}>
                  <Td>
                    <Link href={`/dashboard?profile=${m.id}&range=${range}`} className="font-medium hover:text-accent">
                      {m.name}
                    </Link>
                    {!m.is_active && <span className="ml-1.5 text-[11px] text-faint">(disabled)</span>}
                  </Td>
                  <Td right>{num(m.generated)}</Td>
                  <Td right>{num(m.assigned)}</Td>
                  <Td right>{num(m.applied)}</Td>
                  <Td right>{m.apply_failed ? <span className="text-rose-300">{m.apply_failed}</span> : num(0)}</Td>
                  <Td right>{num(m.scheduled)}</Td>
                  <Td right>{num(m.results)}</Td>
                  <Td right>{num(m.decisions)}</Td>
                  <Td right className="font-semibold">{m.total}</Td>
                  <Td right>
                    {num(team.reduce((n, t) => n + t.total, 0))}
                    <span className="ml-1 text-[11px] text-faint" title="bidders and callers">
                      ({team.length})
                    </span>
                  </Td>
                  <Td right>{m.today}</Td>
                  <Td right className="text-xs text-muted">{shortTime(m.last_active, "—")}</Td>
                </tr>
              );
            })}
            {members.length === 0 && (
              <tr>
                <td colSpan={12} className="py-8 text-center text-xs text-faint">
                  No members yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

const ROLE_NAME = { member: "Member", bidder: "Bidder", caller: "Caller" } as const;
const ROLE_TONE = { member: "text-violet-200", bidder: "text-indigo-200", caller: "text-sky-200" } as const;
// Zero shown dimmed so the work that was done stands out.
const num = (n: number) => (n ? n : <span className="text-faint">0</span>);

function TeamSummary({ team }: { team: TeamActivity[] }) {
  const bidders = team.filter((t) => t.role === "bidder");
  const callers = team.filter((t) => t.role === "caller");
  const sum = (list: TeamActivity[], key: "applied" | "apply_failed" | "results") => list.reduce((n, t) => n + t[key], 0);
  const items = [
    { label: "Bidders", value: bidders.length },
    { label: "Applications", value: sum(bidders, "applied") },
    { label: "Apply failed", value: sum(bidders, "apply_failed") },
    { label: "Callers", value: callers.length },
    { label: "Interview results", value: sum(callers, "results") },
    { label: "Done today", value: team.reduce((n, t) => n + t.today, 0) },
  ];
  return (
    <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {items.map((s) => (
        <div key={s.label} className="rounded-lg border border-line bg-surface-2/60 px-3 py-2">
          <dt className="truncate text-[11px] text-muted">{s.label}</dt>
          <dd className="mt-0.5 text-lg font-semibold tabular-nums">{s.value.toLocaleString()}</dd>
        </div>
      ))}
    </dl>
  );
}

function Panel({ title, subtitle, className, children }: { title: string; subtitle?: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`card p-4 ${className ?? ""}`}>
      <h2 className="text-sm font-semibold">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-4 py-2 font-medium ${right ? "text-right" : ""}`}>{children}</th>;
}

function Td({ children, right, className }: { children: React.ReactNode; right?: boolean; className?: string }) {
  return <td className={`px-4 py-2 ${right ? "text-right" : ""} ${className ?? ""}`}>{children}</td>;
}
