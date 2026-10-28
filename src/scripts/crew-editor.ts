import {
  crewName as tripCrewName,
  hasControlCharacters,
  MAX_MEMBERS,
  parseTrip,
  type Trip,
} from "../lib/trip.ts";
import {
  action,
  avatar,
  byId,
  message,
  node,
  renderPeople,
  selectedPeople,
} from "./views.ts";

type Crew = Pick<Trip, "members" | "groups">;

// The page owns trip data; this editor owns only the crew and group form state.
export function createCrewEditor(
  getTrip: () => Trip,
  onChange: (crew: Crew, notice?: string) => void,
) {
  let editingGroupId: string | null = null;

  function crewName(id: string) {
    return tripCrewName(getTrip(), id);
  }
  function memberGroup(id: string) {
    return getTrip().groups.find((group) => group.members.includes(id));
  }
  function commitCrewChange(crew: Crew, notice: string) {
    onChange(crew, notice);
    renderCrew();
  }

  function validMemberName(name: string, currentId?: string) {
    const trip = getTrip();
    if (!name || name.length > 40 || hasControlCharacters(name)) {
      return "Use a name between 1 and 40 characters.";
    }
    if (
      trip.members.some((member) =>
        member.id !== currentId &&
        member.name.toLowerCase() === name.toLowerCase()
      )
    ) {
      return "That name is already aboard. Add an initial to tell shipmates apart.";
    }
    return "";
  }

  function memberRemovalReason(id: string) {
    const trip = getTrip();
    if (trip.expenses.some((expense) =>
      expense.paidBy === id || expense.participants.includes(id)
    )) return "Update this entry’s costs before removing it.";
    if (memberGroup(id)) return "Remove this shipmate from their group first.";
    return "";
  }

  function renderCrew() {
    const trip = getTrip();
    const list = byId("crew-list");
    list.replaceChildren();
    trip.members.forEach((member, index) => {
      const badge = avatar(member.name, index);
      const input = node("input", "crew-name");
      input.value = member.name;
      input.maxLength = 40;
      input.setAttribute("aria-label", `Shipmate ${index + 1}’s name`);
      input.addEventListener("change", () => {
        const name = input.value.trim();
        const error = validMemberName(name, member.id);
        if (error) {
          message("member-error", error);
          input.value = member.name;
          return;
        }
        const trip = getTrip();
        member = { ...member, name };
        onChange({
          members: trip.members.map((other) =>
            other.id === member.id ? member : other
          ),
          groups: trip.groups,
        });
        input.value = name;
        message("member-error", "");
        badge.textContent = [...name][0]?.toUpperCase() ?? "?";
        remove.setAttribute("aria-label", `Remove ${name}`);
        if (!remove.disabled) remove.title = `Remove ${name}`;
        // Update labels in place so renaming does not interrupt keyboard focus.
        list.querySelectorAll<HTMLElement>("[data-group-id]").forEach((label) => {
          label.textContent = crewName(label.dataset.groupId!);
        });
        renderGroups();
      });
      const details = node("div", "crew-details", input);
      const group = memberGroup(member.id);
      if (group) {
        const label = node("small", "group-tag", crewName(group.id));
        label.dataset.groupId = group.id;
        details.append(label);
      }
      const remove = action("×", "remove-member", () => {
        if (memberRemovalReason(member.id)) return;
        const trip = getTrip();
        commitCrewChange({
          members: trip.members.filter((other) => other.id !== member.id),
          groups: trip.groups,
        }, `${member.name} left the crew.`);
        byId<HTMLInputElement>("member-name").focus();
      });
      const reason = memberRemovalReason(member.id);
      remove.setAttribute("aria-label", `Remove ${member.name}`);
      remove.disabled = !!reason;
      remove.title = reason || `Remove ${member.name}`;
      list.append(node("div", "crew-row", badge, details, remove));
    });
    byId("crew-empty").hidden = trip.members.length > 0;
    renderGroups();
  }

  function resetMemberForm() {
    byId<HTMLFormElement>("member-form").reset();
    message("member-error", "");
  }
  byId("member-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const trip = getTrip();
    const input = byId<HTMLInputElement>("member-name");
    const name = input.value.trim();
    const error = validMemberName(name);
    if (error || trip.members.length >= MAX_MEMBERS) {
      message(
        "member-error",
        error || `This voyage can have up to ${MAX_MEMBERS} shipmates.`,
      );
      return;
    }
    resetMemberForm();
    commitCrewChange({
      members: [...trip.members, { id: crypto.randomUUID(), name }],
      groups: trip.groups,
    }, `Aye, ${name} is aboard.`);
    input.focus();
  });

  function resetGroupForm() {
    editingGroupId = null;
    byId<HTMLFormElement>("group-form").reset();
    byId("save-group").textContent = "Create group";
    byId("cancel-group-edit").hidden = true;
    message("group-error", "");
  }
  function renderGroups(selected = selectedPeople(byId("group-people"))) {
    const trip = getTrip();
    byId("group-list").replaceChildren(...trip.groups.map((group) => {
      const name = crewName(group.id);
      const edit = action("Edit", "text-button", () => {
        resetGroupForm();
        editingGroupId = group.id;
        byId("save-group").textContent = "Save group";
        byId("cancel-group-edit").hidden = false;
        renderGroups(group.members);
        byId("group-people").querySelector<HTMLInputElement>("input")?.focus();
      });
      edit.setAttribute("aria-label", `Edit group ${name}`);
      const remove = action("Ungroup", "text-button", () => {
        const trip = getTrip();
        if (editingGroupId === group.id) resetGroupForm();
        commitCrewChange({
          members: trip.members,
          groups: trip.groups.filter((other) => other.id !== group.id),
        }, `${name} now settle separately. Individual costs are unchanged.`);
        byId("groups-section").querySelector("summary")!.focus();
      });
      remove.setAttribute("aria-label", `Ungroup ${name}`);
      return node(
        "div",
        "group-row",
        node("div", "crew-details", node("strong", "", name)),
        node("div", "group-actions", edit, remove),
      );
    }));
    const available = trip.members.filter((member) => {
      const group = memberGroup(member.id);
      return !group || group.id === editingGroupId;
    });
    renderPeople(trip, byId("group-people"), selected, available);
    byId("group-form").hidden = available.length < 2;
    byId("group-empty").hidden = available.length >= 2;
  }

  byId("cancel-group-edit").addEventListener("click", () => {
    resetGroupForm();
    renderGroups([]);
    byId("groups-section").querySelector("summary")!.focus();
  });
  byId("group-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const trip = getTrip();
    const group = {
      id: editingGroupId ?? crypto.randomUUID(),
      members: selectedPeople(byId("group-people")),
    };
    const groups = editingGroupId
      ? trip.groups.map((other) => other.id === editingGroupId ? group : other)
      : [...trip.groups, group];
    const next = parseTrip({ ...trip, groups });
    if (!next) {
      message(
        "group-error",
        "Choose at least two shipmates who aren’t in another group.",
      );
      return;
    }
    resetGroupForm();
    commitCrewChange(
      { members: trip.members, groups: next.groups },
      `${tripCrewName(next, group.id)} will settle together. Each person keeps their own share.`,
    );
    byId("groups-section").querySelector("summary")!.focus();
  });

  return {
    render: renderCrew,
    reset() {
      resetMemberForm();
      resetGroupForm();
      byId<HTMLDetailsElement>("groups-section").open = false;
      renderCrew();
    },
  };
}
