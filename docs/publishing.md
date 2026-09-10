# Publishing to npm with Trusted Publishing

This package uses npm trusted publishing (OIDC) to publish to npm without requiring an `NPM_TOKEN` or OTP codes.

## Setup (one-time)

Configure trusted publishing on npmjs.com:

1. Go to [npmjs.com](https://www.npmjs.com/) and sign in
2. Navigate to the **contextpack** package settings (or use "Add Trusted Publisher" if the package doesn't exist yet)
3. Under **Publishing access**, select **Trusted Publishers**
4. Configure the GitHub Actions publisher:
   - **Organization or user:** `shreeshailaya`
   - **Repository:** `contextpack`
   - **Workflow filename:** `publish.yml`
5. Enable **Allow `npm publish`**
6. Save the configuration

## Publishing a release

### First release

Either:
- Tag and push: `git tag v0.1.0 && git push origin v0.1.0`
- Or run the workflow manually from the GitHub Actions tab using **workflow_dispatch**

### Subsequent releases

1. Update the version in `package.json`:
   ```bash
   npm version patch  # or minor, major
   ```
2. Push the commit and tag:
   ```bash
   git push origin master --tags
   ```

The `publish.yml` workflow will automatically run when a tag matching `v*` is pushed, running tests and publishing to npm with provenance attestation.

## How it works

The workflow uses GitHub's OIDC provider to authenticate with npm. This is more secure than long-lived tokens because:

- No secrets to manage or rotate
- Publishes are tied to specific workflow runs
- Provenance attestation proves the package was built from this repository
