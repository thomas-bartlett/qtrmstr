import { test } from "node:test";
import {
  createDraftStore,
  decodeDraft,
  MAX_DRAFT_LENGTH,
  STORAGE_KEY,
} from "../src/lib/draft.ts";
import { emptyTrip, exampleTrip, parseTrip } from "../src/lib/trip.ts";
import { deepStrictEqual, equal, ok } from "node:assert/strict";

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    failRead: false,
    failWrite: false,
    getItem(key: string) {
      if (this.failRead) throw new Error("Unavailable");
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (this.failWrite) throw new Error("Quota exceeded");
      data.set(key, value);
    },
    removeItem(key: string) {
      if (this.failWrite) throw new Error("Unavailable");
      data.delete(key);
    },
  };
}

test("a full supported trip survives save and reload beyond the former read limit", () => {
  const storage = memory();
  const store = createDraftStore(() => storage);
  store.load();
  const members = Array.from(
    { length: 50 },
    (_, index) => ({
      id: `member-${index}`.padEnd(36, "x"),
      name: `Shipmate ${index + 1}`,
    }),
  );
  const trip = {
    ...emptyTrip(),
    name: "Full voyage",
    members,
    expenses: Array.from({ length: 1000 }, (_, index) => ({
      id: `expense-${index}`.padEnd(36, "x"),
      name: `Cost ${index}`,
      amount: 100,
      category: "meals" as const,
      paidBy: members[0].id,
      participants: members.map((member) => member.id),
      split: "even" as const,
      date: "",
    })),
  };
  ok(parseTrip(trip));
  ok(JSON.stringify(trip).length > 2_000_000);
  equal(store.save(trip), null);
  const reloaded = createDraftStore(() => storage).load();
  equal(reloaded.issue, null);
  deepStrictEqual(reloaded.trip, trip);
});

test("unreadable and oversized drafts stay intact until an explicit reset", () => {
  for (
    const raw of [
      "broken JSON",
      "x".repeat(MAX_DRAFT_LENGTH + 1),
      '{"version":999}',
    ]
  ) {
    const storage = memory();
    storage.data.set(STORAGE_KEY, raw);
    const store = createDraftStore(() => storage);
    equal(store.load().issue, "unreadable");
    equal(store.save(exampleTrip()), "unreadable");
    equal(storage.data.get(STORAGE_KEY), raw);
    equal(store.reset(), null);
    equal(storage.data.has(STORAGE_KEY), false);
    equal(store.save(exampleTrip()), null);
  }
});

test("the largest participant lists fit the shared draft bound for itemized costs", () => {
  const members = Array.from(
    { length: 50 },
    (_, index) => ({
      id: `member-${index}`.padEnd(64, "x"),
      name: `Mate ${index}`.padEnd(40, "x"),
    }),
  );
  const participants = members.map((member) => member.id);
  const trip = {
    ...emptyTrip(),
    name: "x".repeat(80),
    members,
    groups: Array.from({ length: 25 }, (_, index) => ({
      id: `group-${index}`.padEnd(64, "x"),
      members: members.slice(index * 2, index * 2 + 2).map(({ id }) => id),
    })),
    expenses: Array.from({ length: 1000 }, (_, index) => ({
      id: `receipt-${index}`.padEnd(64, "x"),
      name: "x".repeat(100),
      category: "meals" as const,
      amount: 99_999_999_999,
      paidBy: members[0].id,
      participants,
      split: "itemized" as const,
      date: "2026-10-08",
      receipt: {
        items: [{
          name: "x".repeat(100),
          amount: 99_999_999_997,
          participants,
        }],
        tax: 1,
        tip: 1,
      },
    })),
  };
  ok(parseTrip(trip));
  const raw = JSON.stringify(trip);
  ok(raw.length > 5_000_000 && raw.length < MAX_DRAFT_LENGTH);
  const storage = memory();
  const store = createDraftStore(() => storage);
  store.load();
  equal(store.save(trip), null);
  deepStrictEqual(createDraftStore(() => storage).load().trip, trip);
});

test("an older tab cannot overwrite or reset a changed draft, even without a storage event", () => {
  const storage = memory();
  const first = createDraftStore(() => storage);
  const second = createDraftStore(() => storage);
  first.load();
  second.load();
  equal(first.save(exampleTrip()), null);
  const saved = storage.data.get(STORAGE_KEY);
  equal(second.save({ ...exampleTrip(), name: "Stale edit" }), "conflict");
  equal(second.reset(), "conflict");
  equal(storage.data.get(STORAGE_KEY), saved);
  second.load();
  equal(second.save({ ...exampleTrip(), name: "After reload" }), null);
  equal(first.check(), "conflict");
});

test("clearing a draft elsewhere prevents an older tab from restoring it", () => {
  const storage = memory();
  storage.data.set(STORAGE_KEY, JSON.stringify(exampleTrip()));
  const store = createDraftStore(() => storage);
  store.load();
  storage.data.clear();
  equal(store.save(exampleTrip()), "conflict");
  equal(storage.data.size, 0);
});

test("a failed save preserves the last draft and can recover when storage returns", () => {
  const storage = memory();
  const store = createDraftStore(() => storage);
  store.load();
  equal(store.save(exampleTrip()), null);
  const saved = storage.data.get(STORAGE_KEY);
  storage.failWrite = true;
  const changed = { ...exampleTrip(), name: "New voyage" };
  equal(store.save(changed), "unavailable");
  equal(store.check(), "unavailable");
  equal(storage.data.get(STORAGE_KEY), saved);
  storage.failWrite = false;
  equal(store.check(), "unavailable");
  equal(store.save(changed), null);
  equal(store.check(), null);
  deepStrictEqual(decodeDraft(storage.data.get(STORAGE_KEY)!), changed);
  storage.failRead = true;
  equal(createDraftStore(() => storage).load().issue, "unavailable");
});

test("invalid working data cannot replace a valid saved draft", () => {
  const storage = memory();
  const store = createDraftStore(() => storage);
  store.load();
  store.save(exampleTrip());
  const saved = storage.data.get(STORAGE_KEY);
  const invalid = exampleTrip();
  invalid.expenses[0].amount = NaN;
  equal(store.save(invalid), "invalid");
  equal(store.check(), "invalid");
  equal(storage.data.get(STORAGE_KEY), saved);
});

test("failed first saves and transient read failures stay visible until a successful save or reset", () => {
  const storage = memory();
  const store = createDraftStore(() => storage);
  store.load();
  storage.failWrite = true;
  equal(store.save(exampleTrip()), "unavailable");
  storage.failWrite = false;
  equal(store.check(), "unavailable");
  equal(store.reset(), null);
  storage.failRead = true;
  equal(store.check(), "unavailable");
  storage.failRead = false;
  equal(store.check(), "unavailable");
  equal(store.save(exampleTrip()), null);
  equal(store.check(), null);
});

test("read errors never clear a conflict or an unreadable draft", () => {
  for (const raw of [JSON.stringify(exampleTrip()), "broken JSON"]) {
    const storage = memory();
    const store = createDraftStore(() => storage);
    store.load();
    storage.data.set(STORAGE_KEY, raw);
    const expected = raw === "broken JSON" ? store.load().issue : store.check();
    storage.failRead = true;
    equal(store.check(), expected);
    equal(store.save(exampleTrip()), expected);
    storage.failRead = false;
    equal(store.check(), expected);
    equal(storage.data.get(STORAGE_KEY), raw);
  }
});
