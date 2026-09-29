# Deploying Deployment Maintainer on AWS

A step-by-step guide from an empty AWS account to a running dashboard at `https://your-domain`, deploying your first app.

**What you'll end up with:** one Ubuntu EC2 instance running MongoDB, Nginx, PM2 and this dashboard. Each app you deploy runs under PM2 on a private port (4001, 4002, …) and is reachable at `https://your-domain/<app-name>/`.

**Time:** about 45–60 minutes the first time.

**You need:**
- an AWS account
- a domain name you can add DNS records to
- a GitHub account with the repos you want to deploy
- a terminal with `ssh` (macOS/Linux, or Windows PowerShell)

---

## Part 1: AWS setup (in the AWS Console)

### 1.1 Pick a region
Top-right region selector. Pick one close to your users (e.g. `ap-south-1` Mumbai) and use the same region for every step below.

### 1.2 Create the SSH key pair
This is how you log in to the server.

1. **EC2 → Network & Security → Key Pairs → Create key pair**
2. Name: `deployment-maintainer`, type **ED25519**, format **.pem**
3. Create. The browser downloads `deployment-maintainer.pem`. **This is the only copy.** If you lose it, you lose SSH access.
4. Move it somewhere safe and lock its permissions. SSH refuses keys that other users can read:

```bash
mkdir -p ~/.ssh
mv ~/Downloads/deployment-maintainer.pem ~/.ssh/
chmod 400 ~/.ssh/deployment-maintainer.pem
```

On Windows: right-click the file → Properties → Security, and remove every user except yourself.

### 1.3 Launch the EC2 instance
**EC2 → Instances → Launch instances**:

| Setting | Value |
|---|---|
| Name | `deployment-maintainer` |
| AMI | **Ubuntu Server 24.04 LTS** (or 22.04 LTS), 64-bit (x86) |
| Instance type | **t3.small** (2 GB RAM) recommended. `t3.micro` (1 GB) works for 1–2 small apps if you add swap (step 3.2). Go bigger for many apps or heavy builds. |
| Key pair | `deployment-maintainer` (from 1.2) |
| Storage | **30 GiB gp3**. Every app keeps its own `node_modules`, so disk fills faster than you'd expect. |

**Network settings → Edit → create a security group** named `deployment-maintainer-sg` with these inbound rules:

| Type | Port | Source | Why |
|---|---|---|---|
| SSH | 22 | **My IP** | only you can SSH in |
| HTTP | 80 | Anywhere (0.0.0.0/0) | needed for the certbot check and the HTTPS redirect |
| HTTPS | 443 | Anywhere (0.0.0.0/0) | the dashboard and your apps |

Do **not** open 3000, 4001+ or 27017. Apps and MongoDB stay private behind Nginx.

Click **Launch instance**.

> If your home IP changes later and SSH stops working, update the port 22 rule to your new IP (EC2 → Security Groups → `deployment-maintainer-sg` → Edit inbound rules).

### 1.4 Give it a fixed IP (Elastic IP)
Without this, the public IP changes every time the instance stops and starts, and your domain breaks.

1. **EC2 → Network & Security → Elastic IPs → Allocate Elastic IP address → Allocate**
2. Select it → **Actions → Associate Elastic IP address** → choose your instance → Associate.
3. Note the IP, e.g. `13.233.10.20`. It's used below as `YOUR_IP`.

> AWS bills public IPv4 addresses hourly. Release the Elastic IP if you ever terminate the instance.

### 1.5 Point your domain at it
At your DNS provider (Route 53, Cloudflare, GoDaddy, Namecheap, …) add:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `deploy` (for `deploy.yourdomain.com`) or `@` (for the root domain) | `YOUR_IP` | 300 |

Your dashboard domain is used below as `YOUR_DOMAIN`, e.g. `deploy.yourdomain.com`. If you use Cloudflare, set the record to **DNS only** (grey cloud) until certbot has finished (step 3.11).

Check it from your machine (it can take a few minutes):
```bash
dig +short YOUR_DOMAIN     # should print YOUR_IP
```

### 1.6 Optional but recommended
- **Enable termination protection:** Instance → Actions → Instance settings → Change termination protection.
- **Enable automatic backups:** EC2 → Elastic Block Store → Lifecycle Manager → create a daily EBS snapshot policy for the instance's volume.
- **Set a billing alarm:** Billing → Budgets → create a monthly cost budget with an email alert.

---

## Part 2: GitHub setup

### 2.1 Push this dashboard repo to GitHub
The server needs to clone the dashboard itself. From your Mac:

```bash
cd ~/projects/deployment_maintainer
gh repo create deployment_maintainer --private --source . --push
# or: create an empty private repo on github.com, then
# git remote add origin git@github.com:YOUR_USER/deployment_maintainer.git && git push -u origin master
```

