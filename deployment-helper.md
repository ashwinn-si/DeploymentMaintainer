# Deployment helper: fresh EC2 → working setup

Copy-paste guide for **one fresh Ubuntu EC2** that runs both:

| What                                                                                   | Where          | Example domain        |
| -------------------------------------------------------------------------------------- | -------------- | --------------------- |
| **Agent** (`server/`): deploys your apps; your apps live at `https://api…/<app-name>/` | EC2, port 3000 | `api.ashwinsi.in`     |
| **Control plane API** (`control/`): login, server list, proxy to agents                | EC2, port 3100 | `control.ashwinsi.in` |
| **Dashboard UI** (`web/`)                                                              | **Vercel**     | `deploy.ashwinsi.in`  |

The database is **MongoDB Atlas** (cloud), and the repo `ashwinn-si/DeploymentMaintainer` is **public**, so there's no local MongoDB and no deploy key.

> **All three domains must be under the same parent domain** (here `ashwinsi.in`). The login cookie only works when the UI and the control API are "same-site". A `*.vercel.app` URL will **not** be able to log in, so give Vercel a custom domain (Part 5).

Commands marked **[Mac]** run on your laptop. Commands marked **[EC2]** run on the server over SSH. Everything else happens in a web console (AWS, GitHub, DNS, Vercel).

---

## Part 1: AWS console (one time)

### 1.1 Security group

EC2 → your instance → **Security** tab → click the security group → **Edit inbound rules**. Make it exactly:

| Type  | Port | Source    |
| ----- | ---- | --------- |
| SSH   | 22   | **My IP** |
| HTTP  | 80   | 0.0.0.0/0 |
| HTTPS | 443  | 0.0.0.0/0 |

Nothing else. 3000, 3100 and 4001+ stay closed; Nginx fronts everything. (MongoDB is in Atlas, so no database port is needed on this box.)

### 1.2 Elastic IP (fixed IP)

EC2 → **Elastic IPs → Allocate** → select it → **Actions → Associate** → your instance. Note the IP; below it's `YOUR_IP`.

### 1.3 Disk and size check

- At least **20 GB** of disk. Each deployed app keeps its own `node_modules`.
- **t3.small (2 GB RAM)** or bigger is recommended. A t3.micro works with the swap file added in step 3.2.

---

## Part 2: DNS and GitHub (one time)

### 2.1 DNS records (at your domain provider)

| Type | Name      | Value     |
| ---- | --------- | --------- |
| A    | `api`     | `YOUR_IP` |
| A    | `control` | `YOUR_IP` |

You'll add `deploy` in Part 5, once Vercel gives you its target. On Cloudflare, set these records to **DNS only** (grey cloud).

Check from your Mac until both print `YOUR_IP`. This can take a few minutes:

**[Mac]**

```bash
dig +short api.ashwinsi.in
dig +short control.ashwinsi.in
```

### 2.2 GitHub token (lets the agent list and clone your repos)

GitHub → avatar → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**:

- **Resource owner:** you (or your org)
- **Repository access:** All repositories
- **Repository permissions:** **Contents: Read-only** (Metadata is added automatically)
- **Expiration:** up to 1 year (set a reminder)

Copy the `github_pat_…` value. You'll paste it in step 3.8.

### 2.3 MongoDB Atlas (the cloud database)

