/// <reference types="vite/client" />
/**
 * 2026-11-04 (the company profile: People): company contacts. Every role
 * against the matrix, required fields and the email check, one main contact
 * per company, a company known only by its projects getting its row, and a
 * merge moving contacts to the kept company with its main contact kept.
 */
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { dashboardCompanyKey, DASHBOARD_UNNAMED_COMPANY_KEY } from "../shared/dashboardProjection";
import { getEffectiveCapabilityLevel, type CapabilityRole } from "../shared/capabilities";
import { COMPANY_CONTACT_LIMIT, MERGE_COMPANY_CONTACT_LIMIT } from "./companyContacts";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const writerId = await ctx.db.insert("users", { authId: "cc-writer", role: "writer", email: "wendy@firm.com" });
    const managerId = await ctx.db.insert("users", { authId: "cc-manager", role: "manager", email: "mina@firm.com" });
    await ctx.db.insert("users", { authId: "cc-admin", role: "admin", email: "ada@firm.com" });
    await ctx.db.insert("users", { authId: "cc-roleless" });
    const client = (name: string) =>
      ctx.db.insert("clients", { name, nameKey: dashboardCompanyKey(name), status: "active", createdBy: managerId, createdAt: now, updatedAt: now });
    const project = (title: string, clientName: string, clientId?: Id<"clients">) =>
      ctx.db.insert("projects", {
        title,
        clientName,
        ...(clientId ? { clientId } : {}),
        dashboardCompanyKey: dashboardCompanyKey(clientName),
        status: "draft",
        createdBy: writerId,
        ownerId: writerId,
        shareToken: `${title}-token`,
        createdAt: now,
        updatedAt: now,
      });
    const acmeId = await client("Acme");
    const borealisId = await client("Borealis");
    await project("Seal", "Acme", acmeId);
    await project("Valve", "Borealis", borealisId);
    // A company known only by its projects (no clients row yet).
    const cedarProjectId = await project("Pump", "Cedar");
    await ctx.db.insert("dashboardCompanies", { companyKey: "acme", clientName: "Acme", projectCount: 1, updatedAt: now });
    await ctx.db.insert("dashboardCompanies", { companyKey: "borealis", clientName: "Borealis", projectCount: 1, updatedAt: now });
    await ctx.db.insert("dashboardCompanies", { companyKey: "cedar", clientName: "Cedar", projectCount: 1, updatedAt: now });
    return { writerId, managerId, acmeId, borealisId, cedarProjectId };
  });
  return {
    t,
    ...ids,
    writer: t.withIdentity({ subject: "cc-writer" }),
    manager: t.withIdentity({ subject: "cc-manager" }),
    admin: t.withIdentity({ subject: "cc-admin" }),
    roleless: t.withIdentity({ subject: "cc-roleless" }),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const DANA = { firstName: "Dana", lastName: "Whitlock", role: "VP Engineering", email: "dana@acme.example", phone: "(604) 555-0142", isMain: false };
const MARC = { firstName: "Marc", lastName: "Teo", role: "Lab lead", email: "marc@acme.example", isMain: false };

async function addTo(s: Setup, companyKey: string, person: typeof DANA | typeof MARC, overrides: Record<string, unknown> = {}) {
  return await s.writer.mutation(api.companyContacts.addCompanyContact, { companyKey, ...person, ...overrides });
}


/** `count` plain contacts on a company, written directly (oldest first). */
async function seedContacts(s: Setup, clientId: Id<"clients">, count: number, prefix = "P") {
  await s.t.run(async (ctx) => {
    for (let index = 0; index < count; index++) {
      await ctx.db.insert("companyContacts", {
        clientId,
        firstName: `${prefix}${index}`,
        lastName: "X",
        role: "R",
        email: `${prefix.toLowerCase()}${index}@acme.example`,
        isMain: false,
        createdBy: s.writerId,
        createdAt: index,
        updatedAt: index,
      });
    }
  });
}

async function list(s: Setup, companyKey = "acme") {
  return (await s.writer.query(api.companyContacts.listCompanyContacts, { companyKey })).contacts;
}

describe("who may read and manage contacts", () => {
  const asRole = { writer: "writer", manager: "manager", admin: "admin" } as const;

  for (const role of ["writer", "manager", "admin"] as const) {
    test(`${role}: follows the matrix for read and manage`, async () => {
      const s = await setup();
      const viewer = s[asRole[role]];
      const canRead = getEffectiveCapabilityLevel(role as CapabilityRole, "companyContacts.read") !== "none";
      const canManage = getEffectiveCapabilityLevel(role as CapabilityRole, "companyContacts.manage") !== "none";
      expect(canRead).toBe(true);
      expect(canManage).toBe(true);
      const id = await viewer.mutation(api.companyContacts.addCompanyContact, { companyKey: "acme", ...DANA });
      expect((await viewer.query(api.companyContacts.listCompanyContacts, { companyKey: "acme" })).contacts).toHaveLength(1);
      await viewer.mutation(api.companyContacts.updateCompanyContact, { contactId: id, ...DANA, role: "CTO" });
      await viewer.mutation(api.companyContacts.setMainCompanyContact, { contactId: id });
      await viewer.mutation(api.companyContacts.removeCompanyContact, { contactId: id });
      expect(await list(s)).toEqual([]);
    });
  }

  test("Financial reads contacts but does not manage them (matrix)", () => {
    expect(getEffectiveCapabilityLevel("financial", "companyContacts.read")).toBe("all");
    expect(getEffectiveCapabilityLevel("financial", "companyContacts.manage")).toBe("none");
  });

  test("no role and no sign-in are refused everywhere", async () => {
    const s = await setup();
    const id = await addTo(s, "acme", DANA);
    for (const viewer of [s.roleless, s.t]) {
      await expect(viewer.query(api.companyContacts.listCompanyContacts, { companyKey: "acme" })).rejects.toThrow();
      await expect(viewer.mutation(api.companyContacts.addCompanyContact, { companyKey: "acme", ...MARC })).rejects.toThrow();
      await expect(viewer.mutation(api.companyContacts.updateCompanyContact, { contactId: id, ...DANA })).rejects.toThrow();
      await expect(viewer.mutation(api.companyContacts.setMainCompanyContact, { contactId: id })).rejects.toThrow();
      await expect(viewer.mutation(api.companyContacts.removeCompanyContact, { contactId: id })).rejects.toThrow();
    }
    expect(await list(s)).toHaveLength(1);
  });
});

describe("adding and editing a contact", () => {
  test("stores the fields trimmed, with who added it and when", async () => {
    const s = await setup();
    const id = await addTo(s, "acme", { ...DANA, firstName: "  Dana ", email: " dana@acme.example " });
    const row = await s.t.run(async (ctx) => await ctx.db.get(id));
    expect(row).toMatchObject({
      clientId: s.acmeId,
      firstName: "Dana",
      lastName: "Whitlock",
      role: "VP Engineering",
      email: "dana@acme.example",
      phone: "(604) 555-0142",
      isMain: false,
      createdBy: s.writerId,
    });
    expect(row!.createdAt).toBe(row!.updatedAt);
    const [listed] = await list(s);
    expect(listed).toMatchObject({ firstName: "Dana", phone: "(604) 555-0142", isMain: false });
  });

  test("refuses each missing required field and an email that does not look like one", async () => {
    const s = await setup();
    for (const [field, message] of [
      ["firstName", "Enter their first name"],
      ["lastName", "Enter their last name"],
      ["role", "Enter their role"],
      ["email", "Enter their email"],
    ] as const) {
      await expect(addTo(s, "acme", DANA, { [field]: "   " })).rejects.toThrow(message);
    }
    for (const email of ["dana", "dana@acme", "dana @acme.example", "@acme.example"]) {
      await expect(addTo(s, "acme", DANA, { email })).rejects.toThrow("Enter an email like name@example.com");
    }
    expect(await list(s)).toEqual([]);
  });

  test("the phone is optional, and an edit can clear it", async () => {
    const s = await setup();
    const id = await addTo(s, "acme", MARC);
    expect((await list(s))[0].phone).toBeNull();
    await s.writer.mutation(api.companyContacts.updateCompanyContact, { contactId: id, ...MARC, phone: "555-0190", lastName: "Teo-Park" });
    expect((await list(s))[0]).toMatchObject({ phone: "555-0190", lastName: "Teo-Park" });
    await s.writer.mutation(api.companyContacts.updateCompanyContact, { contactId: id, ...MARC, phone: "" });
    expect((await list(s))[0].phone).toBeNull();
  });

  test("an edit runs the same checks", async () => {
    const s = await setup();
    const id = await addTo(s, "acme", MARC);
    await expect(
      s.writer.mutation(api.companyContacts.updateCompanyContact, { contactId: id, ...MARC, email: "not an email" })
    ).rejects.toThrow("Enter an email like name@example.com");
  });

  test("a company known only by its projects gets its company row, its projects linked", async () => {
    const s = await setup();
    expect(await list(s, "cedar")).toEqual([]);
    await addTo(s, "cedar", DANA);
    const { client, project } = await s.t.run(async (ctx) => ({
      client: await ctx.db.query("clients").withIndex("by_status_and_nameKey", (q) => q.eq("status", "active").eq("nameKey", "cedar")).unique(),
      project: await ctx.db.get(s.cedarProjectId),
    }));
    expect(client).toMatchObject({ name: "Cedar", nameKey: "cedar", createdBy: s.writerId });
    expect(project?.clientId).toBe(client!._id);
    expect(await list(s, "cedar")).toHaveLength(1);
  });

  test("projects with no company name get no contacts, and an unknown company is refused", async () => {
    const s = await setup();
    await expect(addTo(s, DASHBOARD_UNNAMED_COMPANY_KEY, DANA)).rejects.toThrow("share no contacts");
    await expect(addTo(s, "nobody", DANA)).rejects.toThrow("no projects yet");
  });

  test("lists one company's contacts only, the main contact first, then oldest first", async () => {
    const s = await setup();
    await addTo(s, "acme", MARC);
    await addTo(s, "acme", DANA, { isMain: true });
    await addTo(s, "borealis", { ...MARC, firstName: "Bora" });
    expect((await list(s)).map((c) => c.firstName)).toEqual(["Dana", "Marc"]);
    expect((await list(s, "borealis")).map((c) => c.firstName)).toEqual(["Bora"]);
  });

  test(`a company holds up to ${COMPANY_CONTACT_LIMIT} contacts`, async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let index = 0; index < COMPANY_CONTACT_LIMIT; index++) {
        await ctx.db.insert("companyContacts", {
          clientId: s.acmeId,
          firstName: `P${index}`,
          lastName: "X",
          role: "R",
          email: `p${index}@acme.example`,
          isMain: false,
          createdBy: s.writerId,
          createdAt: index,
          updatedAt: index,
        });
      }
    });
    await expect(addTo(s, "acme", DANA)).rejects.toThrow(`up to ${COMPANY_CONTACT_LIMIT} people`);
  });
});

