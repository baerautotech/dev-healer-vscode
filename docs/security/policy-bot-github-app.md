# Policy bot GitHub App permissions (required)

Policy sync (`Policy Sync` / `Policy Propose`) uses a GitHub App installation token to push branches and open PRs across repos.

## Required GitHub App permissions

Minimum recommended repository permissions:

- Contents: Read & write
- Pull requests: Read & write
- Workflows: Read & write
- Metadata: Read

## Failure signature (Workflows permission missing)

If the workflow requests `{\"workflows\":\"write\"}` but the app installation is not granted Workflows permission, token minting fails with:

- HTTP 422: `The permissions requested are not granted to this installation.`

In that case:

1. Update the GitHub App permissions (Workflows: Read & write)
2. Update the installation permissions ("Update permissions" / reinstall)
3. Re-run `Policy Sync`
