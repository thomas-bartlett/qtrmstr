import { test } from "node:test";
import { exportCsv } from "../src/lib/csv.ts";
import { importCsv, MAX_CSV_BYTES } from "../src/lib/import-csv.ts";
import {
  calculate,
  crewName,
  CURRENCIES,
  emptyTrip,
  exampleTrip,
  MAX_AMOUNT,
  MAX_COST_LINES,
  MAX_MEMBERS,
  parseTrip,
  receiptParticipants,
  receiptTotal,
  type Trip,
} from "../src/lib/trip.ts";
import { deepStrictEqual, equal, ok } from "node:assert/strict";

// Compare the user's data and calculation results independently of internal IDs.
function contents(trip: Trip) {
  const names = (ids: string[]) => ids.map((id) => crewName(trip, id));
  const calculated = calculate(trip);
  return {
    name: trip.name,
    currency: trip.currency,
    crew: trip.members.map((member) => member.name),
    groups: trip.groups.map((group) => names(group.members)),
    costs: trip.expenses.map((expense) => ({
      name: expense.name,
      date: expense.date,
      category: expense.category,
      amount: expense.amount,
      payer: crewName(trip, expense.paidBy),
      split: expense.split,
      participants: names(expense.participants),
      receipt: expense.receipt && {
        tax: expense.receipt.tax,
        tip: expense.receipt.tip,
        items: expense.receipt.items.map((item) => ({
          name: item.name,
          amount: item.amount,
          participants: names(item.participants),
        })),
      },
    })),
    total: calculated.total,
    balances: calculated.balances.map(({ name, paid, share, net }) => ({
      name,
      paid,
      share,
      net,
    })),
    settlements: calculated.settlementBalances.map((
      { name, paid, share, net },
    ) => ({
      name,
      paid,
      share,
      net,
    })),
    payments: calculated.transfers.map(({ from, to, amount }) => ({
      from: crewName(trip, from),
      to: crewName(trip, to),
      amount,
    })),
  };
}

function roundTrip(trip: Trip) {
  ok(parseTrip(trip));
  const source = exportCsv(trip);
  const result = importCsv(source);
  if (!result.trip) throw new Error(result.error);
  deepStrictEqual(contents(result.trip), contents(trip));
  // Repeated export/import must not accumulate escapes or alter penny order.
  equal(exportCsv(result.trip), source);
  return result.trip;
}

test("shared CSV restores groups, unused crew, dates, duplicate receipt names and zero-penny participants", () => {
  const trip = exampleTrip();
  const ids = trip.members.map((member) => member.id);
  trip.groups = [{ id: "couple", members: [ids[1], ids[0]] }];
  trip.members.push({ id: "unused", name: "Riley" });
  trip.expenses[0].name = "TOTAL";
  for (let index = 0; index < 2; index++) {
    const receipt = {
      items: [
        {
          name: "Shared bite",
          amount: 1,
          participants: [ids[2], ids[0], ids[1]],
        },
        { name: "Dinner", amount: 101, participants: [ids[1], ids[3]] },
      ],
      tax: index + 1,
      tip: index + 2,
    };
    trip.expenses.push({
      id: `receipt-${index}`,
      name: "The same supper",
      date: "2026-08-15",
      category: "meals",
      paidBy: ids[index],
      split: "itemized",
      amount: receiptTotal(receipt),
      participants: receiptParticipants(receipt),
      receipt,
    });
  }
  for (const currency of Object.keys(CURRENCIES)) {
    trip.currency = currency as Trip["currency"];
    roundTrip(trip);
  }
});

test("shared CSV preserves literal text and reversible formula protection", () => {
  for (
    const name of [
      "=1+1",
      "'=1+1",
      "''=1+1",
      "'Captain",
      "'",
      "@Sam",
      "-Sam",
      "+Sam",
      "＝1+1",
      "＋Sam",
      "－Sam",
      "＠Sam",
      "'＝1+1",
      "''＝1+1",
      'Rae, "Skull"',
      "Anne|Bo",
      "__proto__",
      "constructor",
      '<img src=x onerror="alert(1)">',
      "船員 🦜",
    ]
  ) {
    const trip = exampleTrip();
    trip.name = name;
    trip.members[0].name = name;
    trip.expenses[0].name = name;
    trip.groups = [{
      id: "crew-group",
      members: trip.members.slice(0, 2).map(({ id }) => id),
    }];
    roundTrip(trip);
  }
});

