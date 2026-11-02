import { getTargetIndex } from "./placement";
import type { PageMessage, PageReply, PreviewDraft } from "./shared";

type OriginalCard = {
  gameId: string;
  link: HTMLAnchorElement;
  image: HTMLImageElement;
  imageAttributes: Record<string, string | null>;
  imageFit: string;
  imageFitPriority: string;
  imagePosition: string;
  imagePositionPriority: string;
  title: HTMLElement | null;
  titleText: string;
  titleAttribute: string | null;
  titleStyle: string | null;
  rating: OriginalStat | null;
  players: OriginalStat | null;
  linkLabel: string | null;
};

type OriginalStat = {
  element: HTMLElement;
  text: string;
  title: string | null;
};

function installPreviewHandler(): void {
  const extensionWindow = window as Window & { __prevyourgamesReady?: boolean };
  if (extensionWindow.__prevyourgamesReady) return;
  extensionWindow.__prevyourgamesReady = true;

  const PREVIEW_PATH = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:charts|home)\/?$/i;
  let currentDraft: PreviewDraft | null = null;
  let targetGameId: string | null = null;
  let originalCard: OriginalCard | null = null;
  let renderQueued = false;

  function isRobloxPreviewPage(): boolean {
    return location.hostname === "www.roblox.com" && PREVIEW_PATH.test(location.pathname);
  }

  function findFirstGameList(): HTMLElement | null {
    const headings = [...document.querySelectorAll("h1, h2, h3, [role='heading']")];
    const heading = headings.find((element) => /trending|tendanc|recommended|recommand/i.test(element.textContent ?? ""));
    const section = heading?.closest<HTMLElement>(".games-list-container");
    return section?.querySelector<HTMLElement>(".game-cards")
      ?? document.querySelector<HTMLElement>(".games-list-container .game-cards")
      ?? document.querySelector<HTMLAnchorElement>("#container-main a[href*='/games/']")?.closest<HTMLElement>("ul, .game-grid")
      ?? null;
  }

  function cardsIn(list: HTMLElement): HTMLElement[] {
    const gameCards = [...list.querySelectorAll<HTMLElement>(".game-card")].filter((card) => gameLink(card) !== null);
    return gameCards.length > 0
      ? gameCards
      : [...list.querySelectorAll<HTMLElement>("li")].filter((card) => gameLink(card) !== null);
  }

  function allGameCards(): HTMLElement[] {
    const legacyCards = [...document.querySelectorAll<HTMLElement>(".games-list-container .game-cards .game-card")];
    if (legacyCards.length > 0) return legacyCards;

    return [...document.querySelectorAll<HTMLAnchorElement>("#container-main a[href*='/games/']")]
      .map((link) => link.closest<HTMLElement>("li"))
      .filter((card): card is HTMLElement => card !== null && gameLink(card) !== null);
  }

  function visibleCards(cards: HTMLElement[]): HTMLElement[] {
    return cards.filter((card) => {
      const bounds = card.getBoundingClientRect();
      const style = getComputedStyle(card);
      return bounds.width > 0
        && bounds.height > 0
        && bounds.right > 0
        && bounds.bottom > 0
        && bounds.left < window.innerWidth
        && bounds.top < window.innerHeight
        && style.visibility !== "hidden"
        && style.display !== "none";
    });
  }

  function gameLink(card: HTMLElement): HTMLAnchorElement | null {
    return card.querySelector<HTMLAnchorElement>("a.game-card-link[href*='/games/'], a[href*='/games/']");
  }

  function gameId(link: HTMLAnchorElement): string | null {
    return (link.getAttribute("href")?.match(/\/games\/(\d+)/i)?.[1] ?? link.id) || null;
  }

  function restoreAttribute(element: Element, name: string, value: string | null): void {
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  }

  function saveStat(element: HTMLElement | null): OriginalStat | null {
    return element ? { element, text: element.textContent ?? "", title: element.getAttribute("title") } : null;
  }

  function restoreStat(stat: OriginalStat | null): void {
    if (!stat) return;
    stat.element.textContent = stat.text;
    restoreAttribute(stat.element, "title", stat.title);
  }

  function setStat(stat: OriginalStat | null, value: string): void {
    if (!stat) return;
    const text = value || stat.text;
    if (stat.element.textContent !== text) stat.element.textContent = text;
    setAttributeIfChanged(stat.element, "title", value ? value : stat.title);
  }

  function restoreOriginalCard(): void {
    if (!originalCard) return;

    for (const [name, value] of Object.entries(originalCard.imageAttributes)) {
      restoreAttribute(originalCard.image, name, value);
    }
    restoreStyle(originalCard.image, "object-fit", originalCard.imageFit, originalCard.imageFitPriority);
    restoreStyle(originalCard.image, "object-position", originalCard.imagePosition, originalCard.imagePositionPriority);
    if (originalCard.title) {
      originalCard.title.textContent = originalCard.titleText;
      restoreAttribute(originalCard.title, "title", originalCard.titleAttribute);
      restoreAttribute(originalCard.title, "style", originalCard.titleStyle);
    }
    restoreStat(originalCard.rating);
    restoreStat(originalCard.players);
    restoreAttribute(originalCard.link, "aria-label", originalCard.linkLabel);
    originalCard = null;
  }

  function restoreStyle(image: HTMLImageElement, name: string, value: string, priority: string): void {
    if (value) image.style.setProperty(name, value, priority);
    else image.style.removeProperty(name);
  }

  function saveOriginalCard(
    link: HTMLAnchorElement,
    image: HTMLImageElement,
    title: HTMLElement | null,
    rating: HTMLElement | null,
    players: HTMLElement | null,
    id: string,
  ): void {
    originalCard = {
      gameId: id,
      link,
      image,
      imageAttributes: Object.fromEntries(
        ["src", "srcset", "alt", "data-src", "data-srcset"].map((name) => [name, image.getAttribute(name)]),
      ),
      imageFit: image.style.getPropertyValue("object-fit"),
      imageFitPriority: image.style.getPropertyPriority("object-fit"),
      imagePosition: image.style.getPropertyValue("object-position"),
      imagePositionPriority: image.style.getPropertyPriority("object-position"),
      title,
      titleText: title?.textContent ?? "",
      titleAttribute: title?.getAttribute("title") ?? null,
      titleStyle: title?.getAttribute("style") ?? null,
      rating: saveStat(rating),
      players: saveStat(players),
      linkLabel: link.getAttribute("aria-label"),
    };
  }

  function setAttributeIfChanged(element: Element, name: string, value: string | null): void {
    if (element.getAttribute(name) === value) return;
    restoreAttribute(element, name, value);
  }

  function applyDraft(): "shown" | "waiting" | "missing" {
    if (!currentDraft) return "missing";

    const cards = allGameCards();
    if (cards.length === 0) return "waiting";

    if (!targetGameId) {
      const firstList = currentDraft.placement === "first" ? findFirstGameList() : null;
      if (currentDraft.placement === "first" && !firstList) return "waiting";
      const home = /\/home\/?$/i.test(location.pathname);
      const choices = currentDraft.placement === "first"
        ? cardsIn(firstList!)
        : visibleCards(cards).filter((card) => {
            if (!home) return true;
            const image = gameLink(card)?.querySelector("img");
            const bounds = image?.getBoundingClientRect();
            return bounds !== undefined && bounds.width > bounds.height * 1.2;
          });
      const card = choices[getTargetIndex(choices.length, currentDraft.placement)];
      const link = card && gameLink(card);
      if (!link) return "waiting";
      targetGameId = gameId(link);
      if (!targetGameId) return "waiting";
    }

    const card = cards.find((candidate) => {
      const link = gameLink(candidate);
      return link && gameId(link) === targetGameId;
    });
    const link = card && gameLink(card);
    const image = link?.querySelector<HTMLImageElement>("img");
    const title = link?.querySelector<HTMLElement>(".game-card-name") ?? null;
    const rating = link?.querySelector<HTMLElement>(".vote-percentage-label") ?? null;
    const players = link?.querySelector<HTMLElement>(".playing-counts-label") ?? null;
    if (!link || !image || !targetGameId) return "waiting";

    if (originalCard?.gameId !== targetGameId) {
      restoreOriginalCard();
      saveOriginalCard(link, image, title, rating, players, targetGameId);
    } else {
      originalCard.link = link;
      originalCard.image = image;
      originalCard.title = title;
      if (rating) {
        if (originalCard.rating) originalCard.rating.element = rating;
        else originalCard.rating = saveStat(rating);
      }
      if (players) {
        if (originalCard.players) originalCard.players.element = players;
        else originalCard.players = saveStat(players);
      }
    }
    const savedCard = originalCard;
    if (!savedCard) return "waiting";

    setAttributeIfChanged(image, "src", currentDraft.image);
    setAttributeIfChanged(image, "srcset", null);
    setAttributeIfChanged(image, "alt", currentDraft.gameName);
    setAttributeIfChanged(image, "data-src", null);
    setAttributeIfChanged(image, "data-srcset", null);
    if (image.style.objectFit !== "cover") image.style.objectFit = "cover";
    const cropPosition = `${Math.max(0, Math.min(100, currentDraft.cropX))}% center`;
    if (image.style.objectPosition !== cropPosition) image.style.objectPosition = cropPosition;
    if (title) {
      if (title.textContent !== currentDraft.gameName) title.textContent = currentDraft.gameName;
      title.style.display = "-webkit-box";
      title.style.setProperty("-webkit-box-orient", "vertical");
      title.style.setProperty("-webkit-line-clamp", "2");
      title.style.overflow = "hidden";
      setAttributeIfChanged(title, "title", currentDraft.gameName);
    }
    setStat(savedCard.rating, currentDraft.rating);
    setStat(savedCard.players, currentDraft.players);
    setAttributeIfChanged(link, "aria-label", currentDraft.gameName);

    return "shown";
  }

  function scheduleRender(): void {
    if (!currentDraft || renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      applyDraft();
    });
  }

  chrome.runtime.onMessage.addListener((message: PageMessage, _sender, sendResponse) => {
    if (!isRobloxPreviewPage()) {
      sendResponse({ status: "missing" } satisfies PageReply);
      return;
    }

    if (message.type === "remove") {
      const hadPreview = originalCard !== null;
      currentDraft = null;
      targetGameId = null;
      restoreOriginalCard();
      sendResponse({ status: hadPreview ? "removed" : "absent" } satisfies PageReply);
      return;
    }

    if (message.type === "crop") {
      if (currentDraft) {
        currentDraft = { ...currentDraft, cropX: message.cropX };
        sendResponse({ status: applyDraft() } satisfies PageReply);
      } else {
        sendResponse({ status: "absent" } satisfies PageReply);
      }
      return;
    }

    if (message.type === "variant") {
      if (currentDraft) {
        currentDraft = { ...currentDraft, image: message.image, cropX: message.cropX };
        sendResponse({ status: applyDraft() } satisfies PageReply);
      } else {
        sendResponse({ status: "absent" } satisfies PageReply);
      }
      return;
    }

    if (message.type === "preview") {
      restoreOriginalCard();
      currentDraft = message.draft;
      targetGameId = null;
      sendResponse({ status: applyDraft() } satisfies PageReply);
    }
    return false;
  });

  new MutationObserver(scheduleRender).observe(document.documentElement, { childList: true, subtree: true });
}

installPreviewHandler();
