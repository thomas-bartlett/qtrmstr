import { test } from "node:test";
import {
  calculate,
  decimal,
  emptyTrip,
  exampleTrip,
  type Expense,
  MAX_AMOUNT,
  parseAmount,
  parseTrip,
  sharesFor,
  type Trip,
} from "../src/lib/trip.ts";
import { csvCell, exportCsv } from "../src/lib/csv.ts";
import { deepStrictEqual, equal, ok } from "node:assert/strict";

test("decimal input is exact and rejects invalid or excessive amounts", () => {
  for (
    const [value, expected] of [["0.01", 1], ["0.10", 10], ["1.01", 101], [
      "42.5",
      4250,
    ], ["999999999.99", MAX_AMOUNT]] as const
  ) equal(parseAmount(value), expected);
  for (
    const value of [
      "",
      "0",
      "-3",
      "1e3",
      "NaN",
      "Infinity",
      "1,000",
      "2.005",
      "1000000000",
      "01.00",
      "=1+1",
    ]
  ) equal(parseAmount(value), null);
  equal(decimal(1), "0.01");
  equal(decimal(-101), "-1.01");
});

test("example voyage has independently checked totals and net balances", () => {
  const result = calculate(exampleTrip());
  equal(result.total, 94100);
  deepStrictEqual(
    result.balances.map(({ paid, share, net }) => [paid, share, net]),
    [[64650, 21113, 43537], [12850, 25613, -12763], [7600, 21762, -14162], [
      9000,
      25612,
      -16612,
    ]],
  );
  deepStrictEqual(
    result.transfers.map(({ from, to, amount }) => [from, to, amount]),
    [["crew-3", "crew-0", 16612], ["crew-2", "crew-0", 14162], [
      "crew-1",
      "crew-0",
      12763,
    ]],
  );
});

test("uneven pennies sum exactly and keep their recorded participant order", () => {
  const expense = { amount: 100, participants: ["c", "a", "b"] } as Expense;
  deepStrictEqual([...sharesFor(expense)], [["c", 34], ["a", 33], ["b", 33]]);
  expense.amount = 1;
  deepStrictEqual([...sharesFor(expense)], [["c", 1], ["a", 0], ["b", 0]]);
});

test("payer may be outside the split; individually assigned costs reimburse the payer", () => {
  const trip = exampleTrip();
  trip.expenses = [{
    ...trip.expenses[0],
    amount: 500,
    paidBy: "crew-0",
    participants: ["crew-1"],
    split: "individual",
  }];
  deepStrictEqual(calculate(trip).transfers, [{
    from: "crew-1",
    to: "crew-0",
    amount: 500,
  }]);
  trip.expenses[0].paidBy = "crew-1";
  deepStrictEqual(calculate(trip).transfers, []);
});

test("adding and renaming members does not change historical splits", () => {
  const trip = exampleTrip();
  const before = calculate(trip);
  trip.members.push({ id: "new", name: "New shipmate" });
  trip.members[0].name = "Zelda";
  const after = calculate(trip);
  deepStrictEqual(
    after.balances.slice(0, 4).map((member) => member.share),
    before.balances.map((member) => member.share),
  );
  equal(after.balances[4].net, 0);
  deepStrictEqual(after.transfers, before.transfers);
});

test("edits and deletion recalculate balances without a stored balance cache", () => {
  const trip = exampleTrip();
  trip.expenses[0].amount += 100;
  equal(calculate(trip).total, 94200);
  trip.expenses = [];
  const result = calculate(trip);
  equal(result.total, 0);
  ok(result.balances.every((member) => member.net === 0));
  deepStrictEqual(result.transfers, []);
});

