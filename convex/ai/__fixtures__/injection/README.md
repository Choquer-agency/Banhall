# Injection fixtures (CAP-5)

The `.txt` files in this directory are **inert test fixtures**. They are prompt
injection payloads of the kind a client could put inside an uploaded document,
a transcript or report prose, and they exist so `../../contextBoundary.test.ts`
can prove that both containment pipelines
(`convex/ai/trustedContext.ts` for generation, `convex/ai/chatEvidence.ts` for
chat) wrap them in `--- BEGIN [...] ---` / `--- END [...] ---` data blocks and
emit the data-not-instructions guidance alongside.

Nothing here is ever executed, and nothing here is ever sent to a model
provider: the tests are pure, in-process calls to two builder functions. The
files read like real attacks because a fixture that did not would prove
nothing.

## The canary convention

Every fixture carries exactly one line matching `^CANARY-[A-Z0-9-]+$`, unique
across the corpus. Containment is asserted on that token's offset rather than
on the payload as a whole, because the payload is *expected* to come back
altered: `neutralizeMarkers` rewrites a forged `--- END [` into `- - - END [`,
so a fixture's own bytes are not a stable thing to search for.

The canary must therefore survive every transform untouched. Two rules follow:

- **No run of three or more dashes** (`---`, and likewise the Unicode dash
  block and the minus sign). Such a run is what `neutralizeMarkers` spaces out.
- **No `BEGIN` or `END` keyword** in the token, for the same reason.

Plain uppercase letters, digits and single hyphens satisfy both. Keep the token
boring: `CANARY-ROLE-SPOOF-9KD`.

Both rules are enforced by `canaryOf` at discovery time, along with "exactly
one canary line per file", so a fixture that breaks them fails at import with a
message naming the rule rather than later as a confusing containment error.
Uniqueness across the corpus is asserted separately, and is how the suite
proves a payload did not escape its block and reappear elsewhere in the
assembled message.

## Adding a fixture

Drop a new `.txt` file in this directory. The suite discovers the corpus with
`readdirSync` (sorted, `.txt` only), so the new file is enrolled in every slot
of both pipelines with **no edit to the test file**. This `README.md` is not a
`.txt` and is skipped by that filter.

`REQUIRED_FIXTURES` in the test names the four attack families that must always
be present, so renaming or deleting one fails the suite rather than silently
shrinking coverage. Add to that list only when a new family should likewise be
mandatory.

Two corpus-wide rules are enforced by `describe("injection corpus")` rather
than per file, so they constrain the corpus as a whole and not any one fixture:
at least one fixture line must still read as a forged `BEGIN`/`END` marker, and
at least one of those forgeries must sit **mid-line** rather than at column 0.
Column 0 is the easy case — line-anchoring `neutralizeMarkers` still catches
it — so a mid-line forgery is what makes that regression fail. Without these,
editing `marker-forgery.txt` down to ordinary prose would keep the whole suite
green while silently removing the only coverage in the repo of a mid-line
forgery driven through the chat builder.

One more authoring rule, this one from `expectPayloadLinesContained` and the
chat system-string check: a fixture needs at least one line of twelve
characters or more that survives assembly verbatim, i.e. that carries no forged
marker for `neutralizeMarkers` to rewrite. Every payload line the assembled
message still carries is asserted to sit inside the block, under that block's
own label, so a fixture made only of forgeries and short lines would have
nothing left to assert and fails on the floor rather than passing vacuously.
