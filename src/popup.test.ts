import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";

test("keeps images and variant buttons visible until the latest selection is decoded", async () => {
  const build = await Bun.build({ entrypoints: [import.meta.dir + "/popup.ts"], target: "browser", format: "iife" });
  expect(build.success).toBe(true);
  const elements = new Map<string, TestElement>();
  class TestElement {
    id = "";
    alt = "";
    src = "";
    value = "";
    hidden = false;
    checked = false;
    textContent = "";
    dataset: Record<string, string> = {};
    children: TestElement[] = [];
    attributes = new Map<string, string>();
    listeners = new Map<string, () => void>();
    style = { objectPosition: "", setProperty() {} };
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    removeAttribute(name: string) { this.attributes.delete(name); }
    addEventListener(name: string, listener: () => void) { this.listeners.set(name, listener); }
    append(...children: TestElement[]) { this.children.push(...children); }
    replaceChildren() { this.children = []; }
    replaceWith(next: TestElement) { elements.set("#thumbnail-preview", next); }
    querySelectorAll() { return this.children; }
    querySelector() { return new TestElement(); }
  }
  const node = (selector: string) => {
    if (!elements.has(selector)) {
      const element = new TestElement();
      element.id = selector.slice(1);
      elements.set(selector, element);
    }
    return elements.get(selector)!;
  };
  const pending: Array<{ image: TestImage; finish: () => void }> = [];
  class TestImage extends TestElement {
    naturalWidth = 0;
    naturalHeight = 0;
    decode() {
      return new Promise<void>((resolve) => pending.push({ image: this, finish: resolve }));
    }
  }
  const body = new TestElement();
  const blobs = [new Blob(["square"]), new Blob(["wide"])];
  let createdUrls = 0;
  const revokedUrls: string[] = [];
  class TestURL extends URL {
    static override createObjectURL() { return `blob:${++createdUrls}`; }
    static override revokeObjectURL(url: string) { revokedUrls.push(url); }
  }
  const database = {
    close() {},
    transaction: () => ({ objectStore: () => ({ get: () => {
      const request = { result: blobs, onsuccess() {} };
      queueMicrotask(() => request.onsuccess());
      return request;
    } }) }),
  };
  runInNewContext(await build.outputs[0]!.text(), {
    document: {
      body, documentElement: new TestElement(), querySelector: node,
      createElement: () => new TestElement(),
    },
    indexedDB: { open: () => {
      const request = { result: database, onsuccess() {} };
      queueMicrotask(() => request.onsuccess());
      return request;
    } },
    chrome: {
      storage: { local: {
        get: async () => ({ settings: { cropX: 25, variantCrops: [25, 75] } }),
        set: async () => {},
      } },
      tabs: {
        query: async () => [{ id: 1, url: "https://www.roblox.com/charts" }],
        sendMessage: async () => ({ status: "absent" }),
      },
    },
    FileReader: class {
      result = "data:image/png;base64,test";
      onload() {}
      readAsDataURL() { queueMicrotask(() => this.onload()); }
    },
    Image: TestImage, URL: TestURL, Blob, console, AbortController,
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
  });
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  await flush();
  function finish(index: number, width: number, height: number) {
    pending[index]!.image.naturalWidth = width;
    pending[index]!.image.naturalHeight = height;
    pending[index]!.finish();
  }
  expect(pending).toHaveLength(1);
  finish(0, 100, 100);
  await flush();
  const firstImage = node("#thumbnail-preview");
  const buttons = node("#variant-options").children;
  expect(firstImage.src).toBe("blob:1");
  expect(body.dataset.thumbnailIsSquare).toBe("true");

  buttons[1]!.listeners.get("click")!();
  expect(body.dataset.thumbnailIsSquare).toBe("unknown");
  expect(node("#thumbnail-preview")).toBe(firstImage);
  expect(node("#image-preview").hidden).toBe(false);
  expect(node("#variant-options").children).toBe(buttons);
  expect(createdUrls).toBe(2);
  expect(revokedUrls).toEqual([]);

  buttons[0]!.listeners.get("click")!();
  finish(2, 100, 100);
  await flush();
  const selectedA = node("#thumbnail-preview");
  finish(1, 200, 100);
  await flush();
  expect(node("#thumbnail-preview")).toBe(selectedA);
  expect(body.dataset.thumbnailIsSquare).toBe("true");

  buttons[1]!.listeners.get("click")!();
  expect(node("#thumbnail-preview")).toBe(selectedA);
  finish(3, 200, 100);
  await flush();
  expect(node("#thumbnail-preview").src).toBe("blob:2");
  expect(node("#thumbnail-preview").style.objectPosition).toBe("75% center");
  expect(body.dataset.thumbnailIsSquare).toBe("false");
  expect(node("#variant-options").children).toBe(buttons);
});
