// lib/quick-options.ts
//
// Parses a trailing "OPTIONS:" block off the end of an assistant message so
// the UI can render it as tappable quick-reply chips instead of raw text.
// The model is instructed (see prompts.ts) to emit, as the very last thing
// in a message, something like:
//
//   OPTIONS:
//   - Daily commuting
//   - Weekend rides
//   - Long touring
//
// This function strips that block from the displayed text and returns the
// options as a plain string array. If no well-formed block is found at the
// end of the text, the text is returned unchanged with an empty options list.

export function extractQuickOptions(text: string): {
  text: string;
  options: string[];
} {
  const match = text.match(
    /\n{1,2}OPTIONS:\s*\n((?:[ \t]*-[ \t]*.+(?:\n|$))+)\s*$/i
  );
  if (!match || match.index === undefined) {
    return { text, options: [] };
  }

  const options = match[1]
    .split("\n")
    .map((line) => line.replace(/^[ \t]*-[ \t]*/, "").trim())
    .filter(Boolean)
    .slice(0, 6);

  if (options.length === 0) {
    return { text, options: [] };
  }

  return { text: text.slice(0, match.index).trimEnd(), options };
}
