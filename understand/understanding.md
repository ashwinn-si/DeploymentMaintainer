# Understanding the project

The mental model, in plain language. Read this after [readme.md](readme.md) and before diving into code.

## The idea in one paragraph

You own some Linux servers. You want "push a button, my repo runs there" without Docker or Kubernetes.
So this project is a small robot living on each server (the **agent**). It knows how to: download your repo
with git, pick the right Node version, install dependencies, start the app under PM2 on a private port,
check it responds, and add an Nginx rule so `https://your-domain/app-name/` reaches it. A second program
(the **control plane**) is the one place you log in, and it tells the right robot what to do. The web page
is just the remote control for the control plane.

## Analogy

- **Control plane** = the head office switchboard. It knows who you are and which branch offices (servers) exist.
- **Agent** = the branch office worker. Trusts only head office (via a shared password), does the real work.
- **PM2** = the supervisor that keeps each app running and restarts it if it dies.
- **Nginx** = the receptionist: reads the URL path and sends the visitor to the right app's port.

## Vocabulary

| Term | Meaning |
|---|---|
| **Server** (dashboard sense) | One managed EC2 box, registered in the control plane |
| **Agent** | The `server/` program running on that box |
| **Control plane** | The `control/` program: login + server list + proxy |
| **App** | One deployable thing: a repo + branch + port + Node version + env + pipeline. The same repo can be several apps. |
| **Deployment** | One run of an app's pipeline, numbered #1, #2… per app |
| **Step** | One stage of the pipeline (git, install, pm2, health check, nginx…) |
| **Mode** | `update` (pull in place), `fresh` (delete folder and re-clone), `rollback` (pin to an old commit) |
| **SERVER_ID / SERVER_SECRET** | The agent's name and its shared password with the control plane |
| **ENCRYPTION_KEY** | A 64-hex key that encrypts stored secrets (one per program, not shared) |
| **SSE** | Server-Sent Events: one-way live stream, used for deploy logs |
| **Path routing** | Apps share one domain, separated by URL prefix (`/app-a/`, `/app-b/`) |

## Two things that confuse people

1. **There are two different secrets.** The dashboard password and JWT protect *you → control plane*. The
   `SERVER_SECRET` protects *control plane → agent*. They are unrelated.
2. **There are two databases.** The control plane keeps users and the server list; each agent keeps its own
   apps and deployments. Losing the control plane doesn't lose your apps (you re-add the servers), but
   changing a program's `ENCRYPTION_KEY` makes its stored secrets unreadable.

## Life of a button click ("Deploy")

`AppDetail` → `api.apps.deploy(id)` → `POST /api/servers/<id>/api/apps/<appId>/deploy` (cookie) →
control plane adds the Bearer secret → agent `POST /api/apps/<appId>/deploy` → `startDeployment` locks the
app, writes a Deployment, kicks off `runPipeline` in the background → UI opens
`GET …/deployments/<id>/stream` and watches steps turn green. Details: [how-it-works.md](how-it-works.md).

## Where to read the code (suggested order)

1. `server/src/steps/index.js`: the list of step types, their config schemas, and the default pipeline. Small and revealing.
2. `server/src/services/deployer.js`: the heart. Read `startDeployment` then `runPipeline`.
3. `server/src/steps/pm2.js`, `healthCheck.js`, `nginx.js` (and their services): the "real" actions.
4. `server/src/services/deployLog.js` + `routes/deployments.js`: how live logs work.
5. `control/src/routes/proxy.js`: the relay.
6. `web/src/api.js`, `web/src/pages/AppDetail.jsx`, `components/StepsEditor.jsx`, `hooks/useDeploymentStream.js`: the UI side.
7. `server/test/*`: the best executable documentation; tests run against fake `pm2`/`fnm`/`sudo`.

## Things that behave in surprising ways

- **A health-check failure is not "the endpoint is missing".** It is also triggered by a crash loop (3+ PM2 restarts), long before a 404 would matter. When it says "crash loop detected", read the app's PM2 log; the cause is in the app, usually missing env vars, a wrong start script, or an unreachable DB.
- **The health check only counts 200–399.** An API that answers 404 at `/` fails unless you set the check path to a route that returns 2xx, or turn the step off. Disabling the step also stops background health monitoring for that app.
- **Changing the start command later** doesn't apply while the app is running (`pm2 startOrReload` keeps the old definition). Run `pm2 delete app-<name>` and redeploy.
- **Rollbacks use today's env and steps**, only the code is old.
- **The lock lives in memory.** Never run these programs in PM2 cluster mode.
- **Empty step configs vanish in MongoDB** (Mongoose drops `{}`), so the API now returns `config: {}` explicitly. That was the cause of the blank Steps tab bug.
- **Two apps must not share an Nginx path.** The app card now shows the full public URL so you can spot this.
- **Secrets are only best-effort masked in logs**, and the app's `.env` is plaintext (mode 600) on disk.
- **The control plane shares server 1's box**: if server 1 is down, the dashboard is down even though other servers keep running their apps.

## Known limitations (from the project's own README)

Control plane on server 1's box; start-command change needs delete + redeploy; single-process only;
first real-server run is the integration test; secrets on disk in plaintext at mode 600; `ENCRYPTION_KEY`
rotation is destructive; rollbacks use current env and steps.

## Quick FAQ

- **Why path routing instead of subdomains?** One domain and one certificate per server; no wildcard DNS or certs.
- **Why does the control plane proxy instead of the browser calling agents?** The agent secret never reaches the browser, agents need no CORS or user system, and one login covers every server.
- **Why SSE and not WebSockets?** Logs are one-way; SSE is simpler and reconnects with `Last-Event-ID`/`after=<i>` replay.
- **Why `shell:false` and tokenized commands?** Prevents shell injection; the cost is no pipes or `&&` in a step (use several steps).
- **Where do deployed apps live on disk?** `APPS_DIR/<app-name>` (default `/home/ubuntu/apps/<name>`), with `.env` and `ecosystem.config.cjs` beside the code.
- **How do I run an app's Node version?** `fnm exec --using=<version> -- <cmd>`, and PM2 gets the matching bin directory on its `PATH`.
