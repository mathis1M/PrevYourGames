import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import type { PageMessage, PageReply } from "./shared";

test("switches variants on the same random card and restores its original content", async () => {
  const build = await Bun.build({ entrypoints: [import.meta.dir + "/content.ts"], target: "browser", format: "iife" });
  expect(build.success).toBe(true);
  const source = await build.outputs[0]!.text();

  function element(text = "") {
    const attributes = new Map<string, string>();
    return {
      textContent: text,
      style: {
        objectFit: "", objectPosition: "",
        getPropertyValue: () => "", getPropertyPriority: () => "",
        setProperty() {}, removeProperty() {},
      },
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute: (name: string, value: string) => { attributes.set(name, value); },
      removeAttribute: (name: string) => { attributes.delete(name); },
    };
  }

  const bounds = () => ({ width: 240, height: 135, top: 100, bottom: 235, left: 10, right: 250 });
  function gameCard(id: number) {
    const image = { ...element(), getBoundingClientRect: bounds };
    image.setAttribute("src", `original-${id}.png`);
    const title = element(`Original ${id}`);
    const rating = element("80%");
    const players = element("100");
    const link = {
      ...element(), id: "",
      querySelector: (selector: string) => ({ img: image, ".game-card-name": title, ".vote-percentage-label": rating, ".playing-counts-label": players })[selector] ?? null,
      closest: (selector: string): unknown => selector === "li" ? card : list,
    };
    link.setAttribute("href", `/games/${id}/game`);
    const card = { querySelector: () => link, getBoundingClientRect: bounds };
    return { card, link, image, title, rating, players };
  }
  const games = [gameCard(1), gameCard(2)];
  const list = { querySelectorAll: (selector: string) => selector === "li" ? games.map((game) => game.card) : [] };
  let listener: (message: PageMessage, sender: unknown, respond: (reply: PageReply) => void) => void;
  runInNewContext(source, {
    window: { innerWidth: 1200, innerHeight: 800 },
    location: { hostname: "www.roblox.com", pathname: "/home" },
    document: {
      documentElement: {},
      querySelector: (selector: string) => selector.startsWith("#container-main") ? games[0]!.link : null,
      querySelectorAll: (selector: string) => selector.startsWith("#container-main") ? games.map((game) => game.link) : [],
    },
    chrome: { runtime: { onMessage: { addListener: (handler: typeof listener) => { listener = handler; } } } },
    getComputedStyle: () => ({ visibility: "visible", display: "block" }),
    Math: Object.assign(Object.create(Math), { random: () => 0.75 }),
    MutationObserver: class { observe() {} },
  });
  function send(message: PageMessage) {
    let reply: PageReply | undefined;
    listener!(message, {}, (response) => { reply = response; });
    return reply?.status;
  }

  expect(send({ type: "variant", image: "B.png", cropX: 25 })).toBe("absent");
  expect(send({ type: "preview", draft: { image: "A.png", cropX: 50, gameName: "My game", placement: "random", rating: "95%", players: "1K" } })).toBe("shown");
  expect(games[0]!.image.getAttribute("src")).toBe("original-1.png");
  expect(games[1]!.image.getAttribute("src")).toBe("A.png");
  expect(send({ type: "variant", image: "B.png", cropX: 25 })).toBe("shown");
  expect(games[1]!.image.getAttribute("src")).toBe("B.png");
  expect(games[1]!.image.style.objectPosition).toBe("25% center");
  expect(games[1]!.title.textContent).toBe("My game");
  expect(games[1]!.rating.textContent).toBe("95%");
  expect(games[1]!.players.textContent).toBe("1K");
  expect(send({ type: "remove" })).toBe("removed");
  expect(games[1]!.image.getAttribute("src")).toBe("original-2.png");
  expect(games[1]!.title.textContent).toBe("Original 2");
  expect(games[1]!.rating.textContent).toBe("80%");
  expect(games[1]!.players.textContent).toBe("100");
  expect(send({ type: "preview", draft: { image: "C.png", cropX: 50, gameName: "First game", placement: "first", rating: "", players: "" } })).toBe("shown");
  expect(games[0]!.image.getAttribute("src")).toBe("C.png");
});
