export type Placement = "first" | "random";
export type Theme = "light" | "dark";

export interface Settings {
  gameName: string;
  players: string;
  rating: string;
  placement: Placement;
  theme: Theme;
  cropX: number;
  activeVariant: number;
  variantCrops: number[];
}

export interface PreviewDraft {
  gameName: string;
  players: string;
  rating: string;
  placement: Placement;
  image: string;
  cropX: number;
}

export type PageMessage =
  | { type: "preview"; draft: PreviewDraft }
  | { type: "variant"; image: string; cropX: number }
  | { type: "remove" }
  | { type: "crop"; cropX: number };

export interface PageReply {
  status: "shown" | "waiting" | "removed" | "absent" | "missing";
}

export const DEFAULT_SETTINGS: Settings = {
  gameName: "",
  players: "",
  rating: "",
  placement: "first",
  theme: "light",
  cropX: 50,
  activeVariant: 0,
  variantCrops: [],
};

export const IMAGE_DB_NAME = "prevyourgames";
export const IMAGE_STORE_NAME = "assets";
export const IMAGE_KEY = "preview-image";
export const MAX_IMAGE_VARIANTS = 5;

export function readStoredImages(value: unknown): Blob[] {
  if (value instanceof Blob) return [value];
  return Array.isArray(value) ? value.filter((image): image is Blob => image instanceof Blob).slice(0, MAX_IMAGE_VARIANTS) : [];
}

export function isRobloxPreviewUrl(url: string | undefined): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "www.roblox.com" && /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:charts|home)\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}
