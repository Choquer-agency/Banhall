/**
 * Panel motion (2026-08-10) — beui.dev-style choreography for the workspace's
 * floating panels, ported to Svelte custom transitions layered on bits-ui
 * primitives (which keep positioning, focus, and aria behavior):
 *
 * - popIn/popOut     · shadcn-style enter: fade + zoom from 95% + slight
 *                      slide, origin at the corner nearest the anchor. Pure
 *                      CSS transform, so box-shadow scales with the panel and
 *                      appears immediately (no clip-path shadow delay). The
 *                      workspace default for popovers, selects, and menus
 *                      (owner direction, 2026-08-10).
 * - morphIn/morphOut · alternate: panels clip-morph open from the corner
 *                      nearest the trigger as one surface. Needs a
 *                      drop-shadow filter (clip cuts box-shadow), which
 *                      makes the shadow trail the morph. Currently unused.
 * - gooIn/gooOut     · alternate: popovers ooze out of their trigger through
 *                      an SVG goo filter (liquid neck), content clipped by
 *                      the same morph. Currently unused.
 * - unfoldIn/unfoldOut · alternate: selects bouncily unfold from the trigger
 *                      edge and pinch off; items stagger in. Currently unused.
 *
 * All three respect prefers-reduced-motion (plain 120ms fade). Transitions are
 * tick-driven so they can choreograph several properties on one element; every
 * inline style is cleared at rest so panels that resize while open stay honest.
 */

import type { TransitionConfig } from "svelte/transition";

const reduced = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeOutQuint = (t: number) => 1 - (1 - t) ** 5;
/** Single mild overshoot; overshoot grows with s (~6% at s=1). */
const backOut = (s: number) => (t: number) => {
  const u = t - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
};

const FADE: TransitionConfig = { duration: 120, css: (t) => `opacity:${t}` };

/* -------------------------------------------------------------------- pop */

function popConfig(node: HTMLElement, duration: number): TransitionConfig {
  const side = node.dataset.side === "top" ? "top" : "bottom";
  const align = node.dataset.align === "end" ? "end" : "start";
  node.style.transformOrigin = `${side === "bottom" ? "top" : "bottom"} ${align === "end" ? "right" : "left"}`;
  const dy = side === "bottom" ? -8 : 8;
  return {
    duration,
    easing: easeOutCubic,
    css: (t, u) => `opacity:${t}; transform: scale(${0.95 + 0.05 * t}) translateY(${dy * u}px);`,
  };
}

export function popIn(node: HTMLElement): TransitionConfig {
  if (reduced()) return FADE;
  return popConfig(node, 150);
}

export function popOut(node: HTMLElement): TransitionConfig {
  if (reduced()) return FADE;
  return popConfig(node, 120);
}

/* ------------------------------------------------------------------ morph */

interface MorphParams {
  radius?: number;
}

function morphConfig(node: HTMLElement, radius: number, duration: number): TransitionConfig {
  const side = node.dataset.side === "top" ? "top" : "bottom";
  const align = node.dataset.align === "end" ? "end" : "start";
  node.style.transformOrigin = `${side === "bottom" ? "top" : "bottom"} ${align === "end" ? "right" : "left"}`;
  // Hide everything but the corner nearest the trigger; unclip as one piece.
  const hidden = {
    top: side === "bottom" ? 0 : 92,
    bottom: side === "bottom" ? 92 : 0,
    right: align === "end" ? 0 : 92,
    left: align === "end" ? 92 : 0,
  };
  return {
    duration,
    easing: easeOutQuint,
    tick: (t) => {
      if (t >= 1) {
        node.style.clipPath = "";
        node.style.transform = "";
        node.style.opacity = "";
        return;
      }
      const u = 1 - t;
      node.style.clipPath = `inset(${hidden.top * u}% ${hidden.right * u}% ${hidden.bottom * u}% ${hidden.left * u}% round ${radius}px)`;
      node.style.transform = `scale(${lerp(0.96, 1, t)})`;
      node.style.opacity = `${clamp01(t / 0.4)}`;
    },
  };
}

export function morphIn(node: HTMLElement, { radius = 12 }: MorphParams = {}): TransitionConfig {
  if (reduced()) return FADE;
  return morphConfig(node, radius, 300);
}

export function morphOut(node: HTMLElement, { radius = 12 }: MorphParams = {}): TransitionConfig {
  if (reduced()) return FADE;
  return morphConfig(node, radius, 200);
}

