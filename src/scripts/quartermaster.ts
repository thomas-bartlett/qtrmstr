import {
  type Balance,
  balanceText,
  calculate,
  crewName as tripCrewName,
  CURRENCIES,
  type Currency,
  emptyTrip,
  exampleTrip,
  type Expense,
  hasControlCharacters,
  money,
  type Transfer,
  type Trip,
} from "../lib/trip.ts";
import { exportCsv } from "../lib/csv.ts";
import { createDraftStore, type DraftIssue, STORAGE_KEY } from "../lib/draft.ts";
import { importCsv, MAX_CSV_BYTES } from "../lib/import-csv.ts";
import { createCrewEditor } from "./crew-editor.ts";
import { createExpenseEditor } from "./expense-editor.ts";
import {
  action,
  avatar,
  byId,
  createCostCard,
  createCostDetails,
  createPrintReport,
  message,
  node,
  personLabel,
} from "./views.ts";

const draft = createDraftStore(() => localStorage);
const initialDraft = draft.load();
let trip: Trip = initialDraft.trip;
let toastTimer = 0;
const expenseEditor = createExpenseEditor(() => trip, (expenses, addedId) => {
  trip.expenses = expenses;
  commitTrip(addedId);
  toast(addedId ? "Logged, captain." : "Cost updated. Shares recalculated.");
});

const crewEditor = createCrewEditor(() => trip, (crew, notice) => {
  trip.members = crew.members;
  trip.groups = crew.groups;
  commitTrip();
  expenseEditor.refreshPeople();
  if (notice) toast(notice);
});

function showStorageIssue(issue: DraftIssue | null) {
  const descriptions = {
    unavailable:
      "This browser couldn’t save your draft. You can keep working; export before closing the page.",
    unreadable:
      "The saved draft couldn’t be read and has been kept intact. This trip won’t replace it unless you choose Reset trip. Export anything you enter here.",
    conflict:
      "Another tab changed the saved trip. Your changes here won’t overwrite it. Export this version or reload the saved trip.",
    invalid:
      "This draft couldn’t be saved. The previous saved version has been kept. Check the trip details and export before closing.",
  };
  byId("storage-notice").hidden = !issue;
  byId("storage-message").textContent = issue ? descriptions[issue] : "";
  byId("reload-draft").hidden = issue !== "conflict";
  byId("save-status").textContent = issue
    ? "Draft not saved"
    : "Saved in this browser";
}
function save() {
  showStorageIssue(draft.save(trip));
}
function toast(content: string) {
  window.clearTimeout(toastTimer);
  message("toast", content);
  toastTimer = window.setTimeout(() => message("toast", ""), 4500);
}
function confirmAction(
  title: string,
  description: string,
  accept: string,
  handler: () => void,
) {
  const dialog = byId<HTMLDialogElement>("confirm-dialog");
  byId("confirm-title").textContent = title;
  byId("confirm-message").textContent = description;
  byId("confirm-accept").textContent = accept;
  byId("confirm-cancel").textContent = "Cancel";
  byId("confirm-accept").onclick = () => {
    dialog.close();
    handler();
  };
  dialog.showModal();
}
byId("confirm-cancel").addEventListener(
  "click",
  () => byId<HTMLDialogElement>("confirm-dialog").close(),
);
byId("reload-draft").addEventListener("click", () => {
  confirmAction(
    "Reload the saved trip?",
    "Changes in this tab will be lost. Export this version first if you want to keep it.",
    "Reload trip",
    () => location.reload(),
  );
});

function crewName(id: string) {
  return tripCrewName(trip, id);
}
function format(amount: number) {
  return money(amount, trip.currency);
}
function renderSummary() {
  const total = trip.expenses.reduce((sum, expense) => sum + expense.amount, 0);
  byId("summary-total").textContent = format(total);
  byId("summary-currency").textContent = trip.currency;
  byId("trip-tally").hidden = trip.expenses.length === 0;
  byId("crew-count").textContent = String(trip.members.length);
  byId("expense-count").textContent = String(trip.expenses.length);
  byId("amount-currency").textContent = trip.currency;
  byId<HTMLSelectElement>("currency").disabled = trip.expenses.length > 0;
  byId("currency-hint").textContent = trip.expenses.length > 0
    ? "Currency is fixed while the trip has expenses."
    : "Convert foreign costs to your trip’s currency first.";
}

