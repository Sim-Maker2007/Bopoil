/** Match the salon's Square naming convention. Unknown services are never guessed. */
export const coatOptions = [
  ["A", "Ras ou nu"], ["B", "Très court, sans sous-poil"],
  ["C", "Court à moyen, avec sous-poil"], ["D", "Long ou frisé"],
  ["E", "Long ou double, très dense"], ["F", "Je ne sais pas / conseil du salon"],
] as const;
export const sizeOptions = [
  ["XXS", "10 lb et moins"], ["XS", "11 à 20 lb"], ["S", "21 à 40 lb"],
  ["M", "41 à 60 lb"], ["L", "61 à 80 lb"], ["XL", "81 à 100 lb"], ["OTHER", "Plus de 100 lb / je ne sais pas"],
] as const;
function normalize(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
// Suggestions only: the client confirms the actual coat, including for mixed breeds.
export function suggestedCoat(breed: string): string {
  const value = normalize(breed.trim());
  if (/mix|crois|doodle/.test(value)) return "";
  if (/caniche|poodle|bichon|shih.?tzu|yorkshire/.test(value)) return "D";
  if (/husky|malamute|samoyede|terre.neuve|newfoundland|chow/.test(value)) return "E";
  if (/labrador|golden retriever|berger allemand|german shepherd|corgi/.test(value)) return "C";
  if (/boxer|doberman|dalmatien|dalmatian|beagle/.test(value)) return "B";
  return "";
}
export function isPublicCareService(name: string) {
  return !/sur appel|call only|livraison|deplacement|delivery/i.test(normalize(name));
}
export function careLabel(name: string) {
  const base = name.split("·")[0].replace(/\s*-\s*Catégorie\s+[A-F].*$/i, "").trim();
  return base === "Base" ? "Bain et soins de base" : base === "Complet" ? "Toilettage complet" : base;
}
export function matchingCare<T extends { name: string }>(services: T[], pet: { species?: string }, coat: string, size: string): T[] {
  return services.filter(({ name }) => {
    if (!isPublicCareService(name)) return false;
    const text = normalize(name);
    const species = pet.species || "dog";
    if (species === "cat") return /chat/.test(text);
    if (species !== "dog") return /petit animal/.test(text);
    if (/chat|petit animal/.test(text)) return false;
    const category = text.match(/categorie\s+([a-f])/i)?.[1].toUpperCase();
    const band = name.split("·")[1]?.trim().match(/^(XXS|XS|XL|S|M|L)(?:\/|\s|$)/i)?.[1].toUpperCase();
    if (category && (category === "F" || category !== coat || !band)) return false;
    if (band && band !== size) return false;
    // Only known care families; don't expose unrelated Square catalog entries.
    return /^(base|complet|traitement de la mue|brossage|taille de griffes)/.test(text);
  });
}
