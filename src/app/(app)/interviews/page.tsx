import { can, requirePageUser } from "@/lib/auth";
import { assigneeFilter, workProfile } from "@/lib/access";
import { countJobs, interviewEndedSql, listJobs, readListParams, type SearchParams } from "@/lib/jobs";
import { FilterBar, Pagination } from "@/components/list-controls";
import { PageTitle } from "@/components/page-title";
import { autoAssign } from "@/lib/assign";
import { teamFilter } from "@/lib/team";
import { ProfileCard } from "@/components/profile-card";
import { InterviewList } from "./interview-list";

export const metadata = { title: "Interview Schedule" };

const VIEW_OPTIONS = [
  { value: "all", label: "All" },
  { value: "needs_result", label: "Needs result" },
  { value: "scheduled", label: "Scheduled" },
  { value: "interviewed", label: "Interviewed" },
  { value: "unscheduled", label: "Unscheduled" },
  { value: "offered", label: "Offered" },
  { value: "rejected", label: "Rejected" },
];

// Scheduled interviews: soonest upcoming first, then past ones (most recent first).
const BY_INTERVIEW_TIME =
  "(j.interview_start_at IS NULL), (j.interview_start_at < now() - interval '2 hours'), " +
  "CASE WHEN j.interview_start_at >= now() - interval '2 hours' THEN j.interview_start_at END ASC, j.interview_start_at DESC";

export default async function InterviewsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageUser(can.viewInterviews);
  const profile = await workProfile(user);
  const params = readListParams(await searchParams, "all");
  // Safety net: a single bidder / caller always holds every open job before the list is read.
  await autoAssign(profile?.id);
  // Bidders / callers see only their own jobs; a member can narrow the list to one caller (or the unassigned jobs).
  const people = user.role === "member" ? await teamFilter(user.id, "caller", params.who) : null;
  const assignee =
    assigneeFilter(user) ?? (people && people.userId !== undefined ? { column: "assigned_caller_id" as const, userId: people.userId } : undefined);
  const view = VIEW_OPTIONS.some((o) => o.value === params.status) ? params.status : "all";

  // All: every applied job — scheduled interviews first (by time), then interviewed (awaiting a decision),
  // unscheduled (just applied), offered and rejected.
  const orderBy =
    view === "all"
      ? // Interviews waiting for their result first: they need someone to act.
        `NOT (j.interview_status = 'scheduled' AND ${interviewEndedSql()}), ` +
        "array_position(ARRAY['scheduled', 'interviewed', 'unscheduled', 'offered', 'rejected'], j.interview_status), " +
        `${BY_INTERVIEW_TIME}, j.applied_at DESC NULLS LAST, j.id DESC`
      : view === "scheduled" || view === "needs_result"
        ? `${BY_INTERVIEW_TIME}, j.id DESC`
        : "j.applied_at DESC NULLS LAST, j.id DESC";

  const [{ rows, total, page }, counts] = await Promise.all([
    listJobs({
      profileId: profile?.id ?? null,
      q: params.q,
      page: params.page,
      size: params.size,
      applyStatus: "applied",
      interviewStatus: view === "all" ? undefined : view === "needs_result" ? "scheduled" : view,
      interviewEnded: view === "needs_result" ? true : view === "scheduled" ? false : undefined,
      assignee,
      orderBy,
    }),
    countJobs(profile?.id ?? null, assignee),
  ]);

  const own = user.role !== "member";
  const picked = people?.options.find((o) => o.value && o.value === people.value);
  const countsFor = own ? "Counts are the interviews assigned to you. " : picked ? `Counts are ${picked.value === "none" ? "the unassigned interviews" : `the interviews of ${picked.label}`}. ` : "";

  return (
    <div className="space-y-5">
      <PageTitle
        title="Interview Schedule"
        subtitle={
          can.editInterviews(user.role)
            ? "Track interviews for applied jobs. Click a row to see or edit its details."
            : "The interviews your member assigned to you. Click a row to see its details."
        }
      />
      <ProfileCard
        profile={profile}
        stats={[
          { label: "Scheduled", value: counts.scheduled, tone: "accent" },
          { label: "Needs result", value: counts.needs_result, tone: "warn" },
          { label: "Interviewed", value: counts.interviewed, tone: "warn" },
          { label: "Offered", value: counts.offered, tone: "good" },
        ]}
        note={countsFor ? `${countsFor}Click a detail to copy it.` : undefined}
      />
      <FilterBar
        people={people ? { label: "Caller", value: people.value, options: people.options } : undefined}
        statusLabel="View"
        statusOptions={VIEW_OPTIONS}
        status={view}
        search={params.q}
      />
      <InterviewList jobs={rows} canEdit={can.editInterviews(user.role)} />
      <Pagination total={total} page={page ?? 1} size={params.size} />
    </div>
  );
}
