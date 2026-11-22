import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type Ctx = QueryCtx | MutationCtx;

/**
 * Reads an ingestion item's preview text, preferring the legacy inline field
 * on pre-split rows and falling back to the companion ingestionItemTexts table.
 */
export async function readIngestionItemText(
  ctx: Ctx,
  item: Pick<Doc<"ingestionItems">, "_id" | "text">
): Promise<string | undefined> {
  if (item.text !== undefined) return item.text;
  const companion = await ctx.db
    .query("ingestionItemTexts")
    .withIndex("by_itemId", (q) => q.eq("itemId", item._id))
    .unique();
  return companion?.text;
}

/**
 * Upserts or clears the companion preview text row for an ingestion item.
 */
export async function writeIngestionItemText(
  ctx: MutationCtx,
  itemId: Id<"ingestionItems">,
  text: string | undefined
): Promise<void> {
  const existing = await ctx.db
    .query("ingestionItemTexts")
    .withIndex("by_itemId", (q) => q.eq("itemId", itemId))
    .unique();
  if (text === undefined) {
    if (existing) await ctx.db.delete(existing._id);
    return;
  }
  const now = Date.now();
  if (existing) {
    await ctx.db.patch(existing._id, { text, updatedAt: now });
  } else {
    await ctx.db.insert("ingestionItemTexts", {
      itemId,
      text,
      updatedAt: now,
    });
  }
}

export async function deleteIngestionItemText(
  ctx: MutationCtx,
  itemId: Id<"ingestionItems">
): Promise<void> {
  const existing = await ctx.db
    .query("ingestionItemTexts")
    .withIndex("by_itemId", (q) => q.eq("itemId", itemId))
    .unique();
  if (existing) await ctx.db.delete(existing._id);
}
