# Deployment Maintainer: start here

A self-hosted "mini-Vercel" for your own EC2 servers. You log in to one dashboard, pick a server, pick a
GitHub repo and branch, set env vars and a deploy pipeline, and click **Deploy**. Later deploys are one
click, with live logs, health checks, rollback, and path-based URLs like `https://api.example.com/my-app/`.

## The reading guide (in this order)

| File | Read it when you want to know... |
|---|---|
| [readme.md](readme.md) (this file) | What the project is, its pieces, and the repo map |
| [understanding.md](understanding.md) | The mental model in plain language, key terms, gotchas, and what to read in the code |
| [architecture.md](architecture.md) | How the three programs, two databases and Nginx fit together, plus security design |
| [how-it-works.md](how-it-works.md) | Step-by-step flows: login, add server, deploy, live logs, rollback, health monitoring |
| [setup.md](setup.md) | How to run it locally, and the short version of the production setup |

Deeper references already in the repo: [../README.md](../README.md), [../DEPLOYMENT.md](../DEPLOYMENT.md) (full AWS guide),
[../docs/api-contract.md](../docs/api-contract.md) (every endpoint), [../style.md](../style.md) (UI design system).

## The three programs

The repo is an npm workspace with three packages that run as separate processes:

| Package | What it is | Runs where | Port |
|---|---|---|---|
| `web/` | The dashboard UI (React 19 + Vite + Tailwind 4) | Browser. Built to static files, served by `control/` or hosted on Vercel | dev: 5173 |
| `control/` | The **control plane**: admin login, list of servers, a proxy to agents | One box (server 1) | 3100 |
| `server/` | The **agent**: runs the deploy pipeline, PM2, Nginx routes, one per managed server | Every managed EC2 | 3000 |

The browser only ever talks to `control/`. `control/` forwards requests to the right agent, adding that
agent's secret. Agents have no users and no UI.

```
Browser ──cookie──▶ control/ (:3100) ──Bearer SERVER_SECRET──▶ server/ agent (:3000) ──▶ PM2 apps (:4001, :4002 …)
                       │                                          │                       ▲
                    MongoDB                                    MongoDB              Nginx /app-name/
              (deployment_control)                        (deployment_maintainer)
```

## Repo map

```
package.json            npm workspaces: server, control, web; root scripts (dev, seed, test, build)
server/                 THE AGENT
  src/index.js          Express app + startup (connect DB, recover stuck deploys, start monitor)
  src/config.js         Env validation with zod
  src/routes/           apps, deployments (incl. SSE stream), repos, ports, node, system, settings, config-io, handshake
  src/services/         deployer (the engine), git, pm2, nginx, node (fnm), shell, crypto, deployLog, monitor, github, ports, system
  src/steps/            One file per pipeline step: gitSync, nodeSetup, writeEnv, install, build, custom, pm2, healthCheck, nginx
  src/models/           App, Deployment (Mongoose)
  src/middleware/auth.js  Bearer-secret check
  test/                 193 tests, using fake pm2/fnm/sudo
control/                THE CONTROL PLANE
  src/index.js          Express app: auth, servers, proxy, serves web/dist
  src/routes/           auth, account, servers, proxy
  src/models/           User, Server
  src/services/         agentClient (handshake/verify), statusCache (15s)
  src/middleware/       auth (JWT cookie), originCheck (CSRF)
  scripts/              seed.js (admin user), clear-db.js
web/                    THE DASHBOARD
  src/pages/            Servers, Apps, NewApp, AppDetail, Deployments, DeploymentDetail, Ports, Server, ServerSettings, Account, Login
  src/components/       StepsEditor, EnvEditor, LogViewer, StepTimeline, pickers, dialogs, ui/ and layout/
  src/context/          Auth, Servers, Server (current), Theme
  src/api.js            All HTTP calls to the control plane
  src/hooks/            useDeploymentStream (SSE), useActiveDeployments, useSystemStats
deploy/                 Nginx site templates, sudoers rule, PM2 ecosystem files for the agent and control plane
docs/api-contract.md    Endpoint reference for both APIs
DEPLOYMENT.md           Full AWS walkthrough
deployment-helper.md    Copy-paste version of the EC2 setup
handoff.md              Snapshot of the live state at a point in time
plan-29.09.md           The multi-server design plan
style.md                The glassmorphism UI design system
```

## Tech at a glance

Node 20+ (ES modules), Express, Mongoose/MongoDB, zod for validation, PM2 to run apps, fnm to switch Node
versions per app, Nginx for routing, Server-Sent Events for live logs, AES-256-GCM for secrets at rest,
JWT cookie for the dashboard login, Bearer secret between control plane and agents.
