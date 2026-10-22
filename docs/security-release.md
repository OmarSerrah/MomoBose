# Release workflow security

The release workflow keeps Sparkle's Ed25519 key in the protected GitHub
environment named `release`. It is configured with OmarSerrah as a required
reviewer and allows only version tags (`v*`) to deploy to it. The solo maintainer
may approve their own release. `SPARKLE_EDDSA_PRIVATE_KEY` has been moved into
that environment; the repository-level copy was removed. The workflow exposes
the key only to the Sparkle signing step.
Pull request and manual runs cannot enter the signing or publishing jobs.

Before the environment approval is requested, the workflow checks that the
version tag points to a commit reachable from `main`. Earlier commits on `main`
remain eligible for a release tag. The release job validates the updater
manifests, signs both Mac update archives, and creates the Sparkle appcast. A
separate publisher receives only `contents: write`; it never receives the
Sparkle key. Release assets upload to a draft first. If uploading fails, the
draft stays unpublished. A retry may replace same-named assets only while the
release is still a draft; published releases are refused.

Two active tag rulesets restrict creation of `v*` tags to administrators and
prohibit updating or deleting those tags without any bypass. Signing still
requires environment approval. Repository administrators can change these
settings; protect the owner's GitHub account and review the tagged commit and
dependency changes before approving. Runs for the same ref are serialized.

The macOS package jobs verify each staged app bundle with `codesign --verify
--deep --strict` and `electron-sparkle doctor --app` before uploading artifacts.
Ad-hoc signatures are accepted. This gate does not require a Developer ID
certificate, notarization, or Gatekeeper approval.

Packaging signs and archives in an OS temporary directory. Desktop/File Provider
metadata can invalidate signatures if a signed `.app` is copied into this
workspace; only completed DMG/ZIP files are copied back. `npm run package:mac`
keeps the unpacked app in temporary storage and records its location in
`release/mac-<arch>-app-path.txt`. Hardened Runtime stays enabled. Bundle versions,
architecture, feed URL, public key and signature settings are checked before
artifacts are accepted.

The app requires signed feeds and verifies ZIP signatures before extraction.
The release validator independently checks the feed signature and exact bytes,
both ZIP signatures, sizes, version, immutable GitHub URLs and architecture
metadata. It rejects DTDs, malformed XML and ambiguous structure. ARM-only items
precede Intel items because Sparkle selects the first compatible item when
versions are equal. The official `sign_update` tool signs the archives and the
feed; `generate_appcast` cannot accept two architecture archives with the same
bundle version. The key reaches the signer through stdin and is absent from its
arguments and inherited environment.

References: Sparkle's [manual signing and appcast format](https://sparkle-project.org/documentation/publishing/)
and its [equal-version item selection](https://github.com/sparkle-project/Sparkle/blob/2.9.6/Sparkle/SUAppcastDriver.m#L525).

`electron-sparkle` is pinned to 0.2.0. The `global-agent` override to 4.1.3
removes the vulnerable logging dependency chain used by its older build tooling.
Its HTTP proxy bootstrap behavior was checked locally. Keep the override under
review when upgrading Electron's packaging tools.

All Actions dependencies in the workflow are pinned to full commit SHAs. The
SHAs and version labels were checked against the corresponding official
`actions/*` GitHub tag refs using `gh api` while implementing this workflow:

| Action | Pinned version | Commit |
| --- | --- | --- |
| `actions/checkout` | v4.2.2 | `11bd71901bbe5b1630ceea73d27597364c9af683` |
| `actions/setup-node` | v4.4.0 | `49933ea5288caeca8642d1e84afbd3f7d6820020` |
| `actions/setup-dotnet` | v4.3.1 | `67a3573c9a986a3f9c594539f4ab511d57bb3ce9` |
| `actions/upload-artifact` | v4.6.2 | `ea165f8d65b6e75b540449e92b4886f43607fa02` |
| `actions/download-artifact` | v4.3.0 | `d3f86a106a0bac45b974a628896c90dbdf5c8093` |

The workflow grants `contents: read` by default, disables persisted checkout
credentials, and grants `contents: write` only to the final publishing job.