test("shared CSV also preserves an empty draft or a crew without costs", () => {
  roundTrip(emptyTrip());
  const trip = exampleTrip();
  trip.expenses = [];
  roundTrip(trip);
});

// A hand-written file ensures the reader is not tested only against its writer.
const report = `Quartermaster CSV,1
Quartermaster trip,Tortuga weekend
Currency,USD

CREW
ID,Name
p1,Alex
p2,Jamie
p3,Sam

SETTLEMENT GROUPS
Group,Member IDs
Alex & Jamie,p1|p2

EXPENSES
Expense,Date,Category,Paid by,Amount,Split,ID,Split with (crew IDs),Alex,Jamie,Sam
Stay,2026-08-14,stays,Alex,30.01,even,e1,p3|p2|p1,10.00,10.00,10.01
Dinner,2026-08-15,meals,Jamie,9.03,itemized,e2,p2|p1,4.50,4.53,0.00
TOTAL,,,,39.04,,,,14.50,14.53,10.01

RECEIPT DETAILS — already included in expense totals above
Receipt,Item / extra,Amount,Expense ID,Type,Split with (crew IDs),Alex,Jamie,Sam
Dinner,Meal,8.01,e2,item,p2|p1,4.00,4.01,0.00
Dinner,Tax,0.51,e2,tax,,0.25,0.26,0.00
Dinner,Tip,0.51,e2,tip,,0.25,0.26,0.00
`;

test("CSV group IDs avoid crew IDs and other generated group IDs", () => {
  const source = report
    .replace("p3,Sam", "p3,Sam\np4,Riley")
    .replace("Alex & Jamie,p1|p2", "Alex & Jamie,p1|p2\nSam & Riley,p3|p4");
  const original = importCsv(source);
  const imported = importCsv(source.replace(/\bp([1-4])\b/g, "g$1"));
  ok(original.trip);
  ok(imported.trip, imported.error ?? "Import failed");
  const ids = [...imported.trip.members, ...imported.trip.groups].map((
    { id },
  ) => id);
  equal(new Set(ids).size, ids.length);
  deepStrictEqual(contents(imported.trip), contents(original.trip));
  roundTrip(imported.trip);
});

test("shared CSV recalculates all summaries from editable source costs and receipt items", () => {
  const original = importCsv(report);
  ok(original.trip);
  equal(calculate(original.trip).total, 3904);
  deepStrictEqual(calculate(original.trip).transfers, [{
    from: "p3",
    to: "g1",
    amount: 1001,
  }]);
  const changed = importCsv(
    report
      .replace("Alex,30.01", "Alex,31.01")
      .replace("Meal,8.01", "Meal,9.01")
      .replace("Tax,0.51", "Tax,1.00")
      .replace("Jamie,9.03,itemized,e2,p2|p1", "Jamie,=SUM(A1),itemized,e2,p3")
      .replace("TOTAL,,,,39.04", "TOTAL,,,,=HYPERLINK(1)")
      .replaceAll("10.00", "999999.99"),
  );
  ok(changed.trip);
  equal(calculate(changed.trip).total, 4153);
  equal(changed.trip.expenses[1].amount, 1052);
  deepStrictEqual(changed.trip.expenses[1].participants, ["p2", "p1"]);
  ok(!JSON.stringify(changed.trip).includes("HYPERLINK"));
  roundTrip(changed.trip);
});

test("shared CSV accepts spreadsheet padding and CRLF without confusing table boundaries", () => {
  const padded = report.split("\n").map((row) =>
    row + ",".repeat(11 - row.split(",").length)
  ).join("\r\n");
  deepStrictEqual(importCsv(padded), importCsv(report));
});

