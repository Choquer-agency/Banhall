// The one ease for layout changes (owner, 2026-10-06): Full width, side
// panels, Assistant full screen, the intake context pane and the candidate
// view. Pair it with the properties that move, for example
// `transition-[width] ${layoutMotion}`. The curve and duration live in
// --ease-layout and --duration-layout in src/routes/layout.css.
export const layoutMotion = "duration-(--duration-layout) ease-(--ease-layout) motion-reduce:transition-none";
