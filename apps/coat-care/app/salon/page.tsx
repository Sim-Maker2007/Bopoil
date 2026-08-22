import { requireChatGPTUser } from "../chatgpt-auth";
import { SalonWorkspace } from "./salon-workspace";

export const dynamic = "force-dynamic";

export default async function SalonPage() {
  const user = await requireChatGPTUser("/salon");
  return <SalonWorkspace signedInName={user.fullName || user.displayName} />;
}
