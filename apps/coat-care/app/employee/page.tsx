import { getEmployeeSession } from "../../lib/employee-auth";
import { EmployeePortal } from "./employee-portal";

export const dynamic = "force-dynamic";

export default async function EmployeePage() {
  const session = await getEmployeeSession();
  return <EmployeePortal initiallySignedIn={Boolean(session)} />;
}
