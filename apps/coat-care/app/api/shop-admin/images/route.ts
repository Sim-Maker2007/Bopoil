import { isAllowedImageBytes } from "../../../../lib/media-validation";
import { loadAdminProduct, uploadCatalogImage } from "../../../../lib/shop-admin";
import { shopConfig } from "../../../../lib/square-shop";
import { SalonAccessError } from "../../../salon-access";
import { recordShopChange, requireShopAdmin, shopAdminError, squareId } from "../shop-admin-request";

// Square takes JPEG, PNG and GIF photos. The admin resizes a photo to a JPEG
// of at most 2 000 pixels before sending it, well under the 4.5 MB a Vercel
// function accepts.
const mimeTypes = ["image/jpeg", "image/png"];

export async function POST(request: Request) {
  try {
    const { db, membership } = await requireShopAdmin();
    if (!shopConfig().hasToken) throw new SalonAccessError("Connect Square first: SQUARE_ACCESS_TOKEN is not set.", 503);
    const form = await request.formData();
    const file = form.get("file");
    const kind = String(form.get("kind") || "");
    const objectId = squareId(form.get("objectId"), kind === "category" ? "category" : "product");
    if (kind !== "product" && kind !== "category") throw new SalonAccessError("Choose a product or a category.", 400);
    if (!(file instanceof File) || !mimeTypes.includes(file.type) || file.size < 1 || file.size > 4 * 1024 * 1024) throw new SalonAccessError("Choose a JPEG or PNG photo up to 4 MB.", 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isAllowedImageBytes(file.type, bytes)) throw new SalonAccessError("The file contents do not match a supported image format.", 400);
    const filename = (file.name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "photo").slice(0, 120);
    // A category shows a single photo, so a new one replaces it at the front.
    const primary = kind === "category" || form.get("primary") === "true";
    const image = await uploadCatalogImage(objectId, new Blob([bytes], { type: file.type }), { filename, primary });
    await recordShopChange(db, membership, "boutique.photo_added", kind === "category" ? "square_category" : "square_item", objectId, { imageId: image.id, sizeBytes: file.size });
    if (kind === "category") return Response.json({ image }, { headers: { "cache-control": "no-store" } });
    return Response.json({ image, product: await loadAdminProduct(objectId) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return shopAdminError(error, "The photo could not be added in Square"); }
}
