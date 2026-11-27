import { requirePageUser } from "@/lib/auth";
import { TopBar } from "@/components/top-bar";
import { GmailCheckNotice } from "@/components/gmail-notice";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  return (
    <div className="min-h-screen">
      <TopBar user={user} />
      <main className="mx-auto w-full max-w-7xl px-4 pb-16 pt-6 sm:px-6">{children}</main>
      {/* The daily Gmail check results, bottom right, until closed. */}
      <GmailCheckNotice />
    </div>
  );
}
