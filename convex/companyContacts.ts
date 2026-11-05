/**
 * Company contacts (2026-11-04, the company profile: People). A company's
 * own people, not Banhall users: first name, last name, role, email, an
 * optional phone and a main contact mark (at most one per company; marking
 * one clears the other in the same mutation). Consultants, Managers, Admins
 * and Financial users read them (companyContacts.read); Consultants,
 * Managers and Admins add, edit, mark and remove them
 * (companyContacts.manage). A merge moves them to the kept company
 * (clients.mergeClients, through the helpers at the end of this file).
 *
 * Contacts never reach an AI call: nothing in convex/ai, drafts, chat,
 * labels or the company summary reads this table.
 */
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { domainError } from "./lib/contracts";
import { requireCapability } from "./lib/roleCapabilities";
import { activeClientForKey, dashboardCompanyForKey } from "./lib/clients";
import { linkKeyProjectsPage } from "./companyFiles";
import { DASHBOARD_UNNAMED_COMPANY_KEY } from "../shared/dashboardProjection";
import { checkContact, type ContactField } from "../shared/companyContacts";

/** Contacts Add person lets one company hold. */
export const COMPANY_CONTACT_LIMIT = 200;
/**
 * Contacts a company may end up with after a merge (more refuses the merge
 * whole), and so the most the list and the count read.
 */
export const MERGE_COMPANY_CONTACT_LIMIT = 500;

const contactValidator = v.object({
  _id: v.id("companyContacts"),
  firstName: v.string(),
  lastName: v.string(),
  role: v.string(),
  email: v.string(),
  phone: v.union(v.string(), v.null()),
  isMain: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const contactFields = {
  firstName: v.string(),
  lastName: v.string(),
  role: v.string(),
  email: v.string(),
  phone: v.optional(v.string()),
  isMain: v.boolean(),
};

function listed(contact: Doc<"companyContacts">) {
  return {
    _id: contact._id,
    firstName: contact.firstName,
    lastName: contact.lastName,
    role: contact.role,
    email: contact.email,
    phone: contact.phone ?? null,
    isMain: contact.isMain,
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
  };
}

/** Refuses a contact the dialog would have refused, naming the first field. */
function requireValidContact(input: { firstName: string; lastName: string; role: string; email: string; phone?: string }) {
  const { contact, errors } = checkContact(input);
  const field = (Object.keys(errors) as ContactField[])[0];
  if (field) domainError("INVALID_INPUT", errors[field]!, { field });
  return contact;
}

/** The company row a contact is on, active, or a refusal. */
async function requireActiveContactClient(ctx: QueryCtx, clientId: Id<"clients">): Promise<Doc<"clients">> {
  const client = await ctx.db.get(clientId);
  if (!client || client.status !== "active") {
    domainError("INVALID_STATE", "This company was merged or removed. Open the company again.");
  }
  return client;
}

/**
 * The company row for a company page, made from its projects when it has
 * none yet, with its projects linked to it: the same row a first company
 * file makes (companyFiles.ensureCompanyForKey), under contact permissions.
 */
async function companyRowForKey(ctx: MutationCtx, key: string, userId: Id<"users">): Promise<Doc<"clients">> {
  if (key === DASHBOARD_UNNAMED_COMPANY_KEY) {
    domainError("INVALID_INPUT", "Projects with no company name share no contacts. Name their company first.");
  }
  const existing = await activeClientForKey(ctx, key);
  if (existing) return existing;
  const company = await dashboardCompanyForKey(ctx, key);
  if (!company) domainError("NOT_FOUND", "This company has no projects yet. Add a project first.");
  const now = Date.now();
  const clientId = await ctx.db.insert("clients", {
    name: company.clientName.trim() || key,
    nameKey: key,
    status: "active",
    nameHistoryComplete: true,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  });
  await linkKeyProjectsPage(ctx, key, clientId, null);
  return (await ctx.db.get(clientId))!;
}

/** Clears the company's main contact mark, except on `keep`. */
async function clearMain(ctx: MutationCtx, clientId: Id<"clients">, keep: Id<"companyContacts"> | null, userId: Id<"users">, now: number) {
  const mains = await ctx.db
    .query("companyContacts")
    .withIndex("by_clientId_and_isMain", (q) => q.eq("clientId", clientId).eq("isMain", true))
    .take(COMPANY_CONTACT_LIMIT);
  for (const main of mains) {
    if (main._id === keep) continue;
    await ctx.db.patch(main._id, { isMain: false, updatedBy: userId, updatedAt: now });
  }
}

/**
 * A company's contacts by company key, the main contact first, then in the
 * order they were added. A company with no company row has none.
 */
export const listCompanyContacts = query({
  args: { companyKey: v.string() },
  returns: v.object({ contacts: v.array(contactValidator), truncated: v.boolean() }),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "companyContacts.read");
    const client = await activeClientForKey(ctx, args.companyKey);
    if (!client) return { contacts: [], truncated: false };
    // The main contact by its own index, so it is first however many came before it.
    const main = await ctx.db
      .query("companyContacts")
      .withIndex("by_clientId_and_isMain", (q) => q.eq("clientId", client._id).eq("isMain", true))
      .first();
    const rows = await ctx.db
      .query("companyContacts")
      .withIndex("by_clientId", (q) => q.eq("clientId", client._id))
      .take(MERGE_COMPANY_CONTACT_LIMIT + 1);
    const others = rows.filter((row) => row._id !== main?._id);
    const room = MERGE_COMPANY_CONTACT_LIMIT - (main ? 1 : 0);
    const contacts = [...(main ? [main] : []), ...others.slice(0, room)].map(listed);
    return { contacts, truncated: others.length > room };
  },
});

