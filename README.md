# raE.E

raE.E is an open-source video editor and recording studio for the browser and
desktop. Edit local media on a multitrack timeline, record screens and cameras,
and control the desktop editor through a CLI, MCP server, or TypeScript SDK.

The repository and internal package names still use `sidecut` for compatibility.
The entire project is licensed under the [GNU AGPL v3](LICENSE).

## Get started

Install [Vite+](https://viteplus.dev/guide/) and Node.js **24.22.1 or a newer
Node 24 release**. Vite+ manages the pnpm version pinned in `package.json`.
Run these commands from the repository root:

```sh
vp install --frozen-lockfile
vp run dev
```

Open the local URL printed by Vite. The editor runs directly through Vite;
Portless is used by the separate landing app. Local editing works without
cloud credentials or environment files.

To build and preview the web app:

```sh
vp run build
vp run preview
```

To run the landing page:

```sh
vp run dev:landing
```

The landing app uses Portless at `sidecut-landing.localhost`. Set
`VITE_EDITOR_URL` in `apps/landing/.env.local` to link it to your editor deployment.

## Edit and record

- Import video, audio, and images into Project media, then drag sources onto
  compatible timeline tracks. Place sound on an audio track; video tracks show
  picture without playing their source audio.
- Split, trim, move, link, and ripple-edit clips. Use roll, slip, slide, speed,
  held-frame, and synced-angle controls for more detailed edits.
- Compose picture layers with crop, transforms, opacity, keyframes, layouts,
  color correction, LUTs, transitions, and local person cutouts.
- Mix audio with gain, fades, crossfades, dynamics, voice cleanup, and local
  RNNoise isolation. Reuse media, fonts, LUTs, and saved segments in the local
  asset library.
- Record screens, cameras, and microphones. Studio adds scenes, overlays,
  audio controls, recorded takes, and marked moments. Desktop screen selection
  includes source previews and lets you replace a source after adding it.
- Queue local WebM video or WAV audio exports, including marked timeline ranges.
  Desktop services also support native MP4 and HEVC output.

Common shortcuts include Ctrl/Cmd+K or Ctrl/Cmd+B to split, Delete to lift
selected clips, and Shift+Delete to remove their time. Shift/Ctrl/Cmd-click
selects multiple clips.

Codec support, export limits, and effect coverage depend on the browser and
output path. Unsupported processing produces a preflight error. See
[export presets and acceptance](docs/verification/export-presets.md) and
[browser verification](docs/verification/lawn-videorc-remaining-browser.md)
for tested behavior and remaining gaps.

## Run the desktop app

```sh
vp run dev:desktop
```

This builds the web renderer and Electron bundles, downloads the pinned Electron
binary on first launch, and opens the app. `vp run build:desktop` builds without
launching. FFmpeg and FFprobe are installed with the workspace dependencies;
no system installation is required.

For renderer development, start `vp run dev`, then export
`SIDECUT_RENDERER_URL` as the direct `http://127.0.0.1:<port>` URL before launching
the desktop app. Electron does not load `.env` files automatically. If the app
fails to open a window, check that `ELECTRON_RUN_AS_NODE` is unset.

Desktop features include native recording, folder watching, local automation,
and in-app updates. Camera, microphone, and screen access also depend on operating
system permissions. The desktop profile is separate from browser storage.

To build a distributable for the current platform:

```sh
vp run package:desktop
```

Windows NSIS, Linux AppImage/deb, and macOS DMG/ZIP targets are configured.
See [desktop builds](docs/desktop-builds.md) for platform requirements,
verification, and signing limitations.

## Save and move projects

The browser stores projects and resources in SQLite and origin-private storage.
The desktop stores metadata in its profile's `sidecut.sqlite` and media bytes in
`storage-files`. Browser storage belongs to the current browser profile and
origin and can be cleared or evicted.

- Download a `.tandem` project to save project data and media references. It does
  not include the source media bytes.
- Use **Archive project** to create a portable `.sidecut` archive with source and
  library copies. Archives require available local sources and are limited to
  256 MiB. Open them through **Open project** in the browser or desktop app.
- Use **Relink source** for missing media. Project opening also accepts supported
  EDL recipe JSON and basic zipped Filmora `.wfp` imports.

Project journals retain commands and recovery data across restarts. The
interactive undo stack resets on reload. Unsupported project formats open
read-only and preserve the original JSON for download.

See [project interchange and limits](docs/verification/phases-116-120.md) and
[SQLite migration and recovery](docs/verification/sqlite-migration.md).

## Configure cloud features

The cloud stack uses Convex for metadata and authorization, WorkOS AuthKit for
identity, and Cloudflare R2 for private media. Cloudflare Workers Static Assets
hosts the web build.

For a configured deployment:

1. Run `vp run dev:cloud` from the repository root to select a Convex deployment.
2. Configure the deployment variables listed in `apps/cloud/.env.example`.
3. Copy `apps/web/.env.example` to `apps/web/.env.local` and set the public Convex
   and WorkOS values. Production also requires a WorkOS authentication hostname.
4. Register the app origin and redirect URI with WorkOS, then restart Vite.

Keep server credentials in the deployment environment. Every `VITE_*` value is
public. Copying a local environment file does not configure a Convex deployment.

See the [environment guide](packages/env/README.md) for loading and validation,
and [cloud setup](docs/cloud-setup.md) for authentication, storage, uploads,
and deployment details. `vp run build:cloudflare` prepares the static web assets
in `apps/web/.cloudflare`.

All components can be self-hosted without a subscription, using your own
infrastructure and provider keys. The planned hosted service keeps the editor
free and charges for Studio, MCP, in-app AI, cloud uploads, and collaboration.
Pricing and payment enforcement are not implemented. See
[product access](docs/product-access.md) for the policy and implementation status.

## Automate the desktop editor

Run the desktop app before using operations that need a live project. The CLI,
MCP server, and SDK use the same host coordinator and edit history as the UI.

```sh
vp run cli --help
vp run mcp --endpoint-file <discovery-file>
```

The running desktop writes its local API endpoint and bearer token to
`current.tandem.api.json` in its profile. Select it with `--endpoint-file` or the
`SIDECUT_API_FILE` environment variable. Keep the discovery file private.

Helpers preview edits by default and require `--apply` to commit. The `apply`
command commits by default and supports `--dry-run`. Use revision guards when
another client might edit the same project.

- [CLI commands and compatibility](docs/verification/phases-126-130.md)
- [CLI edit batches](docs/verification/cli-apply.md)
- [MCP tools and configuration](docs/verification/mcp-adapters.md)
- [TypeScript SDK workflow](docs/verification/sdk.md)

## Develop and verify

```sh
vp run check
```

This runs formatting, Oxlint, TypeScript checks, and Vitest. Type checking
generates TanStack routes before checking the web and landing apps.

Use `vp run format` to format files and `vp run lint:fix` to apply lint fixes.
Run workspace tasks with `vp run --filter <package> <task>` and installed tools
with `vp exec <binary>`. Use `vp add`, `vp remove`, and `vp update` for dependencies.

Runtime checks are separate from the unit suite. Open `/diagnostics` on the web
app for local project and codec probes. Targeted scripts include
`vp run verify:browsers`, `vp run verify:recording`, and
`vp run verify:packaged`; see their verification reports for build prerequisites
and platform requirements.

## Workspace layout

| Path                        | Purpose                                                                   |
| --------------------------- | ------------------------------------------------------------------------- |
| `apps/web`                  | React editor and Studio, TanStack Start in SPA mode, and feature modules. |
| `apps/desktop`              | Electron host, preload bridge, native media jobs, and local API.          |
| `apps/landing`              | Public landing page and source brand assets.                              |
| `apps/cloud`                | Convex functions for accounts, teams, media, and sharing.                 |
| `packages/contracts`        | Effect project and command schemas, with exact `bigint` flick timing.     |
| `packages/core`             | Portable validation, atomic commands, revisions, and undo/redo.           |
| `packages/platform-browser` | Browser storage, media analysis, decoding, playback, and rendering.       |
| `packages/client`           | Typed client and command builders for the desktop service.                |
| `packages/assets`           | Asset provider adapters and library support.                              |
| `packages/env`              | Runtime-specific environment schemas and validation.                      |
| `packages/ui`               | Shared shadcn components, styles, fonts, and utilities.                   |
| `packages/config`           | Shared TypeScript, Oxlint, and Oxfmt presets.                             |

Shared dependency versions live in the `pnpm-workspace.yaml` catalog. Declare
direct imports in the package that uses them.

## Architecture and implementation status

- [Monorepo architecture](docs/monorepo-plan.md)
- [Tandem parity roadmap](docs/tandem-parity-roadmap.md)
- [Recording, desktop, cloud, and live studio phases](docs/lawn-videorc-phases.md)
- [Verification reports](docs/verification)

The reports record tested scenarios and outstanding acceptance work. Physical
devices, long recordings, hosted integrations, and packaged apps have separate
acceptance requirements; an implemented feature does not imply that every
platform and deployment has passed them.