At [cloud.mongodb.com](https://cloud.mongodb.com):

1. **Create a cluster.** The free **M0** tier is fine to start. Pick the AWS region closest to your EC2 (e.g. Mumbai `ap-south-1`).
2. **Security → Database Access → Add New Database User**:
   - Authentication: **Password**. Username e.g. `dm-app`.
   - Click **Autogenerate Secure Password** and copy it. Generated passwords contain only letters and digits, which matters because special characters would need URL-encoding in the connection string.
   - Built-in role: **Read and write to any database**. Add the user.
3. **Security → Network Access → Add IP Address**: enter **`YOUR_IP/32`** (the Elastic IP from 1.2), with the comment `EC2 main`. Confirm. Don't use `0.0.0.0/0`.
4. **Database → Connect → Drivers** (Node.js): copy the connection string. It looks like:
   ```
   mongodb+srv://dm-app:<db_password>@cluster0.abcd123.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
   ```
   Replace `<db_password>` with the real password. **Keep only the part before the `/?`**, for example:
   ```
   mongodb+srv://dm-app:THEPASSWORD@cluster0.abcd123.mongodb.net
   ```
   You'll paste this in step 3.8. The script adds a separate database name for the agent and for the control plane, so you don't need to create databases; Atlas creates them on first write.

---

## Part 3: Set up the EC2

### 3.1 SSH in

**[Mac]**

```bash
chmod 400 ~/.ssh/YOUR_KEY.pem
ssh -i ~/.ssh/YOUR_KEY.pem ubuntu@YOUR_IP
```

### 3.2 Base packages + swap

**[EC2]**

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git nginx build-essential unzip curl
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

### 3.3 Your settings (edit once)

**[EC2]**: run this, then change the values in `nano` to yours:

```bash
cat > ~/dm-setup.env <<'EOF'
export AGENT_DOMAIN=api.ashwinsi.in
export CONTROL_DOMAIN=control.ashwinsi.in
export UI_ORIGIN=https://deploy.ashwinsi.in
export ADMIN_EMAIL=you@example.com
export LETSENCRYPT_EMAIL=you@example.com
export REPO_URL=https://github.com/ashwinn-si/DeploymentMaintainer.git
export AGENT_DB=deployment_maintainer
export CONTROL_DB=deployment_control
EOF
nano ~/dm-setup.env
```

Save with `Ctrl+O`, Enter, `Ctrl+X`. Then load it. **Re-run this line whenever you open a new SSH session:**

```bash
source ~/dm-setup.env && echo "$AGENT_DOMAIN $CONTROL_DOMAIN $UI_ORIGIN"
```

### 3.4 Node.js (fnm) with a reboot-safe PATH

**[EC2]**

```bash
curl -fsSL https://fnm.vercel.app/install | bash
source ~/.bashrc
fnm install 20 && fnm default 20
echo 'export PATH="$HOME/.local/share/fnm/aliases/default/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc && source ~/dm-setup.env
which node     # MUST be /home/ubuntu/.local/share/fnm/aliases/default/bin/node
node -v        # v20.x
```

### 3.5 PM2

**[EC2]**

```bash
npm install -g pm2
which pm2      # MUST be /home/ubuntu/.local/share/fnm/aliases/default/bin/pm2
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

### 3.6 (MongoDB is in Atlas, so nothing to install here)

The cluster, user and IP allowlist are set up in step 2.3. The connection is tested in step 3.8.

### 3.7 Clone the repo (public, no key needed)

**[EC2]**

```bash
source ~/dm-setup.env
git clone "$REPO_URL" ~/DeploymentMaintainer
cd ~/DeploymentMaintainer && npm ci
mkdir -p ~/apps
```

### 3.8 Write both `.env` files (secrets are generated for you)

**[EC2]**: it asks for the GitHub token, the Atlas connection string from 2.3 (the part before `/?`), and the admin password you want. Don't use `'` in the password:

```bash
cd ~/DeploymentMaintainer && source ~/dm-setup.env
read -rsp "GitHub token (github_pat_...): " GH_TOKEN; echo
read -rsp "Atlas URI (mongodb+srv://user:pass@cluster...mongodb.net): " ATLAS_URI; echo
read -rsp "Dashboard admin password (12+ chars, no single quotes): " ADMIN_PW; echo
ATLAS_URI="${ATLAS_URI%%.mongodb.net*}.mongodb.net"   # keep only up to the host, whatever form was pasted
DB_OPTS="?retryWrites=true&w=majority"
gen_hex() { node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"; }
gen_b64() { node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"; }
SERVER_ID=$(node -e "console.log(require('crypto').randomUUID())")
SERVER_SECRET=$(gen_b64)

cat > server/.env <<EOF
PORT=3000
MONGO_URI=$ATLAS_URI/$AGENT_DB$DB_OPTS
SERVER_ID=$SERVER_ID
SERVER_SECRET=$SERVER_SECRET
ENCRYPTION_KEY=$(gen_hex)
GITHUB_TOKEN=$GH_TOKEN
APPS_DIR=/home/ubuntu/apps
NGINX_APPS_DIR=/etc/nginx/deployer-apps
APP_PORT_START=4001
DEFAULT_NODE_VERSION=20
NGINX_ENABLED=true
NODE_ENV=production
GIT_REMOTE_BASE=https://github.com
EOF

cat > control/.env <<EOF
PORT=3100
MONGO_URI=$ATLAS_URI/$CONTROL_DB$DB_OPTS
JWT_SECRET=$(gen_hex)
ENCRYPTION_KEY=$(gen_hex)
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD='$ADMIN_PW'
NODE_ENV=production
ALLOW_INSECURE_SERVER_URLS=false
CORS_ORIGINS=$UI_ORIGIN
EOF

chmod 600 server/.env control/.env
unset GH_TOKEN ADMIN_PW ATLAS_URI

# Test the Atlas connection before going further
(cd server && node --input-type=module -e "import 'dotenv/config'; import m from 'mongoose'; await m.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 }); console.log('Atlas OK →', m.connection.name); await m.disconnect();")

npm run seed       # → "Created admin user you@example.com."
```

The test should print `Atlas OK → deployment_maintainer`. If it fails with `MongooseServerSelectionError` or a timeout, the EC2's IP isn't in Atlas **Network Access** (2.3 step 3). `bad auth` means the user or password in the URI is wrong. Fix it, edit `MONGO_URI` in both `.env` files with `nano`, then re-run the test.

> **Back up both `.env` files** (password manager). The `ENCRYPTION_KEY` values can't be recovered; if one is lost, the stored env vars / server secrets are unreadable. The Atlas data is safe either way; Atlas handles database backups (enable them under the cluster's **Backup** tab on paid tiers).

