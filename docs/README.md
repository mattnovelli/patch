# Patch OAuth Site

This folder contains the hosted OAuth receiver/config website for the Pebble app.

## Publish This Folder!

1. In GitHub repository settings, open Pages.
2. Set source to branch `main` and folder `/docs`.
3. Save and wait for deploy.

Expected URL for this repository:

- https://mattnovelli.github.io/patch/

## App Wiring

Set the same URL in these places:

- Azure Entra app Redirect URI (Web)
- `patch/src/pkjs/index.js` as `redirectUri` (and `CONFIG_PAGE_URL`)

The hosted page receives OAuth callbacks, returns callback payload/settings to Pebble via `pebblejs://close#...`, and PKJS performs token redemption.

## Hybrid Client Model

- Default mode uses the shared Entra client ID: `b9260194-8028-48ae-8907-e30182eda409`
- Optional mode uses **Bring your own Entra app** from the config page dropdown, including a short self-host tutorial.
