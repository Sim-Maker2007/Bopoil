import { BookingExperience } from "../../booking-experience";
import { resolveStorefront } from "../../../db/public-storefront";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> | { slug: string } }) {
  const { slug } = await params;
  try {
    const { organization, location } = await resolveStorefront({ organizationSlug: slug });
    return { title: `${organization.name} — Book pet grooming`, description: `Book thoughtful pet grooming at ${organization.name}, ${location.name} in ${location.city}.` };
  } catch { return { title: "Salon booking — Coat & Care" }; }
}

export default async function SalonStorefront({ params }: { params: Promise<{ slug: string }> | { slug: string } }) {
  const { slug } = await params;
  return <BookingExperience storefrontSlug={slug} />;
}
