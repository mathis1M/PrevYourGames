import type { Placement } from "./shared";

export function getTargetIndex(cardCount: number, placement: Placement, random = Math.random): number {
  if (cardCount <= 0 || placement === "first") return 0;
  return Math.floor(random() * cardCount);
}
