// Deterministic palette for user-defined tags. Same tag → same colour.

const TAG_PALETTE = [
  '#ff8a3d',  // amber
  '#ffa564',  // amber-soft
  '#b8d4e3',  // lunar
  '#7df0c8',  // mint
  '#ff8ad1',  // pink
  '#c9b8ff',  // iridescent
  '#8a93a8',  // slate
] as const;

export function tagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  }
  return TAG_PALETTE[hash % TAG_PALETTE.length];
}
