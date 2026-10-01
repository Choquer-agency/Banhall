<script lang="ts">
  // One import per icon we show, never the whole set. Each vivid SVG is under
  // 1.5 KB, so Vite inlines it as a data URL. They render through <img> on
  // purpose: the SVGs carry global `.st0`/`.st1` class styles that would clash
  // with each other if inlined into the page.
  import pdfIcon from "file-icon-vectors/dist/icons/vivid/pdf.svg?url";
  import docxIcon from "file-icon-vectors/dist/icons/vivid/docx.svg?url";
  import xlsxIcon from "file-icon-vectors/dist/icons/vivid/xlsx.svg?url";
  import txtIcon from "file-icon-vectors/dist/icons/vivid/txt.svg?url";
  import blankIcon from "file-icon-vectors/dist/icons/vivid/blank.svg?url";
  import { fileIconKind, type FileIconKind } from "$lib/uploads/fileIconKind";

  /**
   * File type icon from file-icon-vectors (dmhendricks, MIT), "vivid" set,
   * as on the round 2 boards. Pass a file name or extension, or a resolved
   * `kind`. `size` is the height in px; the page is 3:4, so the boards' 28
   * and 40 render 21x28 and 30x40. Decorative by default: the file name
   * next to it already says what it is. Give `label` when it stands alone.
   */
  let {
    name = undefined,
    kind = undefined,
    size = 28,
    label = undefined,
    class: className = "",
  }: {
    name?: string | null;
    kind?: FileIconKind;
    size?: number;
    label?: string;
    class?: string;
  } = $props();

  const SOURCES: Record<FileIconKind, string> = {
    pdf: pdfIcon,
    docx: docxIcon,
    xlsx: xlsxIcon,
    txt: txtIcon,
    generic: blankIcon,
  };

  const resolved = $derived(kind ?? fileIconKind(name));
</script>

<img
  src={SOURCES[resolved]}
  alt={label ?? ""}
  width={Math.round(size * 0.75)}
  height={size}
  draggable="false"
  data-file-icon={resolved}
  class={`shrink-0 select-none ${className}`}
/>
