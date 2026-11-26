<!--
  The writer picker's list (board ao5; writers from initials, 2026-11-16):
  the firm's team members (people with a login), then Past writers (writers
  with no login: "DW" or "Dana Whitlock", each with a quiet "No login" tag),
  then 'Use "..."', which makes a writer with no login and that name (the
  server reuses one with exactly that name). Read only while a picker is
  open: mount it inside the popover. The list is ingestion.writerChoices
  (Admin only, bounded like the team roster).

  Only real names are offered (phase 3b fixes): a member whose roster label
  is only an email address or "Unknown team member" is left out by the
  server. A typed email address is refused in words (the server refuses it
  too, cleanWriterName).

  The Reviewer cell and bar (2026-11-17) use the same list with
  role="reviewer": a reviewer is one of the same people.
-->
<script lang="ts" module>
  import type { FunctionArgs } from "convex/server";
  import type { api as apiType } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";

  /** A writer a person can choose: a team member, a writer by id, or a typed name. */
  export type WriterChoice = NonNullable<FunctionArgs<typeof apiType.ingestion.matchWriterInitials>["writer"]>;

  /**
   * What the list gives back: the choice, its label, its option value,
   * whether it is the file's writer now, and whether its name came from a PD
   * (a past writer's; choosing it makes the name a person's, even when it is
   * the file's writer now).
   */
  export type PickedWriter = {
    choice: WriterChoice;
    label: string;
    value: string | null;
    current: boolean;
    nameFromDocument: boolean;
  };
</script>

<script lang="ts">
  import { useQuery } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import { looksLikeEmail, NO_LOGIN } from "../../../../shared/importSheetRules";
  import ImportNameList from "./ImportNameList.svelte";

  let {
    currentWriterId = null,
    currentValue = null,
    role = "writer",
    initials = null,
    onPick,
  }: {
    /** The file's writer now, checked in the list. */
    currentWriterId?: Id<"pdWriters"> | null;
    /** Or an option already picked (the selection bar), by its value. */
    currentValue?: string | null;
    /** Whom the list picks: the file's writer or its reviewer (2026-11-17); only the words differ. */
    role?: "writer" | "reviewer";
    /** When picking matches filename initials across the firm, display those initials clearly. */
    initials?: string | null;
    onPick: (picked: PickedWriter) => void;
  } = $props();

  const words = $derived(
    role === "reviewer"
      ? { label: "Reviewer", placeholder: "Find or type a reviewer", hint: "Type the reviewer's name.", email: "Type the reviewer's name, not an email address." }
      : { label: "Writer", placeholder: "Find or type a writer", hint: "Type the writer's name.", email: "Type the writer's name, not an email address." }
  );

  const initialsNote = $derived(
    initials ? `Pick a ${role} for ${initials} - applies to all ${initials} files.` : null
  );

  const choicesQ = useQuery(api.ingestion.writerChoices, () => ({}));

  /** One option; `writerIds`: the writers that are this option (a member's own and the past writer linked to them). */
  type Entry = {
    value: string;
    label: string;
    detail: string | null;
    group: string;
    choice: WriterChoice;
    writerIds: Id<"pdWriters">[];
    nameFromDocument: boolean;
  };

  const entries = $derived.by((): Entry[] => {
    const data = choicesQ.data;
    if (!data) return [];
    return [
      ...data.members.map((member) => ({
        value: `user:${member.userId}`,
        label: member.label,
        detail: null,
        group: "Team members",
        choice: { kind: "user" as const, userId: member.userId },
        writerIds: [member.writerId, member.linkedWriterId].filter((id): id is Id<"pdWriters"> => id !== null),
        nameFromDocument: false,
      })),
      ...data.pastWriters.map((writer) => ({
        value: `writer:${writer.writerId}`,
        label: writer.label,
        detail: NO_LOGIN,
        group: "Past writers",
        choice: { kind: "writer" as const, writerId: writer.writerId },
        writerIds: [writer.writerId],
        nameFromDocument: writer.nameFromDocument,
      })),
    ];
  });

  const current = $derived(
    currentValue ?? (currentWriterId ? (entries.find((entry) => entry.writerIds.includes(currentWriterId))?.value ?? null) : null)
  );

  function pick(value: string) {
    const entry = entries.find((option) => option.value === value);
    if (!entry) return;
    onPick({
      choice: entry.choice,
      label: entry.label,
      value: entry.value,
      current: entry.value === current,
      nameFromDocument: entry.nameFromDocument,
    });
  }
</script>

<ImportNameList
  label={words.label}
  placeholder={words.placeholder}
  options={entries}
  {current}
  loading={choicesQ.data === undefined && !choicesQ.error}
  hint={words.hint}
  note={initialsNote}
  newText={(typed) => `Use "${typed}"`}
  refuseTyped={(typed) => (looksLikeEmail(typed) ? words.email : null)}
  onPick={pick}
  onNew={(typed) =>
    onPick({ choice: { kind: "name", name: typed }, label: typed, value: null, current: false, nameFromDocument: false })}
/>
