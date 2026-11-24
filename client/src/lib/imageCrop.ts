export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file could not be read as an image")); };
    img.src = url;
  });
}

/** Draws a square crop of the image. zoom 1 = just fills the square, ox and oy (-1 to 1) move the picture. */
export function drawCrop(canvas: HTMLCanvasElement, img: HTMLImageElement, size: number, zoom: number, ox: number, oy: number) {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size, size);
  const scale = Math.max(size / img.width, size / img.height) * zoom;
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (size - w) / 2 + ox * Math.max(0, (w - size) / 2), (size - h) / 2 + oy * Math.max(0, (h - size) / 2), w, h);
}

/** A small square JPEG (about 30 KB) ready to upload. */
export function cropToDataUrl(img: HTMLImageElement, zoom: number, ox: number, oy: number, size = 320) {
  const c = document.createElement("canvas");
  drawCrop(c, img, size, zoom, ox, oy);
  return c.toDataURL("image/jpeg", 0.86);
}