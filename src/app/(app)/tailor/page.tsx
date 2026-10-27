import { redirect } from "next/navigation";
import { can, requirePageUser } from "@/lib/auth";
import { readProvider } from "@/lib/tailor/api-key";
import { listJobs, recoverInterruptedJobs } from "@/lib/tailor/jobs";
import { loadProfile } from "@/lib/tailor/profile";
import { serverless } from "@/lib/tailor/hosting";
import { TailorApp } from "./tailor-app";

export const metadata = { title: "Resume Tailor" };

export default async function TailorPage() {
  const user = await requirePageUser(can.tailor);
  const profile = await loadProfile(user.id);
  if (!profile) redirect("/tailor/profile");
  if (!serverless) await recoverInterruptedJobs();
  const jobs = await listJobs(user.id);
  const provider = readProvider();
  const { baseResumeText: _baseResumeText, ...publicProfile } = profile;
  return <TailorApp profile={publicProfile} initialJobs={jobs} keyReady={Boolean(provider.apiKey)} keyName={provider.keyName} />;
}
