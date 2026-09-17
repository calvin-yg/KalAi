/**
 * Downscale a camera photo in the browser before it goes anywhere near the network.
 *
 * Phone cameras produce 8-12 MP JPEGs; the model gains nothing from that detail and
 * the upload costs the user time and data. 1024 px on the long edge keeps plate
 * detail and portion cues while landing well under the request size limit.
 */
export async function downscaleImage(
  file: File,
  maxEdge = 1024,
  quality = 0.82,
): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not read that photo.");
    ctx.drawImage(bitmap, 0, 0, width, height);

    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    bitmap.close();
  }
}