describe("the list and the count", () => {
  test("puts the main contact first even past the list's bound, and lists up to 500", async () => {
    const s = await setup();
    await seedContacts(s, s.acmeId, MERGE_COMPANY_CONTACT_LIMIT + 5);
    const main = await addTo(s, "borealis", DANA, { isMain: true });
    await s.t.run(async (ctx) => ctx.db.patch(main, { clientId: s.acmeId }));
    const result = await s.writer.query(api.companyContacts.listCompanyContacts, { companyKey: "acme" });
    expect(result.contacts).toHaveLength(MERGE_COMPANY_CONTACT_LIMIT);
    expect(result.contacts[0]._id).toBe(main);
    expect(result.truncated).toBe(true);
    expect(await s.writer.query(api.companyContacts.countCompanyContacts, { companyKey: "acme" })).toEqual({
      count: MERGE_COMPANY_CONTACT_LIMIT,
      more: true,
    });
  });

  test("counts a company's contacts, and none for a company with no row", async () => {
    const s = await setup();
    await addTo(s, "acme", DANA);
    await addTo(s, "acme", MARC);
    expect(await s.writer.query(api.companyContacts.countCompanyContacts, { companyKey: "acme" })).toEqual({ count: 2, more: false });
    expect(await s.writer.query(api.companyContacts.countCompanyContacts, { companyKey: "cedar" })).toEqual({ count: 0, more: false });
    await expect(s.roleless.query(api.companyContacts.countCompanyContacts, { companyKey: "acme" })).rejects.toThrow();
  });
});

