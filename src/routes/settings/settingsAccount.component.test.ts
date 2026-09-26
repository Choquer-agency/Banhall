import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import AccountPage from "./account/+page.svelte";
import { authClient } from "$lib/authClient";
import { __resetPage } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation, goto } from "$lib/test/app-navigation-stub";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationError,
  __setMutationResult,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";

vi.mock("$lib/authClient", () => ({
  authClient: {
    signOut: vi.fn(async () => {}),
    listSessions: vi.fn(async () => ({ data: [], error: null })),
    getSession: vi.fn(async () => ({ data: null, error: null })),
    revokeSessions: vi.fn(async () => ({ data: { status: true }, error: null })),
  },
}));

const me = {
  _id: "u-1",
  firstName: "Johnny",
  lastName: "Nguyen",
  email: "johnny@banhall.com",
  role: "admin",
  isDeveloper: true,
  imageUrl: null,
};

function sessions(count: number) {
  vi.mocked(authClient.listSessions).mockResolvedValue({
    data: Array.from({ length: count }, (_, index) => ({ id: `s-${index}`, token: `t-${index}` })),
    error: null,
  } as never);
  vi.mocked(authClient.getSession).mockResolvedValue({
    data: { session: { id: "s-0", token: "t-0" }, user: {} },
    error: null,
  } as never);
}

const saveButton = () => document.querySelector<HTMLButtonElement>("[data-settings-save]")!;

