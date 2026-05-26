// Tiny fuzzy ranker — good enough for a command palette of a few hundred
// items. No external dep. Higher score = better match. Returns 0 if any
// character in the (lowercased) query isn't present in order.

export function fuzzyScore(haystack: string, needle: string): number {
  if (!needle) return 1; // empty query matches everything weakly
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();

  let score = 0;
  let hi = 0;        // cursor through haystack
  let lastMatch = -2; // for consecutive-bonus tracking
  let firstMatch = -1;

  for (let ni = 0; ni < n.length; ni++) {
    const c = n[ni];
    let found = -1;
    for (let j = hi; j < h.length; j++) {
      if (h[j] === c) {
        found = j;
        break;
      }
    }
    if (found === -1) return 0;
    // Word-start bonus (after space, hyphen, slash, or at index 0)
    const prev = h[found - 1];
    const atWordStart = found === 0 || prev === ' ' || prev === '-' || prev === '/' || prev === '_';
    let inc = 1;
    if (atWordStart) inc += 2;
    if (found === lastMatch + 1) inc += 3; // consecutive char bonus
    score += inc;
    lastMatch = found;
    hi = found + 1;
    if (firstMatch === -1) firstMatch = found;
  }

  // Earlier matches rank slightly higher.
  score += Math.max(0, 8 - firstMatch);
  // Shorter haystacks rank slightly higher when scores tie.
  score += Math.max(0, 32 - h.length) * 0.05;
  return score;
}
