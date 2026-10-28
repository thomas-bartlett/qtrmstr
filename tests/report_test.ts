import { test } from "node:test";
import { createPrintReport } from "../src/scripts/views.ts";
import {
  emptyTrip,
  exampleTrip,
  receiptParticipants,
  receiptTotal,
} from "../src/lib/trip.ts";
import { equal, ok } from "node:assert/strict";

// Minimal DOM recording for content tests; this does not emulate browser layout.
class Element {
  children: Element[] = [];
  className = "";
  textContent = "";
  scope = "";
  attributes: Record<string, string> = {};
  tag: string;
  constructor(tag: string) {
    this.tag = tag;
  }
  get tagName() {
    return this.tag.toUpperCase();
  }
  append(...values: (Element | string)[]) {
    for (const value of values) {
      this.children.push(
        typeof value === "string"
          ? Object.assign(new Element("text"), { textContent: value })
          : value,
      );
    }
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
}
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: {
    createElement: (tag: string) => new Element(tag),
    createElementNS: (_namespace: string, tag: string) => new Element(tag),
    createDocumentFragment: () => new Element("fragment"),
  },
});
const flatten = (
  node: Element,
): Element[] => [node, ...node.children.flatMap(flatten)];
const contents = (root: Element) =>
  flatten(root).map((node) => node.textContent).filter(Boolean).join("\n");

test("compact report renders the checked totals, payments and all costs", () => {
  const trip = exampleTrip();
  const report = createPrintReport(trip) as unknown as Element;
  const text = contents(report);
  for (
    const expected of [
      trip.name,
      "Trip total $941.00",
      "Gets back $435.37",
      "$166.12",
      "$141.62",
      "$127.63",
      ...trip.expenses.map((expense) => expense.name),
    ]
  ) ok(text.includes(expected));
  const table = flatten(report).find((node) =>
    node.className.includes("report-costs")
  )!;
  equal(table.children[1].children.length, 5);
  ok(flatten(table).some((cell) => cell.scope === "col"));
  ok(flatten(table).some((cell) => cell.scope === "row"));
});

test("group report keeps individual shares, current names and literal user text", () => {
  const trip = exampleTrip();
  trip.groups = [{ id: "pair", members: ["crew-0", "crew-1"] }];
  trip.members[0].name = "Alexandra";
  trip.name = '<img src=x onerror="alert(1)">';
  const before = JSON.stringify(trip);
  const report = createPrintReport(trip) as unknown as Element;
  const text = contents(report);
  for (
    const expected of [
      trip.name,
      "Alexandra & Jamie",
      "$775.00",
      "$467.26",
      "Gets back $307.74",
      "Each shipmate’s share",
      "$211.13",
    ]
  ) ok(text.includes(expected));
  ok(!flatten(report).some((node) => node.tag === "img"));
  equal(JSON.stringify(trip), before);
});

test("detailed report renders every receipt item, exact extras and allocation totals", () => {
  const trip = exampleTrip();
  const receipt = {
    items: Array.from(
      { length: 100 },
      (_, index) => ({
        name: `Item ${index + 1}`,
        amount: 100,
        participants: ["crew-0", "crew-2"],
      }),
    ),
    tax: 100,
    tip: 200,
  };
  trip.expenses = [{
    ...trip.expenses[0],
    name: "Supper",
    category: "meals",
    paidBy: "crew-3",
    split: "itemized",
    amount: receiptTotal(receipt),
    participants: receiptParticipants(receipt),
    receipt,
  }];
  const text = contents(createPrintReport(trip, true) as unknown as Element);
  for (
    const expected of [
      "Trip total $103.00",
      "Supper",
      "Item 1",
      "Item 100",
      "Item subtotal",
      "$100.00",
      "Tax",
      "$1.00",
      "Tip",
      "$2.00",
      "$51.50",
    ]
  ) ok(text.includes(expected));
});

test("empty reports contain an explicit message", () => {
  const text = contents(createPrintReport(emptyTrip()) as unknown as Element);
  ok(text.includes("Your voyage"));
  ok(text.includes("Trip total $0.00"));
  ok(text.includes("Nothing to settle yet."));
});