describe("one main contact per company", () => {
  test("marking one clears the other, in add, edit and Make main contact", async () => {
    const s = await setup();
    const dana = await addTo(s, "acme", DANA, { isMain: true });
    const marc = await addTo(s, "acme", MARC, { isMain: true });
    const mains = async () => (await list(s)).filter((c) => c.isMain).map((c) => c._id);
    expect(await mains()).toEqual([marc]);
    await s.writer.mutation(api.companyContacts.setMainCompanyContact, { contactId: dana });
    expect(await mains()).toEqual([dana]);
    await s.writer.mutation(api.companyContacts.updateCompanyContact, { contactId: marc, ...MARC, isMain: true });
    expect(await mains()).toEqual([marc]);
    await s.writer.mutation(api.companyContacts.updateCompanyContact, { contactId: marc, ...MARC, isMain: false });
    expect(await mains()).toEqual([]);
  });

  test("another company's main contact is untouched", async () => {
    const s = await setup();
    const bora = await addTo(s, "borealis", MARC, { isMain: true });
    await addTo(s, "acme", DANA, { isMain: true });
    expect((await list(s, "borealis")).find((c) => c._id === bora)?.isMain).toBe(true);
  });

  test("a merged company's contact cannot be changed or removed", async () => {
    const s = await setup();
    const id = await addTo(s, "acme", DANA);
    await s.t.run(async (ctx) => ctx.db.patch(s.acmeId, { status: "merged", mergedIntoClientId: s.borealisId }));
    await expect(s.writer.mutation(api.companyContacts.removeCompanyContact, { contactId: id })).rejects.toThrow("merged");
    await expect(s.writer.mutation(api.companyContacts.setMainCompanyContact, { contactId: id })).rejects.toThrow("merged");
    await expect(s.writer.mutation(api.companyContacts.updateCompanyContact, { contactId: id, ...DANA })).rejects.toThrow("merged");
    expect(await s.t.run(async (ctx) => await ctx.db.get(id))).not.toBeNull();
  });

  test("removing a contact deletes it", async () => {
    const s = await setup();
    const id = await addTo(s, "acme", DANA, { isMain: true });
    await s.writer.mutation(api.companyContacts.removeCompanyContact, { contactId: id });
    expect(await s.t.run(async (ctx) => await ctx.db.get(id))).toBeNull();
    // Removing again is a no-op.
    await s.writer.mutation(api.companyContacts.removeCompanyContact, { contactId: id });
  });
});

