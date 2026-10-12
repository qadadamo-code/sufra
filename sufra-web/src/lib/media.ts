import { images, videos, credits } from "virtual:media";

const have = new Set(images);
const haveVideo = new Set(videos);

/** Relative URL (works from any subpath) or null when the photo isn't available. */
export function imgUrl(key: string | undefined | null): string | null {
  if (!key) return null;
  return have.has(key) ? `./img/${key}.jpg` : null;
}
export function videoUrl(key: string | undefined | null): string | null {
  if (!key) return null;
  return haveVideo.has(key) ? `./video/${key}.webm` : null;
}
export const allImages = images;
export const allVideos = videos;
export const photoCredits = credits;

/** Stable tint for a placeholder tile. */
export function tintFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  const tints = ["#0d5a53", "#a8700c", "#3f6b5c", "#7a5a2a", "#2f5d68", "#5b6a64"];
  return tints[Math.abs(h) % tints.length];
}
