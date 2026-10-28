import type { Category } from "./trip.ts";
import type { IconName } from "./icons.ts";

// The data and CSV keep plain category names; the UI adds a nautical nickname.
export const CATEGORY_THEME = {
  stays: { name: "Bunks", icon: "bunk", example: "e.g. The harbor house" },
  meals: { name: "Grub", icon: "mug", example: "e.g. Supper ashore" },
  transport: { name: "Passage", icon: "boat", example: "e.g. Ferry tickets" },
  activities: {
    name: "Shore leave",
    icon: "compass",
    example: "e.g. Kayaks for the afternoon",
  },
  groceries: {
    name: "Provisions",
    icon: "barrel",
    example: "e.g. Breakfast supplies",
  },
  other: {
    name: "Odds & ends",
    icon: "chest",
    example: "e.g. Sunscreen for the crew",
  },
} as const satisfies Record<
  Category,
  { name: string; icon: IconName; example: string }
>;