/* ----------------------------------------------------------------- unfold */

interface UnfoldParams {
  /** Final gap between trigger and panel — animate with sideOffset 0. */
  gap?: number;
  radius?: number;
}

export function unfoldIn(
  node: HTMLElement,
  { gap = 6, radius = 12 }: UnfoldParams = {}
): TransitionConfig {
  if (reduced()) return FADE;
  const isTop = node.dataset.side === "top";
  const items = [...node.querySelectorAll<HTMLElement>("[data-unfold-item]")];
  const fullHeight = node.offsetHeight;
  const heightEase = backOut(0.35);
  const gapEase = backOut(1.4);
  const DURATION = 460;
  node.style.transformOrigin = isTop ? "bottom" : "top";
  return {
    duration: DURATION,
    tick: (t) => {
      if (t >= 1) {
        node.style.height = "";
        node.style.overflow = "";
        node.style.opacity = "";
        node.style.marginTop = "";
        node.style.marginBottom = "";
        node.style.borderRadius = "";
        for (const el of items) {
          el.style.opacity = "";
          el.style.transform = "";
          el.style.filter = "";
        }
        return;
      }
      const ms = t * DURATION;
      node.style.overflow = "hidden";
      node.style.opacity = `${clamp01(ms / 160)}`;
      node.style.height = `${Math.max(0, fullHeight * heightEase(clamp01(ms / 400)))}px`;
      // The gap springs open late — the panel pinches off the trigger.
      const g = gap * gapEase(clamp01((ms - 110) / 350));
      if (isTop) node.style.marginBottom = `${g}px`;
      else node.style.marginTop = `${g}px`;
      // Near corners flatten against the trigger, then round as it separates.
      const near = radius * easeOutQuint(clamp01((ms - 140) / 280));
      node.style.borderRadius = isTop
        ? `${radius}px ${radius}px ${near}px ${near}px`
        : `${near}px ${near}px ${radius}px ${radius}px`;
      items.forEach((el, i) => {
        const ti = easeOutQuint(clamp01((ms - 60 - i * 35) / 260));
        el.style.opacity = `${ti}`;
        el.style.transform = `translateY(${(1 - ti) * -6}px)`;
        el.style.filter = ti >= 1 ? "" : `blur(${(1 - ti) * 3}px)`;
      });
    },
  };
}

export function unfoldOut(
  node: HTMLElement,
  { gap = 6, radius = 12 }: UnfoldParams = {}
): TransitionConfig {
  if (reduced()) return FADE;
  const isTop = node.dataset.side === "top";
  const fullHeight = node.offsetHeight;
  return {
    duration: 220,
    easing: easeOutCubic,
    tick: (t) => {
      node.style.overflow = "hidden";
      node.style.opacity = `${t}`;
      node.style.height = `${fullHeight * t}px`;
      const g = gap * t;
      if (isTop) node.style.marginBottom = `${g}px`;
      else node.style.marginTop = `${g}px`;
      const near = radius * t;
      node.style.borderRadius = isTop
        ? `${radius}px ${radius}px ${near}px ${near}px`
        : `${near}px ${near}px ${radius}px ${radius}px`;
    },
  };
}

/* -------------------------------------------------------------------- goo */

interface GooParams {
  /** The trigger element the panel oozes out of. */
  trigger: HTMLElement | null;
  radius?: number;
}

interface GooRect {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

const lerpRect = (a: GooRect, b: GooRect, t: number): GooRect => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  w: lerp(a.w, b.w, t),
  h: lerp(a.h, b.h, t),
  r: lerp(a.r, b.r, t),
});

const insetClip = (rect: GooRect, layerW: number, layerH: number) =>
  `inset(${rect.y}px ${layerW - (rect.x + rect.w)}px ${layerH - (rect.y + rect.h)}px ${rect.x}px round ${rect.r}px)`;

interface GooParts {
  body: HTMLElement;
  pill: HTMLElement;
  blob: HTMLElement;
  clip: HTMLElement;
  maskRect: SVGRectElement | null;
}

function gooParts(node: HTMLElement): GooParts | null {
  const body = node.querySelector<HTMLElement>("[data-goo-body]");
  const pill = node.querySelector<HTMLElement>("[data-goo-pill]");
  const blob = node.querySelector<HTMLElement>("[data-goo-blob]");
  const clip = node.querySelector<HTMLElement>("[data-goo-clip]");
  if (!body || !pill || !blob || !clip) return null;
  return { body, pill, blob, clip, maskRect: node.querySelector("[data-goo-mask-rect]") };
}

