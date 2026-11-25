import { extensionJson, extensionRoute, extensionSnapshot, requireExtensionMember } from "@/lib/extension";

// GET /api/extension/sync — everything the extension window shows, for the Synchronize button.
export const GET = extensionRoute(async (request) => {
  const user = await requireExtensionMember(request);
  return extensionJson(await extensionSnapshot(user));
});

export { extensionOptions as OPTIONS } from "@/lib/extension";
