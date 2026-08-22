import { del, get, put } from "@vercel/blob";

export const mediaStore = {
  async put(pathname: string, body: Uint8Array, options: { httpMetadata?: { contentType?: string } } = {}) {
    await put(pathname, Buffer.from(body), {
      access: "private",
      contentType: options.httpMetadata?.contentType,
      addRandomSuffix: false,
    });
  },

  async get(pathname: string) {
    const result = await get(pathname, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return { body: result.stream };
  },

  async delete(pathname: string) {
    await del(pathname);
  },
};
