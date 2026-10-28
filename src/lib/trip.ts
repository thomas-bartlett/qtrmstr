export const CURRENCIES = {
  USD: "US dollar",
  EUR: "Euro",
  GBP: "British pound",
  CAD: "Canadian dollar",
  AUD: "Australian dollar",
  NZD: "New Zealand dollar",
  CHF: "Swiss franc",
  INR: "Indian rupee",
  SGD: "Singapore dollar",
} as const;

export const CATEGORIES = {
  stays: "Stays",
  meals: "Meals & drinks",
  transport: "Transport",
  activities: "Events & activities",
  groceries: "Groceries",
  other: "Other",
} as const;

export const MAX_MEMBERS = 50;
export const MAX_RECEIPT_ITEMS = 100;
export const MAX_COST_LINES = 1000;
export const MAX_AMOUNT = 99_999_999_999;

export type Currency = keyof typeof CURRENCIES;
export type Category = keyof typeof CATEGORIES;
export interface Member {
  id: string;
  name: string;
}
export interface Group {
  id: string;
  members: string[];
}
export interface ReceiptItem {
  name: string;
  amount: number;
  participants: string[];
}
export interface Receipt {
  items: ReceiptItem[];
  tax: number;
  tip: number;
}
export interface Expense {
  id: string;
  name: string;
  category: Category;
  amount: number;
  paidBy: string;
  split: "even" | "individual" | "itemized";
  participants: string[];
  date: string;
  receipt?: Receipt;
}
export interface Trip {
  version: 4;
  name: string;
  currency: Currency;
  members: Member[];
  groups: Group[];
  expenses: Expense[];
}
export interface Balance extends Member {
  paid: number;
  share: number;
  net: number;
}
export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

export function emptyTrip(): Trip {
  return {
    version: 4,
    name: "",
    currency: "USD",
    members: [],
    groups: [],
    expenses: [],
  };
}

// A group has no separate name to keep in sync with its members.
export function groupName(group: Group, members: Member[]): string {
  return group.members.map((id) =>
    members.find((member) => member.id === id)!.name
  )
    .join(" & ");
}

export function crewName(trip: Trip, id: string): string {
  const member = trip.members.find((member) => member.id === id);
  if (member) return member.name;
  const group = trip.groups.find((group) => group.id === id);
  return group ? groupName(group, trip.members) : "Unknown shipmate";
}

export function balanceText(net: number, currency: Currency): string {
  return net > 0
    ? `Gets back ${money(net, currency)}`
    : net < 0
    ? `Owes ${money(-net, currency)}`
    : "All square";
}

// Parse decimal text directly into cents, avoiding floating-point rounding.
export function parseAmount(value: string): number | null {
  const clean = value.trim();
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(clean)) return null;
  const [whole, fraction = ""] = clean.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return cents > 0 && cents <= MAX_AMOUNT ? cents : null;
}

// Receipt-wide extras may be zero or blank; costs themselves must be positive.
export function parseExtra(value: string): number | null {
  const clean = value.trim();
  return clean === "" || /^0(?:\.0{1,2})?$/.test(clean)
    ? 0
    : parseAmount(clean);
}

