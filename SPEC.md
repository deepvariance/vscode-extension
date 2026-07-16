# SPEC — deepvariance-vscode

The single source of truth for this repo. Every non-obvious fact here was **verified empirically**
against the live gateway or VS Code's shipped source — not inferred from docs. Where a fact came from
an experiment, the experiment is written down so you can re-run it.

**How this doc is organised.** The middle sections (§2–§9) are stable reference — read them before
changing how the model reaches VS Code; most "obvious" designs are already proven impossible in §5.
The volatile facts (model, versions, dates) live in one place, [§1 Snapshot](#1-snapshot), so there's
a single spot to update. The appendices are **append-only logs** — add to them, don't rewrite them.

## Contents

- [§1 Snapshot](#1-snapshot) — volatile facts, update in place
- [§2 What & why](#2-what--why)
- [§3 Architecture](#3-architecture)
- [§4 Gateway contract](#4-gateway-contract)
- [§5 VS Code platform constraints](#5-vs-code-platform-constraints) — why the obvious approaches fail
- [§6 Working in the repo](#6-working-in-the-repo) — layout, style, commands, testing
- [§7 Release & publishing](#7-release--publishing)
- [§8 Change recipes](#8-change-recipes) — append-only
- [§9 Boundaries & assumptions](#9-boundaries--assumptions)
- [Appendix A — Open items](#appendix-a--open-items) — append-only
- [Appendix B — Bug ledger](#appendix-b--bug-ledger) — append-only
- [Appendix C — Release & model history](#appendix-c--release--model-history) — append-only

---

## 1. Snapshot

**Volatile facts — update this table in place; don't scatter these numbers through the prose.**
Last verified: **2026-07-16**.

| | |
|---|---|
| Gateway | `https://demo.deepvariance.com` (override: `--gateway`, `DEEPVARIANCE_GATEWAY`) |
| Served model id | `Qwen/Qwen3.6-27B-FP8` — the exact id, **no alias** (see §4.5) |
| Display name | `Qwen3.6 27B` |
| Context window | `131072` (`max_model_len`) · max output 8192 · max **4 images/request** |
| Published (npm) | `@deepvariance/vscode` **0.1.8** |
| Extension (vsix) | **0.3.8** |
| Min VS Code | `1.104` to install; agent-mode utility-model fix needs `1.128+` (§5.5) |
| Facts verified on | VS Code 1.127–1.128 |
| Tests | CLI **21** · provider **16** |
| Invite (baked in) | `inv-PxPzaJVIrSdk7F4VeBUiC7X69_qx42Ij` — public by design (§4.4) |

> When the gateway swaps models, this whole table can go stale at once — the served id changes and a
> release is required (§4.5). That coupling is the project's most fragile point; the durable fix is
> [runtime discovery](#appendix-a--open-items).

---

## 2. What & why

Get a tester from *nothing* to *a working AI coding assistant in VS Code* with **one command and zero
manual steps**.

```bash
npx @deepvariance/vscode
```

**User:** a tester at Deep Variance. Has VS Code. Has no API key. Should not have to read a PDF, paste
a key, or edit a config file.

**Replaces:** a 6-step manual setup guide (install Continue → curl a register endpoint → copy the key
→ open `config.yaml` → select-all → paste → save).

**Success criteria:**

- [x] One command; the only question asked is the user's email.
- [x] Nothing is installed or written when the gateway is down.
- [x] No API key is ever pasted by a human.
- [x] No file we touch is destroyed — anything we rewrite is backed up first.
- [x] Re-running is safe and idempotent.
- [x] The model streams, calls tools, reads images, and shows its thinking.
- [x] Verified in VS Code: the model appears in the picker, VS Code dispatches to our provider, the
      thinking block renders. (A fully rendered answer end-to-end is only partially confirmed —
      [Appendix A](#appendix-a--open-items).)

---

## 3. Architecture

Two packages, one shared core. **The CLI and the extension share `src/`, so registration and config
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
VS Code launches
  extension activate()
    ├─ consumeHandoff()             read key → SecretStorage → DELETE the file
    ├─ ensureByokUtilityDefault()   chat.byokUtilityModelDefault = mainAgent (§5.5)
    └─ registerLanguageModelChatProvider('deepvariance', provider)
         ↓
    Chat model picker → "Qwen3.6 27B"
```

**Why the handoff file.** The CLI runs in a terminal; the extension runs in VS Code. They can't share
memory. The key is written `0600` to `~/.deepvariance/handoff.json`; the extension moves it into
SecretStorage and **deletes the file** on activation, so the plaintext copy lives for *seconds*. (The
setup guide this replaces had testers paste the key into a `config.yaml` that keeps it plaintext
**forever**. Seconds beats forever.)

**The extension must stay installed — it *is* what answers Chat's requests.** Uninstalling it removes
the model from the picker. Only the handoff file is transient.

---

## 4. Gateway contract

External facts about `https://demo.deepvariance.com`. All verified with live `curl`. **Re-run these
before trusting them** — the gateway changes under us (§4.5, [Appendix C](#appendix-c--release--model-history)).

### 4.1 Endpoints

| Endpoint | Auth | Behaviour |
|---|---|---|
| `GET /health` | none | `200 {"status":"ok","detail":"upstream ok"}` — reports on its **upstream** too |
| `POST /register` | none (invite in body) | `{email, invite}` → `{api_key, email, created_user}` |
| `GET /v1/models` | Bearer | lists exactly one model |
| `POST /v1/chat/completions` | Bearer | OpenAI-compatible, streaming supported |
| `GET /` | — | `404` (there is no index; a 404 here is normal) |

### 4.2 Authentication — Bearer only

`Authorization: Bearer sk-wh-…` is the *only* accepted mechanism. Every alternative was tested and all
return `401`:

```
X-Api-Key: <key>   → 401     ?api_key=<key> → 401
api-key: <key>     → 401     ?api-key=<key> → 401
                             ?key=<key>     → 401
```

Two distinct 401 bodies, and the difference matters when debugging:

- `{"detail":"missing bearer token"}` → **no key was sent** (or an empty one)
- `{"detail":"invalid or disabled api key"}` → a key was sent but is not valid

> If the gateway ever gains a non-`Authorization` auth header, re-read §5.2 — it would unlock a simpler
> design that is currently impossible.

### 4.3 `POST /register` semantics — not idempotent

- Mints a **brand-new key on every call.** Two calls → two different keys.
- **Old keys keep working** (verified: key #1 still returned `200` after key #2 was issued), so
  re-running setup never breaks a key already in use elsewhere.
- `created_user: false` means *the account already existed* — **not** "an existing key was returned." A
  fresh key is still minted. (An earlier CLI said "existing key returned"; that was a lie, now fixed.)
- Keys accumulate per user with no cleanup. Gateway-side wart, not ours.
- `403 {"detail":"invalid invite token"}` when the invite is wrong.

### 4.4 The invite token is public, by design

```
inv-PxPzaJVIrSdk7F4VeBUiC7X69_qx42Ij
```

It ships as a plaintext constant inside the **public** `@deepvariance/opencode` npm package
(`lib/constants.js`), so baking it into this package adds no new exposure. It's what lets a tester type
only their email. Override with `--invite` / `DEEPVARIANCE_INVITE` when it rotates.

> **Security note for the gateway owner:** anyone who reads that npm tarball can mint keys. The token
> has been rotated server-side at least once and can 403 mid-session while a rotation is in flight.

### 4.5 The model — and why there is no stable alias

The gateway serves **exactly one** model at a time. See the [Snapshot](#1-snapshot) for the current id.

| `model` value sent (now) | Result |
|---|---|
| `Qwen/Qwen3.6-27B-FP8` | **200** — the exact served id. Send this. |
| `qwen-coder` | **404** — this alias was **removed** on the 3.5 → 3.6 swap |
| `Qwen/Qwen3.5-27B-FP8` | 404 — the previous model id is gone |

> **The "always use the alias" theory was wrong.** This file used to say the `qwen-coder` alias
> survives model swaps. It didn't: the gateway removed the alias *and* changed the model in the same
> swap, 404-ing every published extension in the field until a release fixed it. **Reality: there is no
> alias. Pin the exact served id (`MODEL_ID` in `src/model.js`) and cut a release whenever the gateway
> swaps models.** A swap silently breaks the published package until then — the single most fragile
> coupling in the project. The durable fix is runtime discovery ([Appendix A](#appendix-a--open-items)).

### 4.6 Streaming shape — `reasoning` is a separate field

```jsonc
data: {"choices":[{"delta":{"role":"assistant","content":""}}]}
data: {"choices":[{"delta":{"reasoning":"Thinking"}}]}      // ← chain of thought, NOT content
data: {"choices":[{"delta":{"reasoning":" Process"}}]}      // ← ~120 chunks of this in one test
data: {"choices":[{"delta":{"content":"Hello"}}]}           // ← the actual answer
data: [DONE]
```

This is a **reasoning model**: it spends most of its token budget in `reasoning` before emitting any
`content`. Two consequences that will bite you:

1. **Low `max_tokens` yields an empty answer.** With `max_tokens: 16` you get `finish_reason:
   "length"`, `content: null`, and only reasoning. Tests need ≥ ~400 tokens to see a reply.
2. Ignoring `delta.reasoning` makes the model look silent and thoughtless. (It did, until fixed —
   [Appendix B](#appendix-b--bug-ledger).)

### 4.7 Capabilities — verified live, not assumed

| Capability | Verified how |
|---|---|
| Tool calling | `finish_reason:"tool_calls"` with a clean `get_weather({"city":"Paris"})` (via `tool_choice:required`) |
| Vision | Sent a solid crimson PNG, asked the colour → answered **"Red"** |
| Thinking | Streams chain-of-thought in `delta.reasoning` |

> The name has no "VL" but **vision genuinely works.** Don't "fix" `imageInput: true` on the assumption
> that a non-VL model can't see. **Re-verify on every model swap** — capabilities are not guaranteed to
> carry over.

### 4.8 The host behind the gateway (JarvisLabs)

The gateway is a **paused-when-idle GPU box**, not always-on infrastructure. Managed with the `jl` CLI
(`jl list`, `jl pause <id> -y`, `jl resume <id> -y`, `jl exec <id> <cmd>`).

| Fact | Detail |
|---|---|
| Instance | `API-Hosting`, 1× **H200** (143 GB), region IN2 |
| Model server unit | **`warehouse-gateway.service`** — *not* `warehouse`. `systemctl is-enabled warehouse` says "No such file or directory", which looks dead but isn't. |
| Tunnel | `cloudflared.service`, active + enabled |
| **Cold start** | **~140 s** from resume to `/health` 200. Progresses `530` (origin gone) → `502` (tunnel up, app not ready) → `200`. |
| **Resume changes the machine id** | e.g. `444396` → `444694`. Any runbook that hardcodes an id goes stale. |

vLLM is launched roughly like this (explains most of §4):

```
--model Qwen/Qwen3.6-27B-FP8  --max-model-len 131072   # = CONTEXT_WINDOW
--reasoning-parser qwen3                               # = why delta.reasoning exists
--tool-call-parser qwen3_xml                           # ← tuned for 3.5; see the tool-call gotcha in §5.5
--limit-mm-per-prompt {"image": 4}                     # = max 4 images PER REQUEST
--kv-cache-dtype fp8 --max-num-seqs 512 --enable-prefix-caching --gpu-memory-utilization 0.9
```

> **The image limit is per *request*, and a request carries the whole conversation** — images
> accumulate across turns until a chat trips the cap. Rejecting the request would kill the conversation
> permanently (every later turn resends the same images and fails identically), so the provider keeps
> the **4 most recent** images and replaces older ones with a visible note. Degrade, don't die — and
> never drop an image silently, or the model answers confidently about something it cannot see.

**A `530` from the gateway almost always means the instance is paused**, not that anything is broken.

---

## 5. VS Code platform constraints

**This section exists to stop you re-deriving dead ends.** Each claim cites shipped source. Facts
verified on VS Code 1.127–1.128 at `/Applications/Visual Studio Code.app/…`.

### 5.1 Copilot Chat is built in

The `copilot` extension ships **inside** VS Code (`Resources/app/extensions/copilot`), which is why
`code --list-extensions` doesn't list it. BYOK ("bring your own key") **requires no GitHub account and
no Copilot plan.** So the built-in Chat is a legitimate target for testers with nothing installed.

### 5.2 ✗ You cannot automate VS Code's built-in BYOK. Do not try.

Four independent blockers, any one of which is fatal:

1. **The key is a secret-storage reference, not a value.**
   `src/vs/workbench/contrib/chat/common/languageModels.ts` — on write, a schema property marked
   `secret: true` is stored in `ISecretStorageService` under `chat.lm.secret.<hash>`; the file gets
   only an *encoded reference*. On read, `decodeSecretKey(value)` → `secretStorage.get(...)`. A
   plaintext `apiKey` written into `chatLanguageModels.json` is parsed as a *lookup name* and resolves
   to `undefined`. It does not work.
2. **It's only ever collected interactively.** The same file builds a `QuickInput` with
   `inputBox.password = true`. **No command accepts an API key as an argument.**
3. **One extension cannot write another's secrets.** `SecretStorage` is documented in `vscode.d.ts` as
   "secrets stored by **this** extension" and hangs off `ExtensionContext`. There is no API to plant a
   key into Copilot's store. → **A "configure-then-uninstall" helper extension is impossible.**
4. **A keyless group is invisible.** `apiKey` is `required` in the `customendpoint` schema; a group
   without one doesn't appear in the model picker at all. (Observed: a probe with only `requestHeaders`
   never showed up.)

Corollary — the `x-api-key` idea is dead too. VS Code's forbidden `requestHeaders` set (extracted from
the shipped bundle) contains `authorization` and `api-key` but **not** `x-api-key`, so a custom auth
header *would* pass… except the gateway only accepts `Authorization` (§4.2), and blocker 4 means the
group wouldn't render anyway.

### 5.3 ✓ The supported path: be the provider

`vscode.lm.registerLanguageModelChatProvider(vendor, provider)` is **stable API** (present in
`vscode.d.ts`, not a proposal). An extension declaring:

```json
"contributes": { "languageModelChatProviders": [{ "vendor": "deepvariance", "displayName": "Deep Variance" }] }
```

serves models straight into the Chat picker and holds the key in **its own** SecretStorage. No BYOK
group, no `chatLanguageModels.json`, nothing to paste.

### 5.4 ⚠ Thinking requires a proposed API

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

> **README vs reality.** The README tells users to run *Reload Window*, which is correct 99% of the
> time: the model, chat, tools, and vision all appear after a reload (the extension host respawns).
> Only the *thinking view* needs the argv.json flag, applied at Electron launch — so the first time
> argv.json is written, thinking won't render until one full restart. After that it persists and
> reloads are fine forever. Keep the README on "Reload Window"; don't put a restart step in front of
> every user for a one-time, one-feature quirk.

**Risk:** proposed APIs can change or vanish between releases. The provider guards on
`vscode.LanguageModelThinkingPart` being defined and silently drops thinking if it isn't — it degrades,
never breaks, and never dumps raw reasoning into the answer as plain text.

### 5.5 Gotchas — append-only

Platform quirks discovered in the field. **Append here; don't rewrite entries.**

**Agent mode needs a BYOK utility model (VS Code 1.128+).** Agent mode invokes a small *utility model*
for background tasks (titles, summaries) separate from the main model. With a BYOK model and no Copilot
plan, its default `copilot-utility-small` is unavailable, so agent mode errors: *"No utility model is
configured for 'copilot-utility-small' while the selected main agent model is BYOK."* Hit real testers
on every release before **0.1.7**. Not our bug (affects all BYOK providers, e.g. DeepSeek) but it blocks
agent mode out of the box. **Fix, applied for the user:** the extension sets
`chat.byokUtilityModelDefault: "mainAgent"` on activation (`ensureByokUtilityDefault` in
`extension.js`), routing utility calls to the selected BYOK model. Guarded: skips VS Code versions
where the setting doesn't exist (`update()` would throw) and never overrides a user-set value — it only
flips the default `none`.

**Tool calls don't fire in agent mode — gateway-side, not ours.** Qwen3.6 emits tool calls as
`<tool_call><function=name><parameter=key>…`, but the gateway's vLLM `--tool-call-parser` (tuned for
3.5) doesn't parse it, so `tool_calls` comes back empty and the call leaks into `content` as raw text —
the agent "finishes" without acting. `tool_choice:"required"` works (constrained decoding bypasses the
parser); `auto` (what agent mode uses) does not. **Fix is on the gateway:** `--tool-call-parser
qwen3_coder`. A client-side fallback parser is possible but is a workaround for a server
misconfiguration — prefer the gateway fix. Tracked in [Appendix A](#appendix-a--open-items).

**Registering a provider does not publish a model — you must fire the change event.** Agent Sessions
offered only "Auto" while the regular Chat picker showed Qwen3.6 fine. Cause: VS Code keeps a
`_modelCache` and only fills it when a vendor is *resolved* (`_resolveAllLanguageModels` →
`provideLanguageModelChatInformation`). Registering a provider does **not** resolve it; the only
triggers are `selectLanguageModels()` — which the regular Chat picker calls, resolving every vendor —
and the provider's own `onDidChange`. The agent-host bridge behind Agent Sessions
(`AgentHostByokLmHandler.listModels`) only *reads* the cache:

```js
for (let i of this._languageModelsService.getLanguageModelIds())   // = Array.from(_modelCache.keys())
  { let n = lookupLanguageModel(i); n?.isBYOK && !n.targetChatSessionType && t.push({...}) }
```

So on a fresh window nothing had ever resolved us, the cache had no entry, and the bridge logged
`[Copilot] Found 1 models: Auto`. **Fix:** `provider.refresh()` unconditionally at the end of
`activate()` — it fires `onDidChange`, VS Code resolves us, the cache fills, the bridge picks us up.
Previously `refresh()` was only reached via `importHandoff`, which returns early on every startup
after the first. Regression test: *"activation resolves our models, so Agent Sessions can see them."*

Two dead ends ruled out along the way, so nobody re-tries them: **`isBYOK: true` in the model info is
a no-op** — the renderer auto-assigns it (`isBYOK: !isCopilotExtension`), so every non-Copilot
provider is already BYOK. And the **`chatProvider` API proposal is not needed**. Neither changes
anything; the gate was always cache population.

---

## 6. Working in the repo

### 6.1 Project structure

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
  src/provider.js           The LM provider: message translation, SSE, tools, thinking, image cap
  src/extension.js          activate(): consume handoff, ensure utility model, register provider,
                            setup + sign-out commands
  src/test-entry.js         Re-exports internals so tests run against the BUILT bundle
  esbuild.mjs               ESM sources → one CJS file (VS Code loads extensions via require)
  test/provider.test.js     Provider tests, with a stubbed `vscode` module
  *.vsix                    Committed on purpose — it ships inside the npm package
```

**`extension/*.vsix` is committed and listed in `package.json#files`.** That's what lets `npx` install
the provider with no marketplace account. Rebuild it whenever `extension/` changes (§8).

### 6.2 Code style

Plain ESM JavaScript. **No TypeScript, no framework, no test runner beyond `node:test`.** Node ≥ 18 (for
global `fetch`). The only runtime dependency is `@clack/prompts` (and it's bundled into `dist/cli.js`,
so the published package has zero runtime deps).

Stdlib first, further than people expect: `node:util`'s `parseArgs` replaces commander; global `fetch`
replaces axios; `node:test` replaces jest.

Comments explain **why**, never what — a comment earns its place by recording a constraint the code
can't show:

```js
/**
 * Windows needs a shell to run .cmd shims; quote every arg that has whitespace, not just the binary —
 * the npx vsix path (C:\Users\<user>\...) would otherwise split into two tokens under a shell.
 *
 * stdin is 'ignore', never inherited: a prompt library may have put the shared stdin into raw/flowing
 * mode, and a synchronous child that inherits it blocks forever. The timeout backstops a wedged CLI.
 */
function run(bin, args, timeout = 12_000) { … }
```

Every destructive file write follows the same shape: **read → back up → write.** Never clobber.

### 6.3 Commands

```bash
npm test                      # CLI tests (see Snapshot for count)
npm run build:extension       # rebuild + repackage the bundled .vsix  ← after ANY extension/ change
cd extension && npm test      # provider tests, run against the built bundle
cd extension && npm run build # bundle only, no .vsix

node bin/cli.js --help
node bin/cli.js --health      # gateway check only; exits non-zero when down
node bin/cli.js --email you@example.com --yes   # fully non-interactive
```

**Sandbox any test run that writes config**, or it installs into your real VS Code:

```bash
SB=$(mktemp -d); HOME="$SB" node bin/cli.js --email t@example.com --yes
```

`HOME` sandboxing also redirects the `code` CLI's extension dir, so installs land in the sandbox — your
real editor is untouched.

### 6.4 Testing strategy

`node:test` + `node:assert/strict`. No jest, no mock framework, no fixtures.

| Layer | Where | How |
|---|---|---|
| CLI logic | `test/*.test.js` | Stub `fetch`; write into `mkdtemp()` dirs; never touch `$HOME`. Plus one spawn-based smoke test with a hard kill so a hang fails instead of stalling CI. |
| Provider | `extension/test/provider.test.js` | `Module._load` swaps in a **stub `vscode`**, then `require()`s the **built bundle** (`dist/test-entry.cjs`) — so tests exercise the code VS Code actually loads, not the sources |
| Live gateway | manual `curl` | Anything asserting §4. **Re-run before trusting it.** |
| In-editor | a human | Nothing else can prove VS Code drives the provider correctly |

The provider stub must define the real part classes (`LanguageModelTextPart`, `…ToolCallPart`,
`…ToolResultPart`, `…DataPart`) because `provider.js` dispatches on `instanceof`.

---

## 7. Release & publishing

**Automatic.** Bump `version` in the root `package.json`, merge to `main`, and CI publishes. It checks
npm first, so every other commit to `main` is a no-op rather than a failed re-publish.

> The publish gate keys off the **root** version. Bumping only `extension/package.json` ships nothing —
> see the recipe in §8.

Authenticated by **npm trusted publishing (OIDC)**: GitHub mints a short-lived token per run. There is
no `NPM_TOKEN`, no secret to leak or rotate.

### 7.1 No-source publish policy

**No source code is ever published.** Both artifacts ship minified bundles only:

| Artifact | Contents |
|---|---|
| npm tarball | `package.json`, `README.md`, `LICENSE`, `dist/cli.js` (minified, deps bundled, **zero runtime deps**), and the `.vsix` |
| `.vsix` | manifest, `package.json`, readme, license, `dist/extension.js` (minified) |

No `src/`, no `bin/`, no sourcemaps, in either. **CI enforces this on both** — it greps each artifact
for source paths and sourcemaps, asserts the bundles are actually minified, and opens the *committed*
`.vsix` bytes to confirm they aren't stale vs a fresh build. One careless edit to `.vscodeignore` or
`package.json#files` would otherwise republish the source with nobody noticing.

Sourcemaps are off in both esbuild configs *for this reason* — a `.map` puts the source back,
minification or not. Don't turn them on for a published build.

> Minification is not a security control. It raises the cost of reading the code; it hides nothing from
> someone determined. The baked invite is recoverable from the bundle by anyone who looks — it's public
> by design (§4.4), so that's fine, but never put a real secret in the bundle and assume minification
> protects it.

**One README.** A single committed `README.md` ships to GitHub, npm, and the marketplace `.vsix`. The
banner uses an absolute `raw.githubusercontent` URL so it renders on all three (repo is public). The
extension `package` script and the CI `.vsix` step copy it into `extension/` before packaging; nothing
is swapped. No marketplace account is needed — the `.vsix` rides inside the npm tarball.

### 7.2 Why not a token

An npm **automation token bypasses 2FA by design** — a standing credential that publishes with no human
factor. Leak it (CI logs, a compromised third-party action, a maintainer's laptop) and an attacker
publishes as you. That's the mechanism behind most recent npm supply-chain compromises. OIDC mints a
token scoped to this repo and this workflow, useless once the run ends.

### 7.3 Trusted-publishing bootstrap (one-time)

A trusted publisher **cannot be registered for a package that doesn't exist**, so the first release is
manual. Until step 4, CI warns and stays green instead of 404ing on every commit.

1. **Publish once by hand:** `npm login && npm run build && npm publish --access public`
2. **Register the publisher** on npmjs.com → package → *Settings* → *Trusted publisher*: GitHub Actions
   · org `deepvariance` · repo `vscode-extension` · workflow `ci.yml` · environment empty.
   `repository.url` in `package.json` must match the repo exactly or npm rejects the OIDC token.
3. **Slam the door on tokens** — npmjs.com → package → *Settings* → **Publishing access** → **"Require
   two-factor authentication and disallow tokens"**. This is the step that actually buys the security
   and is the easy one to skip: adopting OIDC does nothing on its own if a leaked token can still
   publish. The restriction applies to token auth only — the trusted publisher keeps working.
4. **Switch CI over:** `gh variable set NPM_TRUSTED_PUBLISHING --body true`

*Optional, maximum paranoia:* configure the trusted publisher for `npm stage publish` only. CI stages
a release and a human approves it with an interactive 2FA prompt; `npm stage approve` can't use an OIDC
token, so even a compromised workflow can't ship unattended.

### 7.4 Release gotchas

- **Requires npm ≥ 11.5.1.** `setup-node` ships npm 10.x, so CI upgrades it in the job.
- **A `404` on publish is almost always auth**, not a missing package: npm returns 404 when it can't
  match the run to a trusted publisher. Check org, repo, and workflow filename character for character.
- **Provenance is on.** The repo is public, so `npm publish --provenance` generates a signed attestation
  linking the tarball to the commit and workflow. Needs `id-token: write` (set). If the repo ever goes
  private, drop `--provenance` — it hard-fails on private repos.
- **Committing a new `.vsix`?** `git rm` the old versioned file in the same commit — a glob `git add`
  won't stage the deletion, and CI fails if two `.vsix` files are present.

---

## 8. Change recipes

**Append-only** — each recipe lists the files to touch and how to verify. Add recipes; don't delete
them.

**Change the gateway URL** — `src/gateway.js` → `DEFAULT_GATEWAY`. Nothing else derives from anywhere
else. Existing installs keep their `globalState` copy until setup re-runs.
Verify: `node bin/cli.js --health --gateway https://new-host`.

**Rotate the invite** — `src/gateway.js` → `DEFAULT_INVITE`. Old versions can pass `--invite`.
Verify: a wrong invite must produce `403 … invite token was rejected`.

**Swap the backing model** — there's no alias to lean on (§4.5), so a swap **always** needs a code
change: set `MODEL_ID` in `src/model.js` to the new `GET /v1/models` id (verify with `curl` first),
update the display name if it changed, `npm run build:extension`, bump **both** versions, release.
Re-verify capabilities live (§4.7) — they may not carry over. Log it in [Appendix C](#appendix-c--release--model-history).

**Change the extension (provider, activation, manifest)** —
1. Edit `extension/src/**`.
2. Bump `extension/package.json` version — VS Code won't reinstall the same version.
3. **Also bump the root `package.json` version** — the publish gate keys off root; an extension-only
   bump ships nothing to npm and your work never reaches users.
4. `npm run build:extension` → new `.vsix`; `git rm` the old one, `git add` the new one.
5. `cd extension && npm test`.
Verify for real: `code --install-extension extension/*.vsix --force`, **fully quit and reopen** VS
Code, send a Chat message.

**Add a model capability (embeddings, autocomplete, …)** — `extension/src/provider.js` →
`provideLanguageModelChatInformation()` returns `capabilities`. **Only claim what you've verified live
with curl** — a false claim fails at message time, in the user's face, not at setup.

**Add a new setup target** — `bin/cli.js` add to the flow; add a `src/<target>-config.js` owning only
that target's file (back up before writing); guard with a `wants<Target>` flag; one test per target.

**Publish a release** — bump root `version`, merge to `main`. CI does the rest (§7).

---

## 9. Boundaries & assumptions

### Always

- Health-check the gateway before installing or writing anything.
- Back up any file before overwriting it, and **merge** rather than replace files shared with other
  tools (`argv.json`, `chatLanguageModels.json`).
- Send the exact model id from `GET /v1/models` (no stable alias); bump `MODEL_ID` and release on every
  gateway model swap.
- Verify a gateway claim with `curl` before encoding it. Every fact in §4 is re-runnable.
- Sandbox `HOME` when testing anything that writes config.
- Bump `extension/package.json` **and** root `package.json` when the extension changes.

### Ask first

- Minting keys against the live gateway with a *new* email — it creates real account state that never
  gets cleaned up.
- Publishing to npm, or installing/uninstalling extensions in the user's real editor.
- Adding a runtime dependency. There is currently exactly one, and it's bundled away.

### Never

- Write VS Code's encrypted secret store directly (Keychain-derived AES over `state.vscdb`). Works
  until the next VS Code update, needs VS Code closed, unsupported — the 3am pager.
- Claim a model capability that hasn't been verified live.
- Put the API key anywhere permanent in plaintext. The handoff file is deleted on read; that's the only
  plaintext copy that should ever exist.
- Commit a real API key. The *invite* is public by design; keys are not.

### Assumptions (correct these rather than silently inherit them)

1. Testers are on VS Code. Forks (Cursor, Windsurf, VSCodium, Insiders) are detected and the VSIX
   installs into them, but the provider is only verified on VS Code proper.
2. The gateway stays OpenAI-compatible. It does **not** keep a stable model id or alias — it has swapped
   the served model twice and removed `qwen-coder`, so `MODEL_ID` must be updated + released on each
   swap (or replaced with runtime discovery).
3. The shared invite model persists (one token for all testers; email is the only per-user input).
4. Testers have Node ≥ 18 for `npx`.
5. The gateway is a demo: no SLA, and it *has* been down mid-session (`530`). That's why the health gate
   exists.

---

## Appendix A — Open items

**Append-only.** Add items; mark resolved rather than deleting, so the history stays.

1. **Agent-mode tool calls don't fire (gateway-side).** The gateway's `--tool-call-parser` doesn't
   parse Qwen3.6's `<function=…>` format (§5.5). One-line gateway fix: `--tool-call-parser qwen3_coder`.
   Owned by the gateway team. Until then, Ask mode works; agent mode reasons but doesn't act.
2. **Pinned model id is the biggest fragility — recommended: runtime discovery.** The gateway has
   swapped the model twice and removed the alias, and each swap 404s the published extension until a
   manual `MODEL_ID` bump + release. Durable fix: `provideLanguageModelChatInformation` queries
   `GET /v1/models` and uses `data[0].id` + `max_model_len`, falling back to the pinned `MODEL_ID` only
   when the gateway is unreachable. ~20 lines; would have made every swap a no-op. Deferred to avoid a
   network call on the picker-population path without UX testing.
3. **The CLI doesn't check the VS Code *version*.** `detectEditors` only checks that `code --version`
   exits 0. On too-old VS Code the install fails downstream with vsce's raw "not compatible" error
   rather than a friendly "need ≥ 1.104". `code --version` prints the semver on line 1 — a small
   parse-and-compare. Note the two tiers: 1.104 to install, 1.128 for the agent-mode utility fix.
4. **A fully rendered answer end-to-end hasn't been eyeballed by a human** past the thinking block. Low
   risk, not zero.
5. **Proposed-API fragility.** If `languageModelThinkingPart` changes, thinking silently disappears. The
   guard prevents breakage, not disappearance.
6. **(Not ours) `@deepvariance/opencode@0.2.1` is broken.** It pins `Qwen/Qwen3-VL-30B-A3B-Thinking`,
   which 404s; both that id and the old `qwen-coder` alias are gone. Only the current served id works.
   Owned by the gateway team.
7. **(Resolved 0.1.4+)** Published to npm via OIDC trusted publishing with provenance; `npx` works.
8. **(Historical, moot)** Continue's built-in web search returned 401 from *Continue's* own free-trial
   proxy — never touched our gateway, no config of ours could fix it. Moot since the Continue path was
   removed.

---

## Appendix B — Bug ledger

**Append-only. Do not reintroduce these.** Each cost real debugging time and is now covered by a test
or a comment.

| Bug | Root cause | Fix |
|---|---|---|
| CLI hung forever after the health check | `spawnSync` probing `code --version` **inherited a stdin that `@clack/prompts`' spinner put into raw mode**. Only reproduced with *both* present, so isolated tests each passed and lied. | `stdio:['ignore','pipe','pipe']` + timeout in `src/editor.js#run` |
| `--yes` blocked on the editor prompt | With 2+ editors installed it asked which one, even fully flagged → hangs in any non-TTY. | `--yes` takes `editors[0]` |
| `--yes` blocked on the **email** prompt | Only the editor prompt was guarded; `text()` never resolves on a non-TTY. | guard email on `values.yes \|\| !stdin.isTTY` |
| Windows install broke on a spaced username | `run()` quoted the binary but not the args, so the npx vsix path split into two tokens under a shell. | quote every whitespace arg |
| Chat `401` after "pasting" the key | The key was only put on the clipboard; a later run clobbered it, so the paste inserted nothing and VS Code stored an empty key. Copilot's error hid the gateway's real `missing bearer token`. | Never rely on invisible state. (Moot now: no paste at all.) |
| Model showed no thinking | `delta.reasoning` was dropped; only `delta.content` forwarded. | Emit `LanguageModelThinkingPart` (§5.4) |
| Image in a tool result dumped a byte blob | A `LanguageModelDataPart` hit the `JSON.stringify` fallback. | short `[tool returned an image]` placeholder |
| `register()` threw a raw `TypeError` on a `null` 2xx body | `null.api_key`. | guard the whole body |
| Bad flag dumped a raw Node stack trace | `parseArgs` ran outside `main().catch`. | wrap it; print the help |
| Published extension 404'd every chat | Sent the `qwen-coder` alias after the gateway removed it on the 3.5→3.6 swap. | pin the served id, release (§4.5) |
| CI passed a stale/duplicate `.vsix` | `git add *.vsix` staged the new file but not the old one's deletion; the check globbed two files. | assert exactly one `.vsix`; `git rm` the old |
| `npm test` failed on a fresh clone | Root `node --test` recursed into `extension/`, whose tests need `dist/`. | scope the glob: `node --test test/*.test.js` |
| `node --test test/` crashed | Node tried to `require()` the directory. | use `test/*.test.js` |

---

## Appendix C — Release & model history

**Append-only.** One line per notable release or gateway change, newest last.

| When | What | Why |
|---|---|---|
| — | Model `Qwen3-VL-30B` (original PDF-era) | first gateway model |
| — | Gateway swap → `Qwen/Qwen3.5-27B-FP8` | model changed under us |
| 0.1.0 | First npx CLI + provider extension, built-in Chat path | replace the manual 6-step guide |
| 0.1.3 | Repo public, single README, provenance on | drop the two-README split |
| 0.1.4 | First OIDC-published release | kill the standing npm token |
| 0.1.5 | Review follow-ups (Windows quoting, `--yes` hang, null-body, etc.) | bugs found in a full review |
| 0.1.6 | Gateway swap → `Qwen/Qwen3.6-27B-FP8`; **`qwen-coder` alias removed** | published extension was 404ing every chat |
| 0.1.7 | Auto-set `chat.byokUtilityModelDefault: mainAgent` on activation | agent mode errored out of the box for every BYOK tester |
| 0.1.8 | Fire `onDidChange` on activation (extension 0.3.8) | Agent Sessions only offered "Auto" — our model was never resolved into VS Code's cache |
