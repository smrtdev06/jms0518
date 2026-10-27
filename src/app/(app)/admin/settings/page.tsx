import { getSettings } from "@/lib/settings";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Settings · Administrator" };

export default async function SettingsPage() {
  return <SettingsForm settings={await getSettings()} />;
}
