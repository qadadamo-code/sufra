/// <reference types="vite/client" />
declare module "virtual:media" {
  export const images: string[];
  export const videos: string[];
  export const credits: Record<
    string,
    { title?: string; creator?: string; creator_url?: string; license?: string; license_version?: string; license_url?: string; source_url?: string; provider?: string }
  >;
}
declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}
interface ImportMetaEnv {
  /** Optional: Google Maps JavaScript API + Places API (New) browser key. Unset → OpenStreetMap map, no Google ratings. */
  readonly VITE_GOOGLE_MAPS_KEY?: string;
  /** Optional: a Google Cloud map ID (needed for advanced markers in production; "DEMO_MAP_ID" otherwise). */
  readonly VITE_GOOGLE_MAP_ID?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
