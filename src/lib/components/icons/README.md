# Icons from the round 2 boards

These icons are copied from the Paper round 2 boards (A1 to J9, page "Round 2, finalized"). They replace the Phosphor icons that the round 2 screens used as stand-ins. The geometry is exact. Colour comes from `currentColor`, so set it with a text colour class (`text-ink-muted`, `text-primary`).

```svelte
<script lang="ts">
  import { IconHome, IconClose } from "$lib/components/icons";
</script>

<IconHome class="text-ink-secondary" />
<IconClose size={18} strokeWidth={2} />
```

## Props

- `size`: width and height in px. The default is the size the boards use most for that icon.
- `strokeWidth`: in viewBox units. The default is the boards' most used value. Several icons use a different stroke in some places; the table lists each one.
- `class`, plus any svg attribute (`aria-label`, `role`, `data-*`). Rest props go on the `<svg>` last, so they override the defaults. Icons are decorative by default (`aria-hidden="true"`, `focusable="false"`). An icon-only button should label the button, not the icon.

## How to read the table

- **Default** is `size / strokeWidth` when you pass no props.
- **Seen** is the sizes and stroke widths used for that row. When it differs from the default, pass them. Where the cap or join differs from the component, it is shown in brackets (`butt/miter` means the board left linecap or linejoin unset).
- **Boards** lists every board where that exact drawing appears. A1 to A5 rail, B admin, C team, D view as, E new project, F step by step, G confirm dialogs, H tablet and phone, I settings, J sign in.
- Where two drawings rendered the same shape (a `<rect>` versus the same outline as a path, or one path versus two), they are one icon and the row says so.

## Icons

