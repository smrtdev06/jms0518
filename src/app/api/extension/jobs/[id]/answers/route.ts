import { answerScreeningQuestions } from "@/lib/tailor/answers";
import { assertMemberJob, extensionJson, extensionRoute, requireExtensionMember } from "@/lib/extension";
import { parseId, readJson } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const maxDuration = 300;

// POST { questions: string[] | string } — fills the answers prompts and returns the model's reply.
export const POST = extensionRoute<Ctx>(async (request, { params }) => {
  const user = await requireExtensionMember(request);
  const jobId = parseId((await params).id);
  await assertMemberJob(user.id, jobId);
  const body = await readJson<{ questions?: unknown }>(request);
  const result = await answerScreeningQuestions(user.id, jobId, body.questions, request.signal);
  return extensionJson(result);
});

export { extensionOptions as OPTIONS } from "@/lib/extension";