### 3.9 Nginx sites

**[EC2]**

```bash
cd ~/DeploymentMaintainer && source ~/dm-setup.env
sudo mkdir -p /etc/nginx/deployer-apps && sudo chown ubuntu:ubuntu /etc/nginx/deployer-apps
sed "s/YOUR_SERVER_DOMAIN/$AGENT_DOMAIN/g" deploy/nginx-server.conf | sudo tee /etc/nginx/sites-available/dm-agent > /dev/null
sed "s/YOUR_CONTROL_DOMAIN/$CONTROL_DOMAIN/g" deploy/nginx-control.conf | sudo tee /etc/nginx/sites-available/dm-control > /dev/null
sudo ln -sf /etc/nginx/sites-available/dm-agent /etc/nginx/sites-enabled/dm-agent
sudo ln -sf /etc/nginx/sites-available/dm-control /etc/nginx/sites-enabled/dm-control
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 3.10 Allow the agent to reload Nginx (sudoers)

**[EC2]**

```bash
cd ~/DeploymentMaintainer
sudo visudo -cf deploy/sudoers-deployer
sudo install -o root -g root -m 0440 deploy/sudoers-deployer /etc/sudoers.d/deployer
sudo -n nginx -t && echo "sudo rule OK"
```

### 3.11 HTTPS for both domains

DNS from 2.1 must already resolve to `YOUR_IP`.

**[EC2]**

```bash
source ~/dm-setup.env
sudo snap install --classic certbot && sudo ln -sf /snap/bin/certbot /usr/bin/certbot
sudo certbot --nginx --non-interactive --agree-tos --redirect -m "$LETSENCRYPT_EMAIL" -d "$AGENT_DOMAIN"
sudo certbot --nginx --non-interactive --agree-tos --redirect -m "$LETSENCRYPT_EMAIL" -d "$CONTROL_DOMAIN"
sudo certbot renew --dry-run
```

### 3.12 Start everything under PM2 (and on every reboot)

**[EC2]**

```bash
cd ~/DeploymentMaintainer
pm2 start deploy/ecosystem.server.config.cjs
pm2 start deploy/ecosystem.control.config.cjs
pm2 save
sudo env PATH="$PATH" "$(which pm2)" startup systemd -u "$USER" --hp "$HOME"
pm2 save
pm2 status          # deployment-maintainer + deployment-control → online
```

### 3.13 Check it works

**[EC2]**

```bash
source ~/dm-setup.env
curl -s "https://$AGENT_DOMAIN/deployment-manager"; echo           # {"service":"deployment-maintainer","serverId":"…"}
curl -s -o /dev/null -w "%{http_code}\n" "https://$AGENT_DOMAIN/api/apps"     # 401 (good: needs the secret)
curl -s "https://$CONTROL_DOMAIN/api/health"; echo                  # {"ok":true}
curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS -H "Origin: $UI_ORIGIN" -H "Access-Control-Request-Method: GET" "https://$CONTROL_DOMAIN/api/servers"   # 204
```

Also test a reboot: `sudo reboot`, wait ~1 min, SSH back in, and run `pm2 status`. Both processes should be online.

### 3.14 Print the values for "Add Server"

**[EC2]**

```bash
grep -E '^SERVER_(ID|SECRET)=' ~/DeploymentMaintainer/server/.env
```

Keep this output for Part 6.

---

## Part 4: Push the repo (if you changed anything locally)

Vercel builds from GitHub. Make sure the latest commit is pushed:

**[Mac]**

```bash
cd ~/projects/deployment_maintainer && git push origin master
```

---

## Part 5: Deploy the UI on Vercel

1. vercel.com → **Add New… → Project** → import `ashwinn-si/DeploymentMaintainer`.
2. **Configure Project:**

| Setting                  | Value                                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Framework Preset         | **Vite**                                                                                                   |
| Root Directory           | **`web`**                                                                                                  |
| Build Command            | `npm run build`                                                                                            |
| Output Directory         | `dist`                                                                                                     |
| Install Command          | leave default (if the build can't find packages, set it to `cd .. && npm ci`)                              |
| **Environment Variable** | `VITE_API_URL` = `https://control.ashwinsi.in` (your `CONTROL_DOMAIN`, with `https://`, no trailing slash) |

