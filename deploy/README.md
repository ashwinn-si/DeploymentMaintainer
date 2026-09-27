# EC2 bootstrap

One-time setup for a fresh **Ubuntu 22.04 or 24.04** EC2 instance, running everything as the
default `ubuntu` user, with one domain you point at the box yourself. Copy-paste the numbered
steps in order.

## 1. System packages

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git nginx build-essential
```

## 2. Node via fnm

PM2 needs `node`, `npm` and `fnm` itself on `PATH` at the moment you run `pm2 startup` (step 10) —
that command bakes in whatever `PATH` your current shell has, so do steps 2–10 in one fresh login
shell rather than a shell you opened before installing fnm.

```bash
curl -fsSL https://fnm.vercel.app/install | bash
```

The installer appends shell setup to `~/.bashrc` automatically. Confirm it's there (or add it
yourself if you skipped the interactive prompt):

```bash
export PATH="$HOME/.local/share/fnm:$PATH"
eval "$(fnm env)"
```

```bash
source ~/.bashrc
fnm install 20
fnm default 20
node -v   # v20.x.x
```

## 3. PM2

```bash
npm i -g pm2
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

## 4. MongoDB

Either install MongoDB Community locally, or skip this step and point `MONGO_URI` (step 5) at an
Atlas cluster instead.

```bash
curl -fsSL https://pgp.mongodb.com/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu $(lsb_release -cs)/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update
sudo apt install -y mongodb-org
sudo systemctl enable --now mongod
```

MongoDB 7.0 supports Ubuntu 22.04 (jammy) but not yet 24.04 (noble) — on noble, swap `7.0` for
`8.0` in both the key URL and the repo line above.

The default `/etc/mongod.conf` already binds to `127.0.0.1` — leave it that way and don't open
27017 in the security group; only the dashboard process on the same box talks to it.

## 5. Clone and configure

```bash
git clone <your-fork-url> ~/deployment_maintainer
cd ~/deployment_maintainer
cp server/.env.example server/.env
mkdir -p /home/ubuntu/apps
```

Edit `server/.env`:

- `MONGO_URI` — `mongodb://127.0.0.1:27017/deployment_maintainer`, or your Atlas URI.
- `JWT_SECRET` and `ENCRYPTION_KEY` — run this **twice** (once per value — they must be different):
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `GITHUB_TOKEN` — a fine-grained PAT with **Contents** and **Metadata** read access (all repos,
  or just the ones you'll deploy).
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — the admin login; password 12+ characters.
- `APPS_DIR=/home/ubuntu/apps`
- `NGINX_APPS_DIR=/etc/nginx/deployer-apps`
- `NGINX_ENABLED=true`
- `NODE_ENV=production`

## 6. Install, build, seed

```bash
npm ci
npm run build
npm run seed
```

## 7. Nginx apps directory

```bash
sudo mkdir -p /etc/nginx/deployer-apps
sudo chown ubuntu:ubuntu /etc/nginx/deployer-apps
```

The dashboard process (running as `ubuntu`) writes per-app route files here directly; only
`nginx -t` and reloading need `sudo` (step 9).

## 8. Install the Nginx site

```bash
sed "s/YOUR_DOMAIN/yourdomain.example.com/g" deploy/nginx-site.conf \
  | sudo tee /etc/nginx/sites-available/deployment-maintainer > /dev/null
sudo ln -sf /etc/nginx/sites-available/deployment-maintainer /etc/nginx/sites-enabled/deployment-maintainer
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

## 9. Install the sudoers file

```bash
sudo visudo -cf deploy/sudoers-deployer
sudo cp deploy/sudoers-deployer /etc/sudoers.d/deployer
sudo chown root:root /etc/sudoers.d/deployer
sudo chmod 0440 /etc/sudoers.d/deployer
sudo visudo -cf /etc/sudoers.d/deployer
```

## 10. Start the dashboard under PM2

```bash
pm2 start deploy/ecosystem.dashboard.cjs
pm2 save
pm2 startup
```

`pm2 startup` prints a `sudo env PATH=$PATH pm2 startup systemd -u ubuntu --hp /home/ubuntu`
command — run exactly what it prints (not a guess at the same command), so it captures your
current `PATH` with `fnm`, `node` and `pm2` all resolvable on it.

Because `NODE_ENV=production`, the session cookie is marked `Secure` and only works over HTTPS —
don't try logging in yet. That's step 11.

## 11. DNS and TLS

Point the domain's `A` record at this instance's public IP first — certbot needs to reach the box
over HTTP to verify it.

```bash
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot
sudo certbot --nginx -d YOUR_DOMAIN
```

Certbot rewrites the Nginx site to add TLS and an HTTP → HTTPS redirect, and installs its own
renewal timer (`sudo certbot renew --dry-run` to check it). Log in at `https://YOUR_DOMAIN` with
the admin credentials from step 5.

## 12. EC2 security group

Open only **22** (SSH — ideally restricted to your IP), **80** and **443**. Every deployed app's
port (4001+) and MongoDB's 27017 stay closed to the internet; only Nginx, on `127.0.0.1`, ever
talks to them.

---

## Updating the dashboard itself

```bash
cd ~/deployment_maintainer
git pull
npm ci
npm run build
pm2 reload deployment-maintainer
```

## Maintenance scripts

- `npm run seed` — upserts the admin user from `server/.env`. Re-running it **resets the password**
  to the `.env` value, so it doubles as the recovery path if you forget a UI-changed password.
- `npm run clear-db` — drops the MongoDB database after a typed confirmation (`--yes` to skip it).
  It does **not** touch PM2 processes, app folders or Nginx config — those keep running on the old
  config until you deploy again. Export your config from Settings first if you want a way back to
  the current app definitions.

## Troubleshooting

- **`nginx -t` fails after a deploy** — read the error, it names the broken file (usually a bad
  `location` path). Fix or remove the offending file under `/etc/nginx/deployer-apps/` and reload.
- **A dashboard action fails with a sudo error** — the app runs `sudo -n nginx -t` / `sudo -n
  systemctl reload nginx` (the `-n` means "fail immediately, don't prompt"), so any sudo failure
  means `/etc/sudoers.d/deployer` is missing, misspelled, or the command in it doesn't
  character-for-character match. Re-check it against step 9.
- **Live deploy logs aren't streaming, just appear all at once at the end** — something between
  the browser and the app is buffering the response. Check `deploy/nginx-site.conf` still has
  `proxy_buffering off;` on `location /api/deployments/`, and that no other reverse proxy (a CDN,
  a load balancer) sits in front of Nginx without the same setting.
- **The dashboard doesn't come back after a reboot** — `pm2 startup` wasn't run (or the printed
  `sudo env PATH=...` command wasn't run afterward), or it was run from a shell without `fnm` on
  `PATH`. Redo step 10 from a fresh login shell, then `pm2 save` again.
- **Disk full / deploys start failing** — check the Server page's disk meter, then delete unused
  apps from the dashboard UI (App detail → Delete) rather than `rm -rf`ing folders by hand, so
  PM2 and Nginx stay in sync with what Mongo thinks exists.

## How path routing works

Each app with the `nginx` step enabled gets a location file at
`/etc/nginx/deployer-apps/<name>.conf`, included inside the site's `server` block. With the
default `stripPrefix: true`, a request to `https://YOUR_DOMAIN/<name>/anything` is proxied to the
app as `/anything` — the app itself only ever sees paths relative to `/`, never the `/<name>/`
prefix, so a plain Express app with no path awareness works unmodified. Turn `stripPrefix` off if
the app needs to see its own mount path.
