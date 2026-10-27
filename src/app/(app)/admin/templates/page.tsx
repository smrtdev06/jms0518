import { templateInfo } from "@/lib/tailor/templates";
import { TemplatesManager } from "./templates-manager";

export const metadata = { title: "Templates · Administrator" };

export default async function TemplatesPage() {
  const [resume, cover] = await Promise.all([templateInfo("resume"), templateInfo("cover")]);
  return <TemplatesManager templates={[resume, cover]} />;
}