3. **Deploy.**
4. Project → **Settings → Domains → Add** `deploy.ashwinsi.in`. Vercel shows a DNS record, usually **CNAME `deploy` → `cname.vercel-dns.com`**. Add it at your DNS provider and wait until Vercel shows **Valid Configuration**.
5. The domain must exactly match `UI_ORIGIN` from step 3.3. If you change it, update `CORS_ORIGINS` in `control/.env` and run `pm2 reload deployment-control`.

> `VITE_API_URL` is baked in at build time. If you change it later, click **Redeploy** in Vercel.

---

## Part 6: First login and Add Server

1. Open `https://deploy.ashwinsi.in` and log in with `ADMIN_EMAIL` and the admin password from step 3.8.
2. **Servers → Add Server:**
   - **Name:** e.g. `Main EC2`
   - **URL:** `https://api.ashwinsi.in` (your `AGENT_DOMAIN`)
   - On the next step, switch on **"I already have an ID and secret"**, then paste `SERVER_ID` and `SERVER_SECRET` from step 3.14.
   - **Verify & add.** The server shows **online**.
3. Open the server, then go to **Settings**. The GitHub card should show your GitHub username.

### Deploy your first app

- **New App:** pick a repo and branch.
- **Name:** this becomes the URL path, e.g. `my-api` gives `https://api.ashwinsi.in/my-api/`.
- **Port:** filled in automatically.
- **Environment:** add your env vars.
- **Create & Deploy:** you'll see the live log.

Your app must:

- listen on `process.env.PORT`
- have an `npm start` script (enable the Build step if it needs one)
- return 2xx/3xx on its health-check path (default `/`; change it to e.g. `/health` in the Steps tab)

