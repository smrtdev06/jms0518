import { can, requirePageUser } from "@/lib/auth";
import { teamActivity } from "@/lib/dashboard";
import { assignableJobs, autoAssign, soleAssignees } from "@/lib/assign";
import { PageTitle } from "@/components/page-title";
import { TeamManager } from "./team-manager";

export const metadata = { title: "Team" };

export default async function TeamPage() {
  const member = await requirePageUser(can.manageTeam);
  await autoAssign(member.id);
  const [week, allTime, readyJobs, scheduledJobs, sole] = await Promise.all([
    teamActivity(7, member.id),
    teamActivity(null, member.id),
    assignableJobs(member.id, "bidder"),
    assignableJobs(member.id, "caller"),
    soleAssignees(member.id),
  ]);
  const totals = allTime.map((person) => ({ id: person.id, applied: person.applied, apply_failed: person.apply_failed, results: person.results }));
  return (
    <div className="space-y-5">
      <PageTitle title="Team" subtitle="Your bidders and callers. Each one works only on the jobs you assign: Ready to Apply jobs to bidders, Scheduled interviews to callers." />
      <TeamManager people={week} totals={totals} assignable={{ bidder: readyJobs, caller: scheduledJobs }} sole={sole} />
    </div>
  );
}
