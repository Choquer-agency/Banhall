/**
 * The page frame captures (owner, 2026-10-28; Paper S9, S11, S12, A1): the
 * Projects page, All companies, a company's page, Team, Admin, Settings and
 * a project page at 1440 by 900,
 * rendered with the real stylesheet and written to the ignored
 * `.vitest-attachments/frame/` for review against the boards. Each capture
 * also pins the frame it shows: the 52px global bar, the 80px rail, the one
 * white card and its section sidebar.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { createRawSnippet } from "svelte";
import WorkspaceDashboard from "./WorkspaceDashboard.svelte";
import TeamPage from "$lib/components/team/TeamPage.svelte";
import CompaniesPage from "$lib/components/companies/CompaniesPage.svelte";
import AdminWorkspacePage from "$lib/components/admin/AdminWorkspacePage.svelte";
import SettingsLayout from "../../../routes/settings/+layout.svelte";
import PreviewProjectPage from "$lib/components/project/PreviewProjectPage.svelte";
import { captureOwner } from "$lib/test/captureOwner";
import { __resetPage, __setPageParams, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import {
  __resetConvexStub,
  __setPaginatedRows,
  __setQueryData,
  __setQueryDataForArgs,
} from "$lib/test/convex-svelte-stub.svelte";
import { __resetQaSeenMemory } from "$lib/qa/qaSeen";
import { viewAs } from "$lib/shell/viewAs.svelte";
import { reloadSectionSidebar } from "$lib/workspace/sectionSidebar.svelte";
import { board } from "$lib/test/boardScale";

vi.mock("$lib/authClient", () => ({
  authClient: {
    signOut: vi.fn(async () => {}),
    listSessions: vi.fn(async () => ({ data: [], error: null })),
    getSession: vi.fn(async () => ({ data: null, error: null })),
  },
}));

const captures = captureOwner("frame");
/** `.vitest-attachments/frame/<name>.png` at the repository root. */
async function framePath(name: string) {
  const directory = (await captures.reservation()).directory;
  const root = directory.slice(0, directory.indexOf("/.vitest-attachments/"));
  return `${root}/.vitest-attachments/frame/${name}.png`;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 500));

/**
 * The component server does not serve SvelteKit's static/ folder, so the
 * capture inlines the real logo file the global bar points at.
 */
async function showLogo() {
  const base64 = await commands.readFile("static/banhall-logo-dark.png", "base64");
  const logo = document.querySelector<HTMLImageElement>("[data-global-bar-logo] img")!;
  expect(logo.getAttribute("src")).toBe("/banhall-logo-dark.png");
  logo.src = `data:image/png;base64,${base64}`;
  await expect.poll(() => logo.complete && logo.naturalWidth > 0).toBe(true);
}

async function capture(name: string) {
  await showLogo();
  await settle();
  await page.screenshot({ path: await framePath(name) });
}

const BRYCE = { _id: "u-bryce", firstName: "Bryce", lastName: "Choquer", email: "bryce@banhall.com", role: "admin", isOwner: true, imageUrl: null };
const COMPANIES: [string, number][] = [
  ["Alder Research", 3],
  ["Birchwood Foods", 5],
  ["Cedarline Systems", 10],
  ["Delta Hydraulics", 4],
  ["Evergreen Biotech", 2],
  ["Fjord Marine", 4],
  ["Granite Robotics", 6],
  ["Harbourline Software", 1],
  ["Ironwood Labs", 3],
  ["Juniper Aerospace", 5],
];

function seedFrame() {
  __setQueryData("users:getCurrentUser", BRYCE);
  __setQueryData("myWork:getViewConfig", { killSwitch: false, ready: true });
  __setQueryData("workspaceRollout:getAccess", { available: true });
  __setQueryData("changelog:unseenCount", 0);
  __setQueryData("errorReports:openCount", 0);
  __setQueryData("adminAttention:getAttention", { total: 0, ingestionFailed: 0 });
  __setQueryData("notifications:listRecent", []);
  __setQueryData("dashboard:getFacets", { total: 42, truncated: false, stageCounts: { drafting: 42 } });
  __setQueryData("clients:listClients", {
    clients: COMPANIES.map(([name, projectCount]) => ({ key: name.toLowerCase(), clientId: null, name, projectCount })),
    truncated: false,
  });
}