Requests reach the app **without** the `/my-api` prefix.

---

## Part 7: Adding a second server later

On the new EC2, do Part 1, **2.1 (only the `api2` record)**, 2.2 (the same token is fine), and Part 3 **except**:

- In **Atlas → Network Access**, add the new EC2's Elastic IP (`/32`). The same cluster and user are fine.
- In 3.3, set `AGENT_DOMAIN=api2.ashwinsi.in` and **`AGENT_DB=deployment_maintainer_api2`**. Every server needs its own database name, or their apps and deployments mix. The other values don't matter there.
- In 3.8, write **only** `server/.env` (skip the `control/.env` block and `npm run seed`).
- In 3.9, install only the `dm-agent` site. In 3.11, run certbot only for `$AGENT_DOMAIN`. In 3.12, start only `ecosystem.server.config.cjs`.

Then in the dashboard: **Add Server** → `https://api2.ashwinsi.in` → "I already have an ID and secret" → paste that box's values → Verify.

---

## Updating later

**[Mac]**: push your changes; Vercel redeploys the UI automatically.

**[EC2]**

```bash
cd ~/DeploymentMaintainer && git pull && npm ci
pm2 reload deployment-maintainer && pm2 reload deployment-control
```

## Troubleshooting

| Symptom                                                  | Fix                                                                                                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Login does nothing / logs straight out                   | You're on a `*.vercel.app` URL or `http://`. Use `https://deploy.ashwinsi.in`. The UI and control domains must share the parent domain.  |
| Browser console: CORS error                              | `CORS_ORIGINS` in `control/.env` must exactly equal the UI URL (scheme + host, no trailing slash). Then `pm2 reload deployment-control`. |
| `403 Origin not allowed`                                 | Same fix as the CORS error.                                                                                                              |
| UI calls the wrong API / 404s on `/api`                  | `VITE_API_URL` is missing or wrong in Vercel. Fix it and **Redeploy**.                                                                   |
| Add Server: "Could not reach the server"                 | Check `curl https://api.ashwinsi.in/deployment-manager` from your Mac, DNS, and certbot for that domain.                                 |
| Add Server: "Server ID mismatch" / "rejected the secret" | Paste the exact values from step 3.14. If you edited `server/.env`, run `pm2 reload deployment-maintainer`.                              |
| Server shows **unauthorized**                            | Its `SERVER_SECRET` changed. Use **Rotate secret** in Servers.                                                                           |
| `pm2 logs` shows `MongooseServerSelectionError` / timeouts | The EC2's IP isn't allowed in Atlas **Network Access**, or the cluster is paused (free M0 clusters pause after long inactivity; resume it in Atlas). |
| `pm2 logs` shows `bad auth` / `Authentication failed`    | The Atlas user or password in `MONGO_URI` is wrong. If the password has special characters, URL-encode them or generate a letters-and-digits password. |
| Settings → GitHub error                                  | `GITHUB_TOKEN` in `server/.env` is wrong or expired. Fix it, then `pm2 reload deployment-maintainer`.                                    |
| Deploy fails at sudo/nginx                               | Redo 3.10; `sudo -n nginx -t` must work without a password.                                                                              |
| `npm install` killed (exit 137)                          | Out of memory. Make sure swap is on (`free -h`), or use a bigger instance.                                                               |
| Live logs arrive all at once                             | Both Nginx sites must keep their SSE blocks. Cloudflare proxying (orange cloud) must be off for `api` and `control`.                     |
| Nothing comes back after reboot                          | `which pm2` must be the `aliases/default` path (3.4). Re-run the `pm2 startup` line in 3.12, then `pm2 save`.                            |
| Forgot the admin password                                | Edit `ADMIN_PASSWORD` in `control/.env`, run `cd ~/DeploymentMaintainer && npm run seed`, then log in again.                             |

Logs: `pm2 logs deployment-control --lines 100`, `pm2 logs deployment-maintainer --lines 100`, `pm2 logs app-<name>`.
