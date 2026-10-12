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