describe("merging companies moves contacts", () => {
  test("the merged company's contacts move; the kept company's main contact stays", async () => {
    const s = await setup();
    const keptMain = await addTo(s, "acme", DANA, { isMain: true });
    const movedMain = await addTo(s, "borealis", MARC, { isMain: true });
    const moved = await addTo(s, "borealis", { ...MARC, firstName: "Rachel" });
    await s.manager.mutation(api.clients.mergeClients, { keepKey: "acme", mergeKeys: ["borealis"] });
    const contacts = await list(s);
    expect(contacts.map((c) => c._id).sort()).toEqual([keptMain, movedMain, moved].sort());
    expect(contacts.filter((c) => c.isMain).map((c) => c._id)).toEqual([keptMain]);
    const rows = await s.t.run(async (ctx) => await ctx.db.query("companyContacts").collect());
    expect(new Set(rows.map((row) => row.clientId))).toEqual(new Set([s.acmeId]));
  });

  test("with no main contact on the kept company, the merged company's stays main", async () => {
    const s = await setup();
    await addTo(s, "acme", DANA);
    const movedMain = await addTo(s, "borealis", MARC, { isMain: true });
    await s.manager.mutation(api.clients.mergeClients, { keepKey: "acme", mergeKeys: ["borealis"] });
    expect((await list(s)).filter((c) => c.isMain).map((c) => c._id)).toEqual([movedMain]);
  });

  test("the merge preview says how many contacts move", async () => {
    const s = await setup();
    await addTo(s, "acme", DANA);
    await addTo(s, "borealis", MARC);
    await addTo(s, "borealis", { ...MARC, firstName: "Rachel" });
    const preview = await s.manager.query(api.clients.previewClientMerge, { keepKey: "acme", mergeKeys: ["borealis"] });
    expect(preview).toMatchObject({ companyContactCount: 2, tooManyCompanyContacts: false });
  });

  test(`refuses a merge that would leave the kept company with more than ${MERGE_COMPANY_CONTACT_LIMIT} contacts, counting both`, async () => {
    const s = await setup();
    await seedContacts(s, s.acmeId, 300, "A");
    await seedContacts(s, s.borealisId, 201, "B");
    const preview = await s.manager.query(api.clients.previewClientMerge, { keepKey: "acme", mergeKeys: ["borealis"] });
    expect(preview.tooManyCompanyContacts).toBe(true);
    await expect(s.manager.mutation(api.clients.mergeClients, { keepKey: "acme", mergeKeys: ["borealis"] })).rejects.toThrow(
      `more than ${MERGE_COMPANY_CONTACT_LIMIT} contacts`
    );
    // Exactly 500 merges.
    const last = await s.t.run(async (ctx) =>
      (await ctx.db.query("companyContacts").withIndex("by_clientId", (q) => q.eq("clientId", s.borealisId)).take(1))[0]
    );
    await s.t.run(async (ctx) => ctx.db.delete(last._id));
    await s.manager.mutation(api.clients.mergeClients, { keepKey: "acme", mergeKeys: ["borealis"] });
    expect(await s.writer.query(api.companyContacts.countCompanyContacts, { companyKey: "acme" })).toEqual({ count: 500, more: false });
  });

  test("a merge kept under the merged company's name keeps that row's main contact out of the way", async () => {
    const s = await setup();
    const keptMain = await addTo(s, "borealis", DANA, { isMain: true });
    await addTo(s, "acme", MARC, { isMain: true });
    const result = await s.manager.mutation(api.clients.mergeClients, { keepKey: "borealis", mergeKeys: ["acme"] });
    const contacts = await list(s, result.keptKey);
    expect(contacts).toHaveLength(2);
    expect(contacts.filter((c) => c.isMain).map((c) => c._id)).toEqual([keptMain]);
  });
});
