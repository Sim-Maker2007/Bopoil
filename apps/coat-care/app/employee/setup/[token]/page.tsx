import { EmployeeSetup } from "./setup";

export default async function EmployeeSetupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <EmployeeSetup token={token} />;
}
