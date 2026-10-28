import { can, requirePageUser } from "@/lib/auth";
import { PageTitle } from "@/components/page-title";
import { AdminTabs } from "./tabs";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePageUser(can.administer);
  return (
    <div className="space-y-5">
      <PageTitle title="Administrator" subtitle="Accounts, job links, bot links, resume templates, duplicate rules, the activity log and database backups." />
      <AdminTabs />
      {children}
    </div>
  );
}
