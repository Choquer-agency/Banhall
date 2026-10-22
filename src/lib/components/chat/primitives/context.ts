import { getContext, setContext } from "svelte";

/*
 * Shared context wiring for the chat primitives (prompt-kit-shaped API,
 * implemented natively in Svelte 5). Contexts carry reactive getters so
 * children track the owner's $state without prop drilling.
 */

/** Reactive surface ChatContainer exposes to ScrollButton (and consumers). */
export interface ChatContainerContext {
  /** True while the viewport is pinned to (within threshold of) the bottom. */
  readonly isAtBottom: boolean;
  /** True when content grew while the user was scrolled up (unseen messages);
   * clears as soon as the viewport returns to the bottom. */
  readonly hasUnseen: boolean;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  /**
   * Keep `el` where it is on screen through the next layout change: call it
   * just before the writer opens or closes something, so the control under
   * their pointer does not move (owner, 2026-10-21).
   */
  keepInPlace: (el: Element) => void;
}

const CHAT_CONTAINER_KEY = Symbol("chat-container");

export function setChatContainerContext(ctx: ChatContainerContext): void {
  setContext(CHAT_CONTAINER_KEY, ctx);
}

export function getChatContainerContext(): ChatContainerContext | undefined {
  return getContext(CHAT_CONTAINER_KEY);
}

/** Form surface PromptInput exposes to its subcomponents. */
export interface PromptInputContext {
  value: string;
  readonly isLoading: boolean;
  readonly disabled: boolean;
  /** Autogrow cap for the textarea, px. */
  readonly maxHeight: number;
  submit: () => void;
}

const PROMPT_INPUT_KEY = Symbol("prompt-input");

export function setPromptInputContext(ctx: PromptInputContext): void {
  setContext(PROMPT_INPUT_KEY, ctx);
}

export function getPromptInputContext(): PromptInputContext | undefined {
  return getContext(PROMPT_INPUT_KEY);
}

export type MessageRole = "user" | "assistant";

const MESSAGE_ROLE_KEY = Symbol("message-role");

export function setMessageRoleContext(ctx: { readonly role: MessageRole }): void {
  setContext(MESSAGE_ROLE_KEY, ctx);
}

export function getMessageRoleContext(): { readonly role: MessageRole } | undefined {
  return getContext(MESSAGE_ROLE_KEY);
}
