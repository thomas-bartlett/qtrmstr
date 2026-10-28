import {
  type Balance,
  calculate,
  crewName,
  decimal,
  receiptBreakdown,
  sharesFor,
  type Trip,
} from "./trip.ts";

export const CSV_FORMAT = "Quartermaster CSV";
export const CSV_VERSION = "1";
export const CSV_TABLES = {
  crew: { title: "CREW", columns: ["ID", "Name"] },
  groups: {
    title: "SETTLEMENT GROUPS",
    columns: ["Group", "Member IDs"],
  },
  expenses: {
    title: "EXPENSES",
    columns: [
      "Expense",
      "Date",
      "Category",
      "Paid by",
      "Amount",
      "Split",
      "ID",
      "Split with (crew IDs)",
    ],
  },
  receipts: {
    title: "RECEIPT DETAILS — already included in expense totals above",
    columns: [
      "Receipt",
      "Item / extra",
      "Amount",
      "Expense ID",
      "Type",
      "Split with (crew IDs)",
    ],
  },
  balances: {
    title: "MEMBER BALANCES",
    columns: ["Member", "Paid", "Share", "Net (paid minus share)"],
  },
  settlements: {
    title: "SETTLEMENT BALANCES — groups settle together",
    columns: ["Person or group", "Paid", "Share", "Net (paid minus share)"],
  },
  payments: {
    title: "SUGGESTED PAYMENTS",
    columns: ["From", "To", "Amount", "Currency"],
  },
} as const;

const needsEscape = (value: string) =>
  /^'|^[\s\uFEFF]*[=+@\uFF1D\uFF0B\uFF0D\uFF20-]|^[\t\r\n]/u.test(value);

// Quote separators and escape formula prefixes, including full-width variants.
// Escape existing apostrophes too so importing can recover exact text.
export function csvCell(value: string | number): string {
  const raw = typeof value === "number"
    ? String(value)
    : needsEscape(value)
    ? `'${value}`
    : value;
  return `"${raw.replaceAll('"', '""')}"`;
}

// Only versioned Quartermaster exports use this reversible text escaping.
export function csvText(value: string): string {
  return value.startsWith("'") && needsEscape(value.slice(1))
    ? value.slice(1)
    : value;
}

function balanceRows(balances: Balance[]) {
  return balances.map((member) => [
    member.name,
    decimal(member.paid),
    decimal(member.share),
    member.net / 100,
  ]);
}

export function exportCsv(trip: Trip): string {
  const crewIds = new Map(
    trip.members.map((member, index) => [member.id, `p${index + 1}`]),
  );
  const expenseIds = new Map(
    trip.expenses.map((expense, index) => [expense.id, `e${index + 1}`]),
  );
  const refs = (ids: string[]) => ids.map((id) => crewIds.get(id)!).join("|");
  const rows: (string | number)[][] = [
    [CSV_FORMAT, CSV_VERSION],
    ["Quartermaster trip", trip.name],
    ["Currency", trip.currency],
    [
      "Use this file",
      "Share this CSV with the website link. Open Crew > Import CSV to load the same trip. Each person gets their own copy.",
    ],
    [
      "Recalculate",
      "Import reads crew, group member IDs, costs, receipt items, tax and tip. Shares, receipt totals, balances and payments are recalculated. IDs link the tables; participant order controls rounding ties.",
    ],
    [
      "Amounts",
      "Decimal currency units. Member columns show each expense’s allocated share.",
    ],
    [
      "Check the totals",
      "Sum the cost rows in EXPENSES; TOTAL summarizes them. Receipt detail lines are already included. Each member’s share is the sum of their cost rows. Paid minus share is their balance: positive receives, negative owes.",
    ],
    [
      "Rounding",
      "Even splits give extra pennies in recorded participant order. For each receipt extra, multiply its amount by the person’s item subtotal divided by the receipt’s item subtotal. Round down to cents, then give remaining pennies to the largest fractional remainders; recorded order breaks ties.",
    ],
    [
      "Splitting",
      "Each person gets a share. Groups combine their members’ balances for settlement only; individual cost allocations do not change.",
    ],
    [],
    [CSV_TABLES.crew.title],
    [...CSV_TABLES.crew.columns],
    ...trip.members.map((member) => [crewIds.get(member.id)!, member.name]),
    ...(trip.groups.length
      ? [
        [],
        [CSV_TABLES.groups.title],
        [...CSV_TABLES.groups.columns],
        ...trip.groups.map((group) => [
          crewName(trip, group.id),
          refs(group.members),
        ]),
      ]
      : []),
    [],
    [CSV_TABLES.expenses.title],
    [
      ...CSV_TABLES.expenses.columns,
      ...trip.members.map((member) => member.name),
    ],
  ];
  for (const expense of trip.expenses) {
    const shares = sharesFor(expense);
    rows.push([
      expense.name,
      expense.date,
      expense.category,
      crewName(trip, expense.paidBy),
      decimal(expense.amount),
      expense.split,
      expenseIds.get(expense.id)!,
      refs(expense.participants),
      ...trip.members.map((member) => decimal(shares.get(member.id) ?? 0)),
    ]);
  }
  const { total, balances, settlementBalances, transfers } = calculate(trip);
  rows.push(
    [
      "TOTAL",
      "",
      "",
      "",
      decimal(total),
      "",
      "",
      "",
      ...balances.map((member) => decimal(member.share)),
    ],
    [],
  );
  const itemized = trip.expenses.filter((expense) => expense.receipt);
  if (itemized.length) {
    rows.push(
      [CSV_TABLES.receipts.title],
      [
        ...CSV_TABLES.receipts.columns,
        ...trip.members.map((member) => member.name),
      ],
    );
    for (const expense of itemized) {
      const receipt = expense.receipt!;
      const breakdown = receiptBreakdown(receipt);
      const lines = [
        ...receipt.items.map((item, index) => ({
          name: item.name,
          amount: item.amount,
          type: "item",
          participants: refs(item.participants),
          shares: breakdown.items[index],
        })),
        ...(["tax", "tip"] as const).map((type) => ({
          name: type === "tax" ? "Tax" : "Tip",
          amount: receipt[type],
          type,
          participants: "",
          shares: breakdown[type],
        })),
      ];
      for (const line of lines) {
        rows.push([
          expense.name,
          line.name,
          decimal(line.amount),
          expenseIds.get(expense.id)!,
          line.type,
          line.participants,
          ...trip.members.map((member) =>
            decimal(line.shares.get(member.id) ?? 0)
          ),
        ]);
      }
    }
    rows.push([]);
  }
  rows.push(
    [CSV_TABLES.balances.title],
    [...CSV_TABLES.balances.columns],
    ...balanceRows(balances),
    [],
    ...(trip.groups.length
      ? [
        [CSV_TABLES.settlements.title],
        [...CSV_TABLES.settlements.columns],
        ...balanceRows(settlementBalances),
        [],
      ]
      : []),
    [CSV_TABLES.payments.title],
    [...CSV_TABLES.payments.columns],
    ...transfers.map((
      transfer,
    ) => [
      crewName(trip, transfer.from),
      crewName(trip, transfer.to),
      decimal(transfer.amount),
      trip.currency,
    ]),
    [],
    [
      "Note",
      "Suggested payments only; Quartermaster does not send or track payments.",
    ],
  );
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") +
    "\r\n";
}
