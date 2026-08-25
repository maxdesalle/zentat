# Branching Tree Technique

Every module under `src/lib` has a `.tree` file here describing the complete
branching structure of its behaviour, and a test file whose shape mirrors that
tree exactly.

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

1. A `.tree` file exists for every module in `src/lib`.
2. Every branch in the tree appears as a `describe` with identical text.
3. Every `it` in the tree appears as an `it` with identical text.
4. Coverage is 100% and enforced. The tree says what should be true; coverage
   says nothing was left unexecuted. Neither alone is sufficient — a tree can
   omit a branch, and coverage can be satisfied by a test that asserts nothing.
