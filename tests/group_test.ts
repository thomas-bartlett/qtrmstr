import { test } from "node:test";
import {
  calculate,
  emptyTrip,
  groupName,
  parseTrip,
  type Receipt,
  receiptBreakdown,
  receiptParticipants,
  receiptTotal,
  type Trip,
} from "../src/lib/trip.ts";
import { exportCsv } from "../src/lib/csv.ts";
import { decodeDraft } from "../src/lib/draft.ts";
import { importCsv } from "../src/lib/import-csv.ts";
import { deepStrictEqual, equal, ok } from "node:assert/strict";

function groupTrip(): Trip {
  return {
    ...emptyTrip(),
    name: "Shared voyage",
    members: [
      { id: "alex", name: "Alex" },
      { id: "jamie", name: "Jamie" },
      { id: "sam", name: "Sam" },
      { id: "pat", name: "Pat" },
    ],
    groups: [{
      id: "couple",
      members: ["alex", "jamie"],
    }],
    expenses: [{
      id: "stay",
      name: "Harbor house",
      category: "stays",
      amount: 12000,
      paidBy: "alex",
      split: "even",
      participants: ["alex", "jamie", "sam", "pat"],
      date: "",
    }],
  };
}

test("everyone gets a share while a couple settles one combined balance", () => {
  const trip = groupTrip();
  deepStrictEqual(parseTrip(trip), trip);
  const { balances, settlementBalances, transfers, total } = calculate(trip);
  equal(total, 12000);
  deepStrictEqual(balances.map(({ paid, share, net }) => [paid, share, net]), [
    [12000, 3000, 9000],
    [0, 3000, -3000],
    [0, 3000, -3000],
    [0, 3000, -3000],
  ]);
  deepStrictEqual(
    settlementBalances.map((
      { id, paid, share, net },
    ) => [id, paid, share, net]),
    [["couple", 12000, 6000, 6000], ["sam", 0, 3000, -3000], [
      "pat",
      0,
      3000,
      -3000,
    ]],
  );
  deepStrictEqual(transfers, [
    { from: "sam", to: "couple", amount: 3000 },
    { from: "pat", to: "couple", amount: 3000 },
  ]);
});

test("receipt items stay individual with proportional extras before group settlement", () => {
  const trip = groupTrip();
  const receipt: Receipt = {
    items: [
      { name: "Alex's meal", amount: 2000, participants: ["alex"] },
      { name: "Jamie's meal", amount: 3000, participants: ["jamie"] },
      { name: "Sam's meal", amount: 2000, participants: ["sam"] },
      { name: "Pat's meal", amount: 3000, participants: ["pat"] },
      { name: "Shared starter", amount: 1200, participants: ["alex", "sam"] },
    ],
    tax: 1120,
    tip: 2240,
  };
  trip.expenses = [{
    ...trip.expenses[0],
    name: "Supper",
    category: "meals",
    paidBy: "sam",
    amount: receiptTotal(receipt),
    participants: receiptParticipants(receipt),
    split: "itemized",
    receipt,
  }];
  const restored = decodeDraft(JSON.stringify(trip));
  ok(restored);
  deepStrictEqual(restored, trip);
  const breakdown = receiptBreakdown(receipt);
  deepStrictEqual([...breakdown.subtotals], [["alex", 2600], ["jamie", 3000], [
    "sam",
    2600,
  ], ["pat", 3000]]);
  deepStrictEqual([...breakdown.tax.values()], [260, 300, 260, 300]);
  deepStrictEqual([...breakdown.tip.values()], [520, 600, 520, 600]);
  deepStrictEqual([...breakdown.total.values()], [3380, 3900, 3380, 3900]);
  equal(calculate(restored).total, 14560);
  deepStrictEqual(calculate(restored).transfers, [
    { from: "couple", to: "sam", amount: 7280 },
    { from: "pat", to: "sam", amount: 3900 },
  ]);
  ok(
    exportCsv(restored).includes(
      '"Supper","Tax","11.20","e1","tax","","2.60","3.00","2.60","3.00"',
    ),
  );
});

test("a cost can go to one partner, with payments inside their group netted out", () => {
  const trip = groupTrip();
  trip.expenses = [{
    ...trip.expenses[0],
    amount: 1251,
    split: "individual",
    participants: ["jamie"],
  }];
  ok(parseTrip(trip));
  const result = calculate(trip);
  deepStrictEqual(result.balances.map(({ paid, share }) => [paid, share]), [
    [1251, 0],
    [0, 1251],
    [0, 0],
    [0, 0],
  ]);
  deepStrictEqual(result.transfers, []);
  trip.expenses[0].paidBy = "sam";
  deepStrictEqual(calculate(trip).transfers, [{
    from: "couple",
    to: "sam",
    amount: 1251,
  }]);
});