function projectRow(id: string, title: string, stage: string, fiscalYear: number, updatedAt: number) {
  return {
    _id: id,
    title,
    clientName: "Cedarline Systems",
    workflowStage: stage,
    status: "draft",
    ownerId: "u-jordan",
    ownerLabel: "Jordan Ellis",
    createdBy: "u-jordan",
    fiscalYear,
    fiscalYearEnd: Date.UTC(fiscalYear, 8, 30),
    createdAt: updatedAt - 90 * 86_400_000,
    updatedAt,
    generationActivity: null,
  };
}

const card = () => document.querySelector<HTMLElement>("[data-frame-card]")!;
const box = (element: Element | null) => element!.getBoundingClientRect();

/** The frame every desktop screen shares (S9): bar, rail, card. */
function expectFrame() {
  const bar = box(document.querySelector("[data-global-bar]"));
  const rail = box(document.querySelector("[data-frame-rail]"));
  const frame = box(card());
  expect(bar.height).toBeCloseTo(board(52), 0);
  expect(rail.width).toBeCloseTo(board(80), 0);
  expect(frame.left - rail.right).toBeCloseTo(board(4), 0);
  expect(frame.top).toBeCloseTo(bar.bottom, 0);
  expect(window.innerWidth - frame.right).toBeCloseTo(board(8), 0);
  expect(window.innerHeight - frame.bottom).toBeCloseTo(board(8), 0);
  expect(getComputedStyle(document.querySelector("[data-workspace-chrome], [data-workspace-shell]")!).backgroundColor).toBe("rgb(242, 242, 242)");
}

