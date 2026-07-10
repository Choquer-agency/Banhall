import {
  query,
  mutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import { domainError } from "./lib/contracts";

// BNH-35: admin-curated project tag taxonomy (nested via parentId).
type DefaultTagGroup = {
  name: string;
  aliases?: readonly string[];
  children: readonly string[];
};

const DEFAULT_TAG_TAXONOMY: readonly DefaultTagGroup[] = [
  {
    name: "Software/IT",
    aliases: ["Software / IT"],
    children: ["SaaS", "AI / ML", "Embedded"],
  },
  {
    name: "Manufacturing & Engineering",
    aliases: ["Manufacturing/Engineering"],
    children: ["Process improvement", "Materials", "Automation"],
  },
  {
    name: "Agriculture",
    children: ["Crop science", "AgTech"],
  },
];

function normalizedName(name: string): string {
  return name.trim().toLowerCase();
}

async function assertAdmin(ctx: QueryCtx | MutationCtx): Promise<string> {
  const userId = await getAuthUserId(ctx);
  if (!userId) domainError("NOT_AUTHENTICATED", "Authentication required");
  const user = await ctx.db.get(userId);
  if (user?.role !== "admin") {
    domainError("NOT_AUTHORIZED", "Tag management requires an admin");
  }
  return userId;
}

/** All tags (small curated list) — any signed-in user can read them. */
export const listTags = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db.query("tags").take(500);
  },
});

export const createTag = mutation({
  args: {
    name: v.string(),
    parentId: v.optional(v.id("tags")),
    kind: v.optional(
      v.union(v.literal("industry"), v.literal("writer"), v.literal("custom"))
    ),
  },
  handler: async (ctx, args) => {
    await assertAdmin(ctx);
    const name = args.name.trim();
    if (!name) domainError("INVALID_INPUT", "Tag name is required");
    if (args.parentId && !(await ctx.db.get(args.parentId))) {
      domainError("NOT_FOUND", "Parent tag not found");
    }
    return await ctx.db.insert("tags", {
      name,
      ...(args.parentId ? { parentId: args.parentId } : {}),
      kind: args.kind ?? "custom",
      createdAt: Date.now(),
    });
  },
});

export const renameTag = mutation({
  args: { tagId: v.id("tags"), name: v.string() },
  handler: async (ctx, args) => {
    await assertAdmin(ctx);
    const tag = await ctx.db.get(args.tagId);
    if (!tag) domainError("NOT_FOUND", "Tag not found");
    const name = args.name.trim();
    if (!name) domainError("INVALID_INPUT", "Tag name is required");
    await ctx.db.patch(tag._id, { name });
  },
});

/** Move a tag under a new parent (or to top level with parentId omitted). */
export const moveTag = mutation({
  args: { tagId: v.id("tags"), parentId: v.optional(v.id("tags")) },
  handler: async (ctx, args) => {
    await assertAdmin(ctx);
    const tag = await ctx.db.get(args.tagId);
    if (!tag) domainError("NOT_FOUND", "Tag not found");
    if (args.parentId) {
      if (args.parentId === args.tagId) {
        domainError("INVALID_INPUT", "A tag cannot be its own parent");
      }
      if (!(await ctx.db.get(args.parentId))) {
        domainError("NOT_FOUND", "Parent tag not found");
      }

      // Reject cycles, including a pre-existing corrupt parent chain.
      const visited = new Set<Id<"tags">>();
      let current: Id<"tags"> | undefined = args.parentId;
      while (current) {
        if (current === args.tagId) {
          domainError("INVALID_INPUT", "Moving this tag would create a cycle");
        }
        if (visited.has(current)) {
          domainError("INVALID_STATE", "The selected parent has a cyclic parent chain");
        }
        visited.add(current);
        const currentTag: Doc<"tags"> | null = await ctx.db.get(current);
        if (!currentTag) domainError("NOT_FOUND", "Parent tag not found");
        current = currentTag.parentId;
      }
    }
    await ctx.db.patch(tag._id, { parentId: args.parentId });
  },
});

/**
 * Delete a tag only after every child and project reference has been scrubbed.
 * Convex mutations are transactional, so any limit/error rolls back the cleanup
 * and leaves the tag intact rather than committing an orphaned reference.
 */
export const deleteTag = mutation({
  args: { tagId: v.id("tags") },
  handler: async (ctx, args) => {
    await assertAdmin(ctx);
    const tag = await ctx.db.get(args.tagId);
    if (!tag) domainError("NOT_FOUND", "Tag not found");
    let replacementParentId = tag.parentId;
    if (replacementParentId) {
      const visited = new Set<Id<"tags">>();
      let current: Id<"tags"> | undefined = replacementParentId;
      while (current) {
        if (current === tag._id || visited.has(current)) {
          replacementParentId = undefined;
          break;
        }
        visited.add(current);
        const currentTag: Doc<"tags"> | null = await ctx.db.get(current);
        if (!currentTag) {
          replacementParentId = undefined;
          break;
        }
        current = currentTag.parentId;
      }
    }

    const children: Doc<"tags">[] = [];
    for await (const child of ctx.db
      .query("tags")
      .withIndex("by_parentId", (q) => q.eq("parentId", tag._id))) {
      children.push(child);
    }
    for (const child of children) {
      await ctx.db.patch(child._id, { parentId: replacementParentId });
    }

    for await (const project of ctx.db.query("projects")) {
      if (!project.tagIds?.includes(tag._id)) continue;
      await ctx.db.patch(project._id, {
        tagIds: project.tagIds.filter((tagId) => tagId !== tag._id),
      });
    }

    await ctx.db.delete(tag._id);
    return null;
  },
});

/**
 * Converge the built-in industry taxonomy without disturbing custom tags.
 * Legacy parent spellings are repaired in place so project tag IDs stay valid.
 */
export const seedDefaultTags = mutation({
  args: {},
  handler: async (ctx) => {
    await assertAdmin(ctx);
    const existing: Doc<"tags">[] = [];
    for await (const tag of ctx.db.query("tags")) existing.push(tag);

    const now = Date.now();
    let created = 0;
    let repaired = 0;

    for (const group of DEFAULT_TAG_TAXONOMY) {
      const canonicalName = normalizedName(group.name);
      const aliases = new Set(
        (group.aliases ?? []).map((alias) => normalizedName(alias))
      );
      const parent =
        existing.find(
          (tag) => !tag.parentId && normalizedName(tag.name) === canonicalName
        ) ??
        existing.find(
          (tag) => !tag.parentId && aliases.has(normalizedName(tag.name))
        );

      let parentId: Id<"tags">;
      if (parent) {
        parentId = parent._id;
        if (parent.name !== group.name || parent.kind !== "industry") {
          await ctx.db.patch(parent._id, {
            name: group.name,
            kind: "industry",
          });
          repaired += 1;
        }
      } else {
        parentId = await ctx.db.insert("tags", {
          name: group.name,
          kind: "industry",
          createdAt: now,
        });
        created += 1;
      }

      for (const childName of group.children) {
        const child = existing.find(
          (tag) =>
            tag.parentId === parentId &&
            normalizedName(tag.name) === normalizedName(childName)
        );
        if (child) {
          if (child.name !== childName || child.kind !== "industry") {
            await ctx.db.patch(child._id, {
              name: childName,
              kind: "industry",
            });
            repaired += 1;
          }
          continue;
        }
        await ctx.db.insert("tags", {
          name: childName,
          parentId,
          kind: "industry",
          createdAt: now,
        });
        created += 1;
      }
    }

    return { created, repaired };
  },
});
