import {
  type Balance,
  balanceText,
  calculate,
  CATEGORIES,
  crewName,
  type Expense,
  type Member,
  money,
  orderedParticipants,
  receiptBreakdown,
  sharesFor,
  type Trip,
} from "../lib/trip.ts";
import { CATEGORY_THEME } from "../lib/theme.ts";
import { ICON_PATHS, type IconName } from "../lib/icons.ts";

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element: ${id}`);
  return element as T;
}

export function message(id: string, content: string) {
  const element = byId(id);
  element.textContent = content;
  element.hidden = !content;
}

// append() inserts strings as text nodes. User input never becomes HTML.
export function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  element.append(...children);
  return element;
}

export function action(label: string, className: string, handler: () => void) {
  const button = node("button", className, label);
  button.type = "button";
  button.addEventListener("click", handler);
  return button;
}

export function avatar(name: string, index: number) {
  const element = node(
    "span",
    `avatar avatar-${index % 4}`,
    [...name][0]?.toUpperCase() ?? "?",
  );
  element.setAttribute("aria-hidden", "true");
  return element;
}
export function personLabel(trip: Trip, member: Member) {
  const label = node("span", "", member.name);
  const group = trip.groups.find((group) => group.members.includes(member.id));
  if (group) label.append(node("small", "group-tag", crewName(trip, group.id)));
  return label;
}

export function selectedPeople(container: HTMLElement, recorded: string[] = []) {
  return orderedParticipants(
    [...container.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]:checked',
    )].map((input) => input.value),
    recorded,
  );
}
export function renderPeople(
  trip: Trip,
  container: HTMLElement,
  selected: string[],
  members = trip.members,
) {
  container.replaceChildren(...members.map((member) => {
    const input = node("input");
    input.type = "checkbox";
    input.value = member.id;
    input.checked = selected.includes(member.id);
    return node(
      "label",
      "participant",
      input,
      avatar(member.name, trip.members.indexOf(member)),
      personLabel(trip, member),
    );
  }));
}

function categoryArt(iconName: IconName) {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(namespace, "path");
  path.setAttribute("d", ICON_PATHS[iconName]);
  svg.append(path);
  return node("span", "category-art", svg);
}

export function createShares(trip: Trip, shares: Map<string, number>) {
  return node(
    "dl",
    "cost-shares",
    ...[...shares].map(([id, amount]) =>
      node(
        "div",
        "",
        node("dt", "", crewName(trip, id)),
        node("dd", "", money(amount, trip.currency)),
      )
    ),
  );
}

export function createCostDetails(trip: Trip, expense: Expense) {
  const receipt = expense.receipt;
  if (!receipt) return createShares(trip, sharesFor(expense));
  const breakdown = receiptBreakdown(receipt);
  const format = (amount: number) => money(amount, trip.currency);
  const line = (name: string, amount: number, shares?: Map<string, number>) =>
    node(
      "li",
      "",
      node(
        "div",
        "receipt-line-heading",
        node("span", "", name),
        node("strong", "", format(amount)),
      ),
      ...(shares
        ? [node(
          "p",
          "field-hint",
          [...shares].map(([id, share]) =>
            `${crewName(trip, id)} ${format(share)}`
          ).join(" · "),
        )]
        : []),
    );
  return node(
    "div",
    "",
    node(
      "ul",
      "receipt-lines",
      ...receipt.items.map((item, index) =>
        line(item.name, item.amount, breakdown.items[index])
      ),
      line(
        "Item subtotal",
        receipt.items.reduce((sum, item) => sum + item.amount, 0),
      ),
      line("Tax", receipt.tax, breakdown.tax),
      line("Tip", receipt.tip, breakdown.tip),
    ),
    node("p", "field-hint", "Each shipmate’s total, including tax and tip"),
    createShares(trip, breakdown.total),
  );
}

// Read-only presentation; editing controls belong to the page controller.
export function createCostCard(trip: Trip, expense: Expense, detailed = false) {
  const theme = CATEGORY_THEME[expense.category];
  return node(
    "article",
    `expense-row category-${expense.category}`,
    node(
      "div",
      "expense-heading",
      categoryArt(theme.icon),
      node(
        "div",
        "expense-info",
        node("span", "category-label", theme.name),
        node("h3", "", expense.name),
      ),
      node("strong", "expense-amount", money(expense.amount, trip.currency)),
    ),
    node(
      "p",
      "expense-payer",
      `Paid by ${crewName(trip, expense.paidBy)}${
        expense.date ? ` · ${expense.date}` : ""
      }`,
    ),
    ...(detailed ? [createCostDetails(trip, expense)] : []),
  );
}

function table(headers: string[], rows: string[][], className: string) {
  const row = (values: string[], heading = false) =>
    node(
      "tr",
      "",
      ...values.map((value, index) => {
        const cell = node(heading || index === 0 ? "th" : "td", "", value);
        if (cell.tagName === "TH") cell.scope = heading ? "col" : "row";
        return cell;
      }),
    );
  return node(
    "table",
    `report-table ${className}`,
    node("thead", "", row(headers, true)),
    node("tbody", "", ...rows.map((values) => row(values))),
  );
}

// The trip is the source of truth. Build off-screen, then replace in one operation.
export function createPrintReport(trip: Trip, detailed = false, flag?: Node) {
  const { total, balances, settlementBalances, transfers } = calculate(trip);
  const format = (amount: number) => money(amount, trip.currency);
  const accounts = (values: Balance[]) =>
    table(
      ["Crew", "Paid", "Share", "Balance"],
      values.map((
        account,
      ) => [
        account.name,
        format(account.paid),
        format(account.share),
        balanceText(account.net, trip.currency),
      ]),
      "report-balances",
    );
  const report = document.createDocumentFragment();
  const section = (title: string, content: Node, hint?: string) =>
    report.append(
      node("h2", "", title),
      ...(hint ? [node("p", "field-hint", hint)] : []),
      content,
    );
  report.append(
    node(
      "header",
      "report-heading",
      node(
        "div",
        "report-brand",
        ...(flag ? [flag] : []),
        node("span", "", "quartermaster"),
      ),
      node("h1", "", trip.name || "Your voyage"),
      node(
        "p",
        "",
        `${trip.currency} · ${trip.members.length} shipmates · ${trip.expenses.length} costs`,
      ),
      node("strong", "report-total", `Trip total ${format(total)}`),
    ),
  );
  section(
    "Who pays whom",
    transfers.length
      ? table(
        ["From", "To", "Amount"],
        transfers.map((
          transfer,
        ) => [
          crewName(trip, transfer.from),
          crewName(trip, transfer.to),
          format(transfer.amount),
        ]),
        "report-payments",
      )
      : node(
        "p",
        "all-square",
        trip.expenses.length
          ? "All square, shipmates."
          : "Nothing to settle yet.",
      ),
  );
  section("Crew balances", accounts(settlementBalances));
  if (trip.groups.length) {
    section(
      "Each shipmate’s share",
      accounts(balances),
      "Groups settle together. These individual balances are already included in the suggested payments.",
    );
  }
  const costs = document.createDocumentFragment();
  costs.append(
    ...(detailed
      ? trip.expenses.map((expense) => createCostCard(trip, expense, true))
      : [table(
        ["Cost", "Paid by", "Amount"],
        trip.expenses.map((expense) => [
          `${expense.name}\n${CATEGORIES[expense.category]}${
            expense.date ? ` · ${expense.date}` : ""
          }`,
          crewName(trip, expense.paidBy),
          format(expense.amount),
        ]),
        "report-costs",
      )]),
  );
  section("Ship’s tab", costs);
  report.append(
    node(
      "p",
      "report-note",
      detailed
        ? "Suggested payments, not a record of payments made. Balances are paid minus share; groups settle together. Items split evenly in recorded order. Tax and tip follow each person’s item subtotal, with extra pennies assigned by largest fractional remainder."
        : "Suggested payments, not a record of payments made. Groups settle together. Download the CSV or include receipt & split details for the full workings.",
    ),
  );
  return report;
}
