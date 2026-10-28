export const ICON_PATHS = {
  piece:
    "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0M15 9c0 3-6 3-6 0s6-3 6 0Zm1 6c0 4-8 4-8 0s8-4 8 0Z",
  bunk: "M3 5v16m18-12v12M3 17h18M5 9h4v5H5zm6 0h7a3 3 0 0 1 3 3v2H11Z",
  mug:
    "M4 7h12v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Zm12 2h3a3 3 0 0 1 0 6h-3M7 3l1 1m4-2 1 2",
  boat:
    "M12 2v14M10 4 4 13h6Zm4 1 5 8h-5ZM3 16h18l-3 4H6ZM2 22q3-2 5 0t5 0 5 0 5 0",
  barrel:
    "M6 3h12c4 5 4 13 0 18H6C2 16 2 8 6 3Zm-2 5h16M4 16h16M9 3c-2 5-2 13 0 18m6-18c2 5 2 13 0 18",
  chest:
    "M3 11V8a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5v3M3 11h18v10H3Zm6 0V3m6 8V3m-5 8h4v4h-4Z",
  anchor:
    "M12 8v13M8 12h8M3 15c0 4 4 6 9 6s9-2 9-6M3 15l-1 3m1-3 3 1m15-1 1 3m-1-3-3 1M15 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  crew:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0m4-3.87a4 4 0 0 1 0 7.75",
  plus: "M12 5v14M5 12h14",
  lock:
    "M6 10h12a1 1 0 0 1 1 1v9H5v-9a1 1 0 0 1 1-1m2 0V6a4 4 0 0 1 8 0v4m-4 4v2",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  print: "M6 9V3h12v6M6 17H3V9h18v8h-3M6 14h12v7H6z",
  compass: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0m-6-4-2 6-6 2 2-6z",
} as const;

export type IconName = keyof typeof ICON_PATHS;