| Icon | Meaning | viewBox | Default | Seen (size / stroke) | Boards | Where and label |
| --- | --- | --- | --- | --- | --- | --- |
| `IconSidebar` | Sidebar toggle (collapse or expand the rail) | `0 0 24 24` | 16 / 1.5 | 16 / 1.5 | A1-A3, B1-B3, C1-C5, D1-D5, E1-E6, F1-F5, G1-G3, I1, I1b, I2-I5, J7 | Expanded rail header: collapse button beside the Banhall wordmark |
|  |  |  |  | 17 / 1.5 | A4, A5, H1, H3 | Collapsed rail (A4, A5) and tablet rail (H1, H3): expand button. Drawn there as one path with the same outline |
| `IconSearch` | Search | `0 0 24 24` | 17 / 1.5 | 17 / 1.5 | A4, A5, H1, H3 | Collapsed rail: Search tile under the expand button |
| `IconHome` | Home | `0 0 24 24` | 15 / 1.5 | 15, 17 / 1.5 | A1-A5, B1-B3, C1-C5, D1-D5, E1-E6, F1-F5, G1-G3, H1, H3, I1, I1b, I2-I5, J7 | Rail: Home row (15px expanded; 17px tile in collapsed/tablet rails A4, A5, H1, H3) |
|  |  |  |  | 15 / 1.8 | A1-A5, B1, B2, D1-D3, D5, J7 | Top bar page tile on Home (the icon in the tinted square before "Home") |
| `IconFolder` | Projects | `0 0 24 24` | 15 / 1.5 | 15, 17 / 1.5 | A1-A5, B1-B3, C1-C5, D1-D5, E1-E6, F1-F5, G1-G3, H1, H3, I1, I1b, I2-I5, J7 | Rail: Projects row (17px in collapsed/tablet rails) |
|  |  |  |  | 15 / 1.8 | E1-E6, F1, G1-G3 | Top bar page tile on "Projects / New project" |
| `IconBuilding` | Companies | `0 0 24 24` | 15 / 1.5 | 15, 17 / 1.5 | A1-A5, B1-B3, C1-C5, D1-D5, E1-E6, F1-F5, G1-G3, H1, H3, I1, I1b, I2-I5, J7 | Rail: Companies row (17px in collapsed/tablet rails) |
| `IconUsers` | Team | `0 0 24 24` | 15 / 1.5 | 15, 17 / 1.5 | A2, A3, A5, B1-B3, C1-C5, D1, D2, D5, I1, I1b, I2-I5 | Rail: Team row (A5 collapsed tile 17px); C4 pending-invite menu: Change role |
|  |  |  |  | 15 / 1.8 | C1-C5 | Top bar page tile on Team |
| `IconShield` | Admin | `0 0 24 24` | 15 / 1.5 | 15, 17 / 1.5 | A2, A3, A5, B1-B3, C1, C3-C5, D1, D2, D5, I1, I1b, I2-I5 | Rail: Admin row (A5 collapsed tile 17px) |
|  |  |  |  | 15 / 1.8 | B3, D4 | B3 top bar page tile "Admin /"; D4 hidden-page notice header |
| `IconShieldCheck` | QA reviews / trusted source | `0 0 24 24` | 15 / 1.5 | 15 / 1.5 | A5 | A5 Admin flyout: QA reviews |
|  |  |  |  | 15 / 1.6 | E3 | E3 document preview: note "We use this to check facts and match last year's claim" |
| `IconWarning` | Alerts (warning triangle) | `0 0 24 24` | 15 / 1.5 | 15, 17 / 1.5 | A3, A5, B1-B3, D1, D2, D5, I1, I1b, I2-I5 | Rail, Developer only: Alerts row (A5 collapsed tile 17px with count) |
| `IconLightbulb` | Feature requests | `0 0 24 24` | 15 / 1.5 | 15, 17 / 1.5 | A3, A5, B1-B3, D1, D2, D5, I1, I1b, I2-I5 | Rail, Developer only: Feature requests row (A5 collapsed tile 17px) |
| `IconMegaphone` | What's new | `0 0 24 24` | 15 / 1.5 | 15 / 1.5 | A1-A3, B1-B3, C1-C5, D1-D5, E1-E6, F1-F5, G1-G3, I1, I1b, I2-I5, J7 | Rail footer "Other": What's new row |
|  |  |  |  | 17 / 1.5 | A4, A5, H1, H3 | Collapsed/tablet rail What's new tile (one path, same outline) |
| `IconGear` | Settings | `0 0 24 24` | 15 / 1.5 | 15, 17 / 1.5 | A1-A5, B1-B3, C1-C5, D1-D5, E1-E6, F1-F5, G1-G3, H1, H3, I1, I1b, I2-I5, J7 | Rail footer "Other": Settings row (17px in collapsed/tablet rails) |
|  |  |  |  | 15 / 1.8 | I1, I1b, I2-I5 | Top bar page tile on Settings |
| `IconBell` | Notifications | `0 0 24 24` | 16 / 1.5 | 16 / 1.5 | A1-A5, B1-B3, C1-C5, D1-D5, E1-E6, F1-F5, G1-G3, I1, I1b, I2-I5, J7 | Top bar right: notifications button (next to New project / Invite / Add rule / Cancel) |
|  |  |  |  | 14 / 1.6 | F2, H3 | F2, H3 reading banner: "You can leave this page. We will let you know when the first..." |
| `IconUser` | Account (single person) | `0 0 24 24` | 15 / 1.5 | 15 / 1.5 | D1 | D1 your menu: Account |
| `IconLogout` | Sign out / revoke | `0 0 24 24` | 15 / 1.5 | 15 / 1.5 | C4, D1 | D1 your menu: Sign out; C4 pending-invite menu: Revoke invite (red) |
| `IconEye` | Preview / show / view as | `0 0 24 24` | 15 / 1.6 | 15, 16, 20 / 1.6 | D3, D4, E1-E6, F1, G1-G3, H1, H2, J1-J5, J8, J9 | E, F1, G, H1, H2 supporting document card: preview button (15px); J1-J5, J8, J9 password field: show password (16px); D3 "Now viewing as Consultant" toast (15px); D4 hidden-page notice tile (20px) |
|  |  |  |  | 14 / 1.7 | D3, D4 | D3, D4 "Viewing as" banner, before the role dropdown |
|  |  |  |  | 15 / 1.5 | D1 | D1 your menu: View as another role |
| `IconChevronDown` | Open a dropdown / expand | `0 0 24 24` | 14 / 1.8 | 14 / 1.8 | A2, A3, B1, C1, C3-C5, D1, D2, D5, E1-E6, F1, G1-G3, H1, H2, I1, I1b, I2-I5 | Rail footer role chip menu (Admin/Developer/Other chip); E, F1, G, H1, H2 form selects: Client, Science code, Industry, Model |
|  |  |  |  | 10 / 2.4 (round/miter) | E1-E6, F1, G1-G3, H1, H2 | E, F1, G, H1, H2 file card document-kind chip ("Previous-year PD", "Work plan", "Test results", "Transcript"). Drawn with no stroke-linejoin (miter): pass stroke-linejoin="miter" to match exactly |
|  |  |  |  | 11 / 2.2 (round/miter) | E1-E6, F1, G1-G3, H1, H2 | E, F1, G, H1, H2 Supporting documents "Add" button trailing chevron; E3 preview document-kind select. No stroke-linejoin (miter) on the board |
|  |  |  |  | 12 / 2 | D3, D4 | D3, D4 "Viewing as" banner: role dropdown |
| `IconChevronDownSmall` | Group expand chevron (12 grid) | `0 0 12 12` | 12 / 1.3 | 12 / 1.3 | A1-A5, B1, B2, D1-D3, D5, J7 | Home list group headers: "With you 3", "Recently opened 2" count chevron |
| `IconChevronUp` | Collapse a section | `0 0 24 24` | 14 / 1.8 | 14 / 1.8 | B2, B3 | B2, B3 rail: Admin group open, collapse chevron |
| `IconChevronRight` | Go / open submenu | `0 0 24 24` | 15 / 1.5 | 15 / 1.5 | A5 | A5 Admin flyout: Open Admin |
|  |  |  |  | 12 / 2 | C4 | C4 pending-invite menu: Change role submenu arrow |
| `IconArrowRight` | Continue / start | `0 0 24 24` | 14 / 1.8 | 14 / 1.8 | E1-E3, E5, E6, F1, G1, G2 | E, F1, G1, G2 "Start step by step" primary button |
| `IconArrowLeft` | Back / resend | `0 0 24 24` | 20 / 1.8 | 20 / 1.8 | H2, H4 | H2, H4 phone top bar: back button |
|  |  |  |  | 15 / 1.5 | C4 | C4 pending-invite menu: Resend invite |
| `IconPlus` | Add (24 grid) | `0 0 24 24` | 12 / 2 | 12 / 2 | E1-E6, F1, G1-G3, H1, H2 | E, F1, G, H1, H2 Supporting documents: "Add" button |
|  |  |  |  | 14 / 2 | J7 | J7 empty Home: "New project" button |
| `IconPlusSmall` | Add (12 grid) | `0 0 12 12` | 12 / 1.3 | 12 / 1.3 | A1-A5, B1, B2, D1-D3, D5 | Home list "Add new" row; Continue working card "Add a company document" |
|  |  |  |  | 12 / 1.5 | A1-A5, B1-B3, C1-C5, D1-D3, D5, J7 | Top bar primary button: New project (A, B1, B2, D, J7), Add rule (B3), Invite (C1-C5); white on primary |
| `IconMinus` | No access dash | `0 0 24 24` | 11 / 2.4 | 11 / 2.4 | D2 | D2 pick a role dialog: access table "no" cell |
| `IconClose` | Close / remove | `0 0 24 24` | 14 / 1.8 | 14 / 1.8 | C3, E1-E6, F1, G1-G3, H1, H2 | C3 invite email chip: remove; E, F1, G, H1, H2 transcript row and supporting document card: remove file; E5 error row |
|  |  |  |  | 18 / 2 | C3, C5, D2, E3, F1, G1-G3 | Dialog close button: C3 Invite people, C5 Revoke, D2 Pick a role, E3 preview, F1/G1-G3 confirm dialogs |
|  |  |  |  | 11 / 2.4 | I1, I1b | I1, I1b Account avatar: remove photo |
| `IconCheck` | Done / ticked | `0 0 24 24` | 11 / 3.2 | 9, 10, 11 / 3.2 | E4, F1, G1-G3, I2, J5, J9 | Checkbox ticks: E4, G3 "What should the review check?" (10px); F1, G1-G3 confirm-dialog file list, I2 house-rule checks (11px); J5, J9 password rule "At least 8 characters" (9px) |
|  |  |  |  | 14, 15 / 2 | C1, D5, E1-E3, E5, E6, F1, G1, G2, H1, I4, I5 | E, F1, G1, G2, H1 transcript row: read OK (14px); E3 preview "What we found" section list; C1 toast "Invite sent again", D5 toast "Back to Developer view", I4/I5 detected OS note (15px) |
|  |  |  |  | 13, 14 / 2.2 | C1, C3-C5, E1-E4, E6, F1, G1-G3 | C1, C3-C5 "Sent again" status; C4 role submenu: selected role (14px); E, G section header status ("14,820 words", "Ready to review"); E4, G3 line-count OK |
|  |  |  |  | 11, 12 / 2.4 | D2, H1, H2 | D2 access table ticks (11px); H1, H2 stepper done steps (12px) |
|  |  |  |  | 12 / 3 | E2 | E2 add menu: company document already added (inside a tinted circle) |
|  |  |  |  | 9 / 3.6 | F5 | F5 outline: done step (inside a filled dot) |
| `IconCheckCircle` | Checklist item done | `0 0 24 24` | 16 / 1.8 | 16 / 1.8 | E1-E3, E5, E6, F1, G1, G2 | "Before you start" checklist: Client and title, transcripts, Fiscal year and science code |
| `IconAlertCircle` | Error / problem | `0 0 24 24` | 16 / 1.8 | 16, 18 / 1.8 | E5, E6 | E5 "Before you start": failed row; E6 "Same name as an existing project" row (16px) and banner (18px) |
|  |  |  |  | 18 / 1.8 (round/miter) | F6 | F6 edge-state dialog header: run already going, reading the transcripts failed |
|  |  |  |  | 14 / 2 (round/miter) | J2, J4 | J2, J4 sign-in error line: wrong email or password |
|  |  |  |  | 13 / 2 | E5 | E5 Interview section status: "1 of 2 can be read" |
|  |  |  |  | 16 / 1.7 | E5 | E5 file error row: "FrostLine demo.mp4 is a video" |
| `IconInfo` | Hint (circle r=9) | `0 0 24 24` | 14 / 1.8 | 14 / 1.8 | F3-F5 | F3-F5 seed step hint: "Tick at least one seed to approve this step" |
| `IconInfoWide` | Info button (circle r=10) | `0 0 24 24` | 16 / 1.5 | 16 / 1.5 | F3-F5 | F3-F5 plan tab bar (Plan / Sources): info button at the right edge |
| `IconUpload` | Upload files | `0 0 24 24` | 16 / 1.6 | 16 / 1.6 | E1-E3, E6, F1, G1, G2 | E, F1, G1, G2 Interview dropzone: "Drop transcripts" |
|  |  |  |  | 15 / 1.5 | E2 | E2 add menu: Upload files |
| `IconCloudDownload` | OneDrive import | `0 0 24 24` | 15 / 1.5 | 15 / 1.5 | A5, E2 | A5 Admin flyout: OneDrive import; E2 add menu: From OneDrive |
| `IconBook` | Notes / house rules / written text | `0 0 24 24` | 15 / 1.5 | 15 / 1.5 | A5, C4, E2 | A5 Admin flyout: House rules; E2 add menu: Paste text or notes and each company document (Scoping notes, Interview transcript, FY 2025 report); C4 pending-invite menu: Copy invite link |
| `IconDocument` | Report page (24 grid) | `0 0 24 24` | 15 / 1.8 | 15 / 1.8 | F2-F5 | F2-F5 top bar page tile on "Projects / Adaptive cold storage controls" |
| `IconDocumentSmall` | Company document (14 grid) | `0 0 14 14` | 14 / 1.2 | 14 / 1.2 | A1-A5, B1, B2, D1-D3, D5 | Home "Cedarline Systems documents" card: each document row |
| `IconTable` | Table / list view (14 grid) | `0 0 14 14` | 14 / 1.3 | 14 / 1.3 | A1-A5, B1, B2, D1-D3, D5, J7 | Home list group header: "With you" |
| `IconClock` | Pending / still reading (24 grid) | `0 0 24 24` | 16 / 1.8 | 16 / 1.8 | E1-E3, E5, E6, F1, G1, G2 | "Before you start" checklist: "3 supporting documents, 1 still reading" |
| `IconClockSmall` | Recent (14 grid) | `0 0 14 14` | 14 / 1.3 | 14 / 1.3 | A1-A5, B1, B2, D1-D3, D5 | Home list group header: "Recently opened" |
| `IconCalendar` | Fiscal year date | `0 0 24 24` | 15 / 1.5 | 15 / 1.5 | E1-E6, F1, G1-G3, H1, H2 | E, F1, G, H1, H2 Fiscal year field: leading icon |
| `IconMore` | More actions (horizontal dots) | `0 0 24 24` | 16 / 3 | 16, 18 / 3 | C1, C3-C5, H4 | C1, C3-C5 pending invite row: more menu (16px); H4 phone top bar: more (18px) |
| `IconPencil` | Edit | `0 0 24 24` | 14 / 1.7 | 14 / 1.7 | F4 | F4 seed card footer: edit |
| `IconComment` | Comment | `0 0 24 24` | 14 / 1.7 | 14 / 1.7 | F4 | F4 seed card footer: comment |
| `IconRegenerate` | Regenerate | `0 0 24 24` | 14 / 1.8 | 14 / 1.8 | F3-F5 | F3-F5 section header: Regenerate button |
| `IconLock` | Locked setting | `0 0 24 24` | 11 / 2.2 | 11 / 2.2 | I2 | I2 writing preferences: "Set by your organization" lock |
|  |  |  |  | 10 / 2.6 (round/round) | G3 | G3 confirm dialog: draft file is always reviewed (locked checkbox) |
| `IconTag` | Project tags | `0 0 24 24` | 15 / 1.5 | 15 / 1.5 | A5 | A5 Admin flyout: Project tags |
| `IconBrain` | The Brain | `0 0 24 24` | 15 / 1.5 | 15 / 1.5 | A5 | A5 Admin flyout: The Brain |
| `IconSliders` | Models | `0 0 24 24` | 15 / 1.5 | 15 / 1.5 | A5 | A5 Admin flyout: Models |
| `IconBarChart` | Learning health | `0 0 24 24` | 15 / 1.5 | 15 / 1.5 | A5 | A5 Admin flyout: Learning health |
| `IconDollarCircle` | AI usage and cost | `0 0 24 24` | 15 / 1.5 | 15 / 1.5 | A5 | A5 Admin flyout: AI usage and cost |

## Not in this set

- File-type icons (DOCX, PDF, TXT, XLSX, 72 x 96 viewBox): use `ui/FileIcon`.
- The AI sparkle mark (99.38 viewBox, white on the conic-gradient chip beside the model name and in "ideas are ready" toasts): use `ui/ChatIcon` or `ui/AuroraMark`.
- The Outline progress ring in F3 to F5 ("0 of 13"): it shows a value, so build it where it is used.
- Logos, avatars and initials tiles are not SVGs on these boards.
