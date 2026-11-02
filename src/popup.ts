import * as Effect from "effect/Effect";
import {
  DEFAULT_SETTINGS,
  IMAGE_DB_NAME,
  IMAGE_KEY,
  IMAGE_STORE_NAME,
  MAX_IMAGE_VARIANTS,
  isRobloxPreviewUrl,
  readStoredImages,
  type PageMessage,
  type Placement,
  type Settings,
  type Theme,
} from "./shared";

const form = document.querySelector<HTMLFormElement>("#preview-form")!;
const nameInput = document.querySelector<HTMLInputElement>("#game-name")!;
const playersInput = document.querySelector<HTMLInputElement>("#player-count")!;
const ratingInput = document.querySelector<HTMLInputElement>("#game-rating")!;
const fileInput = document.querySelector<HTMLInputElement>("#image-file")!;
const dropzone = document.querySelector<HTMLElement>("#dropzone")!;
const chooseImageButton = document.querySelector<HTMLButtonElement>("#image-empty")!;
const changeImageButton = document.querySelector<HTMLButtonElement>("#change-image")!;
const emptyPreview = document.querySelector<HTMLElement>("#image-empty")!;
const imagePreview = document.querySelector<HTMLElement>("#image-preview")!;
let thumbnailPreview = document.querySelector<HTMLImageElement>("#thumbnail-preview")!;
const cropInput = document.querySelector<HTMLInputElement>("#crop-position")!;
const themeButton = document.querySelector<HTMLButtonElement>("#theme-toggle")!;
const previewButton = document.querySelector<HTMLButtonElement>("#preview-button")!;
const openChartsButton = document.querySelector<HTMLButtonElement>("#open-charts")!;
const removeButton = document.querySelector<HTMLButtonElement>("#remove-preview")!;
const imageVariants = document.querySelector<HTMLElement>("#image-variants")!;
const variantOptions = document.querySelector<HTMLElement>("#variant-options")!;
const addImageButton = document.querySelector<HTMLButtonElement>("#add-image")!;
const removeImageButton = document.querySelector<HTMLButtonElement>("#remove-image")!;

let imageBlob: Blob | null = null;
let images: Blob[] = [];
const imageUrls = new Map<Blob, string>();
let thumbnailRevision = 0;
let replacingImage = false;
let savingImages = false;
let imageRevision = 0;
let activeTabId: number | undefined;
let onSupportedPage = false;
let currentSettings: Settings = { ...DEFAULT_SETTINGS };

function runTask<A>(task: () => Promise<A>): Promise<A> {
  return Effect.runPromise(Effect.tryPromise({
    try: task,
    catch: (error) => error instanceof Error ? error : new Error(String(error)),
  }));
}

function openImageDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IMAGE_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(IMAGE_STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local image storage."));
  });
}

async function saveImages(nextImages: Blob[]): Promise<void> {
  const database = await openImageDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(IMAGE_STORE_NAME, "readwrite");
    transaction.objectStore(IMAGE_STORE_NAME).put(nextImages, IMAGE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save the image."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Image saving was cancelled."));
  }).finally(() => database.close());
}

async function loadImages(): Promise<Blob[]> {
  const database = await openImageDatabase();
  return new Promise<Blob[]>((resolve, reject) => {
    const request = database.transaction(IMAGE_STORE_NAME, "readonly").objectStore(IMAGE_STORE_NAME).get(IMAGE_KEY);
    request.onsuccess = () => resolve(readStoredImages(request.result));
    request.onerror = () => reject(request.error ?? new Error("Could not load the saved image."));
  }).finally(() => database.close());
}

async function saveSettings(settings: Partial<Settings>): Promise<void> {
  currentSettings = { ...currentSettings, ...settings };
  await chrome.storage.local.set({ settings: currentSettings });
}

function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  themeButton.setAttribute("aria-label", `Switch to ${theme === "light" ? "dark" : "light"} theme`);
}

function setCropPosition(value: number): void {
  const cropX = Math.max(0, Math.min(100, value));
  cropInput.value = String(cropX);
  cropInput.style.setProperty("--crop-progress", `${cropX}%`);
  cropInput.setAttribute("aria-valuetext", cropX === 50 ? "Center" : `${cropX}%`);
  thumbnailPreview.style.objectPosition = `${cropX}% center`;
}

