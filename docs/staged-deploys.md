# Staged deploys

How a deploy moves between folders, and what happens when it fails. Staged deploys are on by default
(`app.stagedDeploys !== false`; turn them off per app under Overview). Source: `server/src/services/deployer.js`
(`runPipelineSteps`, `smokeAndPromote`, `restoreAfterPromote`) and `server/src/services/staging.js`.

Three sibling folders live next to the app's live folder in `APPS_DIR`. App names are `[a-z0-9-]`, so these dotted names
can never collide with another app.

| Folder | Purpose |
| --- | --- |
| `<app>` | The live version. |
| `<app>.staging` | The new version being built. The live version keeps serving meanwhile. |
| `<app>.previous` | The old live version, kept only until the deploy fully passes, as the safety copy to swap back to. |
| `<app>.failed` | Short-lived: the broken new version while the previous one is being restored. |

## Flow

```mermaid
flowchart TD
    A([Deploy clicked]) --> B{"Enough disk?<br/>live size × 1.2 + 500 MB"}
    B -- no --> F0["Fail early<br/>nothing touched"]
    B -- yes --> C["prepareStaging<br/>delete old name.staging and name.previous"]
    C --> D["Create name.staging<br/>seed from live folder, then git sync"]
    D --> E["Run steps inside name.staging<br/>install, build, custom steps...<br/>live app keeps serving"]
    E --> E1{"Step failed<br/>or cancelled?"}
    E1 -- yes --> X1["Delete name.staging<br/>live folder and process never touched"]
    X1 --> FAIL1([Deploy failed<br/>old version still live])
    E1 -- no --> G{"Node app with<br/>health check on?"}
    G -- yes --> H["Smoke test<br/>start the staged build on a temp port"]
    G -- no --> J
    H --> H1{"Smoke test<br/>passed?"}
    H1 -- "no (and not force)" --> X1
    H1 -- yes --> J["promoteStaging<br/>rename name → name.previous<br/>rename name.staging → name"]
    J --> J1{"Second rename<br/>failed?"}
    J1 -- yes --> J2["Rename name.previous back to name<br/>then delete name.staging"]
    J2 --> FAIL1
    J1 -- no --> K["New version is live<br/>name.previous kept as the safety copy"]
    K --> L["pm2 start / restart<br/>(or publish for static apps)"]
    L --> M["Live health check and remaining steps"]
    M --> M1{"Failed after<br/>the swap?"}
    M1 -- no --> OK["Delete name.previous<br/>free the disk"]
    OK --> DONE([Deploy succeeded])
    M1 -- yes --> N{"Had a previous<br/>good version?"}
    N -- yes --> R["restoreAfterPromote<br/>1. pm2 delete the new process<br/>2. name → name.failed<br/>3. name.previous → name<br/>4. delete name.failed<br/>5. pm2 start the old ecosystem"]
    R --> R1([Deploy failed<br/>old version serving again])
    N -- no --> FAIL2([Deploy failed<br/>app marked failed])
```

## Folders over time (successful deploy)

```mermaid
flowchart LR
    S1["① Start<br/>my-app (live)"] --> S2["② Building<br/>my-app (live, serving)<br/>my-app.staging (new build)"]
    S2 --> S3["③ Swap<br/>my-app.previous (old)<br/>my-app (new)"]
    S3 --> S4["④ Passed<br/>my-app (new)<br/>previous deleted"]
```

## Notes

- **Peak disk use** is the live copy plus one more (`staging` while building, then `previous` after the swap), never
  three. `prepareStaging` clears any old `.staging` and `.previous` first.
- **The swap is two atomic renames** on one filesystem (live → previous, staging → live). If the second fails, the first
  is undone.
- **Failure before the swap** needs no rollback: the live folder and process were never touched, so the staging folder
  is just deleted.
- **Failure after the swap** swaps `.previous` back, but only when an earlier successful deploy exists. A first-ever
  deploy that fails after the swap ends up marked failed. If the restore itself fails, the deploy falls back to the
  normal failure handling (including the rebuild-based auto-rollback on a failed health check).
- **Cancelling after the swap does not swap back.** The log says the new version may already be live. Cancelling before
  it deletes the staging folder.
- **Force deploy** ignores a failed smoke test and failures in forceable steps, and promotes anyway.
- **Crash safety:** on startup the agent deletes leftover `.staging` folders from interrupted deploys, and if the swap was
  cut between its two renames (live folder missing, `.previous` present) it moves `.previous` back to live
  (`repairInterruptedSwap`).
- **Static apps** (Vite, React, plain HTML) have no process or smoke test. They go through the same folder swap, and
  the restore points the `current` release symlink back instead of restarting PM2.
