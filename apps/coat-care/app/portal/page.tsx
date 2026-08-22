import type { Metadata } from "next";
import { PortalExperience } from "./[token]/portal-experience";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pet Parent Portal — Coat & Care", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function PortalPage() { return <PortalExperience token=""/>; }