### 2.2 Create the GitHub token the dashboard uses
The dashboard uses this token to **list your repos and branches** and to **clone/pull the apps you deploy**. It only needs read access.

**Fine-grained token (recommended):**
1. GitHub → your avatar → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
2. **Token name:** `deployment-maintainer-ec2`
3. **Expiration:** up to 1 year. Put a calendar reminder to rotate it (see 5.4).
4. **Resource owner:** your account. (If your apps live in an **organization**, pick the org. It may need to approve the token under Org Settings → Personal access tokens.)
5. **Repository access:** **All repositories** (or "Only select repositories" if you prefer).
6. **Permissions → Repository permissions:**
   - **Contents: Read-only**
   - **Metadata: Read-only** (added automatically)
   - leave everything else at "No access"
7. **Generate token** and copy it (`github_pat_…`). GitHub shows it only once. Keep it for step 3.7.

**Classic token (only if you need repos from your personal account *and* an org in one token):**
Settings → Developer settings → Personal access tokens → **Tokens (classic)** → Generate new token → scope **`repo`**. Note: classic `repo` also grants write access, so it's broader than it needs to be.

The token lives only in `server/.env` on the EC2. It's never written into cloned repos, and it's masked in deploy logs.

---

## Part 3: Server setup

### 3.1 SSH in
```bash
ssh -i ~/.ssh/deployment-maintainer.pem ubuntu@YOUR_IP
```
Type `yes` at the fingerprint prompt the first time. All remaining steps run **on the server** as `ubuntu`.

Optional, to make SSH easier: add this to `~/.ssh/config` **on your Mac**, then just run `ssh dm`:
```
Host dm
  HostName YOUR_IP
  User ubuntu
  IdentityFile ~/.ssh/deployment-maintainer.pem
```

### 3.2 System packages (+ swap on small instances)
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git nginx build-essential unzip curl
```

On **t3.micro / 1–2 GB RAM**, add 2 GB of swap so `npm install` and builds don't get killed:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h     # Swap: 2.0Gi
```

### 3.3 Node.js via fnm
The dashboard uses fnm to give each app its own Node version.
```bash
curl -fsSL https://fnm.vercel.app/install | bash
source ~/.bashrc
fnm install 20
fnm default 20
node -v     # v20.x.x
```

Now pin PATH to fnm's **stable** default-alias directory. By default `node`/`npm`/`pm2` resolve through a temporary per-shell directory that disappears on reboot. PM2's boot script must not point there.
```bash
echo 'export PATH="$HOME/.local/share/fnm/aliases/default/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
which node  # must print /home/ubuntu/.local/share/fnm/aliases/default/bin/node
```

### 3.4 PM2 (+ log rotation)
```bash
npm install -g pm2
which pm2   # must print /home/ubuntu/.local/share/fnm/aliases/default/bin/pm2
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

### 3.5 MongoDB
MongoDB 8.0 (commands for Ubuntu 24.04 "noble"; on 22.04 replace `noble` with `jammy`):
```bash
curl -fsSL https://pgp.mongodb.com/server-8.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list
sudo apt update
sudo apt install -y mongodb-org
sudo systemctl enable --now mongod
```
Check: `systemctl status mongod --no-pager` should show `active (running)`. MongoDB listens on `127.0.0.1` only by default. Leave it that way.

*(Alternative: skip this and use a MongoDB Atlas cluster. Put its connection string in `MONGO_URI` in step 3.7, and allow `YOUR_IP` in Atlas → Network Access.)*

### 3.6 Clone the dashboard (with a read-only deploy key)
Create an SSH key on the server that can read **only** the dashboard repo:
```bash
ssh-keygen -t ed25519 -C "ec2-deployment-maintainer" -f ~/.ssh/dm_deploy -N ""
cat ~/.ssh/dm_deploy.pub
```
Copy the printed line, then on GitHub: **your `deployment_maintainer` repo → Settings → Deploy keys → Add deploy key**. Title `ec2`, paste the key, leave "Allow write access" **unchecked**, and click Add key.

Back on the server:
```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/dm_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
ssh -T git@github.com          # answer "yes"; it says "Hi YOUR_USER/deployment_maintainer! ..."
git clone git@github.com:YOUR_USER/deployment_maintainer.git ~/deployment_maintainer
cd ~/deployment_maintainer
mkdir -p ~/apps
```

### 3.7 Configure `server/.env`
Generate two **different** secrets:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # → JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # → ENCRYPTION_KEY
```
```bash
cp server/.env.example server/.env
chmod 600 server/.env
nano server/.env
```
Set these values:

