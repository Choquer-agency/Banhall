import type { SVGAttributes } from "svelte/elements";

/** Props shared by every icon in this folder. Extra attributes (aria-label, role, data-*) go to the svg. */
export type IconProps = Omit<SVGAttributes<SVGSVGElement>, "class" | "width" | "height"> & {
  /** Rendered width and height in px. Defaults to the size most used on the boards. */
  size?: number;
  /** Stroke width in viewBox units. Defaults to the boards' most used value. */
  strokeWidth?: number | string;
  class?: string;
};
