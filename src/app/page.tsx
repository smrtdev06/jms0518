import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { homePath } from "@/lib/roles";

export default async function Home() {
  const user = await getCurrentUser();
  redirect(user ? homePath(user.role) : "/login");
}