| Variable | Value |
|---|---|
| `PORT` | `3000` |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/deployment_maintainer` (or your Atlas URI) |
| `JWT_SECRET` | first generated value |
| `ENCRYPTION_KEY` | second generated value (exactly 64 hex chars) |
| `GITHUB_TOKEN` | the token from step 2.2 |
| `ADMIN_EMAIL` | the email you'll log in with |
| `ADMIN_PASSWORD` | a strong password, 12+ characters |
| `APPS_DIR` | `/home/ubuntu/apps` |
| `NGINX_APPS_DIR` | `/etc/nginx/deployer-apps` |
| `APP_PORT_START` | `4001` |
| `DEFAULT_NODE_VERSION` | `20` |
| `NGINX_ENABLED` | `true` |
| `NODE_ENV` | `production` |
| `GIT_REMOTE_BASE` | `https://github.com` (leave as is) |

Save with `Ctrl+O`, Enter, `Ctrl+X`.

> **Back up `ENCRYPTION_KEY`** in a password manager. All app env vars in the database are encrypted with it; if it's lost or changed, they can't be decrypted.

### 3.8 Install, build, create the admin user
```bash
npm ci
npm run build
npm run seed        # → "Created admin user you@example.com."
```

### 3.9 Nginx
Create the per-app routes folder, owned by `ubuntu` so the dashboard can write to it:
```bash
sudo mkdir -p /etc/nginx/deployer-apps
sudo chown ubuntu:ubuntu /etc/nginx/deployer-apps
```
Install the dashboard site, replacing `YOUR_DOMAIN` in the command with your real domain:
```bash
sed "s/YOUR_DOMAIN/deploy.yourdomain.com/g" deploy/nginx-site.conf \
  | sudo tee /etc/nginx/sites-available/deployment-maintainer > /dev/null
sudo ln -sf /etc/nginx/sites-available/deployment-maintainer /etc/nginx/sites-enabled/deployment-maintainer
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t          # must say "syntax is ok" and "test is successful"
sudo systemctl reload nginx
```

### 3.10 Let the dashboard reload Nginx (sudoers)
The dashboard runs as `ubuntu`. It may run exactly two root commands without a password, `nginx -t` and `systemctl reload nginx`, and nothing else.
```bash
sudo visudo -cf deploy/sudoers-deployer
sudo cp deploy/sudoers-deployer /etc/sudoers.d/deployer
sudo chown root:root /etc/sudoers.d/deployer
sudo chmod 0440 /etc/sudoers.d/deployer
sudo -n nginx -t && echo "sudo rule OK"
```

### 3.11 HTTPS with certbot
DNS from step 1.5 must already resolve to `YOUR_IP`.
```bash
sudo snap install --classic certbot
sudo ln -sf /snap/bin/certbot /usr/bin/certbot
sudo certbot --nginx -d YOUR_DOMAIN
```
Enter your email and agree to the terms. Certbot adds TLS and an HTTP → HTTPS redirect to the site, and sets up auto-renewal. Check renewal with `sudo certbot renew --dry-run`.

### 3.12 Start the dashboard under PM2 and survive reboots
```bash
cd ~/deployment_maintainer
pm2 start deploy/ecosystem.dashboard.cjs
pm2 save
pm2 startup
```
`pm2 startup` prints a line starting with `sudo env PATH=...`. **Copy and run exactly that line.** Then:
```bash
pm2 save
pm2 status          # deployment-maintainer  online
curl -s localhost:3000/api/health    # {"ok":true}
```

Test that it survives a reboot:
```bash
sudo reboot
# wait ~1 minute, SSH back in
pm2 status          # deployment-maintainer should be online again
```

### 3.13 Log in
Open **`https://YOUR_DOMAIN`** and log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

Login only works over **https** because the session cookie is marked Secure in production. Then open **Settings**: the GitHub card should show your GitHub username. If it shows an error, the token in `.env` is wrong (see 5.4).

---

## Part 4: Deploy your first app

### 4.1 What your app needs
- It must **listen on `process.env.PORT`**. The dashboard assigns the port and writes it into `.env` and PM2's env.
- It needs a **start command**; the default is `npm start`. If it needs a build first, enable the Build step.
- The **health-check path** (default `/`) must return a 2xx or 3xx status within 60s of starting. If it doesn't, the deploy fails and auto-rolls back. Point it at something like `/health` if `/` isn't cheap.
- **Path prefix:** at `https://YOUR_DOMAIN/my-api/users`, the app receives just `/users` (the prefix is stripped by default). APIs work unchanged. Apps that render HTML with absolute links (`/css/app.css`) will break under a prefix; turn off "strip prefix" and make the app aware of its base path, or keep such apps API-only.
- If it reads env vars from a `.env` file, use `dotenv`. The dashboard writes `.env` into the app folder. The vars are also passed directly in the process environment.