describe("page frame captures (1440 by 900)", () => {
  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    reloadSectionSidebar();
    viewAs.clear();
    __resetAuthState();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    __resetQaSeenMemory();
    document.body.innerHTML = "";
    await page.viewport(1440, 900);
  });

  it("Projects with Cedarline Systems selected (S9)", async () => {
    seedFrame();
    const now = Date.UTC(2026, 9, 14);
    __setPaginatedRows("dashboard:listCompanyProjects", [
      projectRow("p8", "Adaptive cold storage controls", "drafting", 2026, now),
      projectRow("p9", "High-efficiency pump control", "client_review", 2026, now - 2 * 86_400_000),
      projectRow("p10", "Defrost cycle prediction", "internal_review", 2026, now - 3 * 86_400_000),
      projectRow("p7", "Variable-speed compressor tuning", "delivered", 2025, now - 200 * 86_400_000),
      projectRow("p6", "Ammonia leak detection model", "delivered", 2025, now - 200 * 86_400_000),
      projectRow("p5", "Low-temperature seal testing", "delivered", 2025, now - 230 * 86_400_000),
    ]);
    __setPaginatedRows("dashboard:listFlatProjects", []);
    __setPageUrl("/projects?client=cedarline%20systems");
    await render(WorkspaceDashboard, { view: "all_projects" });
    await expect.poll(() => document.querySelector('[data-client-row="cedarline systems"]')?.getAttribute("aria-current")).toBe("page");
    await expect.poll(() => document.querySelector("[data-client-title]")?.textContent).toBe("Cedarline Systems");
    expectFrame();
    expect(box(document.querySelector('[data-section-sidebar-slot="projects"]')).width).toBeCloseTo(board(228), 0);
    await capture("projects");
  });

  it("All companies (the Companies section, 2026-10-28; laid out as S11)", async () => {
    seedFrame();
    const now = Date.UTC(2026, 9, 14, 15);
    __setQueryData("clients:listClients", {
      clients: COMPANIES.map(([name, projectCount], index) => ({
        key: name.toLowerCase(),
        clientId: null,
        name,
        projectCount,
        ...(index % 3 === 2 ? {} : { fiscalYearEndMonth: index % 2 ? 3 : 9, fiscalYearEndDay: index % 2 ? 31 : 30 }),
        updatedAt: now - index * 3 * 86_400_000,
      })),
      truncated: false,
    });
    __setPageUrl("/companies");
    await render(CompaniesPage, { companyKey: null });
    await expect.poll(() => document.querySelectorAll("[data-company-row]").length).toBe(COMPANIES.length);
    expectFrame();
    expect(box(document.querySelector('[data-section-sidebar-slot="companies"]')).width).toBeCloseTo(board(228), 0);
    expect(document.querySelector('[data-companies-sidebar="all"]')?.getAttribute("aria-current")).toBe("page");
    expect(document.querySelector("[data-page-count]")?.textContent).toBe("10 companies");
    await capture("companies");
  });

  it("A company's page (Z8a's content in the frame)", async () => {
    seedFrame();
    const now = Date.UTC(2026, 9, 14);
    __setQueryDataForArgs("clients:getCompanyPage", { key: "cedarline systems" }, {
      kind: "company",
      key: "cedarline systems",
      clientId: "c3",
      name: "Cedarline Systems",
      projectCount: 10,
      fiscalYearEndMonth: 9,
      fiscalYearEndDay: 30,
      industry: "manufacturing",
      mergedNote: null,
      // 2026-11-04 (the company profile).
      website: "https://cedarline.ca",
      websiteRead: { status: "read", finishedAt: now },
      clientSince: Date.UTC(2025, 0, 14),
      team: [
        { id: "u1", name: "Priya Nair", initials: "PN" },
        { id: "u2", name: "Jordan Ellis", initials: "JE" },
        { id: "u3", name: "Sam Okafor", initials: "SO" },
      ],
      summary: {
        text: "Cedarline Systems builds controls for commercial refrigeration and cold storage. Its engineers work on compressor efficiency, frost and leak sensing, and pump control for food distributors and grocery chains.",
        aiDraftedFrom: "https://cedarline.ca",
        editedByName: "Jordan Ellis",
        editedAt: Date.UTC(2026, 9, 3),
      },
      createdByName: "Jordan Ellis",
      updatedAt: now,
      formerNames: [],
    });
    __setQueryData("companyProjects:listCompanyProjects", {
      rows: [
        ["p8", "8", "Adaptive cold storage controls", "internal_review", 2026, "Priya Nair", 0],
        ["p9", "9", "High-efficiency pump control", "drafting", 2026, "Jordan Ellis", 5],
        ["p10", "10", "Defrost cycle prediction", "intake", 2026, "Sam Okafor", 11],
        ["p7", "7", "Refrigerant leak detection", "client_review", 2025, "Priya Nair", 18],
        ["p6", "6", "Evaporator coil frost sensing", "delivered", 2025, "Jordan Ellis", 60],
      ].map(([id, number, title, stage, fiscalYear, ownerName, days]) => ({
        _id: id,
        projectNumber: number,
        title,
        stage,
        fiscalYear,
        ownerName,
        updatedAt: now - (days as number) * 86_400_000,
      })),
      total: 24,
      all: 24,
      page: 1,
      pageCount: 3,
      pageSize: 10,
      truncated: false,
      options: { stages: ["intake", "drafting", "internal_review", "client_review", "delivered"], fiscalYears: [2026, 2025], noFiscalYear: false, owners: [] },
    });
    __setPaginatedRows("dashboard:listCompanyProjects", [
      projectRow("p8", "Adaptive cold storage controls", "drafting", 2026, now),
      projectRow("p9", "High-efficiency pump control", "client_review", 2026, now - 2 * 86_400_000),
      projectRow("p10", "Defrost cycle prediction", "internal_review", 2026, now - 3 * 86_400_000),
      projectRow("p7", "Variable-speed compressor tuning", "delivered", 2025, now - 200 * 86_400_000),
      projectRow("p6", "Ammonia leak detection model", "delivered", 2025, now - 200 * 86_400_000),
      projectRow("p5", "Low-temperature seal testing", "delivered", 2025, now - 230 * 86_400_000),
    ]);
    __setPageUrl("/companies/cedarline%20systems");
    await render(CompaniesPage, { companyKey: "cedarline systems" });
    await expect.poll(() => document.querySelectorAll("[data-company-project-row]").length).toBe(5);
    expectFrame();
    // 2026-11-04 (the company profile): no sidebar, the switcher in the bar.
    expect(document.querySelector('[data-section-sidebar="companies"]')).toBeNull();
    expect(document.querySelector("[data-company-switcher]")).not.toBeNull();
    expect(document.querySelector("[data-page-title]")?.textContent).toBe("Cedarline Systems");
    expect(document.querySelector("[data-edit-company]")).not.toBeNull();
    await capture("company");
  });

  it("Team (S11)", async () => {
    seedFrame();
    const now = Date.now();
    __setQueryData("team:listMembers", [
      ["Bryce Choquer", "admin", true, 0],
      ["Jordan Ellis", "admin", false, 5],
      ["Maya Chen", "manager", false, 60],
      ["Sam Chen", "manager", false, 1440],
      ["Larry Moss", "writer", false, 12],
      ["Priya Natarajan", "writer", false, 2880],
      ["Owen Park", "writer", false, null],
    ].map(([name, role, isOwner, minutes], index) => {
      const [firstName, lastName] = String(name).split(" ");
      return {
        _id: `m-${index}`,
        name,
        firstName,
        lastName,
        email: `${String(firstName).toLowerCase()}@banhall.com`,
        role,
        isOwner,
        isDeveloper: false,
        lastActiveAt: minutes === null ? null : now - Number(minutes) * 60_000,
        isSelf: index === 0,
      };
    }));
    __setQueryData("invites:listTeamInvites", [
      { _id: "i-1", email: "ana.ruiz@banhall.com", role: "writer", invitedByName: "Bryce Choquer", sentAt: now - 2 * 86_400_000, expiresAt: now + 5 * 86_400_000, expired: false, canManage: true },
      { _id: "i-2", email: "m.tremblay@banhall.com", role: "manager", invitedByName: "Sam Chen", sentAt: now - 18 * 86_400_000, expiresAt: now - 11 * 86_400_000, expired: true, canManage: true },
    ]);
    __setPageUrl("/team");
    await render(TeamPage, { origin: "https://banhall.app" });
    await expect.poll(() => document.querySelector("[data-team-members]")).not.toBeNull();
    expectFrame();
    expect(document.querySelector('[data-team-sidebar="people"]')?.getAttribute("aria-current")).toBe("page");
    expect(document.querySelector("[data-page-count]")?.textContent).toBe("7 people");
    await capture("team");
  });

  it("Admin, House rules", async () => {
    seedFrame();
    __setPageUrl("/admin/house-rules");
    const body = createRawSnippet(() => ({
      render: () => `<div class="flex flex-col gap-3"><div class="h-24 rounded-xl border border-line"></div><div class="h-24 rounded-xl border border-line"></div></div>`,
    }));
    await render(AdminWorkspacePage, {
      title: "House rules",
      description: "The rules every report follows, in your words.",
      children: body,
    });
    await expect.poll(() => document.querySelector('[data-admin-link="/admin/house-rules"]')?.getAttribute("aria-current")).toBe("page");
    expectFrame();
    await capture("admin");
  });

  it("Settings, Account", async () => {
    seedFrame();
    __setPageUrl("/settings/account");
    const body = createRawSnippet(() => ({
      render: () => `<div class="flex flex-col gap-3"><div class="h-16 rounded-lg bg-gray-50"></div><div class="h-16 rounded-lg bg-gray-50"></div></div>`,
    }));
    await render(SettingsLayout, { children: body });
    await expect.poll(() => document.querySelector('[data-settings-sidebar="account"]')?.getAttribute("aria-current")).toBe("page");
    expectFrame();
    await capture("settings");
  });

  it("a project page (A1, no sidebar)", async () => {
    seedFrame();
    seedProject();
    __setPageParams({ id: "project-1" });
    __setPageUrl("/project/project-1");
    await render(PreviewProjectPage);
    await expect.poll(() => document.querySelector("[data-project-heading]")?.textContent).toBe("Adaptive cold storage controls");
    expectFrame();
    expect(document.querySelector("[data-section-sidebar]")).toBeNull();
    await capture("project");
  });
});