/** Geometry is re-read every frame so floating-ui repositioning stays honest. */
function renderGoo(node: HTMLElement, trigger: HTMLElement, parts: GooParts, radius: number, p: number) {
  const nR = node.getBoundingClientRect();
  const tR = trigger.getBoundingClientRect();
  if (!nR.width || !tR.width) return;
  const dx = tR.left - nR.left;
  const dy = tR.top - nR.top;
  const left = Math.min(0, dx);
  const top = Math.min(0, dy);
  const layerW = Math.max(nR.width, dx + tR.width) - left;
  const layerH = Math.max(nR.height, dy + tR.height) - top;

  parts.body.style.left = `${left}px`;
  parts.body.style.top = `${top}px`;
  parts.body.style.width = `${layerW}px`;
  parts.body.style.height = `${layerH}px`;
  // Mask only while morphing — Chromium's filter+mask interplay leaves paint
  // artifacts at rest even when the cutout rect is zero-sized.
  const mask = parts.body.dataset.gooMask ?? "";
  parts.body.style.mask = mask;
  parts.body.style.webkitMask = mask;

  const pillR = Math.min(radius, tR.height / 2);
  const from: GooRect = { x: dx - left, y: dy - top, w: tR.width, h: tR.height, r: pillR };
  const to: GooRect = { x: -left, y: -top, w: nR.width, h: nR.height, r: radius };

  parts.pill.style.display = "block";
  parts.pill.style.left = `${from.x}px`;
  parts.pill.style.top = `${from.y}px`;
  parts.pill.style.width = `${from.w}px`;
  parts.pill.style.height = `${from.h}px`;
  parts.pill.style.borderRadius = `${pillR}px`;

  parts.blob.style.clipPath = insetClip(lerpRect(from, to, p), layerW, layerH);

  const contentFrom: GooRect = { x: dx, y: dy, w: tR.width, h: tR.height, r: pillR };
  const contentTo: GooRect = { x: 0, y: 0, w: nR.width, h: nR.height, r: radius };
  parts.clip.style.clipPath = insetClip(lerpRect(contentFrom, contentTo, p), nR.width, nR.height);

  // Cut the real trigger's area out of the goo body so the melted copy never
  // covers the live chip's label or focus ring.
  parts.maskRect?.setAttribute("x", `${from.x}`);
  parts.maskRect?.setAttribute("y", `${from.y}`);
  parts.maskRect?.setAttribute("width", `${from.w}`);
  parts.maskRect?.setAttribute("height", `${from.h}`);
  parts.maskRect?.setAttribute("rx", `${pillR}`);
}

/** Rest state: goo body simply hugs the panel so content may resize freely. */
function restGoo(parts: GooParts, radius: number) {
  parts.body.style.left = "";
  parts.body.style.top = "";
  parts.body.style.width = "";
  parts.body.style.height = "";
  parts.pill.style.display = "";
  parts.pill.style.left = "";
  parts.pill.style.top = "";
  parts.pill.style.width = "";
  parts.pill.style.height = "";
  parts.blob.style.clipPath = `inset(0 round ${radius}px)`;
  parts.clip.style.clipPath = "";
  parts.body.style.mask = "none";
  parts.body.style.webkitMask = "none";
  parts.maskRect?.setAttribute("width", "0");
  parts.maskRect?.setAttribute("height", "0");
}

export function gooIn(node: HTMLElement, { trigger, radius = 12 }: GooParams): TransitionConfig {
  const parts = gooParts(node);
  if (reduced() || !trigger || !parts) return FADE;
  return {
    duration: 300,
    easing: backOut(0.3),
    tick: (t) => {
      if (t >= 1) {
        restGoo(parts, radius);
        return;
      }
      renderGoo(node, trigger, parts, radius, Math.max(0, t));
    },
  };
}

export function gooOut(node: HTMLElement, { trigger, radius = 12 }: GooParams): TransitionConfig {
  const parts = gooParts(node);
  if (reduced() || !trigger || !parts) return FADE;
  return {
    duration: 210,
    easing: easeOutCubic,
    tick: (t) => renderGoo(node, trigger, parts, radius, clamp01(t)),
  };
}
