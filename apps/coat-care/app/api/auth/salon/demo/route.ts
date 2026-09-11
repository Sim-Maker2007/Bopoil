import { createDevelopmentOwnerSession } from "../../../../chatgpt-auth";

export async function POST() {
  if (process.env.NODE_ENV !== "development") return Response.json({ error: "Not found" }, { status: 404 });
  try {
    await createDevelopmentOwnerSession();
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Development salon sign-in failed", error);
    return Response.json({ error: "The preview workspace could not be opened." }, { status: 500 });
  }
}
