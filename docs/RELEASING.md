# Releasing

## Checks

Every push to `master` and every pull request runs the [CI workflow](../.github/workflows/ci.yml) on Windows: typecheck, lint, formatting, unit tests (with a real Mosquitto broker) and the Electron tests.

## Publishing a version

1. Add a section for the version to [CHANGELOG.md](../CHANGELOG.md), for example `## 1.2.0 - 2026-11-30`.
2. Set the same version in `package.json` and `package-lock.json` with `npm version 1.2.0 --no-git-tag-version`.
3. Commit, then tag and push:

   ```sh
   git tag v1.2.0
   git push origin master v1.2.0
   ```

4. The [Release workflow](../.github/workflows/release.yml) runs the checks again, builds the installer and drafts a GitHub release with the changelog section, `MQTTLooter-Setup-1.2.0.exe` and `latest.yml`.
5. Review the draft on GitHub and publish it. Installed apps find it through **Help > Check for updates**, and check quietly at startup.

Versions follow semantic versioning: patch for fixes, minor for features, major when saved data or behavior changes incompatibly.

## Beta releases

Tag a pre-release version such as `v1.3.0-beta.1` (with the matching `package.json` version and changelog heading) and tick **Set as a pre-release** before publishing the draft. Only apps with **Settings > General > Updates** set to **Stable and beta releases** are offered it.

## Code signing

Unsigned installers make Windows SmartScreen warn about an unknown publisher. The Release workflow signs the app and installer with [Azure Trusted Signing](https://learn.microsoft.com/azure/trusted-signing/) once these repository secrets exist (**Settings > Secrets and variables > Actions**):

| Secret | Value |
| --- | --- |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | An Entra ID app registration with the Trusted Signing Certificate Profile Signer role |
| `SIGNING_ENDPOINT` | The account endpoint, for example `https://weu.codesigning.azure.net` |
| `SIGNING_ACCOUNT` | The Trusted Signing account name |
| `SIGNING_PROFILE` | The certificate profile name |
| `SIGNING_PUBLISHER` | The certificate's subject common name, usually your validated name |

Setting it up takes an Azure subscription, a Trusted Signing account (a small monthly fee) and identity validation by Microsoft. Updates keep working across the switch: apps installed unsigned accept signed updates.

## Saved data

Upgrades must never lose data. Every saved format carries a version:

| Data | Where | Version |
| --- | --- | --- |
| Settings, connections, Publishing drafts and history, simulated devices | Window storage | `STORAGE_VERSION` in `src/renderer/src/services/storageMigrations.ts` |
| Message schemas | Window storage | `VERSION` in `MessageTemplateService.ts` |
| Disk history | `history.sqlite` | `PRAGMA user_version` in `history-database.ts` |
| Recordings | `recordings.sqlite` | `PRAGMA user_version` in `recording-database.ts` |
| Decoders, credentials | JSON files in the app data folder | `version` field |

When a format changes, raise its version and add a migration from the previous version with a test that loads data in the old format. An older build that finds data from a newer version leaves it untouched.