test("editing and removing groups preserve individual shares and penny order", () => {
  const trip = groupTrip();
  trip.expenses[0].amount = 12001;
  const before = calculate(trip);
  deepStrictEqual(before.balances.map(({ share }) => share), [
    3001,
    3000,
    3000,
    3000,
  ]);
  for (
    const groups of [
      [{ id: "couple", members: ["jamie", "alex"] }],
      [{
        id: "crew",
        members: ["alex", "jamie", "sam", "pat"],
      }],
      [{ id: "pair", members: ["sam", "pat"] }],
      [],
    ]
  ) {
    trip.groups = groups;
    ok(parseTrip(trip));
    const result = calculate(trip);
    deepStrictEqual(result.balances, before.balances);
    equal(result.total, before.total);
    if (groups[0]?.members.length === 4) deepStrictEqual(result.transfers, []);
    const remaining = new Map(
      result.settlementBalances.map(({ id, net }) => [id, net]),
    );
    for (const { from, to, amount } of result.transfers) {
      remaining.set(from, remaining.get(from)! + amount);
      remaining.set(to, remaining.get(to)! - amount);
    }
    ok([...remaining.values()].every((net) => net === 0));
  }
  deepStrictEqual(calculate(trip).transfers, [
    { from: "jamie", to: "alex", amount: 3000 },
    { from: "sam", to: "alex", amount: 3000 },
    { from: "pat", to: "alex", amount: 3000 },
  ]);
});

test("groups reject ambiguous identities, overlaps, invalid references and nested groups", () => {
  const trip = groupTrip();
  const valid = trip.groups[0];
  for (
    const groups of [
      undefined,
      null,
      {},
      "couple",
      [{ ...valid, id: "alex" }],
      [{ ...valid, id: "not an id" }],
      [{ ...valid, members: [] }],
      [{ ...valid, members: ["alex"] }],
      [{ ...valid, members: ["alex", "alex"] }],
      [{ ...valid, members: ["alex", "missing"] }],
      [{ ...valid, members: ["alex", "couple"] }],
      [{ ...valid, members: ["alex", 1] }],
      [valid, { ...valid, members: ["sam", "pat"] }],
      [valid, {
        ...valid,
        id: "second",
        members: ["jamie", "pat"],
      }],
      Array.from({ length: 26 }, () => valid),
    ]
  ) equal(parseTrip({ ...trip, groups }), null);
  equal(parseTrip({ ...trip, version: 2 }), null);
  equal(
    parseTrip({
      ...trip,
      members: [{ ...trip.members[0], group: true }, ...trip.members.slice(1)],
    }),
    null,
  );
  for (
    const changed of [
      { ...trip.expenses[0], paidBy: "couple" },
      { ...trip.expenses[0], participants: ["couple", "sam"] },
    ]
  ) equal(parseTrip({ ...trip, expenses: [changed] }), null);
  const reconstructed = parseTrip({
    ...trip,
    groups: [{ ...valid, extra: "ignored" }],
  });
  deepStrictEqual(reconstructed, trip);
  reconstructed!.groups[0].members.reverse();
  deepStrictEqual(trip.groups[0].members, ["alex", "jamie"]);
});

test("older shared-name entries retain their amounts without guessing individual identities", () => {
  const legacy = {
    name: "Earlier voyage",
    currency: "USD",
    members: [{ id: "couple", name: "Alex & Jamie", group: true }, {
      id: "sam",
      name: "Sam",
    }],
    expenses: [{
      ...groupTrip().expenses[0],
      amount: 9001,
      paidBy: "couple",
      participants: ["couple", "sam"],
    }],
  };
  for (const version of [1, 2]) {
    const migrated = decodeDraft(JSON.stringify({ ...legacy, version }));
    ok(migrated);
    equal(migrated.version, 4);
    deepStrictEqual(migrated.groups, []);
    deepStrictEqual(migrated.members, [{ id: "couple", name: "Alex & Jamie" }, {
      id: "sam",
      name: "Sam",
    }]);
    deepStrictEqual(
      calculate(migrated).balances.map((
        { paid, share, net },
      ) => [paid, share, net]),
      [[9001, 4501, 4500], [0, 4500, -4500]],
    );
    deepStrictEqual(calculate(migrated).transfers, [{
      from: "sam",
      to: "couple",
      amount: 4500,
    }]);
    for (const group of ["true", 1, null, [], {}]) {
      equal(
        parseTrip({
          ...legacy,
          version,
          members: [{ ...legacy.members[0], group }, legacy.members[1]],
        }),
        null,
      );
    }
  }
});

