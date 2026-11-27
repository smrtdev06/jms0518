import { HttpError } from "@/lib/errors";
import { extensionJson, extensionRoute, extensionSnapshot, requireExtensionMember } from "@/lib/extension";

// GET /api/extension/sync — everything the extension window shows, for the Synchronize button.
// Up to 1000 jobs at a time: when `nextOffset` is not null, GET ?offset=<nextOffset> for the next page (?limit=1-1000).
export const GET = extensionRoute(async (request) => {
  const user = await requireExtensionMember(request);
  const search = new URL(request.url).searchParams;
  const number = (name: string) => {
    const value = search.get(name);
    if (value === null || value === "") return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) throw new HttpError(400, `${name} must be a whole number`);
    return parsed;
  };
  return extensionJson(await extensionSnapshot(user, { offset: number("offset"), limit: number("limit") }));
});

export { extensionOptions as OPTIONS } from "@/lib/extension";
