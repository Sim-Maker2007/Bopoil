import { SalonLoginForm } from "./salon-login-form";

export default async function SalonLoginPage({ searchParams }: { searchParams: Promise<{ expired?: string; return_to?: string }> }) {
  const query = await searchParams;
  return <SalonLoginForm expired={query.expired !== undefined} returnTo={query.return_to || "/salon"} />;
}
