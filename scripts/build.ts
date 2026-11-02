import { copyFile, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

const result = await Bun.build({
  entrypoints: ["src/popup.ts", "src/content.ts"],
  outdir: "dist",
  target: "browser",
  format: "iife",
  minify: false,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("Bun could not build the extension.");
}

await Promise.all([
  copyFile("manifest.json", "dist/manifest.json"),
  copyFile("src/popup.html", "dist/popup.html"),
  copyFile("src/popup.css", "dist/popup.css"),
  copyFile("logo.png", "dist/logo.png"),
  copyFile("banner.png", "dist/banner.png"),
]);

console.log("Built the extension in dist/.");
