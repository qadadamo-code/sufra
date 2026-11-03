/** Small JPEG data URLs for staff photos, document scans and clock-in selfies (kept tiny: rows sync to every device). */

export async function fileToDataUrl(file: File, max = 320, quality = 0.78): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    return drawScaled(img, img.naturalWidth, img.naturalHeight, max, quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function drawScaled(src: CanvasImageSource, w: number, h: number, max = 240, quality = 0.72, square = false): string {
  const s = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement("canvas");
  if (square) {
    const side = Math.min(w, h);
    canvas.width = canvas.height = Math.round(Math.min(max, side));
    canvas.getContext("2d")!.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  } else {
    canvas.width = Math.round(w * s);
    canvas.height = Math.round(h * s);
    canvas.getContext("2d")!.drawImage(src, 0, 0, canvas.width, canvas.height);
  }
  return canvas.toDataURL("image/jpeg", quality);
}

/** One frame from a live <video> (selfie), square-cropped. */
export function snapshot(video: HTMLVideoElement, max = 240): string | null {
  if (!video.videoWidth) return null;
  return drawScaled(video, video.videoWidth, video.videoHeight, max, 0.7, true);
}