export function decimal(cents: number): string {
  const absolute = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(absolute / 100)}.${
    String(absolute % 100).padStart(2, "0")
  }`;
}

const formatters = new Map<Currency, Intl.NumberFormat>();
export function money(cents: number, currency: Currency): string {
  let formatter = formatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", { style: "currency", currency });
    formatters.set(currency, formatter);
  }
  return formatter.format(cents / 100);
}

// Preserve recorded penny allocation when an edit only changes the description.
export function orderedParticipants(
  selected: string[],
  recorded: string[] = [],
): string[] {
  return [
    ...recorded.filter((id) => selected.includes(id)),
    ...selected.filter((id) => !recorded.includes(id)),
  ];
}

// Participant order is captured when saving an expense. Remaining pennies go
// to the first participants in that order; existing splits never change when
// another crew member is added later.
export function sharesFor(
  expense: Pick<Expense, "amount" | "participants"> & { receipt?: Receipt },
): Map<string, number> {
  if (expense.receipt) return receiptBreakdown(expense.receipt).total;
  const base = Math.floor(expense.amount / expense.participants.length);
  const remainder = expense.amount % expense.participants.length;
  return new Map(
    expense.participants.map((
      id,
      index,
    ) => [id, base + (index < remainder ? 1 : 0)]),
  );
}

export function receiptParticipants(receipt: Receipt): string[] {
  return [...new Set(receipt.items.flatMap((item) => item.participants))];
}

export function receiptTotal(receipt: Receipt): number {
  return receipt.items.reduce(
    (sum, item) => sum + item.amount,
    receipt.tax + receipt.tip,
  );
}

// Largest remainders preserve every cent. BigInt prevents overflow when a
// large receipt subtotal is multiplied by its tax/tip. Ties keep recorded order.
function proportionalShares(
  amount: number,
  weights: Map<string, number>,
): Map<string, number> {
  const denominator = BigInt(
    [...weights.values()].reduce((sum, value) => sum + value, 0),
  );
  const portions = [...weights].map(([id, weight], order) => {
    const numerator = BigInt(amount) * BigInt(weight);
    return {
      id,
      order,
      cents: Number(numerator / denominator),
      remainder: numerator % denominator,
    };
  });
  const result = new Map(portions.map(({ id, cents }) => [id, cents]));
  let pennies = amount -
    portions.reduce((sum, portion) => sum + portion.cents, 0);
  portions.sort((a, b) =>
    a.remainder === b.remainder
      ? a.order - b.order
      : a.remainder > b.remainder
      ? -1
      : 1
  );
  for (const portion of portions) {
    if (pennies-- <= 0) break;
    result.set(portion.id, portion.cents + 1);
  }
  return result;
}

export function receiptBreakdown(receipt: Receipt) {
  const subtotals = new Map(receiptParticipants(receipt).map((id) => [id, 0]));
  const items = receipt.items.map((item) => sharesFor(item));
  for (const shares of items) {
    for (const [id, amount] of shares) {
      subtotals.set(id, subtotals.get(id)! + amount);
    }
  }
  const tax = proportionalShares(receipt.tax, subtotals);
  const tip = proportionalShares(receipt.tip, subtotals);
  const total = new Map(
    [...subtotals].map((
      [id, amount],
    ) => [id, amount + tax.get(id)! + tip.get(id)!]),
  );
  return { items, subtotals, tax, tip, total };
}

export function costLineCount(expenses: Expense[]): number {
  return expenses.reduce(
    (count, expense) => count + (expense.receipt?.items.length ?? 1),
    0,
  );
}

export function calculate(trip: Trip) {
  const balances: Balance[] = trip.members.map((member) => ({
    ...member,
    paid: 0,
    share: 0,
    net: 0,
  }));
  const byId = new Map(balances.map((member) => [member.id, member]));
  let total = 0;
  for (const expense of trip.expenses) {
    total += expense.amount;
    byId.get(expense.paidBy)!.paid += expense.amount;
    for (const [id, share] of sharesFor(expense)) byId.get(id)!.share += share;
  }
  for (const member of balances) member.net = member.paid - member.share;
  // Groups affect settlement only. Costs and receipt extras always belong to
  // individuals, so changing a group cannot rewrite an earlier allocation.
  const groupByMember = new Map(
    trip.groups.flatMap((group) =>
      group.members.map((id) => [id, group] as const)
    ),
  );
  const accounts = new Map<string, Balance>();
  for (const member of balances) {
    const group = groupByMember.get(member.id);
    const owner = group ?? member;
    let account = accounts.get(owner.id);
    if (!account) {
      account = {
        id: owner.id,
        name: group ? groupName(group, trip.members) : member.name,
        paid: 0,
        share: 0,
        net: 0,
      };
      accounts.set(owner.id, account);
    }
    account.paid += member.paid;
    account.share += member.share;
    account.net += member.net;
  }
  const settlementBalances = [...accounts.values()];
  const debtors = settlementBalances.filter((member) => member.net < 0).map((
    member,
  ) => ({
    id: member.id,
    amount: -member.net,
  }));
  const creditors = settlementBalances.filter((member) => member.net > 0).map((
    member,
  ) => ({ id: member.id, amount: member.net }));
  // A deterministic, simple settlement with at most crew size - 1 transfers.
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);
  const transfers: Transfer[] = [];
  let debtor = 0;
  let creditor = 0;
  while (debtor < debtors.length && creditor < creditors.length) {
    const from = debtors[debtor];
    const to = creditors[creditor];
    const amount = Math.min(from.amount, to.amount);
    transfers.push({ from: from.id, to: to.id, amount });
    from.amount -= amount;
    to.amount -= amount;
    if (from.amount === 0) debtor++;
    if (to.amount === 0) creditor++;
  }
  return { balances, settlementBalances, transfers, total };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001F\u007F]/u.test(value);
}
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max &&
    !hasControlCharacters(value);
}
function id(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
}
export function validDate(value: unknown): value is string {
  return typeof value === "string" &&
    (value === "" || (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value));
}

// Browser storage is untrusted, just like imported data. Reconstruct only the
// known fields and reject invalid references, duplicates, or unsafe amounts.
export function parseTrip(value: unknown): Trip | null {
  if (
    !record(value) ||
    (value.version !== 1 && value.version !== 2 && value.version !== 3 &&
      value.version !== 4) ||
    !text(value.name, 80) ||
    typeof value.currency !== "string" ||
    !Object.hasOwn(CURRENCIES, value.currency) ||
    !Array.isArray(value.members) || value.members.length > MAX_MEMBERS ||
    !Array.isArray(value.expenses) || value.expenses.length > MAX_COST_LINES
  ) return null;
  const members: Member[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const member of value.members) {
    if (
      !record(member) || !id(member.id) || ids.has(member.id) ||
      !text(member.name, 40) ||
      !member.name.trim() || names.has(member.name.trim().toLowerCase()) ||
      (member.group !== undefined &&
        (value.version >= 3 || typeof member.group !== "boolean"))
    ) return null;
    ids.add(member.id);
    names.add(member.name.trim().toLowerCase());
    // Older shared-name entries keep their identity and costs. Drop only the
    // legacy label; names do not reliably identify the people inside a group.
    members.push({
      id: member.id,
      name: member.name.trim(),
    });
  }
  const expenseIds = new Set<string>();
  const expenses: Expense[] = [];
  let costLines = 0;
  function participants(value: unknown): value is string[] {
    return Array.isArray(value) && value.length > 0 &&
      value.length <= members.length &&
      value.every((participant) =>
        typeof participant === "string" && ids.has(participant)
      ) &&
      new Set(value).size === value.length;
  }
  const groups: Group[] = [];
  const groupIds = new Set<string>();
  const grouped = new Set<string>();
  if (value.version >= 3) {
    if (
      !Array.isArray(value.groups) ||
      value.groups.length > Math.floor(MAX_MEMBERS / 2)
    ) return null;
    for (const group of value.groups) {
      if (
        !record(group) || !id(group.id) || ids.has(group.id) ||
        groupIds.has(group.id) ||
        !participants(group.members) || group.members.length < 2 ||
        group.members.some((id) => grouped.has(id))
      ) return null;
      groupIds.add(group.id);
      group.members.forEach((id) => grouped.add(id));
      // Ignore legacy custom labels; member IDs remain the source of identity.
      groups.push({
        id: group.id,
        members: [...group.members],
      });
    }
  } else if (
    value.groups !== undefined &&
    (!Array.isArray(value.groups) || value.groups.length)
  ) {
    return null;
  }
  function amount(value: unknown, allowZero = false): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) &&
      value >= (allowZero ? 0 : 1) && value <= MAX_AMOUNT;
  }
  for (const expense of value.expenses) {
    if (
      !record(expense) || !id(expense.id) || expenseIds.has(expense.id) ||
      !text(expense.name, 100) || !expense.name.trim() ||
      typeof expense.category !== "string" ||
      !Object.hasOwn(CATEGORIES, expense.category) ||
      !amount(expense.amount) ||
      typeof expense.paidBy !== "string" || !ids.has(expense.paidBy) ||
      !participants(expense.participants) ||
      (expense.split !== "even" && expense.split !== "individual" &&
        expense.split !== "itemized") ||
      (expense.split === "individual" && expense.participants.length !== 1) ||
      !validDate(expense.date)
    ) return null;
    const participantIds = expense.participants;
    let receipt: Receipt | undefined;
    if (expense.split === "itemized") {
      if (
        value.version === 1 || !record(expense.receipt) ||
        !Array.isArray(expense.receipt.items) ||
        !expense.receipt.items.length ||
        expense.receipt.items.length > MAX_RECEIPT_ITEMS ||
        !amount(expense.receipt.tax, true) || !amount(expense.receipt.tip, true)
      ) return null;
      const items: ReceiptItem[] = [];
      for (const item of expense.receipt.items) {
        if (
          !record(item) || !text(item.name, 100) || !item.name.trim() ||
          !amount(item.amount) || !participants(item.participants)
        ) return null;
        items.push({
          name: item.name.trim(),
          amount: item.amount,
          participants: [...item.participants],
        });
      }
      receipt = { items, tax: expense.receipt.tax, tip: expense.receipt.tip };
      const involved = receiptParticipants(receipt);
      if (
        receiptTotal(receipt) !== expense.amount ||
        involved.length !== participantIds.length ||
        involved.some((id, index) => id !== participantIds[index])
      ) return null;
    } else if (expense.receipt !== undefined) return null;
    costLines += receipt?.items.length ?? 1;
    if (costLines > MAX_COST_LINES) return null;
    expenseIds.add(expense.id);
    expenses.push({
      id: expense.id,
      name: expense.name.trim(),
      category: expense.category as Category,
      amount: expense.amount,
      paidBy: expense.paidBy,
      split: expense.split,
      participants: [...expense.participants] as string[],
      date: expense.date,
      ...(receipt ? { receipt } : {}),
    });
  }
  return {
    version: 4,
    name: value.name.trim(),
    currency: value.currency as Currency,
    members,
    groups,
    expenses,
  };
}

export function exampleTrip(): Trip {
  const members = ["Alex", "Jamie", "Sam", "Morgan"].map((name, index) => ({
    id: `crew-${index}`,
    name,
  }));
  const everyone = members.map((member) => member.id);
  const cost = (
    id: string,
    name: string,
    category: Category,
    amount: number,
    paidBy: string,
    participants = everyone,
  ): Expense => ({
    id,
    name,
    category,
    amount,
    paidBy,
    split: participants.length === 1 ? "individual" : "even",
    participants: [...participants],
    date: "",
  });
  return {
    ...emptyTrip(),
    name: "A weekend in Port Townsend",
    members,
    expenses: [
      cost("stay", "The harbor house · 2 nights", "stays", 64000, everyone[0]),
      cost("dinner", "First-night fish & chips", "meals", 12850, everyone[1]),
      cost("ferry", "Ferry tickets", "transport", 7600, everyone[2]),
      cost(
        "kayaks",
        "Kayaks for Jamie & Morgan",
        "activities",
        9000,
        everyone[3],
        [everyone[1], everyone[3]],
      ),
      cost(
        "coffee",
        "Sam’s coffee on the way home",
        "meals",
        650,
        everyone[0],
        [everyone[2]],
      ),
    ],
  };
}
