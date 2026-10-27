import { can, requirePageUser } from "@/lib/auth";
import { assigneeFilter, workProfile } from "@/lib/access";
import { countJobs, listJobs, readListParams, type SearchParams } from "@/lib/jobs";
import { FilterBar, Pagination } from "@/components/list-controls";
import { PageTitle } from "@/components/page-title";
import { autoAssign } from "@/lib/assign";
import { teamFilter } from "@/lib/team";
import { ProfileCard } from "@/components/profile-card";
import { ApplyList } from "./apply-list";

export const metadata = { title: "Applying Management" };

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "ready", label: "Ready to Apply" },
  { value: "applied", label: "Applied" },
  { value: "failed", label: "Failed" },
];

// Ready to Apply jobs first (newest generated first), then applied jobs (most recently applied first),
// then failed ones (most recently failed first).
const ORDER = {
  all:
    "array_position(ARRAY['ready', 'applied', 'failed'], j.apply_status), CASE WHEN j.apply_status = 'ready' THEN j.generated_at END DESC, " +
    "j.applied_at DESC NULLS LAST, j.apply_failed_at DESC NULLS LAST, j.id DESC",
  ready: "j.generated_at DESC, j.id DESC",
  applied: "j.applied_at DESC NULLS LAST, j.id DESC",
  failed: "j.apply_failed_at DESC NULLS LAST, j.id DESC",
};

export default async function ApplyingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageUser(can.apply);
  const profile = await workProfile(user);
  const params = readListParams(await searchParams, "all");
  // Safety net: a single bidder / caller always holds every open job before the list is read.
  await autoAssign(profile?.id);
  // Bidders / callers see only their own jobs; a member can narrow the list to one bidder (or the unassigned jobs).
  const people = user.role === "member" ? await teamFilter(user.id, "bidder", params.who) : null;
  const assignee =
    assigneeFilter(user) ?? (people && people.userId !== undefined ? { column: "assigned_bidder_id" as const, userId: people.userId } : undefined);
  const status = (STATUS_OPTIONS.some((o) => o.value === params.status) ? params.status : "all") as keyof typeof ORDER;

  const [{ rows, total, page }, counts] = await Promise.all([
    listJobs({
      profileId: profile?.id ?? null,
      q: params.q,
      page: params.page,
      size: params.size,
      applyStatus: status === "all" ? undefined : status,
      assignee,
      orderBy: ORDER[status],
    }),
    countJobs(profile?.id ?? null, assignee),
  ]);

  const own = user.role !== "member";
  const picked = people?.options.find((o) => o.value && o.value === people.value);
  const countsFor = own ? "Counts are the jobs assigned to you. " : picked ? `Counts are ${picked.value === "none" ? "the unassigned jobs" : `the jobs of ${picked.label}`}. ` : "";

  return (
    <div className="space-y-5">
      <PageTitle
        title="Applying Management"
        subtitle={
          user.role === "bidder"
            ? "The jobs your member assigned to you. Apply and upload the confirmation screenshot."
            : "Apply to tailored jobs and upload the confirmation screenshot."
        }
      />
      <ProfileCard
        profile={profile}
        stats={[
          { label: "To apply", value: counts.ready, tone: "accent" },
          { label: "Applied", value: counts.applied, tone: "good" },
          { label: "Failed", value: counts.failed, tone: "bad" },
        ]}
        note={`${countsFor}Click a detail to copy it into an application form.`}
      />
      <FilterBar
        people={people ? { label: "Bidder", value: people.value, options: people.options } : undefined}
        statusLabel="Available"
        statusOptions={STATUS_OPTIONS}
        status={status}
        search={params.q}
      />
      <ApplyList
        jobs={rows}
        showAssignee={can.manageTeam(user.role)}
        emptyHint={own ? "No jobs assigned to you in this view. Your member assigns Ready to Apply jobs to you on the Team page." : undefined}
      />
      <Pagination total={total} page={page ?? 1} size={params.size} />
    </div>
  );
}