function renderImages(): void {
  for (const [image, url] of imageUrls) {
    if (images.includes(image)) continue;
    URL.revokeObjectURL(url);
    imageUrls.delete(image);
  }
  for (const image of images) {
    if (!imageUrls.has(image)) imageUrls.set(image, URL.createObjectURL(image));
  }
  variantOptions.replaceChildren();
  images.forEach((_image, index) => {
    const label = String.fromCharCode(65 + index);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "variant-button";
    button.setAttribute("aria-label", `Preview variant ${label}`);
    button.setAttribute("aria-pressed", String(index === currentSettings.activeVariant));
    const thumbnail = document.createElement("img");
    thumbnail.src = imageUrls.get(images[index]!)!;
    thumbnail.alt = "";
    const badge = document.createElement("span");
    badge.textContent = label;
    button.append(thumbnail, badge);
    button.addEventListener("click", () => selectVariant(index));
    variantOptions.append(button);
  });
  addImageButton.hidden = images.length >= MAX_IMAGE_VARIANTS;
  imageVariants.hidden = images.length === 0;
  void showSelectedImage().catch(console.error);
}

async function showSelectedImage(): Promise<void> {
  const revision = ++thumbnailRevision;
  imageBlob = images[currentSettings.activeVariant] ?? null;
  document.body.dataset.thumbnailIsSquare = "unknown";
  for (const [index, button] of [...variantOptions.querySelectorAll("button")].entries()) {
    button.setAttribute("aria-pressed", String(index === currentSettings.activeVariant));
  }
  if (!imageBlob) {
    emptyPreview.hidden = false;
    imagePreview.hidden = true;
    thumbnailPreview.removeAttribute("src");
    return;
  }
  const nextImage = new Image();
  nextImage.src = imageUrls.get(imageBlob)!;
  await nextImage.decode();
  if (revision !== thumbnailRevision) return;
  nextImage.id = thumbnailPreview.id;
  nextImage.alt = thumbnailPreview.alt;
  thumbnailPreview.replaceWith(nextImage);
  thumbnailPreview = nextImage;
  setCropPosition(document.body.dataset.previewPage === "home" ? 50 : currentSettings.cropX);
  document.body.dataset.thumbnailIsSquare = String(nextImage.naturalWidth === nextImage.naturalHeight);
  emptyPreview.hidden = true;
  imagePreview.hidden = false;
}

async function syncVariant(): Promise<void> {
  const revision = ++imageRevision;
  if (!onSupportedPage || activeTabId === undefined) return;
  if (!imageBlob) {
    await removePreview();
    return;
  }
  const image = await toDataUrl(imageBlob);
  if (revision !== imageRevision) return;
  const cropX = document.body.dataset.previewPage === "home" ? 50 : currentSettings.cropX;
  await chrome.tabs.sendMessage(activeTabId, { type: "variant", image, cropX } satisfies PageMessage).catch(() => undefined);
}

function selectVariant(index: number): void {
  if (savingImages || !images[index]) return;
  currentSettings.activeVariant = index;
  currentSettings.cropX = currentSettings.variantCrops[index] ?? 50;
  void showSelectedImage().catch(console.error);
  void runTask(() => saveSettings({ activeVariant: index, cropX: currentSettings.cropX })).catch(console.error);
  void syncVariant().catch(console.error);
}

function selectedPlacement(): Placement {
  return form.querySelector<HTMLInputElement>('input[name="placement"]:checked')?.value === "random" ? "random" : "first";
}

function normalizePlayers(value: string): string | null {
  const players = value.trim();
  const compact = players.match(/^(\d+(?:\.\d+)?)\s*([KMB])$/i);
  if (compact) {
    const scale = { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[compact[2]!.toUpperCase() as "K" | "M" | "B"];
    const count = Number(compact[1]) * scale;
    return Number.isSafeInteger(count) ? String(count) : null;
  }
  const digits = players.replaceAll(",", "");
  return !digits ? "" : /^\d{1,15}$/.test(digits) ? String(Number(digits)) : null;
}

function normalizeRating(value: string): string | null {
  const rating = value.trim();
  if (!rating) return "";
  if (!/^\d{1,3}%?$/.test(rating)) return null;
  const numericRating = Number(rating.replace("%", ""));
  return numericRating <= 100 ? String(numericRating) : null;
}

function formatPlayers(value: string): string {
  return value ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value)) : "";
}

function formatRating(value: string): string {
  return value ? `${value}%` : "";
}

function keepDigits(input: HTMLInputElement): void {
  const start = input.selectionStart ?? input.value.length;
  const value = input.value.replace(/\D/g, "").slice(0, input.maxLength);
  if (input.value === value) return;
  input.value = value;
  input.setSelectionRange(Math.min(start, value.length), Math.min(start, value.length));
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read the selected image."));
    reader.onerror = () => reject(new Error("Could not read the selected image."));
    reader.readAsDataURL(blob);
  });
}