test("the same CSV format accepts source rows without optional calculated columns", () => {
  let columns = Infinity;
  const source = report.split("\n")
    .filter((row) => !row.startsWith("TOTAL,"))
    .map((row) => {
      if (row === "EXPENSES") columns = 8;
      if (row.startsWith("RECEIPT DETAILS")) columns = 6;
      return row.split(",").slice(0, columns).join(",");
    }).join("\n");
  deepStrictEqual(importCsv(source), importCsv(report));
});

test("CSV accepts one format and rejects malformed quoting or incomplete source rows", () => {
  for (
    const source of [
      "",
      "Quartermaster CSV,1\n",
      "Quartermaster trip,Voyage\nCurrency,USD\n",
      "trip,currency,description,category,amount,paid_by,split_with,date\nVoyage,USD,Stay,stays,12.00,Alex,Alex|Sam,\n",
      "trip,currency,description,category,amount,paid_by,split_with,date,receipt,tax,tip\nVoyage,USD,Meal,meals,12.00,Alex,Alex|Sam,,Dinner,1.00,2.00\n",
      report + '\n"unfinished',
      report + '\n"closed"junk',
      report.replace("p1,Alex", 'p1,Al"ex'),
      report.replace("p1,Alex", "p1"),
      report.replace("p1,Alex", 'p1,"Al\nex"'),
    ]
  ) {
    const result = importCsv(source);
    equal(result.trip, null);
    ok(result.error);
  }
});

test("CSV treats supplied formula-like text as literal text and escapes it on export", () => {
  const result = importCsv(
    report.replace("Tortuga weekend", "=HYPERLINK(1)")
      .replaceAll("Alex", "@Alex")
      .replace("Stay,", "<script>alert(1)</script>,"),
  );
  ok(result.trip);
  equal(result.trip.name, "=HYPERLINK(1)");
  equal(result.trip.expenses[0].name, "<script>alert(1)</script>");
  const exported = exportCsv(result.trip);
  ok(exported.includes('"\'=HYPERLINK(1)"'));
  ok(exported.includes('"\'@Alex"'));
});

test("shared CSV rejects malformed source data, ambiguous tables and broken references", () => {
  const changes: [string, string][] = [
    ["Quartermaster CSV,1", "Quartermaster CSV,99"],
    ["Currency,USD", "Currency,__proto__"],
    ["Currency,USD", "Currency,USD\nCurrency,EUR"],
    ["CREW\nID,Name", "CREW\nID,Name\nCREW\nID,Name"],
    ["CREW\nID,Name", "ID,Name"],
    ["ID,Name", "ID,Wrong header"],
    ["p2,Jamie", "p2,alex"],
    ["p2,Jamie", "p1,Jamie"],
    ["p3|p2|p1", "p3|p3"],
    ["p3|p2|p1", "p3|unknown"],
    ["p3|p2|p1", "p3|g1"],
    ["stays,Alex,30.01", "stays,Nobody,30.01"],
    ["Alex,30.01", "Alex,=1+1"],
    ["Alex,30.01", "Alex,0.00"],
    ["Alex,30.01", "Alex,-1.00"],
    ["Alex,30.01", "Alex,30.001"],
    ["Alex,30.01", "Alex,1e3"],
    ["Alex,30.01", "Alex,Infinity"],
    ["Alex,30.01", 'Alex,"1,000"'],
    ["p3|p2|p1", ""],
    ["stays,Alex,30.01", "stays,,30.01"],
    ["even,e1", "unknown,e1"],
    ["itemized,e2", "itemized,e1"],
    ["2026-08-14", "2026-02-30"],
    ["TOTAL,,,,39.04", "TOTAL,2026-08-14,,,39.04"],
    ["stays,Alex", "__proto__,Alex"],
    ["Alex & Jamie,p1|p2", "Alex & Jamie,p1|g1"],
    ["Alex & Jamie,p1|p2", "Alex & Jamie,p1|p1"],
    ["Alex & Jamie,p1|p2", "Alex & Jamie,p1|p2\nJamie & Sam,p2|p3"],
    ["p1,Alex", "p1,Alex\u0000"],
    ["p1,Alex", "p1,"],
    ["p1,Alex", `p1,${"a".repeat(41)}`],
    ["e2,item,p2|p1", "e1,item,p2|p1"],
    ["e2,item,p2|p1", "missing,item,p2|p1"],
    ["e2,item,p2|p1", "e2,unknown,p2|p1"],
    ["e2,item,p2|p1", "e2,item,p2|p2"],
    ["Tax,0.51", "Tax,=1+1"],
    ["Tip,0.51", "Tip,-0.51"],
    ["e2,tax,,", "e2,tax,p1,"],
    ["Dinner,Tax,0.51,e2,tax,,0.25,0.26,0.00\n", ""],
    [
      "Dinner,Tax,0.51,e2,tax,,0.25,0.26,0.00\n",
      "Dinner,Tax,0.51,e2,tax,,0.25,0.26,0.00\n".repeat(2),
    ],
  ];
  for (const [from, to] of changes) {
    ok(report.includes(from));
    const result = importCsv(report.replace(from, to));
    if (result.trip) throw new Error(`Accepted invalid edit: ${from} -> ${to}`);
    ok(result.error);
  }
});