function seedProject() {
  __setQueryData("projects:getProject", {
    _id: "project-1",
    title: "Adaptive cold storage controls",
    clientName: "Cedarline Systems",
    writer: "Writer",
    interviewer: "",
    interviewees: [],
    tagIds: [],
    mode: "generate",
    status: "review",
    workflowStage: "drafting",
    createdBy: "u-bryce",
    ownerId: "u-bryce",
    createdAt: new Date(2026, 8, 17).getTime(),
    updatedAt: Date.now() - 12 * 60_000,
    industry: "manufacturing",
    scienceCode: "2.03.01",
    fiscalYearEnd: new Date(2026, 5, 30).getTime(),
    projectNumber: "1A",
  });
  __setQueryData("reports:getLatestReport", {
    _id: "report-1",
    projectId: "project-1",
    generationId: "gen-1",
    version: 1,
    revisionNumber: 1,
    content: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Cedarline Systems designs refrigeration controls and variable-speed pumps for cold storage operators." }] }] }),
    createdAt: 1,
    updatedAt: 1,
  });
  __setQueryData("generations:getLatestGeneration", {
    _id: "gen-1",
    status: "completed",
    candidateMode: "single",
    postQaStatus: "done",
    agentOutputs: JSON.stringify({ qa: { overall_score: 93, section_scores: { "242": { score: 90 } } } }),
  });
  __setQueryData("generations:getGenerationSeedView", null);
  for (const name of ["pdReviews:getLatestPdReview", "reportViews:getViewSummary"]) __setQueryData(name, null);
  for (const name of ["documents:listDocuments", "tags:listTags", "comments:listComments", "chatV2:listThreads", "chatV2:listTurns", "chatV2:listProposals", "research:listSessions", "uploadAttempts:listUploadAttempts"]) __setQueryData(name, []);
  __setQueryData("transcripts:listTranscripts", [{ _id: "t-1", label: "Interview with Priya", position: 0, createdAt: 1, charCount: 60, wordCount: 10 }]);
  __setQueryData("projects:getProjectEditAccess", { canEditDetails: true });
  __setQueryData("projectWorkflow:getProjectWorkflowHeader", {
    workflowStage: "drafting",
    stageIsFallback: false,
    workflowUpdatedAt: Date.now() - 12 * 60_000,
    workflowVersion: 3,
    owner: { userId: "u-bryce", initials: "BC", label: "Bryce Choquer" },
    ownerNeedsReview: false,
    createdByLabel: "Bryce Choquer",
    viewerAuthorities: ["owner"],
  });
  __setQueryData("projects:getProjectDetailsPanel", {
    stage: "drafting",
    workflowVersion: 3,
    industry: "manufacturing",
    fiscalYearEnd: new Date(2026, 5, 30).getTime(),
    scienceCode: "2.03.01",
    projectNumber: "1A",
    owner: { userId: "u-bryce", label: "Bryce Choquer", initials: "BC", isYou: true },
    createdAt: new Date(2026, 8, 17).getTime(),
    editedAt: Date.now() - 12 * 60_000,
    currentHandoff: null,
    permissions: { canEditDetails: true, canChangeStage: true, canHandOff: true },
  });
  __setQueryData("workItems:getProjectWorkPanel", {
    currentHandoffId: null,
    openItems: [],
    viewer: { canCreate: true, canCreateFinancial: false },
    assignable: true,
    assignableReason: null,
    pointerHealthy: true,
    truncated: false,
  });
  __setQueryData("workItems:listAssigneeCandidates", { candidates: [], truncated: false });
  __setQueryData("chatV2:listMessages", { streams: { kind: "list", messages: [] } });
  __setPaginatedRows("chatV2:listMessages", []);
}
