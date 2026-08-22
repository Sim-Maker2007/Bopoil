import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Pet Parent Portal — Coat & Care", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) { const { token } = await params; redirect(`/portal/access/${encodeURIComponent(token)}`); }