function costCard(expense: Expense) {
  const card = createCostCard(trip, expense);
  const detail = node(
    "details",
    "cost-detail",
    node(
      "summary",
      "",
      expense.receipt
        ? `${expense.receipt.items.length} items · see receipt & shares`
        : expense.participants.length === 1
        ? `All for ${crewName(expense.participants[0])}`
        : `Split ${expense.participants.length} ways · see shares`,
    ),
  );
  // Build detailed shares only when opened; a large trip stays light to render.
  detail.addEventListener("toggle", () => {
    if (detail.open && detail.childElementCount === 1) {
      detail.append(createCostDetails(trip, expense));
    }
  });
  const edit = action("Edit", "text-button", () => expenseEditor.edit(expense));
  edit.setAttribute("aria-label", `Edit ${expense.name}`);
  const remove = action(
    "Delete",
    "text-button text-danger",
    () =>
      confirmAction(
        "Strike this cost from the tab?",
        `“${expense.name}” (${
          format(expense.amount)
        }) will be removed and everyone’s share recalculated.`,
        "Delete cost",
        () => {
          trip.expenses = trip.expenses.filter((other) =>
            other.id !== expense.id
          );
          commitTrip();
          if (expenseEditor.editingId === expense.id) expenseEditor.reset();
          byId("expense-name").focus();
          toast("Cost removed. Shares updated.");
        },
      ),
  );
  remove.setAttribute("aria-label", `Delete ${expense.name}`);
  card.append(detail, node("div", "expense-actions", edit, remove));
  return card;
}
function renderLedger(highlightId?: string) {
  byId("expense-list").replaceChildren(
    ...[...trip.expenses].reverse().map((expense) => {
      const card = costCard(expense);
      if (expense.id === highlightId) card.classList.add("fresh-entry");
      return card;
    }),
  );
  byId("expenses-empty").hidden = trip.expenses.length > 0;
}
function transferCard(transfer: Transfer, index: number) {
  return node(
    "div",
    "transfer-row",
    node(
      "div",
      "transfer-instruction",
      node("span", "transfer-index", String(index + 1).padStart(2, "0")),
      node(
        "p",
        "",
        node("strong", "", crewName(transfer.from)),
        node("span", "", " pays "),
        node("strong", "", crewName(transfer.to)),
      ),
    ),
    node("strong", "transfer-amount", format(transfer.amount)),
  );
}
function balanceCard(member: Balance, index: number) {
  return node(
    "article",
    "balance-card",
    node(
      "div",
      "balance-name",
      avatar(member.name, index),
      node("h3", "", personLabel(trip, member)),
    ),
    node(
      "p",
      `balance-net ${member.net < 0 ? "negative" : "positive"}`,
      balanceText(member.net, trip.currency),
    ),
    node(
      "dl",
      "balance-amounts",
      ...([["Paid", member.paid], ["Share", member.share]] as const).map((
        [label, amount],
      ) =>
        node("div", "", node("dt", "", label), node("dd", "", format(amount)))
      ),
    ),
    ...(trip.groups.some((group) => group.id === member.id)
      ? [node("p", "field-hint", "Settles together")]
      : []),
  );
}
function renderResults(
  { balances, settlementBalances, transfers }: ReturnType<typeof calculate>,
) {
  byId("transfers").replaceChildren(
    ...(transfers.length ? transfers.map(transferCard) : [node(
      "p",
      "all-square",
      trip.expenses.length
        ? "All square, shipmates."
        : "Nothing to settle yet.",
    )]),
  );
  byId("settlement-description").textContent = transfers.length
    ? `${transfers.length} payment${
      transfers.length === 1 ? "" : "s"
    } and the crew is square.`
    : trip.expenses.length
    ? "No payments needed."
    : "Log a cost to see who pays whom.";
  byId("balance-cards").replaceChildren(...settlementBalances.map(balanceCard));
  byId("group-settlement-note").hidden = !trip.groups.length;
  byId("individual-balances").hidden = !trip.groups.length;
  byId("member-balance-cards").replaceChildren(
    ...(trip.groups.length ? balances.map(balanceCard) : []),
  );
  byId<HTMLButtonElement>("export-pdf").disabled = !trip.expenses.length;
}
const headings = ["All aboard", "Ship’s tab", "Settle up"];
function updateExampleVisibility() {
  byId("example-trip").hidden = byId("step-0").hidden ||
    !!(trip.name || trip.members.length || trip.expenses.length);
}
function goToStep(next: number, focus = true) {
  if (next > 0) {
    if (!trip.name.trim()) {
      message("notice", "Name your voyage before setting sail.");
      goToStep(0, false);
      byId<HTMLInputElement>("trip-name").focus();
      return;
    }
    if (trip.members.length < 2) {
      message(
        "notice",
        "Bring at least two shipmates aboard to continue.",
      );
      goToStep(0, false);
      byId<HTMLInputElement>("member-name").focus();
      return;
    }
  }
  if (next === 0) crewEditor.render();
  for (let index = 0; index < 3; index++) {
    byId(`step-${index}`).hidden = index !== next;
  }
  document.querySelectorAll<HTMLButtonElement>(".step-link")
    .forEach(
      (button) => {
        const active = Number(button.dataset.step) === next;
        button.classList.toggle("active", active);
        if (active) button.setAttribute("aria-current", "step");
        else button.removeAttribute("aria-current");
      },
    );
  byId("page-title").textContent = headings[next];
  renderTrip();
  if (focus) {
    message("notice", "");
    byId("page-title").focus({ preventScroll: true });
    globalThis.scrollTo({ top: 0, behavior: "instant" });
  }
}
function renderTrip(highlightId?: string) {
  renderSummary();
  // Read-only steps refresh on entry; unfinished editor inputs stay intact.
  if (!byId("step-1").hidden) renderLedger(highlightId);
  if (!byId("step-2").hidden) renderResults(calculate(trip));
  updateExampleVisibility();
  byId("print-content").replaceChildren();
}
function commitTrip(highlightId?: string) {
  save();
  renderTrip(highlightId);
}
function resetView() {
  // A replacement trip must not inherit unfinished inputs or old report text.
  crewEditor.reset();
  for (const id of [
    "expense-list", "transfers", "balance-cards", "member-balance-cards",
  ]) {
    byId(id).replaceChildren();
  }
  byId<HTMLDetailsElement>("crew-balances").open = false;
  byId<HTMLDetailsElement>("individual-balances").open = false;
  byId<HTMLInputElement>("pdf-details").checked = false;
  importRequest++;
  pendingImport = null;
  message("import-error", "");
  byId<HTMLInputElement>("trip-name").value = trip.name;
  byId<HTMLSelectElement>("currency").value = trip.currency;
  expenseEditor.reset();
}

