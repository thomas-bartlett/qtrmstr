import {
  CATEGORIES,
  type Category,
  costLineCount,
  decimal,
  type Expense,
  hasControlCharacters,
  MAX_AMOUNT,
  MAX_COST_LINES,
  MAX_RECEIPT_ITEMS,
  money,
  parseAmount,
  parseExtra,
  parseTrip,
  type Receipt,
  type ReceiptItem,
  receiptParticipants,
  receiptTotal,
  sharesFor,
  type Trip,
  validDate,
} from "../lib/trip.ts";
import { CATEGORY_THEME } from "../lib/theme.ts";
import {
  avatar,
  byId,
  createShares,
  message,
  node,
  personLabel,
  renderPeople,
  selectedPeople,
} from "./views.ts";

// Owns unfinished form inputs. Only a validated submission reaches onSave.
export function createExpenseEditor(
  getTrip: () => Trip,
  onSave: (expenses: Expense[], addedId?: string) => void,
) {
  let editingId: string | null = null;
  const format = (amount: number) => money(amount, getTrip().currency);

  function choiceValue(name: string) {
    return document.querySelector<HTMLInputElement>(
      `input[name="${name}"]:checked`,
    )?.value ?? "";
  }
  function choose(name: string, value: string) {
    document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((
      input,
    ) => input.checked = input.value === value);
  }
  function expenseCategory(): Category {
    const value = choiceValue("category");
    return Object.hasOwn(CATEGORIES, value) ? value as Category : "other";
  }
  function categoryHint() {
    byId<HTMLInputElement>("expense-name").placeholder =
      CATEGORY_THEME[expenseCategory()].example;
  }

  // Retain the original participant order when a receipt is edited: it decides
  // who gets an extra penny when an amount does not divide evenly.
  const itemOrders = new WeakMap<HTMLElement, string[]>();
  const itemRows = () => [
    ...byId("receipt-items").querySelectorAll<HTMLFieldSetElement>(
      ".receipt-item",
    ),
  ];
  const itemInput = (row: HTMLElement, name: string) =>
    row.querySelector<HTMLInputElement>(`.receipt-item-${name}`)!;
  const itemized = () => byId<HTMLInputElement>("itemize-receipt").checked;

  function participantIds() {
    return selectedPeople(
      byId("participants"),
      getTrip().expenses.find((expense) => expense.id === editingId)?.participants,
    );
  }
  function selectPeople(container: HTMLElement, checked: boolean) {
    container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
      .forEach((input) => input.checked = checked);
    renderSplitPreview();
  }
  function populatePeople(selected?: string[]) {
    const trip = getTrip();
    const participants = byId("participants");
    const previous = selected ?? selectedPeople(participants);
    const wholeCrew = !editingId && selected === undefined &&
      previous.length === participants.children.length;
    const value = choiceValue("payer");
    const chosen = trip.members.some((member) => member.id === value)
      ? value
      : trip.members[0]?.id;
    byId("expense-payers").replaceChildren(...trip.members.map((member, index) => {
      const input = node("input");
      input.type = "radio";
      input.name = "payer";
      input.value = member.id;
      input.checked = member.id === chosen;
      input.required = true;
      return node(
        "label",
        "person-choice",
        input,
        avatar(member.name, index),
        personLabel(trip, member),
      );
    }));
    renderPeople(
      trip,
      participants,
      wholeCrew ? trip.members.map((member) => member.id) : previous,
    );
    for (const row of itemRows()) {
      const container = row.querySelector<HTMLElement>(".participants")!;
      renderPeople(trip, container, selectedPeople(container));
    }
  }
  function refreshPeople() {
    populatePeople();
    renderSplitPreview();
  }
  function refreshReceiptItems() {
    const rows = itemRows();
    rows.forEach((row, index) => {
      row.querySelector(".receipt-item-number")!.textContent = `Item ${
        index + 1
      }`;
      const remove = row.querySelector<HTMLButtonElement>(
        ".remove-receipt-item",
      )!;
      remove.disabled = rows.length === 1;
      remove.setAttribute("aria-label", `Remove item ${index + 1}`);
    });
    byId<HTMLButtonElement>("add-receipt-item").disabled =
      rows.length >= MAX_RECEIPT_ITEMS;
    renderSplitPreview();
  }
  // Populate rows first; callers refresh once after the complete receipt is ready.
  function addReceiptItem(item?: ReceiptItem) {
    const trip = getTrip();
    if (itemRows().length >= MAX_RECEIPT_ITEMS) return;
    const template = byId<HTMLTemplateElement>("receipt-item-template");
    const row = template.content.firstElementChild!.cloneNode(
      true,
    ) as HTMLFieldSetElement;
    const participants = item?.participants ??
      trip.members.map((member) => member.id);
    itemOrders.set(row, [...participants]);
    itemInput(row, "name").value = item?.name ?? "";
    itemInput(row, "amount").value = item ? decimal(item.amount) : "";
    const container = row.querySelector<HTMLElement>(".participants")!;
    renderPeople(trip, container, participants);
    row.querySelector(".item-everyone")!.addEventListener(
      "click",
      () => selectPeople(container, true),
    );
    row.querySelector(".item-clear")!.addEventListener(
      "click",
      () => selectPeople(container, false),
    );
    row.querySelector(".remove-receipt-item")!.addEventListener("click", () => {
      row.remove();
      refreshReceiptItems();
      byId("add-receipt-item").focus();
    });
    byId("receipt-items").append(row);
    return row;
  }
  function readReceipt(): Receipt | null {
    const tax = parseExtra(byId<HTMLInputElement>("receipt-tax").value);
    const tip = parseExtra(byId<HTMLInputElement>("receipt-tip").value);
    if (tax === null || tip === null) return null;
    const items: ReceiptItem[] = [];
    for (const row of itemRows()) {
      const amount = parseAmount(itemInput(row, "amount").value);
      const participants = selectedPeople(row, itemOrders.get(row));
      if (amount === null || !participants.length) return null;
      items.push({
        name: itemInput(row, "name").value.trim(),
        amount,
        participants,
      });
    }
    const receipt = { items, tax, tip };
    return items.length && receiptTotal(receipt) <= MAX_AMOUNT ? receipt : null;
  }
  function updateItemizeMode() {
    const enabled = itemized();
    const simple = byId<HTMLFieldSetElement>("simple-cost-fields");
    simple.hidden = enabled;
    simple.disabled = enabled;
    const receipt = byId<HTMLFieldSetElement>("receipt-fields");
    receipt.hidden = !enabled;
    receipt.disabled = !enabled;
    if (enabled && !itemRows().length) addReceiptItem();
    refreshReceiptItems();
  }
  function renderSplitPreview() {
    const trip = getTrip();
    const isReceipt = itemized();
    const receipt = isReceipt ? readReceipt() : undefined;
    const amount = isReceipt
      ? receipt ? receiptTotal(receipt) : null
      : parseAmount(byId<HTMLInputElement>("expense-amount").value);
    const participants = receipt ? receiptParticipants(receipt) : participantIds();
    byId("split-preview").hidden = amount === null;
    byId("split-total").textContent = amount === null ? "—" : format(amount);
    byId("split-shares").replaceChildren(
      ...(amount !== null && participants.length
        ? [...createShares(trip, sharesFor({
          amount,
          participants,
          receipt: receipt ?? undefined,
        })).children]
        : []),
    );
    message(
      "split-hint",
      amount !== null && !participants.length
        ? "Choose at least one shipmate to share this cost."
        : "",
    );
  }
  function resetExpense() {
    const trip = getTrip();
    byId<HTMLFormElement>("expense-form").reset();
    editingId = null;
    byId("receipt-items").replaceChildren();
    byId("expense-editing").hidden = true;
    byId<HTMLDetailsElement>("date-details").open = false;
    byId("save-expense").textContent = "+ Log this cost";
    byId("cancel-edit").hidden = true;
    message("expense-error", "");
    populatePeople(trip.members.map((member) => member.id));
    updateItemizeMode();
    categoryHint();
  }
  function editExpense(expense: Expense) {
    resetExpense();
    editingId = expense.id;
    byId<HTMLInputElement>("expense-name").value = expense.name;
    byId<HTMLInputElement>("expense-amount").value = decimal(expense.amount);
    choose("category", expense.category);
    byId<HTMLInputElement>("expense-date").value = expense.date;
    byId<HTMLInputElement>("itemize-receipt").checked = !!expense.receipt;
    populatePeople(expense.participants);
    choose("payer", expense.paidBy);
    if (expense.receipt) {
      byId<HTMLInputElement>("receipt-tax").value = decimal(expense.receipt.tax);
      byId<HTMLInputElement>("receipt-tip").value = decimal(expense.receipt.tip);
      for (const item of expense.receipt.items) addReceiptItem(item);
    }
    updateItemizeMode();
    categoryHint();
    byId<HTMLDetailsElement>("date-details").open = !!expense.date;
    byId("expense-editing").hidden = false;
    byId("save-expense").textContent = "Save changes";
    byId("cancel-edit").hidden = false;
    message("expense-error", "");
    byId<HTMLInputElement>("expense-name").focus();
    byId("expense-form").scrollIntoView({ block: "center", behavior: "instant" });
  }
  byId("expense-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const trip = getTrip();
    const name = byId<HTMLInputElement>("expense-name").value.trim();
    let receipt: Receipt | undefined;
    if (itemized()) {
      const value = readReceipt();
      if (!value) {
        message(
          "expense-error",
          "Give each item a positive amount and at least one shipmate. Tax and tip can be zero or blank. Use decimal amounts without commas; the receipt total must be at most 999,999,999.99.",
        );
        return;
      }
      if (
        value.items.some((item) =>
          !item.name || item.name.length > 100 || hasControlCharacters(item.name)
        )
      ) {
        message(
          "expense-error",
          "Give each receipt item a description of 1–100 characters.",
        );
        return;
      }
      receipt = value;
    }
    const amount = receipt
      ? receiptTotal(receipt)
      : parseAmount(byId<HTMLInputElement>("expense-amount").value);
    const participants = receipt
      ? receiptParticipants(receipt)
      : participantIds();
    const date = byId<HTMLInputElement>("expense-date").value;
    if (!name || name.length > 100 || hasControlCharacters(name)) {
      message("expense-error", "Give this cost a short description.");
      return;
    }
    if (amount === null) {
      message(
        "expense-error",
        "Enter a positive amount up to 999,999,999.99, using a decimal point and no commas (for example, 42.50).",
      );
      byId("expense-amount").focus();
      return;
    }
    if (!participants.length) {
      message(
        "expense-error",
        "Choose at least one shipmate to share the cost.",
      );
      return;
    }
    if (!validDate(date)) {
      message("expense-error", "Choose a valid date or leave it blank.");
      return;
    }
    const expense: Expense = {
      id: editingId ?? crypto.randomUUID(),
      name,
      amount,
      category: expenseCategory(),
      paidBy: choiceValue("payer"),
      split: receipt
        ? "itemized"
        : participants.length === 1
        ? "individual"
        : "even",
      participants,
      date,
      ...(receipt ? { receipt } : {}),
    };
    const expenses = editingId
      ? trip.expenses.map((other) => other.id === editingId ? expense : other)
      : [...trip.expenses, expense];
    if (costLineCount(expenses) > MAX_COST_LINES) {
      message(
        "expense-error",
        `This trip can hold up to ${MAX_COST_LINES} costs or receipt items in total.`,
      );
      return;
    }
    if (!parseTrip({ ...trip, expenses })) {
      message(
        "expense-error",
        "Check the payer, category, and selected shipmates before saving.",
      );
      return;
    }
    onSave(expenses, editingId ? undefined : expense.id);
    resetExpense();
    byId("expense-name").focus();
  });
  byId("expense-form").addEventListener("input", renderSplitPreview);
  byId("itemize-receipt").addEventListener("change", updateItemizeMode);
  byId("add-receipt-item").addEventListener("click", () => {
    const row = addReceiptItem();
    refreshReceiptItems();
    if (row) itemInput(row, "name").focus();
  });
  document.querySelectorAll('input[name="category"]').forEach((input) =>
    input.addEventListener("change", categoryHint)
  );
  byId("select-all").addEventListener(
    "click",
    () => selectPeople(byId("participants"), true),
  );
  byId("clear-participants").addEventListener(
    "click",
    () => selectPeople(byId("participants"), false),
  );
  byId("cancel-edit").addEventListener("click", resetExpense);

  return {
    edit: editExpense,
    reset: resetExpense,
    refreshPeople,
    refreshPreview: renderSplitPreview,
    get editingId() {
      return editingId;
    },
  };
}