/**
 * How many contacts a company has, read up to MERGE_COMPANY_CONTACT_LIMIT,
 * for the People tab's count while the tab is not shown.
 */
export const countCompanyContacts = query({
  args: { companyKey: v.string() },
  returns: v.object({ count: v.number(), more: v.boolean() }),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "companyContacts.read");
    const client = await activeClientForKey(ctx, args.companyKey);
    if (!client) return { count: 0, more: false };
    const rows = await ctx.db
      .query("companyContacts")
      .withIndex("by_clientId", (q) => q.eq("clientId", client._id))
      .take(MERGE_COMPANY_CONTACT_LIMIT + 1);
    return { count: Math.min(rows.length, MERGE_COMPANY_CONTACT_LIMIT), more: rows.length > MERGE_COMPANY_CONTACT_LIMIT };
  },
});

export const addCompanyContact = mutation({
  args: { companyKey: v.string(), ...contactFields },
  returns: v.id("companyContacts"),
  handler: async (ctx, args) => {
    const { user } = await requireCapability(ctx, "companyContacts.manage");
    const contact = requireValidContact(args);
    const client = await companyRowForKey(ctx, args.companyKey, user._id);
    const held = await ctx.db
      .query("companyContacts")
      .withIndex("by_clientId", (q) => q.eq("clientId", client._id))
      .take(COMPANY_CONTACT_LIMIT);
    if (held.length >= COMPANY_CONTACT_LIMIT) {
      domainError("INVALID_INPUT", `A company can list up to ${COMPANY_CONTACT_LIMIT} people. Remove someone first.`);
    }
    const now = Date.now();
    if (args.isMain) await clearMain(ctx, client._id, null, user._id, now);
    return await ctx.db.insert("companyContacts", {
      clientId: client._id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      role: contact.role,
      email: contact.email,
      ...(contact.phone ? { phone: contact.phone } : {}),
      isMain: args.isMain,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateCompanyContact = mutation({
  args: { contactId: v.id("companyContacts"), ...contactFields },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireCapability(ctx, "companyContacts.manage");
    const existing = await ctx.db.get(args.contactId);
    if (!existing) domainError("NOT_FOUND", "This person was removed from the company.");
    await requireActiveContactClient(ctx, existing.clientId);
    const contact = requireValidContact(args);
    const now = Date.now();
    if (args.isMain) await clearMain(ctx, existing.clientId, existing._id, user._id, now);
    await ctx.db.patch(existing._id, {
      firstName: contact.firstName,
      lastName: contact.lastName,
      role: contact.role,
      email: contact.email,
      phone: contact.phone,
      isMain: args.isMain,
      updatedBy: user._id,
      updatedAt: now,
    });
    return null;
  },
});

/** Marks one contact as the company's main contact and clears the other. */
export const setMainCompanyContact = mutation({
  args: { contactId: v.id("companyContacts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireCapability(ctx, "companyContacts.manage");
    const existing = await ctx.db.get(args.contactId);
    if (!existing) domainError("NOT_FOUND", "This person was removed from the company.");
    await requireActiveContactClient(ctx, existing.clientId);
    const now = Date.now();
    await clearMain(ctx, existing.clientId, existing._id, user._id, now);
    if (!existing.isMain) await ctx.db.patch(existing._id, { isMain: true, updatedBy: user._id, updatedAt: now });
    return null;
  },
});

export const removeCompanyContact = mutation({
  args: { contactId: v.id("companyContacts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "companyContacts.manage");
    const existing = await ctx.db.get(args.contactId);
    if (!existing) return null;
    await requireActiveContactClient(ctx, existing.clientId);
    await ctx.db.delete(existing._id);
    return null;
  },
});

// ─── Merge (clients.mergeClients) ──────────────────────────────────────────

/**
 * A merge's contacts: those the kept company has now (`keptCount`) and the
 * merged companies' (`moving`, which move to it), read up to one past
 * MERGE_COMPANY_CONTACT_LIMIT together, so the merge can refuse when the
 * kept company would end up with more (`tooMany`).
 */
export async function contactsInMerge(
  ctx: QueryCtx,
  keptClientId: Id<"clients"> | null,
  mergedClientIds: Id<"clients">[]
): Promise<{ keptCount: number; moving: Doc<"companyContacts">[]; tooMany: boolean }> {
  const keptCount = keptClientId
    ? (
        await ctx.db
          .query("companyContacts")
          .withIndex("by_clientId", (q) => q.eq("clientId", keptClientId))
          .take(MERGE_COMPANY_CONTACT_LIMIT + 1)
      ).length
    : 0;
  const moving = await contactsMovingInMerge(ctx, mergedClientIds, MERGE_COMPANY_CONTACT_LIMIT + 1 - keptCount);
  return { keptCount, moving, tooMany: keptCount + moving.length > MERGE_COMPANY_CONTACT_LIMIT };
}

/** The merged companies' contacts, read up to `limit`. */
async function contactsMovingInMerge(
  ctx: QueryCtx,
  mergedClientIds: Id<"clients">[],
  limit: number
): Promise<Doc<"companyContacts">[]> {
  const contacts: Doc<"companyContacts">[] = [];
  for (const clientId of mergedClientIds) {
    const room = limit - contacts.length;
    if (room <= 0) break;
    contacts.push(
      ...(await ctx.db
        .query("companyContacts")
        .withIndex("by_clientId", (q) => q.eq("clientId", clientId))
        .take(room))
    );
  }
  return contacts;
}

/**
 * Moves the merged companies' contacts to the kept company. The kept
 * company's main contact stays its main contact; when it has none, the
 * first merged company's main contact (in merge order) becomes it. Every
 * other moved main mark is cleared, so the kept company has at most one.
 */
export async function moveContactsInMerge(
  ctx: MutationCtx,
  moving: Doc<"companyContacts">[],
  keptClientId: Id<"clients">,
  userId: Id<"users">,
  now: number
): Promise<void> {
  let hasMain =
    (await ctx.db
      .query("companyContacts")
      .withIndex("by_clientId_and_isMain", (q) => q.eq("clientId", keptClientId).eq("isMain", true))
      .first()) !== null;
  for (const contact of moving) {
    const keepMain = contact.isMain && !hasMain;
    if (keepMain) hasMain = true;
    await ctx.db.patch(contact._id, {
      clientId: keptClientId,
      ...(contact.isMain && !keepMain ? { isMain: false } : {}),
      updatedBy: userId,
      updatedAt: now,
    });
  }
}
