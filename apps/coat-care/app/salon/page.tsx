import { requireChatGPTUser } from "../chatgpt-auth";
import { CrmLanguageBoundary } from "../crm-language-boundary";
import { SalonWorkspace } from "./salon-workspace";

export const dynamic = "force-dynamic";

export default async function SalonPage() {
  const user = await requireChatGPTUser("/salon");
  return <CrmLanguageBoundary><SalonWorkspace signedInName={user.fullName || user.displayName} /></CrmLanguageBoundary>;
}
