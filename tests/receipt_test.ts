import { test } from "node:test";
import {
  calculate,
  emptyTrip,
  exampleTrip,
  MAX_AMOUNT,
  parseExtra,
  parseTrip,
  type Receipt,
  receiptBreakdown,
  receiptParticipants,
  receiptTotal,
  sharesFor,
  type Trip,
} from "../src/lib/trip.ts";
import { exportCsv } from "../src/lib/csv.ts";
import { deepStrictEqual, equal, ok } from "node:assert/strict";

function dinner(): Receipt {
  return {
    items: [
      { name: "Alex’s meal", amount: 2000, participants: ["crew-0"] },
      { name: "Jamie’s meal", amount: 4000, participants: ["crew-1"] },
      {
        name: "Shared starter",
        amount: 1200,
        participants: ["crew-0", "crew-2"],
      },
    ],
    tax: 720,
    tip: 1440,
  };
}
function tripWith(receipt: Receipt): Trip {
  const trip = exampleTrip();
  trip.expenses = [{
    id: "dinner",
    name: "Harbor supper",
    category: "meals",
    date: "",
    paidBy: "crew-3",
    amount: receiptTotal(receipt),
    participants: receiptParticipants(receipt),
    split: "itemized",
    receipt,
  }];
  return trip;
}

test("individual meals and shared items get proportional tax and tip, reimbursing an outside payer", () => {
  const receipt = dinner();
  const result = receiptBreakdown(receipt);
  deepStrictEqual([...result.subtotals.values()], [2600, 4000, 600]);
  deepStrictEqual([...result.tax.values()], [260, 400, 60]);
  deepStrictEqual([...result.tip.values()], [520, 800, 120]);
  deepStrictEqual([...result.total.values()], [3380, 5200, 780]);
  const trip = tripWith(receipt);
  ok(parseTrip(trip));
  equal(calculate(trip).total, 9360);
  deepStrictEqual(calculate(trip).balances.map(({ net }) => net), [
    -3380,
    -5200,
    -780,
    9360,
  ]);
  deepStrictEqual([...sharesFor(trip.expenses[0])], [...result.total]);
});

test("tax and tip round independently without charging zero-cent participants", () => {
  const receipt: Receipt = {
    items: [{ name: "One penny", amount: 1, participants: ["a", "b", "c"] }],
    tax: 1,
    tip: 1,
  };
  deepStrictEqual([...receiptBreakdown(receipt).total], [["a", 3], ["b", 0], [
    "c",
    0,
  ]]);
  receipt.items[0].amount = 3;
  receipt.tip = 2;
  deepStrictEqual([...receiptBreakdown(receipt).tax], [["a", 1], ["b", 0], [
    "c",
    0,
  ]]);
  deepStrictEqual([...receiptBreakdown(receipt).tip], [["a", 1], ["b", 1], [
    "c",
    0,
  ]]);
  receipt.items[0].participants = ["c", "b", "a"];
  deepStrictEqual([...receiptBreakdown(receipt).total], [["c", 3], ["b", 2], [
    "a",
    1,
  ]]);
  equal(parseExtra(""), 0);
  equal(parseExtra("0.00"), 0);
  equal(parseExtra("4.20"), 420);
  for (const invalid of ["-1", "0.001", "=1+1", "NaN", "1e2"]) {
    equal(parseExtra(invalid), null);
  }
});

test("large proportional products keep exact cents without floating-point overflow", () => {
  const receipt: Receipt = {
    items: [
      { name: "A", amount: 32_999_999_999, participants: ["crew-0"] },
      { name: "B", amount: 32_999_999_998, participants: ["crew-1"] },
    ],
    tax: 30_000_000_001,
    tip: 3_999_999_999,
  };
  ok(parseTrip(tripWith(receipt)));
  deepStrictEqual([...receiptBreakdown(receipt).total.values()], [
    50_000_000_000,
    49_999_999_997,
  ]);
});