async function sendPageMessage(message: PageMessage): Promise<void> {
  if (activeTabId === undefined) throw new Error("Could not access the active tab. Reopen this popup and try again.");

  await chrome.scripting.executeScript({ target: { tabId: activeTabId }, files: ["content.js"] });
  await chrome.tabs.sendMessage(activeTabId, message);
}

function renderPageActions(): void {
  openChartsButton.hidden = onSupportedPage;
  previewButton.hidden = !onSupportedPage;
  removeButton.hidden = !onSupportedPage;
}

async function acceptImages(files: File[], replace = false): Promise<void> {
  if (savingImages || files.length === 0) return;
  savingImages = true;
  try {
    const nextImages = [...images];
    const crops = [...currentSettings.variantCrops];
    const selected = replace ? currentSettings.activeVariant : images.length;
    for (const file of files) {
      if (!replace && nextImages.length >= MAX_IMAGE_VARIANTS) break;
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 10 * 1024 * 1024) continue;
      try {
        const bitmap = await createImageBitmap(file);
        bitmap.close();
      } catch {
        continue;
      }
      const index = replace ? currentSettings.activeVariant : nextImages.length;
      nextImages[index] = file;
      crops[index] = 50;
      if (replace) break;
    }
    if (!nextImages[selected] || (replace && nextImages[selected] === images[selected])) return;
    await runTask(() => saveImages(nextImages));
    images = nextImages;
    currentSettings.activeVariant = selected;
    currentSettings.variantCrops = crops;
    currentSettings.cropX = crops[selected] ?? 50;
    renderImages();
    await saveSettings({ activeVariant: selected, variantCrops: crops, cropX: currentSettings.cropX });
    await syncVariant();
  } catch (error) {
    console.error("Could not save the selected images.", error);
  } finally {
    savingImages = false;
  }
}

async function removeImage(): Promise<void> {
  if (savingImages || !imageBlob) return;
  savingImages = true;
  try {
    const nextImages = images.filter((_image, index) => index !== currentSettings.activeVariant);
    const crops = currentSettings.variantCrops.filter((_crop, index) => index !== currentSettings.activeVariant);
    await saveImages(nextImages);
    images = nextImages;
    const selected = Math.max(0, Math.min(currentSettings.activeVariant, images.length - 1));
    currentSettings.activeVariant = selected;
    currentSettings.variantCrops = crops;
    currentSettings.cropX = crops[selected] ?? 50;
    renderImages();
    await saveSettings({ activeVariant: selected, variantCrops: crops, cropX: currentSettings.cropX });
    await syncVariant();
  } finally {
    savingImages = false;
  }
}

function chooseImages(replace = false): void {
  if (savingImages) return;
  replacingImage = replace;
  fileInput.multiple = !replace;
  fileInput.value = "";
  fileInput.click();
}

async function preview(): Promise<void> {
  const gameName = nameInput.value.trim();
  if (!gameName) {
    nameInput.focus();
    return;
  }
  if (!imageBlob) {
    chooseImageButton.focus();
    return;
  }
  if (!onSupportedPage) return;

  const players = normalizePlayers(playersInput.value);
  if (players === null) {
    playersInput.setCustomValidity("Enter a whole-number player count.");
    playersInput.reportValidity();
    return;
  }
  playersInput.setCustomValidity("");
  const rating = normalizeRating(ratingInput.value);
  if (rating === null) {
    ratingInput.setCustomValidity("Enter a rating from 0 to 100.");
    ratingInput.reportValidity();
    return;
  }
  ratingInput.setCustomValidity("");

  previewButton.disabled = true;
  try {
    const cropX = document.body.dataset.previewPage === "home" ? 50 : Number(cropInput.value);
    const image = await runTask(() => toDataUrl(imageBlob!));
    await runTask(() => sendPageMessage({
      type: "preview",
      draft: { gameName, players: formatPlayers(players), rating: formatRating(rating), placement: selectedPlacement(), image, cropX },
    }));
    playersInput.value = players;
    ratingInput.value = rating;
    await runTask(() => saveSettings({ gameName, players, rating, placement: selectedPlacement(), cropX: currentSettings.cropX }));
  } catch (error) {
    console.error("Preview failed.", error);
  } finally {
    previewButton.disabled = false;
  }
}

async function removePreview(): Promise<void> {
  if (!onSupportedPage) return;
  try {
    await runTask(() => sendPageMessage({ type: "remove" }));
  } catch (error) {
    console.error("Could not remove the preview.", error);
  }
}

async function openCharts(): Promise<void> {
  await chrome.tabs.create({ url: "https://www.roblox.com/charts" });
}

themeButton.addEventListener("click", () => {
  const theme: Theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  setTheme(theme);
  void runTask(() => saveSettings({ theme })).catch(console.error);
});

