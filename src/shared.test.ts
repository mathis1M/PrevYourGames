import { describe, expect, test } from "bun:test";
import { isRobloxPreviewUrl, readStoredImages } from "./shared";

test("restores legacy images and limits stored variants to five valid blobs", () => {
  const image = new Blob(["original image"], { type: "image/png" });
  expect(readStoredImages(image)).toEqual([image]);
  expect(readStoredImages([null, image, "invalid", ...Array(6).fill(image)])).toHaveLength(5);
  expect(readStoredImages(undefined)).toEqual([]);
  expect(readStoredImages({ images: [image] })).toEqual([]);
});

describe("isRobloxPreviewUrl", () => {
  test("accepts root and localized Home and Charts pages", () => {
    expect(isRobloxPreviewUrl("https://www.roblox.com/charts")).toBe(true);
    expect(isRobloxPreviewUrl("https://www.roblox.com/fr/charts")).toBe(true);
    expect(isRobloxPreviewUrl("https://www.roblox.com/pt-br/charts/")).toBe(true);
    expect(isRobloxPreviewUrl("https://www.roblox.com/home")).toBe(true);
    expect(isRobloxPreviewUrl("https://www.roblox.com/fr/home")).toBe(true);
  });

  test("rejects other hosts, routes, and protocols", () => {
    expect(isRobloxPreviewUrl("https://roblox.com/charts")).toBe(false);
    expect(isRobloxPreviewUrl("https://www.roblox.com/games")).toBe(false);
    expect(isRobloxPreviewUrl("http://www.roblox.com/fr/charts")).toBe(false);
    expect(isRobloxPreviewUrl(undefined)).toBe(false);
  });
});