document.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((button) =>
  button.addEventListener("click", () => goToStep(Number(button.dataset.step)))
);
byId("trip-name").addEventListener("input", () => {
  const value = byId<HTMLInputElement>("trip-name").value.trim();
  if (hasControlCharacters(value) || value.length > 80) {
    message(
      "notice",
      "Use a trip name of up to 80 characters, without control characters.",
    );
    return;
  }
  trip.name = value;
  updateExampleVisibility();
  message("notice", "");
  save();
});
byId("currency").addEventListener("change", () => {
  if (trip.expenses.length) return;
  const code = byId<HTMLSelectElement>("currency").value;
  if (Object.hasOwn(CURRENCIES, code)) trip.currency = code as Currency;
  commitTrip();
  expenseEditor.refreshPreview();
});
function replaceTrip(next: Trip, destination: number) {
  trip = next;
  message("notice", "");
  save();
  resetView();
  goToStep(destination);
}
byId("example-trip").addEventListener("click", () => {
  const load = () => {
    replaceTrip(exampleTrip(), 1);
    toast("Example voyage loaded. All yours to edit.");
  };
  if (trip.name || trip.members.length || trip.expenses.length) {
    confirmAction(
      "Try the example voyage?",
      "This replaces the trip you’re working on. Export it first if you want to keep a copy.",
      "Load example",
      load,
    );
  } else load();
});
byId("reset-trip").addEventListener("click", () => {
  confirmAction(
    "Reset this trip?",
    "This clears the trip, crew, and expenses. Download your PDF or CSV first if you want to keep a copy.",
    "Reset trip",
    () => {
      const issue = draft.reset();
      showStorageIssue(issue);
      if (issue) return;
      trip = emptyTrip();
      message("notice", "");
      resetView();
      goToStep(0);
      byId("trip-name").focus();
      toast("Trip reset, captain.");
    },
  );
});