chooseImageButton.addEventListener("click", () => chooseImages());
addImageButton.addEventListener("click", () => chooseImages());
changeImageButton.addEventListener("click", () => chooseImages(true));
removeImageButton.addEventListener("click", () => void removeImage().catch(console.error));
fileInput.addEventListener("change", () => void acceptImages([...fileInput.files ?? []], replacingImage));
dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("is-dragging");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-dragging"));
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("is-dragging");
  void acceptImages([...event.dataTransfer?.files ?? []]);
});
nameInput.addEventListener("input", () => {
  void runTask(() => saveSettings({ gameName: nameInput.value })).catch(console.error);
});
playersInput.addEventListener("input", () => {
  keepDigits(playersInput);
  playersInput.setCustomValidity("");
  void runTask(() => saveSettings({ players: playersInput.value })).catch(console.error);
});
ratingInput.addEventListener("input", () => {
  keepDigits(ratingInput);
  ratingInput.setCustomValidity("");
  void runTask(() => saveSettings({ rating: ratingInput.value })).catch(console.error);
});
form.addEventListener("change", (event) => {
  if (event.target instanceof HTMLInputElement && event.target.name === "placement") {
    void runTask(() => saveSettings({ placement: selectedPlacement() })).catch(console.error);
  }
});
cropInput.addEventListener("input", () => {
  const cropX = Number(cropInput.value);
  currentSettings.cropX = cropX;
  currentSettings.variantCrops[currentSettings.activeVariant] = cropX;
  setCropPosition(cropX);
  if (onSupportedPage && activeTabId !== undefined) {
    void chrome.tabs.sendMessage(activeTabId, { type: "crop", cropX } satisfies PageMessage).catch(() => undefined);
  }
});
cropInput.addEventListener("change", () => {
  void runTask(() => saveSettings({ cropX: currentSettings.cropX, variantCrops: currentSettings.variantCrops })).catch(console.error);
});
form.addEventListener("submit", (event) => {
  event.preventDefault();
  void preview();
});
removeButton.addEventListener("click", () => void removePreview());
openChartsButton.addEventListener("click", () => void openCharts().catch(console.error));

async function initialize(): Promise<void> {
  const [saved, storedImages] = await Promise.all([
    chrome.storage.local.get("settings").catch(() => ({ settings: undefined })),
    runTask(loadImages).catch((error) => {
      console.error("Could not load saved thumbnail.", error);
      return [];
    }),
  ]);
  const storedSettings = saved.settings && typeof saved.settings === "object" ? saved.settings as Partial<Settings> : {};
  currentSettings = { ...DEFAULT_SETTINGS, ...storedSettings };
  if (currentSettings.placement !== "first" && currentSettings.placement !== "random") currentSettings.placement = "first";
  currentSettings.players = typeof currentSettings.players === "string" ? normalizePlayers(currentSettings.players) ?? "" : "";
  currentSettings.rating = typeof currentSettings.rating === "string" ? normalizeRating(currentSettings.rating) ?? "" : "";
  if (!Number.isFinite(currentSettings.cropX)) currentSettings.cropX = 50;
  currentSettings.cropX = Math.max(0, Math.min(100, currentSettings.cropX));
  images = storedImages;
  currentSettings.activeVariant = Number.isInteger(currentSettings.activeVariant)
    ? Math.max(0, Math.min(currentSettings.activeVariant, Math.max(0, images.length - 1))) : 0;
  const savedCrops = Array.isArray(currentSettings.variantCrops) ? currentSettings.variantCrops : [];
  currentSettings.variantCrops = images.map((_image, index) => {
    const crop = savedCrops[index] ?? (index === 0 ? currentSettings.cropX : 50);
    return Number.isFinite(crop) ? Math.max(0, Math.min(100, crop)) : 50;
  });
  currentSettings.cropX = currentSettings.variantCrops[currentSettings.activeVariant] ?? 50;
  nameInput.value = currentSettings.gameName;
  playersInput.value = currentSettings.players;
  ratingInput.value = currentSettings.rating;
  form.querySelector<HTMLInputElement>(`input[name="placement"][value="${currentSettings.placement}"]`)!.checked = true;
  setTheme(currentSettings.theme === "dark" ? "dark" : "light");
  setCropPosition(currentSettings.cropX);

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  activeTabId = tab?.id;
  onSupportedPage = isRobloxPreviewUrl(tab?.url);
  document.body.dataset.previewPage = onSupportedPage && /\/home\/?$/i.test(new URL(tab!.url!).pathname) ? "home" : "charts";
  renderImages();
  renderPageActions();
}

void runTask(initialize).catch(console.error);
