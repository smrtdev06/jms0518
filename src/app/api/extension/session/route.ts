import { createExtensionToken } from "@/lib/auth";
import { extensionJson, extensionRoute } from "@/lib/extension";
import { readJson, str } from "@/lib/http";
import { verifySignIn } from "@/lib/sign-in";

// POST /api/extension/session — the extension signs in with the same user ID and password as the site.
// A success body is returned only for an active member. Other roles are confirmed, but not signed in.
export const POST = extensionRoute(async (request) => {
  const body = await readJson(request);
  const username = str(body.username ?? body.userId ?? body.user_id, 100);
  const result = await verifySignIn(request, username, String(body.password ?? ""));
  if (!result.ok) return extensionJson({ ok: false, exists: false, error: result.error }, result.status);

  const account = result.account;
  const user = {
    id: account.id,
    username: account.username,
    displayName: account.display_name || account.username,
    role: account.role,
    active: account.is_active,
  };
  if (!account.is_active) {
    return extensionJson({ ok: false, exists: true, role: account.role, user, error: "This account is deactivated" }, 403);
  }
  if (account.role !== "member") {
    return extensionJson({ ok: false, exists: true, role: account.role, user, error: "Only a member can use the auto-apply extension" }, 403);
  }
  return extensionJson({ ok: true, exists: true, role: account.role, token: await createExtensionToken(account.id), user });
});

export { extensionOptions as OPTIONS } from "@/lib/extension";
