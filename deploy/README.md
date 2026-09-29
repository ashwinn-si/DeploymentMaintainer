# deploy/

Server-side templates used when setting up the EC2 instance. The full step-by-step guide (AWS, GitHub token, server setup, first app) is in [../DEPLOYMENT.md](../DEPLOYMENT.md).

| File | Installed as | Purpose |
|---|---|---|
| `nginx-site.conf` | `/etc/nginx/sites-available/deployment-maintainer` | Dashboard site: proxies `/` to `:3000`, streams `/api/deployments/` unbuffered (SSE), and includes the per-app route files from `/etc/nginx/deployer-apps/*.conf` |
| `sudoers-deployer` | `/etc/sudoers.d/deployer` (root, 0440) | Lets the `ubuntu` user run only `nginx -t` and `systemctl reload nginx` without a password |
| `ecosystem.dashboard.cjs` | `pm2 start deploy/ecosystem.dashboard.cjs` | PM2 definition for the dashboard itself (single fork-mode process — never cluster it; the deploy lock is in memory) |

## How path routing works

Each app with the Nginx step enabled gets `/etc/nginx/deployer-apps/<name>.conf`, included inside the dashboard's `server` block. Nginx picks the longest matching prefix, so `/<name>/` goes to the app and everything else goes to the dashboard. With the default `stripPrefix: true`, `https://YOUR_DOMAIN/<name>/anything` reaches the app as `/anything`, and `/<name>` redirects to `/<name>/`.
