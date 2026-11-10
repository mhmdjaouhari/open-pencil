# OpenPencil Cloud on Dokploy (Syndic)

[`compose.yml`](./compose.yml) runs this fork's Cloud, which stores workspace component libraries,
with its own PostgreSQL and SeaweedFS. The image is built by GitHub Actions
([`image-cloud-syndic.yml`](../../../../.github/workflows/image-cloud-syndic.yml)) on every push to
`syndic/code-connect` and published as `ghcr.io/<owner>/openpencil-cloud:syndic`, so the server
only pulls it; building it needs Rust and several GB of memory.

## 1. The image

1. In the fork's GitHub settings, enable Actions, then push `syndic/code-connect` (or run
   **Cloud image (Syndic)** by hand). It takes 15–30 minutes the first time.
2. The package appears under the owner's **Packages**. If it is private, add a GHCR registry in
   Dokploy (**Settings → Registry**: `ghcr.io`, your GitHub user, a token with `read:packages`).

## 2. DNS

Two hostnames pointing at the Dokploy server, for example:

- `design.example.com`: the editor, sign-in pages, and API;
- `design-files.example.com`: object storage. Browsers upload and download files there directly
  through links the server signs, and the server reaches it at the same address.

## 3. The Dokploy app

1. **Create → Compose**, source **Git** (the fork), branch `syndic/code-connect`, compose path
   `packages/cloud/deploy/dokploy/compose.yml`.
2. **Environment**:

   ```sh
   CLOUD_DOMAIN=design.example.com
   S3_DOMAIN=design-files.example.com
   POSTGRES_PASSWORD=          # openssl rand -hex 24
   BETTER_AUTH_SECRET=         # openssl rand -hex 32
   S3_ACCESS_KEY_ID=           # openssl rand -hex 12
   S3_SECRET_ACCESS_KEY=       # openssl rand -hex 32
   EMAIL_FROM=Syndic Design <design@example.com>
   SMTP_HOST=smtp.example.com
   SMTP_PORT=587               # 465 with SMTP_SECURE=true
   SMTP_SECURE=false
   SMTP_USER=
   SMTP_PASSWORD=
   ENROLLMENT_NOTIFY=you@example.com   # one address, without quotes: told of new sign-ups
   # Optional
   ENROLLMENT_MODE=approval    # or "open"; "closed" stops new accounts
   OPENPENCIL_IMAGE=ghcr.io/<owner>/openpencil-cloud:syndic
   ```

   Sign-up always confirms the address by email, so SMTP is required.

3. **Domains**: leave Dokploy's Domains tab empty. The compose file routes `CLOUD_DOMAIN` to
   `openpencil` (8787) and `S3_DOMAIN` to `seaweedfs` (8333) itself, with Traefik labels on
   `dokploy-network` and Let's Encrypt certificates (`letsencrypt`), since domains added in the UI
   do not reach Compose services reliably. Its routers are named `openpencil-cloud` and
   `openpencil-files`; rename them if another app on the server uses those names.
4. **Deploy**. `GET https://<CLOUD_DOMAIN>/ready` answers 200 once it has migrated the database.

## 4. The first administrator

With `ENROLLMENT_MODE=approval`, a new account waits for an administrator. For the first one, open
the `openpencil` container's terminal in Dokploy (**Docker → openpencil → Terminal**) and run:

```sh
node admin.mjs approve you@example.com
# sign up at https://<CLOUD_DOMAIN> and confirm the email, then:
node admin.mjs grant you@example.com
```

Later accounts are approved in the server's admin pages (`/admin`).

## 5. The library

Create a workspace in the editor and invite the team. Then publish `@syndic/ui` to it from a
syndic-frontend checkout (`packages/design-sync`):

```sh
pnpm cloud:login https://<CLOUD_DOMAIN>   # approve the code in the browser; prints the exports
export DESIGN_SYNC_CLOUD_URL=… DESIGN_SYNC_CLOUD_TOKEN=… DESIGN_SYNC_CLOUD_WORKSPACE=…
pnpm sync                                  # capture and publish
```

In the editor, **Libraries** shows Syndic UI for every member of that workspace; editors and admins
can publish, viewers only use it.

## Backups and upgrades

Back up the `database` and `storage` volumes together. Pushing the branch builds a new image;
**Redeploy** in Dokploy pulls it, and the server migrates the database before it accepts requests.
