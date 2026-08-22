import { BookingExperience } from "../../../booking-experience";
import { resolveStorefront } from "../../../../db/public-storefront";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; location: string }> | { slug: string; location: string } }) {
  const { slug, location: locationSlug } = await params;
  try {
    const { organization, location } = await resolveStorefront({ organizationSlug: slug, locationSlug });
    return { title: `${organization.name} ${location.name} — Book pet grooming`, description: `See live grooming availability at ${organization.name}, ${location.name} in ${location.city}.` };
  } catch { return { title: "Salon booking — Coat & Care" }; }
}

export default async function SalonLocationStorefront({ params }: { params: Promise<{ slug: string; location: string }> | { slug: string; location: string } }) {
  const { slug, location } = await params;
  return <BookingExperience storefrontSlug={slug} locationSlug={location} />;
}
