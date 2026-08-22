import { ApprovalExperience } from "./approval-experience";

export const metadata = { referrer: "no-referrer" as const };

export default async function ApprovalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ApprovalExperience token={token} />;
}
