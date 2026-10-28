import { emptyTrip, parseTrip, type Trip } from "./trip.ts";

// Keep the historical key so existing drafts can be upgraded in place.
export const STORAGE_KEY = "quartermaster.trip.v1";
// Enough for the bounded trip model, including itemized receipt participants.
// Keep a bound before JSON parsing; use the same bound when writing.
export const MAX_DRAFT_LENGTH = 9_000_000;
export type DraftIssue = "unavailable" | "unreadable" | "conflict" | "invalid";

interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function decodeDraft(raw: string): Trip | null {
  if (raw.length > MAX_DRAFT_LENGTH) return null;
  try {
    return parseTrip(JSON.parse(raw));
  } catch {
    return null;
  }
}

// Storage stays behind a small adapter so failures and competing tabs can be
// tested without a browser. An unreadable draft is preserved until Reset trip.
export function createDraftStore(storage: () => DraftStorage) {
  let baseline: string | null | undefined;
  let issue: DraftIssue | null = null;

  function load(): { trip: Trip; issue: DraftIssue | null } {
    try {
      baseline = storage().getItem(STORAGE_KEY);
      const trip = baseline === null ? emptyTrip() : decodeDraft(baseline);
      issue = trip ? null : "unreadable";
      return { trip: trip ?? emptyTrip(), issue };
    } catch {
      issue = "unavailable";
      return { trip: emptyTrip(), issue };
    }
  }

  function verifyCurrent(): boolean {
    try {
      const current = storage().getItem(STORAGE_KEY);
      if (baseline === undefined && current === null) baseline = null;
      if (current !== baseline) issue = "conflict";
      return true;
    } catch {
      if (issue !== "unreadable" && issue !== "conflict") issue = "unavailable";
      return false;
    }
  }

  function check(): DraftIssue | null {
    verifyCurrent();
    return issue;
  }

  function save(trip: Trip): DraftIssue | null {
    if (!verifyCurrent() || issue === "unreadable" || issue === "conflict") {
      return issue;
    }
    const validated = parseTrip(trip);
    if (!validated) return issue = "invalid";
    const raw = JSON.stringify(validated);
    if (raw.length > MAX_DRAFT_LENGTH) return issue = "invalid";
    try {
      storage().setItem(STORAGE_KEY, raw);
      baseline = raw;
      return issue = null;
    } catch {
      return issue = "unavailable";
    }
  }

  function reset(): DraftIssue | null {
    if (!verifyCurrent() || issue === "conflict") return issue;
    try {
      storage().removeItem(STORAGE_KEY);
      baseline = null;
      return issue = null;
    } catch {
      return issue = "unavailable";
    }
  }

  return { load, save, check, reset };
}