test("CSV preserves groups, individual calculations and escaped group names", () => {
  const imported = importCsv(exportCsv(groupTrip()));
  ok(imported.trip);
  equal(imported.trip.members.length, 4);
  equal(imported.trip.groups.length, 1);
  const trip = imported.trip;
  let csv = exportCsv(trip);
  ok(
    csv.includes(
      '"SETTLEMENT GROUPS"\r\n"Group","Member IDs"\r\n"Alex & Jamie","p1|p2"',
    ),
  );
  ok(
    csv.includes(
      '"TOTAL","","","","120.00","","","","30.00","30.00","30.00","30.00"',
    ),
  );
  ok(csv.includes('"Alex & Jamie","120.00","60.00","60"'));
  ok(csv.includes('"Sam","Alex & Jamie","30.00","USD"'));
  trip.members[0].name = '=HYPERLINK("example.invalid")';
  ok(parseTrip(trip));
  csv = exportCsv(trip);
  ok(
    csv.includes(
      '"\'=HYPERLINK(""example.invalid"") & Jamie","p1|p2"',
    ),
  );
  ok(
    csv.includes(
      '"Sam","\'=HYPERLINK(""example.invalid"") & Jamie","30.00","USD"',
    ),
  );
});

test("multiple groups conserve every cent across varied costs and individual assignments", () => {
  let seed = 7521;
  const random = (max: number) => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed % max;
  };
  for (let run = 0; run < 100; run++) {
    const trip = groupTrip();
    trip.groups.push({
      id: "second",
      members: ["sam", "pat"],
    });
    trip.expenses = Array.from({ length: 20 }, (_, index) => {
      const participants = trip.members.filter(() => random(3) > 0).map((
        { id },
      ) => id);
      return {
        ...trip.expenses[0],
        id: `cost-${index}`,
        amount: 1 + random(99_999_999_999),
        paidBy: trip.members[random(4)].id,
        participants: participants.length ? participants : ["alex"],
      };
    });
    ok(parseTrip(trip));
    const { balances, settlementBalances, total, transfers } = calculate(trip);
    equal(settlementBalances.reduce((sum, { paid }) => sum + paid, 0), total);
    equal(settlementBalances.reduce((sum, { share }) => sum + share, 0), total);
    equal(settlementBalances.reduce((sum, { net }) => sum + net, 0), 0);
    const ungrouped = calculate({ ...trip, groups: [] });
    deepStrictEqual(balances, ungrouped.balances);
    const remaining = new Map(
      settlementBalances.map(({ id, net }) => [id, net]),
    );
    for (const { from, to, amount } of transfers) {
      ok(Number.isSafeInteger(amount) && amount > 0);
      ok(from !== to && remaining.has(from) && remaining.has(to));
      remaining.set(from, remaining.get(from)! + amount);
      remaining.set(to, remaining.get(to)! - amount);
    }
    ok([...remaining.values()].every((net) => net === 0));
    ok(transfers.length <= settlementBalances.length - 1);
  }
});

test("group labels always follow current member names without changing allocations", () => {
  const trip = groupTrip();
  const group = trip.groups[0];
  const before = calculate(trip);
  equal(groupName(group, trip.members), "Alex & Jamie");
  trip.members[0].name = "Alexandra";
  trip.members[1].name = "James";
  equal(groupName(group, trip.members), "Alexandra & James");
  const result = calculate(trip);
  equal(result.settlementBalances[0].name, "Alexandra & James");
  deepStrictEqual(result.transfers, before.transfers);
  deepStrictEqual(
    result.balances.map(({ paid, share, net }) => [paid, share, net]),
    before.balances.map(({ paid, share, net }) => [paid, share, net]),
  );
  ok(exportCsv(trip).includes('"Sam","Alexandra & James","30.00","USD"'));
  group.members.push("sam");
  equal(groupName(group, trip.members), "Alexandra & James & Sam");
  trip.members[0].name = "A".repeat(40);
  trip.members[1].name = "J".repeat(40);
  ok(parseTrip(trip));
  equal(
    groupName(group, trip.members),
    `${"A".repeat(40)} & ${"J".repeat(40)} & Sam`,
  );
  deepStrictEqual(decodeDraft(JSON.stringify(trip)), trip);
});

test("custom group labels in older drafts are discarded while membership and money survive", () => {
  const trip = groupTrip();
  for (
    const name of [
      "The captains",
      "",
      "Alex",
      '<img src=x onerror="alert(1)">',
      "=HYPERLINK(1)",
    ]
  ) {
    const old = { ...trip, version: 3, groups: [{ ...trip.groups[0], name }] };
    const restored = decodeDraft(JSON.stringify(old));
    ok(restored);
    deepStrictEqual(restored, trip);
    deepStrictEqual(calculate(restored), calculate(trip));
    equal(groupName(restored.groups[0], restored.members), "Alex & Jamie");
    ok(!Object.hasOwn(restored.groups[0], "name"));
  }
});
