# Spec: deepvariance-vscode

The single source of truth for this repo. Every non-obvious fact here was **verified empirically**
against the live gateway or VS Code's shipped source — not inferred from docs. Where a fact came
from an experiment, the experiment is written down so you can re-run it.

Read [Constraints](#3-platform-constraints-why-the-obvious-approaches-fail) before proposing any
change to how the model reaches VS Code. Most "obvious" designs there are already proven impossible.

---

## 1. Objective

Get a tester from *nothing* to *a working AI coding assistant in VS Code* with **one command and
zero manual steps**.

```bash
npx @deepvariance/vscode
```

**User:** a tester at Deep Variance. Has VS Code. Does not have an API key. Should not have to read a
PDF, paste a key, or edit a config file.

**Replaces:** a 6-step manual setup guide (install Continue → curl a register endpoint → copy the
key → open `config.yaml` → select-all → paste → save).

**Success criteria** (all met; the last is confirmed only partially — see §10):

- [x] One command; the only question asked is the user's email.
- [x] Nothing is installed or written when the gateway is down.
- [x] No API key is ever pasted by a human.
- [x] No file we touch is destroyed — `argv.json` is backed up before it is rewritten.
- [x] Re-running is safe and idempotent.
- [x] The model streams, calls tools, reads images, and shows its thinking.
- [x] Verified in VS Code: the model appears in the picker, VS Code dispatches to our provider, and
      the thinking block renders. (A fully rendered answer has not been eyeballed — see §10.)

---

## 2. External contract: the gateway

Base URL: `https://demo.deepvariance.com` (override: `--gateway`, `DEEPVARIANCE_GATEWAY`).

All of the below was verified with live `curl` on 2026-07-13.

### Endpoints

| Endpoint | Auth | Behaviour |
|---|---|---|
| `GET /health` | none | `200 {"status":"ok","detail":"upstream ok"}` — reports on its **upstream** too |
| `POST /register` | none (invite in body) | `{email, invite}` → `{api_key, email, created_user}` |
| `GET /v1/models` | Bearer | lists exactly one model |
| `POST /v1/chat/completions` | Bearer | OpenAI-compatible, streaming supported |
| `GET /` | — | `404` (there is no index; a 404 here is normal) |

### Authentication — **Bearer only**

`Authorization: Bearer sk-wh-…` is the *only* accepted mechanism. Every alternative was tested and
**all return `401 {"detail":"missing bearer token"}`**:

```
X-Api-Key: <key>        → 401        ?api_key=<key>  → 401
api-key: <key>          → 401        ?api-key=<key>  → 401
                                     ?key=<key>      → 401
```

Two distinct 401 bodies, and the difference matters when debugging:

- `{"detail":"missing bearer token"}` → **no key was sent** (or an empty one)
- `{"detail":"invalid or disabled api key"}` → a key was sent but is not valid

> If the gateway ever gains a non-`Authorization` auth header, re-read §3.2 — it would unlock a
> simpler design that is currently impossible.

### `POST /register` semantics — **not idempotent**

- Mints a **brand-new key on every call.** Two calls → two different keys.
- **Old keys keep working** (verified: key #1 still returned `200` after key #2 was issued).
  So re-running setup never breaks a key already in use elsewhere.
- `created_user: false` means *the account already existed* — **not** "an existing key was returned."
  A fresh key is still minted. (An earlier version of the CLI said "existing key returned"; that was
  a lie and was fixed.)
- Keys accumulate per user with no cleanup. Operational wart on the gateway side, not ours.
- `403 {"detail":"invalid invite token"}` when the invite is wrong.

### The invite token is public, by design

```
inv-PxPzaJVIrSdk7F4VeBUiC7X69_qx42Ij
```

It ships as a plaintext constant inside the **public** `@deepvariance/opencode` npm package
(`lib/constants.js`), so baking it into this package adds no new exposure. It is what lets a tester
type only their email. Override with `--invite` / `DEEPVARIANCE_INVITE` when it rotates.

**Security note for the gateway owner:** anyone who reads that npm tarball can mint keys.

### The model — and why there is no stable alias

The gateway serves **exactly one** model. As of 2026-07-15 that is `Qwen/Qwen3.6-27B-FP8` (vLLM,
`max_model_len: 131072`). It has changed twice: `Qwen3-VL-30B` → `Qwen3.5-27B` → `Qwen3.6-27B`.

| `model` value sent (now) | Result |
|---|---|
| `Qwen/Qwen3.6-27B-FP8` | **200** — the exact served id. Send this. |
| `qwen-coder` | **404** — this alias was **removed** on the 3.5 → 3.6 swap |
| `Qwen/Qwen3.5-27B-FP8` | 404 — the previous model id is gone |

> **The alias theory was wrong.** This file used to say "always send the alias `qwen-coder`, it
> survives model swaps." It did not: the gateway removed the alias *and* changed the model in the
> same swap, 404-ing every published extension in the field until a release fixed it. **Reality: there
> is no alias. Pin the exact served id (`MODEL_ID` in `src/model.js`) and cut a release whenever the
> gateway swaps models.** A swap silently breaks the published package until then — this is the single
> most fragile coupling in the project. The lasting fix is runtime discovery (query `GET /v1/models`
> and use `data[0].id`); see §10.

Capabilities, each verified live on the current model rather than assumed:

| Capability | Verified how |
|---|---|
| Tool calling | `finish_reason: "tool_calls"` with a clean `get_weather({"city":"Paris"})` |
| Vision | Sent a solid crimson PNG, asked the colour → answered **"Red"** |
| Thinking | Streams chain-of-thought in `delta.reasoning` |

> The name has no "VL" but **vision genuinely works.** Don't "fix" `imageInput: true` on the
> assumption that a non-VL model can't see.

### Streaming shape — `reasoning` is a separate field

```jsonc
data: {"choices":[{"delta":{"role":"assistant","content":""}}]}
data: {"choices":[{"delta":{"reasoning":"Thinking"}}]}      // ← chain of thought, NOT content
data: {"choices":[{"delta":{"reasoning":" Process"}}]}      // ← 120 chunks of this in one test
data: {"choices":[{"delta":{"content":"Hello"}}]}           // ← the actual answer
data: [DONE]
```

This is a **reasoning model**: it spends most of its token budget in `reasoning` before emitting any
`content`. Two consequences that will bite you:

1. **Low `max_tokens` yields an empty answer.** With `max_tokens: 16` you get `finish_reason:
   "length"`, `content: null`, and only reasoning. Tests need ≥ ~400 tokens to see a reply.
2. Ignoring `delta.reasoning` makes the model look silent and thoughtless. (It did, until fixed.)

### The host behind the gateway (JarvisLabs)

The gateway is a **paused-when-idle GPU box**, not always-on infrastructure. Managed with the `jl`
CLI (`jl list`, `jl pause <id> -y`, `jl resume <id> -y`, `jl exec <id> <cmd>`).

| Fact | Detail |
|---|---|
| Instance | `API-Hosting`, 1× **H200** (143 GB), region IN2 |
| Model server unit | **`warehouse-gateway.service`** — *not* `warehouse`. `systemctl is-enabled warehouse` says "No such file or directory", which looks dead but isn't. |
| Tunnel | `cloudflared.service`, active + enabled |
| **Cold start** | **~140 s** from resume to `/health` 200. Progresses `530` (origin gone) → `502` (tunnel up, app not ready) → `200`. |
| **Resume changes the machine id** | `444396` → `444694`. Any runbook that hardcodes an id goes stale. |

vLLM is launched with (this explains most of §2):

```
--model Qwen/Qwen3.6-27B-FP8  --max-model-len 131072   # = CONTEXT_WINDOW (illustrative; observed on 3.5, unchanged behaviourally on 3.6)
--reasoning-parser qwen3                               # = why `delta.reasoning` exists
--tool-call-parser qwen3_xml                           # = why tool calling works
--limit-mm-per-prompt {"image": 4}                     # = MAX 4 IMAGES PER PROMPT
--kv-cache-dtype fp8 --max-num-seqs 512 --enable-prefix-caching --gpu-memory-utilization 0.9
```

> **The limit is per *request*, and a request carries the whole conversation** — so images
> accumulate across turns until a chat trips the cap. Rejecting the request would kill the
> conversation permanently (every later turn resends the same images and fails identically), so the
> provider keeps the **4 most recent** images and replaces older ones with a visible note. Degrade,
> don't die — and never drop an image silently, or the model answers confidently about something it
> cannot see.

A `530` from the gateway almost always means **the instance is paused**, not that anything is broken.

---

## 3. Platform constraints: why the obvious approaches fail

**This section exists to stop you re-deriving dead ends.** Each claim cites the shipped source that
proves it. VS Code 1.127 (`/Applications/Visual Studio Code.app/…`).

### 3.1 Copilot Chat is built in

The `copilot` extension ships **inside** VS Code (`Resources/app/extensions/copilot`), which is why
`code --list-extensions` doesn't list it. BYOK ("bring your own key") **requires no GitHub account
and no Copilot plan.** So the built-in Chat is a legitimate target for testers with nothing installed.

### 3.2 ✗ You cannot automate VS Code's built-in BYOK. Do not try.

Four independent blockers, any one of which is fatal:

1. **The key is a secret-storage reference, not a value.**
   `src/vs/workbench/contrib/chat/common/languageModels.ts` — on write, a schema property marked
   `secret: true` is stored in `ISecretStorageService` under `chat.lm.secret.<hash>` and the file
   receives only an *encoded reference*. On read, `decodeSecretKey(value)` → `secretStorage.get(...)`.
   A plaintext `apiKey` written into `chatLanguageModels.json` is therefore parsed as a *lookup name*
   and resolves to `undefined`. It does not work.

2. **It's only ever collected interactively.** The same file builds a `QuickInput` with
   `inputBox.password = true`. **No command accepts an API key as an argument.**

3. **One extension cannot write another's secrets.** `SecretStorage` is documented in `vscode.d.ts`
   as "secrets stored by **this** extension" and hangs off `ExtensionContext`. There is no API to
   plant a key into Copilot's store. → **A "configure-then-uninstall" helper extension is impossible.**

4. **A keyless group is invisible.** `apiKey` is `required` in the `customendpoint` schema; a group
   without one does not appear in the model picker at all. (Observed: a probe model with only
   `requestHeaders` never showed up.)

Corollary — the `x-api-key` idea is dead too. VS Code's forbidden `requestHeaders` set (extracted
from the shipped bundle) contains `authorization` and `api-key` but **not** `x-api-key`, so a custom
auth header *would* pass… except the gateway only accepts `Authorization` (§2), and blocker 4 means
the group wouldn't render anyway.

### 3.3 ✓ The supported path: be the provider

`vscode.lm.registerLanguageModelChatProvider(vendor, provider)` is **stable API** (present in
`vscode.d.ts`, not a proposal). An extension declaring:

```json
"contributes": { "languageModelChatProviders": [{ "vendor": "deepvariance", "displayName": "Deep Variance" }] }
```

serves models straight into the Chat picker. It holds the key in **its own** SecretStorage. No BYOK
group, no `chatLanguageModels.json`, nothing to paste.

**The extension must stay installed — it *is* what answers Chat's requests.** Uninstalling it removes
the model. Only the *key handoff file* is transient.

### 3.4 ⚠ Thinking requires a proposed API

There is **no thinking part in stable VS Code** (zero matches for "thinking" in `vscode.d.ts`). It
exists only as `vscode.proposed.languageModelThinkingPart.d.ts`:

```ts
export class LanguageModelThinkingPart {
  constructor(value: string | string[], id?: string, metadata?: { readonly [key: string]: any });
}
```

Using it needs **both**:

1. `"enabledApiProposals": ["languageModelThinkingPart"]` in the extension manifest, **and**
2. VS Code launched with `--enable-proposed-api deepvariance.deepvariance-vscode`.

(2) is made permanent through `~/.vscode/argv.json`. Verified in the shipped `out/main.js`:

```js
let e = ["enable-proposed-api", "log-level", ...];
case "enable-proposed-api":
  Array.isArray(c) && c.forEach(d => process.argv.push("--enable-proposed-api", d))
```

**This requires a full quit-and-reopen of VS Code, not a window reload** — the flag is read at launch.

> **README vs reality.** The user-facing README tells people to run *Reload Window*, which is correct
> for what they'll do 99% of the time: **the model, chat, tools, and vision all appear after a
> reload** (the extension host respawns and picks up the freshly installed extension). Only the
> *thinking view* needs the argv.json flag, and that flag is applied at Electron launch — so the very
> first time argv.json is written, the thinking block won't render until one full restart. After that
> restart it persists, and reloads are fine forever. Keep the README on "Reload Window"; don't scare
> every user with a restart step that only matters for one feature, one time.

**Risk:** proposed APIs can change or vanish between releases. The provider therefore guards on
`vscode.LanguageModelThinkingPart` being defined and silently drops thinking if it isn't — it
degrades, it never breaks, and it never dumps raw reasoning into the answer as plain text.

### 3.5 ⚠ Agent mode needs a BYOK utility model (VS Code 1.128+)

VS Code 1.128+ agent mode invokes a small **utility model** for background tasks (titles, summaries)
separate from the main model. With a BYOK model and no Copilot plan, its default
`copilot-utility-small` is unavailable, so agent mode errors: *"No utility model is configured for
'copilot-utility-small' while the selected main agent model is BYOK."* This hit real testers on
every release before 0.1.7 — it's not our bug (it affects all BYOK providers, e.g. DeepSeek) but it
blocks agent mode out of the box.

**Fix, applied for the user:** the extension sets `chat.byokUtilityModelDefault: "mainAgent"` on
activation (`ensureByokUtilityDefault` in `extension.js`), which routes utility calls to the selected
BYOK model. Guarded: it skips VS Code versions where the setting doesn't exist (update() would throw)
and never overrides a value the user set — it only flips the default `none`.

> **Tool calls in agent mode are a separate, gateway-side issue.** Qwen3.6 emits tool calls in the
> `<tool_call><function=name><parameter=key>…` format, but the gateway's vLLM `--tool-call-parser`
> (tuned for 3.5) doesn't parse it, so `tool_calls` comes back empty and the call leaks into
> `content` as raw text — the agent "finishes" without acting. Fix is on the gateway:
> `--tool-call-parser qwen3_coder`. `tool_choice:"required"` works (constrained decoding bypasses the
> parser); `auto` (what agent mode uses) does not. A client-side fallback parser is possible but is a
> workaround for a server misconfiguration — prefer the gateway fix.

---

## 4. Architecture

Two packages, one shared core. **The CLI and the extension share `src/` so registration and config
logic have exactly one implementation.** esbuild bundles `src/` into the extension.

```
npx @deepvariance/vscode
  │
  ├─ 1. checkHealth()          gateway down → exit 1, touch nothing
  ├─ 2. ask: email             (invite is built in)
  ├─ 3. register()             POST /register → sk-wh-…
  ├─ 4. installVsix()          bundled .vsix, no marketplace
  ├─ 5. writeHandoff()         ~/.deepvariance/handoff.json (0600)
  └─ 6. enableProposedApi()    ~/.vscode/argv.json → thinking view
        ↓
VS Code launches (full restart)
  extension activate()
    ├─ consumeHandoff()        read key → SecretStorage → DELETE the file
    └─ registerLanguageModelChatProvider('deepvariance', provider)
         ↓
    Chat model picker → "Qwen3.6 27B"
```

### Why the handoff file

The CLI runs in a terminal; the extension runs in VS Code. They cannot share memory. The key is
written `0600` to `~/.deepvariance/handoff.json`, and the extension moves it into SecretStorage and
**deletes the file** on activation. Plaintext lives for *seconds*.

(For scale: the setup guide this replaces had the tester paste the key into a `config.yaml` that
keeps it in plaintext **forever**. Seconds beats forever.)

---

## 5. Project structure

```
bin/cli.js                  The npx entry point (source). Bundled to dist/cli.js for publishing.
esbuild.mjs                 Bundles + minifies the CLI. Only dist/ and the .vsix reach npm.
src/                        Shared by the CLI *and* the extension (esbuild bundles it in).
  model.js                  THE definition of the model — id, name, limits. Change it here.
  gateway.js                DEFAULT_GATEWAY, DEFAULT_INVITE, checkHealth, register, isValidEmail
  handoff.js                writeHandoff / consumeHandoff — the CLI→extension key bridge
  editor.js                 detectEditors, installVsix, vsixPath
  argv.js                   ~/.vscode/argv.json — enables the proposed thinking API
test/*.test.js              CLI tests (node:test, stubbed fetch, temp dirs)

extension/
  package.json              contributes.languageModelChatProviders + enabledApiProposals
  src/constants.js          VENDOR + a re-export of src/model.js (one definition, no drift)
  src/provider.js           The LM provider: message translation, SSE, tools, thinking
  src/extension.js          activate(): consume handoff, register provider, setup + sign-out commands
  src/test-entry.js         Re-exports internals so tests run against the BUILT bundle
  esbuild.mjs               ESM sources → one CJS file (VS Code loads extensions via require)
  test/provider.test.js     Provider tests, with a stubbed `vscode` module
  *.vsix                    Committed on purpose — it ships inside the npm package
```

**`extension/*.vsix` is committed and listed in `package.json#files`.** That is what lets `npx`
install the provider with no marketplace account. Rebuild it whenever `extension/` changes
(§8, "Change the extension").

---

## 6. Commands

```bash
npm test                      # CLI tests (21)
npm run build:extension       # rebuild + repackage the bundled .vsix  ← after ANY extension/ change
cd extension && npm test      # provider tests (12), run against the built bundle
cd extension && npm run build # bundle only, no .vsix

node bin/cli.js --help
node bin/cli.js --health      # gateway check only; exits non-zero when down
node bin/cli.js --email you@example.com --yes   # fully non-interactive
```

**Sandbox any test run that writes config**, or it will install into your real VS Code:

```bash
SB=$(mktemp -d); HOME="$SB" node bin/cli.js --email t@example.com --yes
```

`HOME` sandboxing also redirects the `code` CLI's extension dir, so extension installs land in the
sandbox too — your real editor is untouched.

---

## 7. Code style

Plain ESM JavaScript. **No TypeScript, no framework, no test runner** beyond `node:test`. Node ≥ 18
(for global `fetch`). The only runtime dependency is `@clack/prompts`.

Stdlib first, and it goes further than people expect: `node:util`'s `parseArgs` replaces commander;
global `fetch` replaces axios; `node:test` replaces jest.

Comments explain **why**, never what. A comment earns its place by recording a constraint the code
cannot show:

```js
/**
 * Windows needs a shell to run .cmd shims; quote paths that contain spaces.
 *
 * stdin is 'ignore', never inherited: an interactive prompt library may have put the
 * shared stdin into raw/flowing mode, and a synchronous child that inherits it blocks
 * forever. The timeout is the backstop for an editor CLI that wedges for its own reasons.
 */
function run(bin, args, timeout = 20_000) {
  const shell = IS_WINDOWS;
  const command = shell && bin.includes(' ') ? `"${bin}"` : bin;
  return spawnSync(command, args, { shell, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout });
}
```

Every destructive file write follows the same shape: **read → back up → write.** Never clobber.

---

## 8. Change recipes

The point of this document. Each recipe lists the files to touch and how to verify.

### Change the gateway URL

`src/gateway.js` → `DEFAULT_GATEWAY`. Nothing else — every module derives its URLs from it.
The extension stores its own copy in `globalState` at setup time; existing installs keep the old one
until setup re-runs.
**Verify:** `node bin/cli.js --health --gateway https://new-host`

### Rotate the invite token

`src/gateway.js` → `DEFAULT_INVITE`. Testers on the old version can pass `--invite`.
**Verify:** a wrong invite must produce `403 … invite token was rejected`.

### Swap the backing model

There is no alias to lean on (the gateway removed `qwen-coder`), so a model swap **always** requires
a code change: set `MODEL_ID` in `src/model.js` to the new `GET /v1/models` id, and release. Verify
the id with `curl .../v1/models -H "Authorization: Bearer <key>"` first.

If the display name or limits change: **`src/model.js` only** — the extension re-exports it, so there
is no second copy. Then `npm run build:extension`.
**Verify:** `curl` `GET /v1/models` and confirm `max_model_len` matches `CONTEXT_WINDOW`.

### Change the extension (provider, activation, manifest)

1. Edit `extension/src/**`.
2. Bump `version` in `extension/package.json` — **VS Code will not reinstall the same version.**
3. `npm run build:extension` → produces a new `.vsix`.
4. `git add extension/*.vsix` — it ships in the npm package.
5. `cd extension && npm test`

**Verify for real:** `code --install-extension extension/*.vsix --force`, then **fully quit and
reopen** VS Code (not reload — proposed API is a launch flag), then send a Chat message.

### Add a capability to the model (e.g. embeddings, autocomplete)

`extension/src/provider.js` → `provideLanguageModelChatInformation()` returns
`capabilities: { toolCalling, imageInput }`. **Only claim a capability you have verified against the
live gateway with curl** — a false claim fails at message time, in the user's face, not at setup.

### Add a new setup target

1. `bin/cli.js` → add to `TARGETS` and the `select` options.
2. Add a `src/<target>-config.js` that owns *only* that target's file, and back up before writing.
3. Guard it with `wants<Target>` in `main()`.
4. One test per target in `test/`.

### Remove the whole Continue path

Already done (commit "drop the Continue path"). `src/continue-config.js`, `src/vscode-byok.js`, the
`--target` flag, and the Continue install helpers are gone. VS Code's built-in Chat is the only
target. Nothing in the tree references Continue any more.

### Publish / release

**Automatic.** Bump `version` in `package.json`, merge to `main`, and CI publishes. It checks npm
first, so every other commit to `main` is a no-op rather than a failed re-publish.

Authenticated by **npm trusted publishing (OIDC)**: GitHub mints a short-lived token per workflow
run. There is no `NPM_TOKEN` and no secret to leak or rotate.

#### No-source publish policy

**No source code is ever published.** Both artifacts ship minified bundles only:

| Artifact | Contents |
|---|---|
| npm tarball | `package.json`, `README.md`, `dist/cli.js` (minified, `@clack/prompts` bundled in, **zero runtime deps**), and the `.vsix` |
| `.vsix` | manifest, `package.json`, readme, `dist/extension.js` (minified) |

No `src/`, no `bin/`, no sourcemaps, in either. **CI enforces this on both** — it greps each artifact
for source paths and sourcemaps and asserts the bundles are actually minified. One careless edit to
`.vscodeignore` or `package.json#files` would otherwise republish the source with nobody noticing.

Sourcemaps are off in both esbuild configs *for this reason* — a `.map` puts the original source
back, minification or not. Don't turn them on for a published build.

> Minification is not a security control. It raises the cost of reading the code; it does not hide
> anything from someone determined. The baked invite token is recoverable from the bundle by anyone
> who looks — it is public by design (§2), so this is fine, but do not put a real secret in the
> bundle and assume minification protects it.

**One README.** A single committed `README.md` ships to GitHub, npm, and the marketplace `.vsix`. The banner uses an absolute `raw.githubusercontent` URL so it renders on all three (the repo is public). The extension `package` script and the CI `.vsix` step copy it into `extension/` before packaging (`cp ../README.md README.md`); nothing is swapped. (The old two-README `npm-readme.md` split was removed once the repo went public.)

No marketplace account is needed; the `.vsix` rides inside the npm tarball.

#### Why not a token

An npm **automation token bypasses 2FA by design** — a standing credential that publishes with no
human factor. Leak it (CI logs, a compromised third-party action, a maintainer's laptop) and an
attacker publishes as you. That is the mechanism behind most recent npm supply-chain compromises.
OIDC mints a token scoped to this repo and this workflow, useless once the run ends.

#### One-time bootstrap

A trusted publisher **cannot be registered for a package that does not exist**, so the first release
is manual. Until step 4, CI warns and stays green instead of 404ing on every commit.

1. **Publish once by hand:** `npm login && npm run build && npm publish --access public`
2. **Register the publisher** on npmjs.com → package → *Settings* → *Trusted publisher*:
   GitHub Actions · org `deepvariance` · repo `vscode-extension` · workflow `ci.yml` · environment
   empty. `repository.url` in `package.json` must match the repo exactly or npm rejects the OIDC
   token.
3. **Slam the door on tokens** — npmjs.com → package → *Settings* → **Publishing access** →
   **"Require two-factor authentication and disallow tokens"**. This is the step that actually buys
   the security and is the easy one to skip: adopting OIDC does nothing on its own if a leaked token
   can still publish. The restriction applies to token auth only — the trusted publisher keeps
   working.
4. **Switch CI over:** `gh variable set NPM_TRUSTED_PUBLISHING --body true`

*Optional, maximum paranoia:* configure the trusted publisher to allow only `npm stage publish`. CI
then stages a release and a human approves it with an interactive 2FA prompt. `npm stage approve`
cannot use an OIDC token — it requires proof of presence — so even a compromised workflow cannot ship
to users unattended.

#### Gotchas

- **Requires npm ≥ 11.5.1.** `setup-node` ships npm 10.x, so CI upgrades it in the job.
- **A `404` on publish is almost always auth**, not a missing package: npm returns 404 when it cannot
  match the run to a trusted publisher. Check org, repo, and workflow filename character for
  character.
- **Provenance is on.** The repo is public, so `npm publish --provenance` generates a signed
  attestation linking the tarball to the commit and workflow that built it. Needs `id-token: write`
  (already set). If the repo ever goes private again, drop `--provenance` — it hard-fails on private
  repos.
- **Bump `extension/package.json` and re-run `npm run build:extension` whenever the extension
  changes.** VS Code will not reinstall an unchanged version, and CI fails if the committed `.vsix`
  does not match.

---

## 9. Testing strategy

`node:test` + `node:assert/strict`. No jest, no mocks framework, no fixtures.

| Layer | Where | How |
|---|---|---|
| CLI logic | `test/*.test.js` | Stub `fetch`; write into `mkdtemp()` dirs; never touch `$HOME` |
| Provider | `extension/test/provider.test.js` | `Module._load` swaps in a **stub `vscode` module**, then `require()`s the **built bundle** (`dist/test-entry.cjs`) — so tests exercise the code VS Code actually loads, not the sources |
| Live gateway | manual `curl` | Anything asserting the gateway's behaviour. **Re-run these before trusting §2.** |
| In-editor | a human | Nothing else can prove VS Code drives the provider correctly |

The provider stub must define the real part classes (`LanguageModelTextPart`, `…ToolCallPart`,
`…ToolResultPart`, `…DataPart`) because `provider.js` dispatches on `instanceof`.

**Tests that would have caught the real bugs** (§11) are the ones worth writing: streaming
reassembly across chunk boundaries, tool results ordered before the following user turn, `--yes`
never prompting, backup-before-overwrite.

---

## 10. Open items

1. **A fully rendered answer has not been eyeballed.** The picker, the dispatch to our provider, and
   the streaming thinking block are all confirmed in VS Code; the final answer text was never watched
   to completion. Low risk, but not zero.
2. **`@deepvariance/opencode@0.2.1` is broken in production.** It pins
   `Qwen/Qwen3-VL-30B-A3B-Thinking`, which the gateway 404s. Every opencode tester is dead right now.
   Both its pinned id and the old `qwen-coder` alias now 404; the only working value is the
   current served id. (Owned by the gateway team, not this repo.)
3. **Published.** `@deepvariance/vscode` is live on npm (v0.1.4+) via OIDC trusted publishing with
   provenance; `npx @deepvariance/vscode` works for testers. Releases are automatic on a version bump
   merged to `main`.
4. **(Historical) Continue's built-in web search returned 401** — Continue's *own* free-trial proxy
   (`proxy-server-blue-…run.app/web`) fails with `"Error in Continue free trial server: … 401 Invalid
   API key"`. It never touches our gateway and **no config of ours can fix it.** Not our bug. A real
   fix means an MCP search server (e.g. Exa) with the user's own key. Moot now that Continue is gone.
5. **Proposed-API fragility.** If `languageModelThinkingPart` changes, thinking silently disappears.
   The guard prevents breakage, not disappearance.
6. **Pinned model id is the biggest fragility (recommended: runtime discovery).** The gateway has
   swapped the served model twice and removed the `qwen-coder` alias, and each swap 404s the
   published extension in the field until a manual `MODEL_ID` bump + release (this is why 0.1.6 exists).
   The durable fix is for the provider's `provideLanguageModelChatInformation` to query
   `GET /v1/models` with the key and use `data[0].id` + `max_model_len`, falling back to the pinned
   `MODEL_ID` only when the gateway is unreachable. ~20 lines; it would have made both swaps a no-op.
   Deferred to keep this release small and avoid adding a network call to the picker-population path
   without UX testing.

---

## 11. Bug ledger — do not reintroduce these

Each of these cost real debugging time. They are all now covered by a test or a comment.

| Bug | Root cause | Fix |
|---|---|---|
| CLI hung forever after the health check | `spawnSync` probing `code --version` **inherited a stdin that `@clack/prompts`' spinner had put into raw mode**. Only reproduced when *both* were present, so isolated tests each passed and lied. | `stdio: ['ignore','pipe','pipe']` + `timeout` in `src/editor.js#run` |
| `--yes` still blocked on a prompt | With 2+ editors installed it asked which one, even fully flagged → hangs in any non-TTY (CI). | `--yes` takes `editors[0]` |
| Chat returned `401` after "pasting" the key | The key was **only** put on the clipboard. A later run clobbered it, so the paste inserted *nothing*; VS Code stored an empty key. Copilot's error (`token expired or invalid`) hides the gateway's real message (`missing bearer token`). | Never rely on invisible state — the key is always printed. (Now moot: no paste at all.) |
| Model showed no thinking | `delta.reasoning` was dropped; only `delta.content` was forwarded. | Emit `LanguageModelThinkingPart` (§3.4) |
| `npm test` failed on a fresh clone | Root `node --test` recursed into `extension/`, whose tests need `dist/` built first. | Scope the glob: `node --test test/*.test.js` |
| `node --test test/` crashed | Node tried to `require()` the *directory* as a module. | Use `test/*.test.js` |

---

## 12. Boundaries

**Always**

- Health-check the gateway before installing or writing anything.
- Back up any file before overwriting it (timestamped), and merge rather than replace files shared
  with other tools (`chatLanguageModels.json`, `argv.json`).
- Send the exact model id from `GET /v1/models` (there is no stable alias); update `MODEL_ID` and
  release on every gateway model swap.
- Verify a gateway claim with `curl` before encoding it in code. Every fact in §2 is re-runnable.
- Sandbox `HOME` when testing anything that writes config.
- Bump `extension/package.json` version when the extension changes, or VS Code won't reinstall it.

**Ask first**

- Anything that mints keys against the live gateway with a *new* email — it creates real account
  state that never gets cleaned up.
- Publishing to npm, or installing/uninstalling extensions in the user's real editor.
- Adding a runtime dependency. There is currently exactly one (`@clack/prompts`).

**Never**

- Write VS Code's encrypted secret store directly (Keychain-derived AES over `state.vscdb`). It
  works until the next VS Code update, needs VS Code closed, and is unsupported. This is the 3am
  pager.
- Claim a model capability that has not been verified live.
- Put the API key anywhere permanent in plaintext. The handoff file is deleted on read; that is the
  only plaintext copy that should ever exist.
- Commit a real API key. The *invite* is public by design; keys are not.

---

## 13. Assumptions

State these so they can be corrected rather than silently inherited:

1. Testers are on VS Code. Forks (Cursor, Windsurf, VSCodium, Insiders) are detected and the VSIX
   installs into them, but the provider is only verified on VS Code proper.
2. The gateway stays OpenAI-compatible. It does NOT keep a stable model id or alias — it has
   swapped the served model twice and removed the `qwen-coder` alias, so the pinned `MODEL_ID` must be
   updated + released on each swap (or replaced with runtime discovery).
3. The shared invite model persists (one token for all testers, email is the only per-user input).
4. Testers have Node ≥ 18 available for `npx`.
5. The gateway is a demo: no SLA, and it *has* been down mid-session (Cloudflare `530 / error 1033`).
   That is precisely why the health gate exists.
