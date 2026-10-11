# @meshtool/sdk

## 0.6.1

### Patch Changes

- 9cfb882: Adopt changesets for versioning and CI-driven publishing.

  Note: the original issue asked for a first changeset targeting version 0.1.0, but the package is already at 0.3.0 in package.json, with 0.2.0 and 0.2.1 previously published manually to npm. Filing this as a patch changeset instead, so the next merge to main produces a correctly ordered 0.3.1 release via CI rather than an invalid downgrade to 0.1.0.

## 0.3.0

Unreleased on npm as of this changelog's creation. Adds typed errors,
retry/timeout support, and CI build/test gates (see git history for
full detail — changelog tracking begins with this entry).

## 0.2.1

Published manually to npm on 2026-06-07, prior to changesets adoption.

## 0.2.0

First public release, published manually to npm on 2026-06-07, prior
to changesets adoption.

---

Future entries in this file are generated automatically by
`changeset version` from the markdown files in `.changeset/`.