### 4.2 Create and deploy
1. **New App** → pick the repo → pick the branch.
2. **Name** becomes the URL path and folder, e.g. `my-api` → `https://YOUR_DOMAIN/my-api/`. Use lowercase letters, numbers and dashes. These names are reserved: `api, assets, login, ports, apps, new, deployments, server, settings`.
3. **Port** is auto-filled (4001, 4002, …).
4. **Node version** is detected from `.nvmrc` / `package.json` `engines`, or defaults to 20.
5. **Environment:** add variables, or paste a whole `.env`.
6. **Steps:** leave the defaults for a standard Node API. Turn on Build if needed, add custom steps (e.g. `npx prisma migrate deploy`), and adjust the health-check path.
7. **Create & Deploy.** You'll see the live log. When it's green, open `https://YOUR_DOMAIN/my-api/`.

**Same repo, another branch:** create another app (e.g. `my-api-dev` on `dev`) with its own env, or use **Duplicate** on the app page.

**Later deploys:** the **Deploy** button → choose a branch → **Update** (pull in place) or **Fresh** (wipe and re-clone).

**Something broke?** Deployments → pick an earlier successful deploy → **Rollback to this**.

---

## Part 5: Day-2 operations

### 5.1 Update the dashboard itself
```bash
cd ~/deployment_maintainer
git pull
npm ci
npm run build
pm2 reload deployment-maintainer
```
Avoid updating while an app deploy is running. An interrupted deploy is marked failed; just redeploy it.

### 5.2 Backups
- **App configs:** Settings → Backup → **Export** (passphrase-encrypted JSON). Keep it somewhere off the server.
- **Database:** `mongodump --db deployment_maintainer --out ~/backup-$(date +%F)`, then copy it off the box: `scp -i ~/.ssh/deployment-maintainer.pem -r ubuntu@YOUR_IP:~/backup-* .`
- **Whole disk:** the EBS snapshots from 1.6.
- Keep `server/.env` (especially `ENCRYPTION_KEY`) in your password manager.

### 5.3 Forgot the dashboard password
```bash
cd ~/deployment_maintainer
nano server/.env        # set a new ADMIN_PASSWORD
npm run seed            # resets it and logs out all sessions
```

### 5.4 Rotate or replace the GitHub token
Create a new token (2.2), put it in `server/.env` as `GITHUB_TOKEN`, then:
```bash
pm2 reload deployment-maintainer
```
Settings should show your GitHub username again. Delete the old token on GitHub.

### 5.5 Useful commands
```bash
pm2 status                              # all processes (apps are named app-<name>)
pm2 logs deployment-maintainer --lines 100
pm2 logs app-my-api --lines 100
ls /etc/nginx/deployer-apps/            # one .conf per routed app
sudo nginx -t
df -h /                                 # disk space
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ssh: Permission denied (publickey)` | Wrong key or user. Use `-i ~/.ssh/deployment-maintainer.pem` and `ubuntu@`. The `.pem` must be `chmod 400`. |
| SSH times out | Your IP changed. Update the port 22 rule (step 1.3 note). |
| Certbot fails with "connection refused" / "timeout" | DNS doesn't point at `YOUR_IP` yet, port 80 isn't open, or Cloudflare proxy is on. |
| Login does nothing / immediately logs out | You're on `http://`. Use `https://`. |
| Settings → GitHub shows an error, New App can't list repos | `GITHUB_TOKEN` is missing, expired or lacks access. Redo 2.2 and 5.4. For org repos, the org may need to approve the token. |
| Deploy fails at `sudo` / nginx step | The sudoers rule isn't installed exactly. Redo 3.10; `sudo -n nginx -t` must work without a password. |
| Deploy fails at the health check | The app isn't listening on `process.env.PORT`, crashes on start, or the health path returns 4xx/5xx. Check App → Runtime logs. |
| `npm install` killed / exit code 137 | Out of memory. Add swap (3.2) or use a bigger instance. |
| Deploy logs appear all at once instead of streaming | Something is buffering. Keep `proxy_buffering off` on `/api/deployments/` in the Nginx site, and turn off Cloudflare proxying for this host. |
| Dashboard doesn't come back after reboot | `pm2 startup`'s printed command wasn't run, or PATH wasn't pinned (3.3). Fix PATH, then rerun `pm2 startup`, its printed command, and `pm2 save`. |
| Changed an app's start command but it still runs the old one | `pm2 delete app-<name>`, then deploy again (known limitation). |
| Disk full | Server page shows usage per app. Delete unused apps from the UI (not with `rm -rf`), and enlarge the EBS volume if needed. |