test("shared CSV keeps bounds on file bytes, cells, columns, crew, costs and receipt items", () => {
  const overBudget = "海".repeat(Math.ceil(MAX_CSV_BYTES / 3));
  ok(overBudget.length < MAX_CSV_BYTES);
  ok(importCsv(overBudget).error?.includes("8 MB"));
  ok(importCsv("x".repeat(MAX_CSV_BYTES + 1)).error?.includes("8 MB"));
  ok(importCsv(report + ",".repeat(58)).error?.includes("columns"));
  ok(
    importCsv(report.replace("Tortuga weekend", "x".repeat(2501))).error
      ?.includes("cell"),
  );
  const morePeople = Array.from(
    { length: 49 },
    (_, index) => `extra${index},Person ${index}`,
  ).join("\n");
  equal(
    importCsv(report.replace("p3,Sam", `p3,Sam\n${morePeople}`)).trip,
    null,
  );
  const moreCosts = Array.from(
    { length: 1001 },
    (_, index) =>
      `Stay,2026-08-14,stays,Alex,30.01,even,cost${index},p3|p2|p1,10.00,10.00,10.01`,
  ).join("\n");
  equal(
    importCsv(
      report.replace(
        "Stay,2026-08-14,stays,Alex,30.01,even,e1,p3|p2|p1,10.00,10.00,10.01",
        moreCosts,
      ),
    ).trip,
    null,
  );
  const item = "Dinner,Meal,8.01,e2,item,p2|p1,4.00,4.01,0.00\n";
  equal(importCsv(report.replace(item, item.repeat(101))).trip, null);
});

test("a maximum-size trip with dense receipt allocations can still be exported and imported", () => {
  const trip = emptyTrip();
  trip.name = "航".repeat(80);
  trip.members = Array.from({ length: MAX_MEMBERS }, (_, index) => ({
    id: `person${index}`,
    name: "員".repeat(38) + String(index).padStart(2, "0"),
  }));
  const participants = trip.members.map(({ id }) => id).reverse();
  const receipt = {
    items: [{ name: "餐".repeat(100), amount: MAX_AMOUNT / 3, participants }],
    tax: MAX_AMOUNT / 3,
    tip: MAX_AMOUNT / 3,
  };
  trip.expenses = Array.from({ length: MAX_COST_LINES }, (_, index) => ({
    id: `bill${index}`,
    name: "帳".repeat(100),
    category: "meals",
    amount: MAX_AMOUNT,
    paidBy: participants[index % participants.length],
    participants,
    split: "itemized",
    date: "2026-08-15",
    receipt,
  }));
  ok(parseTrip(trip));
  const csv = exportCsv(trip);
  const bytes = new TextEncoder().encode(csv).length;
  ok(bytes > 4_000_000);
  ok(bytes <= MAX_CSV_BYTES);
  const imported = importCsv(csv);
  if (!imported.trip) throw new Error(imported.error);
  deepStrictEqual(contents(imported.trip), contents(trip));
});
