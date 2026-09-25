import assert from "node:assert/strict";
import test from "node:test";

import { formatReplyForSpeech } from "../src/voiceFormatter.js";

test("converts chat-oriented Markdown into speech-friendly text", () => {
  const spoken = formatReplyForSpeech(`
## Recommended options

- **CZ123 Fan** — Suitable for a small room.
- [CZ456](https://example.com/product) — Has three speeds.

Type "connect me to an agent" if needed.

Sources: Product catalog
`);

  assert.doesNotMatch(spoken, /[*#\[\]`]/);
  assert.doesNotMatch(spoken, /https?:/);
  assert.doesNotMatch(spoken, /Sources:/i);
  assert.match(spoken, /CZ123 Fan/);
  assert.match(spoken, /say 'connect me to an agent'/i);
});