describe("Settings Account (I1, I1b)", () => {
  beforeEach(() => {
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    __setQueryData("users:getCurrentUser", me);
    sessions(1);
    vi.mocked(authClient.signOut).mockClear();
    vi.mocked(authClient.revokeSessions).mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("I1: clean state, rows and copy, Save off", async () => {
    await render(AccountPage, {});
    await expect.poll(() => document.querySelector("[data-settings-account]")).not.toBeNull();
    const text = document.querySelector("[data-settings-account]")!.textContent!.replace(/\s+/g, " ");
    for (const copy of [
      "Photo",
      "Shown next to your name.",
      "Change photo",
      "PNG or JPG, up to 5 MB",
      "Name",
      "First",
      "Last",
      "Email",
      "Managed by your sign-in.",
      "johnny@banhall.com",
      "Role",
      "Set by an Admin in Team.",
      "Signed in",
      "Sign out everywhere",
      "Password",
      "Change password",
    ]) {
      expect(text).toContain(copy);
    }
    expect(document.querySelector("[data-settings-account] [data-role-chip]")?.textContent?.trim()).toBe("Developer");
    expect(document.querySelector("[data-settings-idle]")?.textContent).toBe("No changes yet");
    expect(saveButton().disabled).toBe(true);
    expect(document.querySelector("[data-settings-discard]")).toBeNull();
    await expect.poll(() => document.querySelector("[data-sessions-line]")?.textContent).toMatch(/^This .+ only\.$/);
  });

  it("I1b: typing enables Discard and Save; Discard restores", async () => {
    await render(AccountPage, {});
    const first = page.getByLabelText("First");
    await expect.element(first).toHaveValue("Johnny");
    await first.fill("Jon");
    await expect.poll(() => saveButton().disabled).toBe(false);
    expect(saveButton().className).toContain("bg-fir");
    await page.getByRole("button", { name: "Discard" }).click();
    await expect.element(first).toHaveValue("Johnny");
    await expect.poll(() => saveButton().disabled).toBe(true);
  });

  it("Save calls updateMyProfile once", async () => {
    await render(AccountPage, {});
    await page.getByLabelText("Last").fill("Nguyen-Tran");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => __mutationCalls("users:updateMyProfile")).toEqual([
      { firstName: "Johnny", lastName: "Nguyen-Tran" },
    ]);
    expect(__mutationCalls("account:setMyPhoto")).toEqual([]);
  });

  it("stages a photo and saves it with the name in one Save", async () => {
    __setMutationResult("documents:generateUploadUrl", "https://upload.test/url");
    __setMutationResult("documents:claimUpload", true);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ storageId: "st-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await render(AccountPage, {});
    await expect.poll(() => document.querySelector("[data-photo-input]")).not.toBeNull();
    const input = document.querySelector<HTMLInputElement>("[data-photo-input]")!;
    await userEvent.upload(input, new File([new Uint8Array(1024)], "me.png", { type: "image/png" }));
    await expect.poll(() => saveButton().disabled).toBe(false);
    expect(document.querySelector("[data-photo-field] img")).not.toBeNull();
    await page.getByLabelText("First").fill("Jon");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => __mutationCalls("account:setMyPhoto")).toEqual([{ storageId: "st-1" }]);
    expect(fetchMock).toHaveBeenCalledWith("https://upload.test/url", expect.objectContaining({ method: "POST" }));
    expect(__mutationCalls("documents:claimUpload")).toEqual([{ storageId: "st-1" }]);
    expect(__mutationCalls("users:updateMyProfile")).toEqual([{ firstName: "Jon", lastName: "Nguyen" }]);
  });

  it("releases a refused upload and shows the server's message", async () => {
    __setMutationResult("documents:generateUploadUrl", "https://upload.test/url");
    __setMutationResult("documents:claimUpload", true);
    __setMutationError("account:setMyPhoto", new Error("That photo is over 5 MB."));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ storageId: "st-2" }), { status: 200 })));
    await render(AccountPage, {});
    await expect.poll(() => document.querySelector("[data-photo-input]")).not.toBeNull();
    await userEvent.upload(
      document.querySelector<HTMLInputElement>("[data-photo-input]")!,
      new File([new Uint8Array(10)], "me.jpg", { type: "image/jpeg" })
    );
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => __mutationCalls("transcripts:discardTranscriptOriginals")).toEqual([
      { storageIds: ["st-2"] },
    ]);
    await expect.poll(() => document.querySelector("[data-settings-save-error]")?.textContent).toBeTruthy();
  });

  it("validates the photo type and size before anything uploads", async () => {
    await render(AccountPage, {});
    await expect.poll(() => document.querySelector("[data-photo-input]")).not.toBeNull();
    const input = document.querySelector<HTMLInputElement>("[data-photo-input]")!;
    await userEvent.upload(input, new File(["x"], "me.gif", { type: "image/gif" }));
    await expect.poll(() => document.querySelector("[data-photo-problem]")?.textContent).toBe("Use a PNG or JPG file.");
    await userEvent.upload(input, new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" }));
    await expect.poll(() => document.querySelector("[data-photo-problem]")?.textContent).toBe("That photo is over 5 MB.");
    expect(saveButton().disabled).toBe(true);
  });

  it("removing an existing photo is staged, then saved", async () => {
    __setQueryData("users:getCurrentUser", { ...me, imageUrl: "https://files.test/me.png" });
    await render(AccountPage, {});
    await page.getByRole("button", { name: "Remove photo" }).click();
    await expect.poll(() => saveButton().disabled).toBe(false);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => __mutationCalls("account:removeMyPhoto")).toEqual([{}]);
  });

  it.each([
    [1, /^This .+ only\.$/],
    [2, /^This .+ and 1 other device\.$/],
    [4, /^This .+ and 3 other devices\.$/],
  ] as const)("session line for %i sessions", async (count, line) => {
    sessions(count);
    await render(AccountPage, {});
    await expect.poll(() => document.querySelector("[data-sessions-line]")?.textContent).toMatch(line);
  });

  it("Sign out everywhere confirms, revokes, signs out and goes to login", async () => {
    sessions(3);
    await render(AccountPage, {});
    await expect.poll(() => document.querySelector("[data-sessions-line]")?.textContent).toContain("2 other devices");
    await page.getByRole("button", { name: "Sign out everywhere" }).click();
    const dialog = page.getByRole("dialog", { name: "Sign out everywhere?" });
    await expect.element(dialog).toBeVisible();
    expect(dialog.element().textContent).toMatch(/You will be signed out on this .+ and 2 other devices\./);
    expect(authClient.revokeSessions).not.toHaveBeenCalled();
    await dialog.getByRole("button", { name: "Sign out everywhere" }).click();
    await expect.poll(() => __navigationCalls).toEqual([{ kind: "goto", url: "/login" }]);
    expect(authClient.revokeSessions).toHaveBeenCalledOnce();
    expect(authClient.signOut).toHaveBeenCalledOnce();
  });

  it("asks before leaving with unsaved changes", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await render(AccountPage, {});
    await page.getByLabelText("First").fill("Jon");
    await goto("/my-work");
    expect(confirmSpy).toHaveBeenCalledWith("Discard your changes?");
    expect(__navigationCalls.at(-1)?.cancelled).toBe(true);
    confirmSpy.mockRestore();
  });

  it("keeps the password change inline with its own action", async () => {
    await render(AccountPage, {});
    await page.getByRole("button", { name: "Change password" }).click();
    await page.getByLabelText("Current password").fill("old-password");
    await page.getByLabelText(/^New password/).fill("new-password-1");
    await page.getByLabelText("Confirm new password").fill("new-password-1");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect.poll(() => __mutationCalls("users:changeMyPassword")).toEqual([
      { currentPassword: "old-password", newPassword: "new-password-1" },
    ]);
    expect(saveButton().disabled).toBe(true);
  });
});
