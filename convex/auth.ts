import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { DataModel } from "./_generated/dataModel";

export const { auth, signIn, signOut, store } = convexAuth({
  providers: [
    Password<DataModel>({
      profile(params) {
        return {
          email: (params.email as string).toLowerCase().trim(),
          name: (params.name as string | undefined) ?? undefined,
          role: "writer" as const,
          createdAt: Date.now(),
        };
      },
    }),
  ],
});
