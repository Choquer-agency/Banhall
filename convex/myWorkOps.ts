import { internalMutation } from "./_generated/server";

export const getDevelopmentAdmin = internalMutation({
  args: {},
  handler: async (ctx) => {
    const admin = (await ctx.db.query("users").take(200)).find((user) => user.role === "admin" && user.isAnonymous !== true);
    return admin ? { adminId: admin._id, label: admin.email ?? admin.name ?? admin.firstName ?? "Administrator" } : null;
  },
});