test("itemized settlements conserve every cent across varied participants and extras", () => {
  let seed = 19837;
  const random = (max: number) => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed % max;
  };
  for (let run = 0; run < 150; run++) {
    const receipt: Receipt = {
      items: Array.from({ length: 1 + random(30) }, (_, index) => {
        const ids = ["crew-0", "crew-1", "crew-2", "crew-3"].filter(() =>
          random(3) > 0
        );
        return {
          name: `Item ${index}`,
          amount: 1 + random(10_000_000),
          participants: ids.length ? ids : ["crew-0"],
        };
      }),
      tax: random(10_000_000),
      tip: random(10_000_000),
    };
    const breakdown = receiptBreakdown(receipt);
    equal(
      [...breakdown.tax.values()].reduce((sum, n) => sum + n, 0),
      receipt.tax,
    );
    equal(
      [...breakdown.tip.values()].reduce((sum, n) => sum + n, 0),
      receipt.tip,
    );
    equal(
      [...breakdown.total.values()].reduce((sum, n) => sum + n, 0),
      receiptTotal(receipt),
    );
    const trip = tripWith(receipt);
    ok(parseTrip(trip));
    const { balances, transfers } = calculate(trip);
    const remaining = new Map(
      balances.map((member) => [member.id, member.net]),
    );
    for (const transfer of transfers) {
      remaining.set(
        transfer.from,
        remaining.get(transfer.from)! + transfer.amount,
      );
      remaining.set(transfer.to, remaining.get(transfer.to)! - transfer.amount);
    }
    ok([...remaining.values()].every((amount) => amount === 0));
  }
});

test("receipt validation rejects inconsistent totals, references, extras, and excessive rows", () => {
  const changes: ((trip: Trip) => void)[] = [
    (trip) => trip.expenses[0].amount++,
    (trip) => trip.expenses[0].participants.reverse(),
    (trip) => trip.expenses[0].split = "even",
    (trip) => delete trip.expenses[0].receipt,
    (trip) => trip.expenses[0].receipt!.tax = -1,
    (trip) => trip.expenses[0].receipt!.tip = 0.1,
    (trip) => trip.expenses[0].receipt!.tax = Infinity,
    (trip) => trip.expenses[0].receipt!.items[0].amount = 0,
    (trip) => trip.expenses[0].receipt!.items[0].amount = MAX_AMOUNT + 1,
    (trip) => trip.expenses[0].receipt!.items[0].name = "\n",
    (trip) => trip.expenses[0].receipt!.items[0].participants = ["missing"],
    (trip) => trip.expenses[0].receipt!.items[0].participants = [],
    (trip) =>
      trip.expenses[0].receipt!.items[0].participants = ["crew-0", "crew-0"],
    (trip) => trip.expenses[0].receipt!.items = [],
  ];
  for (const change of changes) {
    const trip = tripWith(dinner());
    change(trip);
    equal(parseTrip(trip), null);
  }
  const receipt = dinner();
  receipt.items = Array.from({ length: 100 }, () => receipt.items[0]);
  ok(parseTrip(tripWith(receipt)));
  receipt.items.push(receipt.items[0]);
  equal(parseTrip(tripWith(receipt)), null);
  receipt.items.pop();
  const trip = tripWith(receipt);
  trip.expenses = Array.from(
    { length: 10 },
    (_, index) => ({ ...trip.expenses[0], id: `r${index}` }),
  );
  ok(parseTrip(trip));
  trip.expenses.push({ ...tripWith(dinner()).expenses[0], id: "extra" });
  equal(parseTrip(trip), null);
});

test("old drafts migrate to version 4 and new receipt data round-trips without ambiguous versions", () => {
  deepStrictEqual(parseTrip({ ...exampleTrip(), version: 1 }), exampleTrip());
  const trip = tripWith(dinner());
  deepStrictEqual(parseTrip(JSON.parse(JSON.stringify(trip))), trip);
  deepStrictEqual(parseTrip({ ...trip, version: 2 }), trip);
  deepStrictEqual(parseTrip({ ...trip, version: 3 }), trip);
  equal(parseTrip({ ...trip, version: 1 }), null);
  equal(parseTrip({ ...emptyTrip(), version: 5 }), null);
});

test("CSV exports each receipt item, tax, tip and allocations without counting them twice", () => {
  const trip = tripWith(dinner());
  trip.expenses[0].receipt!.items[0].name = "=HYPERLINK(1)";
  const csv = exportCsv(trip);
  ok(
    csv.includes(
      '"TOTAL","","","","93.60","","","","33.80","52.00","7.80","0.00"',
    ),
  );
  ok(
    csv.includes(
      '"Harbor supper","Tax","7.20","e1","tax","","2.60","4.00","0.60","0.00"',
    ),
  );
  ok(
    csv.includes(
      '"Harbor supper","Tip","14.40","e1","tip","","5.20","8.00","1.20","0.00"',
    ),
  );
  ok(csv.includes('"Harbor supper","\'=HYPERLINK(1)","20.00"'));
});
