# Branching Tree Technique

Every module has a `.tree` file here describing the complete branching
structure of its behaviour, and a test file whose shape mirrors that tree
exactly. `src/` is at 100% line, branch, function and statement coverage, and
CI fails below that — entrypoints included, apart from page bootstrap and
message wiring.

The point is that the specification is written _before_ and _separately from_
the implementation of the tests, in a form a human can read end to end and ask
"is a branch missing?" — a question that is very hard to ask of a list of test
names, and impossible to ask of a coverage percentage.

## Syntax

```
ModuleTest
├── when the input is empty
│   └── it returns null
└── when the input has a price
    ├── given the currency has no rate
    │   └── it returns null
    └── given the currency has a rate
        └── it multiplies by the rate
```

- **`when`** — a condition on the arguments. Something the caller controls.
- **`given`** — a condition on state. Something the world is already in.
- **`it`** — a leaf. One assertion about the outcome.

Every non-leaf node must have at least two children, because a branch with one
side is not a branch. Every path from root to leaf ends in an `it`.

## Mapping to vitest

Solidity has no nested test blocks, so upstream BTT encodes the path into the
function name (`test_RevertWhen_XIsFalse`) and uses modifiers for shared
branches. JavaScript has `describe`, so the nesting IS the path:

```ts
describe('when the input has a price', () => {
  describe('given the currency has no rate', () => {
    it('returns null', () => {/* ... */});
  });
});
```

The branch text is copied verbatim from the tree. That is what makes the two
files diffable by eye, and what lets `scripts/check-trees.mjs` verify
mechanically that no branch was written down and then never tested.

## Rules

1. A `.tree` file exists for every behavioural test suite. `<name>.tree` pairs
   with `tests/unit/<name>.test.ts`.
2. Every branch in the tree appears as a `describe` with identical text, **at
   the same nesting**. `scripts/check-trees.mjs` compares paths, not just
   strings: a test that drifts out from under its branch is a failure even
   though both texts still exist in the file.
3. Every `it` in the tree appears as an `it` with identical text, again at its
   own path.
4. Coverage is 100% and enforced. The tree says what should be true; coverage
   says nothing was left unexecuted. Neither alone is sufficient — a tree can
   omit a branch, and coverage can be satisfied by a test that asserts nothing.

## Coverage is a floor, not the measure

Line coverage answers "did this line run". It cannot answer "was the assertion
right", and the difference is not academic: this suite sat at 100% line
coverage while six bugs shipped, and three of them had tests asserting the
broken behaviour as correct — each with a tree written to match.

So the number that matters is the MUTATION score. `npm run test:mutation`
changes the source in every way Stryker can and fails on any change no test
notices. It is a hard 100% in CI.

When you fix a bug, the question to ask is not "is this line covered" but
"if someone put this bug back, would anything fail?". Three honest answers
when a mutant survives, in order of preference:

1. **Write the test.** Almost always the right one. An off-by-one needs an
   input sized exactly on the boundary; a regex mutant needs the string the
   mutated pattern would newly match or newly miss.
2. **Delete the code**, when it is dead by construction and grep proves no
   caller. Two functions and one export went this way.
3. **Annotate it** with `// Stryker disable next-line <Mutator>: <reason>`,
   and only when no input can distinguish the change. The reason must be an
   argument a reviewer can check in half a minute, never "hard to test".

`scripts/mutants.mjs` is a faster subset — every bug this project has actually
shipped, put back one at a time. It exists because the full run is slow, and
it can be retired once the full run has been green for a while.

## What is not a tree

Four suites are deliberately not tree-shaped, and it would be dishonest to
pretend otherwise. They are named in `scripts/check-trees.mjs`, which fails on
any OTHER test file without a tree — so "we do BTT" cannot quietly become "we
did BTT once":

| Suite                | Why                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| `parser.regressions` | A list of bugs found in the wild. Each entry is a specific page that broke, not a branch of a decision. |
| `walker.markup`      | The same, for real-site markup shapes.                                                                  |
| `walker.budget`      | Timing and cost behaviour, measured rather than branched.                                               |
| `converter.security` | Adversarial input. The structure is "things an attacker might try", which is open-ended by nature.      |

These earn their place a different way: every one of them exists because
something actually went wrong. A tree describes what a unit _should_ do; these
record what the world _did_. Both are needed, and conflating them would make
the trees read as complete when they are not.

`tests/corpus` is likewise fixture-driven — saved markup from real sites, run
through the same detection path.

## Deriving a tree from unreachable code

Some decisions cannot be reached through a module's public entry point — a
defensive guard, or a rule that only fires for input the callers cannot
currently produce. Three honest options, in order of preference:

1. **Export the rule and test it directly.** `isBetterMatch`, `overlaps`,
   `rotate` and `withDeadline` are all exported for exactly this reason, each
   with a comment saying so. A rule worth having is a rule worth pinning.
2. **Delete it**, when the types already prove it cannot happen. Several
   `?? ''` guards on `textContent` were removed this way and replaced with one
   tested `textOf` helper.
3. **`/* v8 ignore next */` with a stated reason** — last resort, and only when
   the claim "no input can reach this" has actually been checked. Three sites in
   `parser.ts` carry one. Gaming the counter gives you the number without the
   property, which defeats the point of asking for it.
