# NOVA staging site

The public website remains the editable `index.html` in the repository root. The staging site is a separate hostname, `https://staging.novaporto.eu`, protected by Cloudflare Worker HTTP Basic Auth. The Worker serves the root `index.html`, `logo.png`, `favicon-512.png`, and `social-share.png`, so staging previews the current working copy without replacing the public homepage.

The browser's built-in sign-in prompt is enforced at the server edge. The Worker redirects HTTP requests to HTTPS before checking credentials. There is no password in the HTML or JavaScript.

## Current status

Cloudflare DNS and the Worker route are configured. The latest public DNS check confirmed:

- `novaporto.eu` uses the Cloudflare-assigned nameservers `amit.ns.cloudflare.com` and `dolly.ns.cloudflare.com`.
- `staging.novaporto.eu` is a CNAME to `novaporto.eu` and resolves through Cloudflare.
- The `nova-staging` Worker has been deployed with the route `staging.novaporto.eu/*`.
- Wrangler is signed in on the setup computer.

**Remaining:** set the `STAGING_USERNAME` and `STAGING_PASSWORD` Worker secrets using the commands below. Until both secrets are set, the Worker intentionally returns **503**. In Cloudflare DNS, also confirm the `staging` CNAME is **Proxied** (orange cloud), as required for the Worker route.

## What you need

- Access to the Cloudflare account that manages the `novaporto.eu` DNS zone.
- Access to the domain registrar account where the domain's nameservers are managed (currently GoDaddy).
- Node.js and npm installed on your computer.
- Access to this website repository.

## Connect the domain to Cloudflare

Cloudflare Worker routes require the hostname to be on Cloudflare. This domain has already been moved to Cloudflare DNS. These are the setup steps for reference:

1. In Cloudflare, add `novaporto.eu` as a website/zone and select the Free plan if offered. Let Cloudflare scan/import the existing DNS records.
2. Before changing nameservers, compare Cloudflare's imported DNS records with the records currently active at GoDaddy. Keep the GitHub Pages apex `A` records (`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, and `185.199.111.153`), plus every existing `www`, email (`MX`), and verification/security (`TXT`, `CNAME`) record that you need. **Do not remove or guess email records.** If the import is incomplete, add the missing records in Cloudflare first.
3. In GoDaddy's domain settings, replace the domain's current nameservers with the two nameservers Cloudflare assigns to the zone. Do not change nameservers to values from an example or another account.
4. Wait for Cloudflare to report the zone as **Active**. DNS propagation can take time. The existing public homepage and email should continue working with their DNS records copied correctly.
5. In Cloudflare's active `novaporto.eu` zone, add or edit the staging record:
   - Type: `CNAME`
   - Name: `staging`
   - Target: `novaporto.eu` (or `@`, if that is how the dashboard represents the zone apex)
   - Proxy status: **Proxied** (orange cloud)
   - TTL: **Auto**

The Worker route in `wrangler.toml` applies only to `staging.novaporto.eu`; it does not put a login prompt on the public homepage. The staging record must be **Proxied** for requests to reach the Worker.

## Deploy staging and set the username and password

The Cloudflare zone is **Active**, and the Worker has already been deployed. To configure credentials, open PowerShell in the `NovaWebSite` repository folder (the folder containing `wrangler.toml`). If Wrangler is not already signed in on this computer, run:

```powershell
npx wrangler@latest login
```

The Worker is already deployed. If you need to deploy it again after changing the Worker or configuration, run:

```powershell
npx wrangler@latest deploy --name nova-staging --config wrangler.toml
```

Set a non-empty username of your choice (do not use `:` in the username). Wrangler prompts for the value; enter it when asked:

```powershell
npx wrangler@latest secret put STAGING_USERNAME --name nova-staging --config wrangler.toml
```

Set a unique password in the same way:

```powershell
npx wrangler@latest secret put STAGING_PASSWORD --name nova-staging --config wrangler.toml
```

Use a long, unique password (at least 20 characters is recommended). Do not put either value in `index.html`, `staging-worker.js`, a command argument, or a committed file. Cloudflare stores these as Worker secrets and the Worker fails closed if either secret is missing.

Each `secret put` creates and deploys a Worker version. After both commands succeed, the Worker can authenticate you. The explicit `--name nova-staging --config wrangler.toml` targets the configured Worker. If Wrangler reports that the Worker name is missing, check that PowerShell is in the repository folder and that `wrangler.toml` is present there.

## Test and update staging

Open `https://staging.novaporto.eu`. The browser should prompt for the username and password you set. An incorrect login should keep returning a sign-in prompt. After you authenticate, the site should load over HTTPS.

To change the credentials later, run the matching `secret put` command again and enter the new value. Deploy again if prompted by Wrangler. To update the preview, edit the normal root `index.html` and run `npx wrangler@latest deploy --name nova-staging --config wrangler.toml`; this publishes the current local version to staging. The public website continues to use its normal GitHub Pages publishing process.

## Important security notes

- Keep the Cloudflare DNS record **Proxied**. A DNS-only record bypasses the Worker route and its login check.
- Do not add a public Pages or `workers.dev` deployment of the staging content as an alternate URL. `workers_dev = false` disables the Worker `workers.dev` hostname.
- The repository is public. HTTP Basic Auth protects the staging hostname, but it does not hide files committed to a public GitHub repository or anything already available on the public website. Do not put private customer information, credentials, or confidential material in this repository. For confidential previews, move the staging source to a private repository and restrict access to that deployment.
- Anyone with the shared username and password can sign in. Use a password manager and change the Worker secret if access should be revoked.

## Keep the normal homepage editable

Edit the repository-root `index.html` as usual. The Worker only protects the `staging.novaporto.eu` hostname; it does not change the root page into a login screen. After checking the preview, publish the approved root page to the existing GitHub Pages site using the usual Git workflow.