test("settlement conserves money and clears every balance across many voyages", () => {
  let seed = 16384;
  const random = (max: number) => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed % max;
  };
  for (let run = 0; run < 150; run++) {
    const members = Array.from(
      { length: 2 + random(18) },
      (_, index) => ({ id: `m${index}`, name: `Member ${index}` }),
    );
    const trip: Trip = {
      ...emptyTrip(),
      name: "Test voyage",
      members,
      expenses: [],
    };
    for (let index = 0; index < 1 + random(50); index++) {
      let participants = members.filter(() => random(3) > 0).map((member) =>
        member.id
      );
      if (!participants.length) participants = [members[0].id];
      trip.expenses.push({
        id: `e${index}`,
        name: "Expense",
        amount: 1 + random(1_000_000),
        category: "other",
        paidBy: members[random(members.length)].id,
        participants,
        split: "even",
        date: "",
      });
    }
    const { balances, transfers, total } = calculate(trip);
    equal(balances.reduce((sum, member) => sum + member.paid, 0), total);
    equal(balances.reduce((sum, member) => sum + member.share, 0), total);
    equal(balances.reduce((sum, member) => sum + member.net, 0), 0);
    ok(transfers.length <= members.length - 1);
    const remaining = new Map(
      balances.map((member) => [member.id, member.net]),
    );
    for (const transfer of transfers) {
      ok(Number.isSafeInteger(transfer.amount) && transfer.amount > 0);
      remaining.set(
        transfer.from,
        remaining.get(transfer.from)! + transfer.amount,
      );
      remaining.set(transfer.to, remaining.get(transfer.to)! - transfer.amount);
    }
    ok([...remaining.values()].every((amount) => amount === 0));
  }
});

test("untrusted saved drafts reject invalid amounts, IDs, dates, and splits", () => {
  deepStrictEqual(parseTrip(exampleTrip()), exampleTrip());
  deepStrictEqual(parseTrip(emptyTrip()), emptyTrip());
  for (
    const change of [
      (trip: Trip) => {
        trip.expenses[0].amount = 1.1;
      },
      (trip: Trip) => {
        trip.expenses[0].amount = -1;
      },
      (trip: Trip) => {
        trip.expenses[0].amount = Number.MAX_SAFE_INTEGER;
      },
      (trip: Trip) => {
        trip.expenses[0].paidBy = "missing";
      },
      (trip: Trip) => {
        trip.expenses[0].participants = ["missing"];
      },
      (trip: Trip) => {
        trip.expenses[0].participants = [];
      },
      (trip: Trip) => {
        trip.expenses[0].participants = ["crew-0", "crew-0"];
      },
      (trip: Trip) => {
        trip.expenses[0].split = "individual";
      },
      (trip: Trip) => {
        trip.expenses[0].date = "2026-02-30";
      },
      (trip: Trip) => {
        trip.members[1].name = " alex ";
      },
      (trip: Trip) => {
        trip.members[1].id = trip.members[0].id;
      },
      (trip: Trip) => {
        trip.expenses[1].id = trip.expenses[0].id;
      },
    ]
  ) {
    const trip = exampleTrip();
    change(trip);
    equal(parseTrip(trip), null);
  }
  equal(parseTrip({ ...emptyTrip(), currency: "__proto__" }), null);
  equal(parseTrip({ ...emptyTrip(), version: 999 }), null);
});

test("CSV preserves the expense breakdown, shares, totals, and payments", () => {
  const csv = exportCsv(exampleTrip());
  ok(csv.startsWith("\uFEFF"));
  ok(
    csv.includes(
      '"TOTAL","","","","941.00","","","","211.13","256.13","217.62","256.12"',
    ),
  );
  ok(csv.includes('"Morgan","Alex","166.12","USD"'));
  ok(csv.includes('"Net (paid minus share)"'));
  ok(csv.includes('"-127.63"'));
});

test("CSV quotes separators and neutralizes formulas without breaking numeric balances", () => {
  equal(csvCell('Sam, "the captain"'), '"Sam, ""the captain"""');
  for (
    const value of [
      "=1+1",
      "+cmd",
      "@SUM(A1)",
      "-42+1",
      "   =HYPERLINK(1)",
      "\t=1",
      "＝1+1",
      "＋cmd",
      "－42+1",
      "＠SUM(A1)",
      "\u3000＝1+1",
      "\uFEFF＠SUM(A1)",
    ]
  ) ok(csvCell(value).startsWith("\"'"));
  equal(csvCell(-42.5), '"-42.5"');
  const trip = exampleTrip();
  trip.name = "=1+1";
  trip.members[0].name = "@someone";
  trip.expenses[0].name = "=HYPERLINK(1)";
  const csv = exportCsv(trip);
  ok(csv.includes('"\'=1+1"'));
  ok(csv.includes('"\'@someone"'));
  ok(csv.includes('"\'=HYPERLINK(1)"'));
});
