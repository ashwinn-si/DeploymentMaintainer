# deploy/

Server-side templates used when setting up EC2 instances. The full step-by-step guide (AWS, GitHub token, agent install, control plane, adding more servers, first app) is in [../DEPLOYMENT.md](../DEPLOYMENT.md).

There are two kinds of site. Every server runs an **agent** (the API plus the deploy pipeline). One server (server 1) also runs the **control plane**, the dashboard that manages all agents.

| File | Installed as | Where | Purpose |
|---|---|---|---|
| `nginx-server.conf` | `/etc/nginx/sites-available/deployment-maintainer` | every server | Agent site (`YOUR_SERVER_DOMAIN`): proxies `/api/` and `/deployment-manager` to `:3000`, streams `/api/deployments/` unbuffered (SSE), returns 404 for `/`, and includes the per-app route files from `/etc/nginx/deployer-apps/*.conf` |
| `nginx-control.conf` | `/etc/nginx/sites-available/deployment-control` | server 1 only | Control plane site (`YOUR_CONTROL_DOMAIN`): proxies `/` to `:3100` and streams `/api/servers/` unbuffered (SSE) |
| `sudoers-deployer` | `/etc/sudoers.d/deployer` (root, 0440) | every server | Lets the `ubuntu` user run only `nginx -t` and `systemctl reload nginx` without a password |
| `ecosystem.server.cjs` | `pm2 start deploy/ecosystem.server.cjs` | every server | PM2 definition for the agent (`deployment-maintainer`; single fork-mode process, never cluster it, the deploy lock is in memory) |
| `ecosystem.control.cjs` | `pm2 start deploy/ecosystem.control.cjs` | server 1 only | PM2 definition for the control plane (`deployment-control`; single fork-mode process) |

Replace `YOUR_SERVER_DOMAIN` / `YOUR_CONTROL_DOMAIN` with `sed` when installing (see DEPLOYMENT.md), then run certbot for each domain. Certbot adds the TLS block, so keep the templates HTTP-only.

## How routing works

**Control plane domain** (e.g. `deploy.yourdomain.com`): everything goes to the control plane on `:3100`. The browser only ever talks to this host. The control plane forwards `/api/servers/<id>/api/...` to the right agent with its stored bearer secret. The `/api/servers/` block turns off buffering so live deploy logs stream through.

**Agent domain** (e.g. `api.yourdomain.com`): serves no UI. `/` is a 404, `/deployment-manager` and `/api/` go to the agent on `:3000`, and `/api/deployments/` is the unbuffered SSE variant. Agent API calls need `Authorization: Bearer <SERVER_SECRET>`.

**Deployed apps** live on the agent's domain. Each app with the Nginx step enabled gets `/etc/nginx/deployer-apps/<name>.conf`, included inside the agent's `server` block. Nginx picks the longest matching prefix, so `/<name>/` goes to the app and everything else goes to the agent. With the default `stripPrefix: true`, `https://YOUR_SERVER_DOMAIN/<name>/anything` reaches the app as `/anything`, and `/<name>` redirects to `/<name>/`.
