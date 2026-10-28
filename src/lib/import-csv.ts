import {
  type Category,
  type Expense,
  MAX_COST_LINES,
  MAX_MEMBERS,
  parseAmount,
  parseExtra,
  parseTrip,
  receiptParticipants,
  receiptTotal,
  type Trip,
} from "./trip.ts";
import { CSV_FORMAT, CSV_TABLES, CSV_VERSION, csvText } from "./csv.ts";

// A full report includes allocation columns and receipt breakdowns as well as
// source costs. Keep it bounded while allowing maximum-size trips to round-trip.
export const MAX_CSV_BYTES = 8_000_000;

// A bounded CSV reader: quoted commas, escaped quotes, CRLF, and UTF-8 BOM.
// Cells remain text. No formulas, URLs, HTML, or instructions are evaluated.
function readRows(source: string): string[][] {
  const text = source.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let closed = false;
  function field() {
    row.push(cell.trim());
    if (row.length > CSV_TABLES.expenses.columns.length + MAX_MEMBERS) {
      throw new Error("This CSV has too many columns.");
    }
    cell = "";
    closed = false;
  }
  function line() {
    field();
    if (row.some(Boolean)) rows.push(row);
    row = [];
    if (rows.length > 4 * MAX_COST_LINES + 5 * MAX_MEMBERS + 32) {
      throw new Error("This CSV has too many rows.");
    }
  }
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += char;
    } else if (char === ",") field();
    else if (char === "\n" || char === "\r") {
      line();
      if (char === "\r" && text[index + 1] === "\n") index++;
    } else if (closed) {
      if (char !== " " && char !== "\t") {
        throw new Error(
          "A quoted cell must end before the next comma or line.",
        );
      }
    } else if (char === '"') {
      if (cell) {
        throw new Error(
          "Put quotation marks around the whole cell, and double any quotes inside it.",
        );
      }
      quoted = true;
    } else cell += char;
    if (cell.length > 2500) {
      throw new Error(
        "A CSV cell is too long. Follow the name and description limits in the CSV guide.",
      );
    }
  }
  if (quoted) {
    throw new Error("A quoted cell is missing its closing quotation mark.");
  }
  line();
  return rows;
}

function readTrip(rows: string[][]): Trip {
  if (
    rows[0]?.[0] !== CSV_FORMAT || rows[0][1] !== CSV_VERSION ||
    rows[0].slice(2).some(Boolean)
  ) {
    throw new Error(
      `Use a Quartermaster CSV starting with ${CSV_FORMAT},${CSV_VERSION}. Download a fresh CSV or use the CSV template.`,
    );
  }
  const titles = new Set<string>(
    Object.values(CSV_TABLES).map((table) => table.title),
  );
  const tables = new Map<string, string[][]>();
  const metadata: string[][] = [];
  let current = metadata;
  for (const row of rows.slice(1)) {
    // Spreadsheet editors may pad short rows with empty cells.
    if (titles.has(row[0]) && row.slice(1).every((cell) => cell === "")) {
      if (tables.has(row[0])) {
        throw new Error(`The CSV repeats the ${row[0]} table.`);
      }
      current = [];
      tables.set(row[0], current);
    } else current.push(row);
  }
  function field(label: string): string {
    const matches = metadata.filter((row) => row[0] === label);
    if (
      matches.length !== 1 || matches[0].length < 2 ||
      matches[0].slice(2).some(Boolean)
    ) throw new Error(`The CSV needs one ${label} field.`);
    return matches[0][1];
  }
  function table(
    { title, columns }: { title: string; columns: readonly string[] },
    required = false,
  ): string[][] {
    const rows = tables.get(title);
    if (!rows && !required) return [];
    const [header, ...data] = rows ?? [];
    if (
      !header || columns.some((name, index) => header[index] !== name) ||
      data.some((row) => row.length < columns.length)
    ) throw new Error(`The ${title} table is missing or has invalid columns.`);
    return data;
  }

  const members = table(CSV_TABLES.crew, true).map(([id, name]) => ({
    id,
    name: csvText(name),
  }));
  const memberIds = new Map(members.map((member) => [member.name, member.id]));
  const crewIds = new Set(members.map((member) => member.id));
  let groupNumber = 0;
  const groups = table(CSV_TABLES.groups).map(([, participants]) => {
    // Crew IDs are supplied by the file; generated group IDs must not collide.
    let id: string;
    do {
      id = `g${++groupNumber}`;
    } while (crewIds.has(id));
    return { id, members: participants.split("|") };
  });
  const expenses: Expense[] = table(CSV_TABLES.expenses, true)
    .filter((row) =>
      !(row[0] === "TOTAL" &&
        [1, 2, 3, 5, 6, 7].every((index) => row[index] === ""))
    )
    .map(([name, date, category, payer, amount, split, id, participants]) => ({
      id,
      name: csvText(name),
      date,
      category: category as Category,
      paidBy: memberIds.get(csvText(payer)) ?? "",
      amount: parseAmount(amount) ?? NaN,
      split: split as Expense["split"],
      participants: participants.split("|"),
      ...(split === "itemized"
        ? { receipt: { items: [], tax: 0, tip: 0 } }
        : {}),
    }));
  const byId = new Map(expenses.map((expense) => [expense.id, expense]));
  const extras = new Set<string>();
  for (const row of table(CSV_TABLES.receipts)) {
    const [, name, amount, id, type, participants] = row;
    const receipt = byId.get(id)?.receipt;
    if (!receipt) {
      throw new Error("A receipt row refers to an unknown or ordinary cost.");
    }
    if (type === "item") {
      receipt.items.push({
        name: csvText(name),
        amount: parseAmount(amount) ?? NaN,
        participants: participants.split("|"),
      });
    } else if (type === "tax" || type === "tip") {
      const key = `${id}:${type}`;
      if (extras.has(key) || participants) {
        throw new Error(
          "Each receipt needs one tax row and one tip row, without individual participants.",
        );
      }
      extras.add(key);
      receipt[type] = parseExtra(amount) ?? NaN;
    } else throw new Error("Receipt row types must be item, tax, or tip.");
  }
  for (const expense of expenses) {
    if (!expense.receipt) continue;
    if (!extras.has(`${expense.id}:tax`) || !extras.has(`${expense.id}:tip`)) {
      throw new Error(
        "A receipt is missing its tax or tip row. Use 0.00 for none.",
      );
    }
    // These fields, like all share and balance columns, are derived. Rebuild
    // them from the source items so edited spreadsheet totals are never trusted.
    expense.amount = receiptTotal(expense.receipt);
    expense.participants = receiptParticipants(expense.receipt);
  }
  const trip = parseTrip({
    version: 4,
    name: csvText(field("Quartermaster trip")),
    currency: field("Currency"),
    members,
    groups,
    expenses,
  });
  if (!trip) {
    throw new Error(
      "The CSV has invalid trip data. Check names, IDs, splits, amounts, dates, and size limits.",
    );
  }
  return trip;
}

export function importCsv(
  source: string,
): { trip: Trip; error: null } | { trip: null; error: string } {
  try {
    if (
      source.length > MAX_CSV_BYTES ||
      new TextEncoder().encode(source).length > MAX_CSV_BYTES
    ) {
      throw new Error("Choose a CSV no larger than 8 MB.");
    }
    return { trip: readTrip(readRows(source)), error: null };
  } catch (error) {
    return {
      trip: null,
      error: error instanceof Error
        ? error.message
        : "This CSV could not be read.",
    };
  }
}