byId("export-csv").addEventListener("click", () => {
  const blob = new Blob([exportCsv(trip)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = node("a");
  link.href = url;
  link.download = `${
    trip.name.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(
      0,
      70,
    ) || "quartermaster"
  }-ledger.csv`;
  byId("trip-ledger").append(link);
  link.click();
  link.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("CSV ready to share or import back into Quartermaster.");
});

function renderPrintReport() {
  const flag = document.querySelector(".jolly-roger")?.cloneNode(true);
  const report = createPrintReport(
    trip,
    byId<HTMLInputElement>("pdf-details").checked,
    flag,
  );
  byId("print-content").replaceChildren(report);
}
globalThis.addEventListener("beforeprint", renderPrintReport);
byId("export-pdf").addEventListener("click", () => {
  if (!trip.expenses.length) return;
  // Have the complete report in the DOM before the browser takes its print
  // snapshot. beforeprint also supports the browser's normal print shortcut.
  renderPrintReport();
  globalThis.print();
});
let pendingImport: Trip | null = null;
let importRequest = 0;
const importDialog = byId<HTMLDialogElement>("import-dialog");
byId("import-csv").addEventListener("change", async () => {
  const input = byId<HTMLInputElement>("import-csv");
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const request = ++importRequest;
  message("import-error", "");
  if (file.size > MAX_CSV_BYTES) {
    message("import-error", "Choose a CSV no larger than 8 MB.");
    return;
  }
  try {
    const source = await file.text();
    if (request !== importRequest) return;
    const parsed = importCsv(source);
    if (parsed.error !== null) {
      message("import-error", parsed.error);
      return;
    }
    pendingImport = parsed.trip;
    const candidate = parsed.trip;
    const total = money(calculate(candidate).total, candidate.currency);
    const groups = candidate.groups.length
      ? ` · ${candidate.groups.length} settlement group${
        candidate.groups.length === 1 ? "" : "s"
      }`
      : "";
    byId("import-summary").textContent =
      `${candidate.name} · ${candidate.currency} · ${candidate.members.length} shipmates${groups} · ${candidate.expenses.length} costs · ${total} total`;
    byId("import-preview").replaceChildren(
      ...candidate.expenses.slice(0, 5).map((expense) =>
        node(
          "li",
          "",
          `${expense.name} — ${
            money(expense.amount, candidate.currency)
          } · paid by ${tripCrewName(candidate, expense.paidBy)}`,
        )
      ),
    );
    if (candidate.expenses.length > 5) {
      byId("import-preview").append(
        node(
          "li",
          "field-hint",
          `And ${
            candidate.expenses.length - 5
          } more costs. All rows have been checked.`,
        ),
      );
    }
    importDialog.showModal();
  } catch {
    if (request !== importRequest) return;
    message(
      "import-error",
      "That file couldn’t be read. Choose a UTF-8 Quartermaster CSV.",
    );
  }
});
byId("import-cancel").addEventListener("click", () => importDialog.close());
importDialog.addEventListener("close", () => {
  pendingImport = null;
  byId("import-preview").replaceChildren();
  byId("import-summary").textContent = "";
});
byId("import-accept").addEventListener("click", () => {
  const candidate = pendingImport;
  if (!candidate) return;
  importDialog.close();
  replaceTrip(candidate, 1);
  toast("CSV checked. Your voyage is aboard.");
});
globalThis.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY || event.key === null) {
    showStorageIssue(draft.check());
  }
});
resetView();
goToStep(0, false);
if (initialDraft.issue) showStorageIssue(initialDraft.issue);
