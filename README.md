# File Drop

A Cloudflare Worker upload page that stores files in a GitHub repository and returns stable `raw.githubusercontent.com` links.

## Is GitHub a good file store?

Only for occasional, small uploads. This implementation caps files at **10 MiB** to keep Worker memory and GitHub API request sizes practical. GitHub's Contents API is intended for repository files, not bulk object storage: every upload creates a commit, and uploads consume repository storage and API rate limits. The service's lower limit is deliberate.

The repository must be **public** for its returned direct links to open anonymously in ChatGPT. A private repository's raw URLs require GitHub authentication; exposing the Worker token through a public download proxy would make the files publicly readable anyway. Do not upload confidential files. Links are stable while the file and branch remain in place; deleting the file, renaming the repository, or renaming the branch breaks links.

GitHub receives one Contents API request per upload and commits each file. Normal authenticated API limits and secondary abuse limits apply. GitHub may throttle uploads; this service returns an error and does not queue retries. For regular uploads, larger files, or private access control, use object storage (such as R2) or another dedicated file service.

## Security and limits

- The browser UI asks for an upload key; the GitHub token is never sent to the browser.
- Upload requires the `UPLOAD_KEY` Worker secret and rejects cross-origin POSTs.
- The Worker accepts any file extension and MIME type, provided the file is non-empty and no larger than 10 MiB. The filename is normalized and stored beneath a random UUID path to prevent overwrites.
- The shared upload key is a simple bearer credential, not per-user authentication. Keep it private and rotate it if exposed. Set a Cloudflare rate limiting rule on `POST /api/upload` to reduce abuse and unexpected GitHub API use; the endpoint itself does not maintain per-client quotas.
- Uploaded file content is not scanned. Public links expose the uploaded bytes to anyone who has the URL (and to anyone who can browse the public repository).

## Setup

1. Create or use a **public** GitHub repository for uploaded files. Keep this application source in the same repo if desired; uploads are committed under `uploads/<random-id>/<filename>`.
2. Create a GitHub fine-grained personal access token scoped only to this repository with **Contents: Read and write** permission. No organization, workflow, or administration permissions are needed. GitHub does not provide a write-only Contents permission, so the token can also read repository contents. Set an expiration and rotate it periodically.
3. Install Wrangler and authenticate to Cloudflare:

   ```sh
   npm install --save-dev wrangler
   npx wrangler login
   ```

4. Configure secrets. Use long random values for the upload key and token; never put them in `wrangler.toml`, source files, or browser code:

   ```sh
   npx wrangler secret put GITHUB_TOKEN
   npx wrangler secret put UPLOAD_KEY
   ```

   `GITHUB_OWNER`, `GITHUB_REPO`, and `GITHUB_BRANCH` are non-secret values in `wrangler.toml`; adjust them for your repository/branch. The upload page asks for the value configured as `UPLOAD_KEY`; it is not your GitHub token.
5. Deploy:

   ```sh
   npx wrangler deploy
   ```

6. Open the Worker URL, enter the upload key configured as `UPLOAD_KEY`, and choose any file type up to 10 MiB. The result is a direct raw GitHub link. Open it in a private/incognito window to confirm anonymous access.

## Local development

Set the same values as local Wrangler secrets/vars, then run `npx wrangler dev`. Do not commit `.dev.vars`; it contains local secrets.
