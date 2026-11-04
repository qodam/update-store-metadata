# update-store-metadata

Update your **Google Play** and **App Store** listings (text, screenshots, subscription prices) directly through the store APIs, **without shipping a new build**.

All scripts are interactive and ask their questions in the terminal (prompts are in French).
Press **Enter** to keep the value shown in brackets, type **`-`** to skip a step.

---

## Table of contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Commands](#commands)
- [Recommended workflow](#recommended-workflow)
- [File formats](#file-formats)
- [Image layout](#image-layout)
- [Subscription prices](#subscription-prices)
- [Security](#security)
- [Known limitations](#known-limitations)
- [Project structure](#project-structure)

---

## Requirements

- **Node.js 18 or later** (uses native `fetch` and top-level `await`)
- **Google Play**: a Google Cloud service account with the _Google Play Android Developer API_ enabled, invited to the Play Console with access to the app
- **App Store**: an App Store Connect API key (_App Manager_ or _Admin_ role) as a `.p8` file

## Installation

```bash
git clone <repo-url>
cd update-store-metadata
npm install
cp config/config.example.js config/config.js
```

Then fill in `config/config.js` (see below).

## Configuration

All settings live in `config/config.js`, which is ignored by git:

| Key                | Store  | Description                                             |
| ------------------ | ------ | ------------------------------------------------------- |
| `KEY_FILE`         | Google | Path to the service account JSON key                    |
| `SEND_FOR_REVIEW`  | Google | `false`: saved without review · `true`: sent for review |
| `ISSUER_ID`        | Apple  | API key Issuer ID                                       |
| `KEY_ID`           | Apple  | API key Key ID                                          |
| `PRIVATE_KEY_PATH` | Apple  | Path to the `AuthKey_XXXX.p8` file                      |

> ⚠️ **Use absolute paths** for `KEY_FILE` and `PRIVATE_KEY_PATH`. Depending on the script, relative paths are not resolved from the same folder (see [Known limitations](#known-limitations)).

### Where to get the keys

- **Google**: Google Cloud Console → _IAM & Admin_ → _Service Accounts_ → _Keys_ → _Add key (JSON)_. Then invite the service account email in the Play Console (_Users and permissions_).
- **Apple**: App Store Connect → _Users and Access_ → _Integrations_ → _App Store Connect API_. The `.p8` file can be downloaded **only once**.

## Commands

| Command                   | What it does                                                              |
| ------------------------- | ------------------------------------------------------------------------- |
| `npm run fetch:android`   | Downloads the current Google Play listing → JSON + images (read-only)     |
| `npm run fetch:ios`       | Downloads the current App Store listing → JSON + screenshots (read-only)  |
| `npm run mockups:android` | Copies your mockups into `screenshots/<locale>/<device>` for every locale |
| `npm run mockups:ios`     | Same for iPhone / iPad                                                    |
| `npm run update:android`  | Uploads text and/or images to Google Play                                 |
| `npm run update:ios`      | Uploads text and/or screenshots to the App Store                          |
| `npm run whatsnew:ios`    | Updates only the "What's New" text of an iOS version                      |
| `npm run price:android`   | Google Play subscription prices from an Excel file (dry run)              |
| `npm run price:ios`       | App Store subscription prices from an Excel file (dry run)                |

To actually apply price changes, add `--apply`:

```bash
npm run price:ios -- --apply
```

`whatsnew:ios` also accepts direct arguments:

```bash
node apple/lib/whatnews.js <appId> <version> [file.json] [--yes]
```

## Recommended workflow

1. **Fetch the current listing**: `npm run fetch:android` / `fetch:ios`. You get a JSON file in the right format, ready to edit.
2. **Edit** the JSON (text) and/or prepare the images (`mockups:*`).
3. **Upload**: `npm run update:android` / `update:ios`.
4. **Publish**:
   - Google: _Play Console → Publishing overview_ (unless `SEND_FOR_REVIEW: true`)
   - Apple: submit the version in App Store Connect

### Built-in safeguards

- **Everything is validated before upload**: Google text lengths, image count and dimensions.
- **Google**: all changes go into a single _edit_. If anything fails, the edit is deleted and nothing is half-published.
- **Apple**: only a version in an editable state (`PREPARE_FOR_SUBMISSION`, `REJECTED`…) is modified. If the requested version doesn't exist, it is created, unless another version is already being prepared.
- **A field missing from the JSON keeps its current value.**

## File formats

Full examples in [`examples/`](examples/).

**Google Play** (`metadata.json`):

```json
{
  "details": {
    "contactEmail": "support@example.com",
    "contactWebsite": "https://example.com"
  },
  "locales": {
    "en-US": {
      "title": "≤ 30",
      "shortDescription": "≤ 80",
      "fullDescription": "≤ 4000"
    }
  }
}
```

**App Store** (`metadata.json`):

```json
{
  "copyright": "2026 My Company",
  "locales": {
    "en-US": {
      "name": "",
      "subtitle": "",
      "privacyPolicyUrl": "",
      "description": "",
      "keywords": "",
      "promotionalText": "",
      "whatsNew": "",
      "supportUrl": "",
      "marketingUrl": ""
    }
  }
}
```

`name`, `subtitle`, `privacyPolicyUrl` and `privacyChoicesUrl` go to the _App Info_. All other fields go to the version.

**iOS What's New** (`whatsnew.json`), three accepted shapes:

```json
{ "en-US": "text", "fr-FR": "texte" }
{ "*": "same text for every existing locale" }
{ "locales": { "en-US": { "whatsNew": "text" } } }
```

## Image layout

Files are uploaded **in filename order** (`1.png`, `2.png`, … `10.png`). Existing images of the same type are **replaced**.

**Google Play**:

```
screenshots/
└── en-US/
    ├── phone/      (max 8, each side between 320 and 3840 px)
    ├── tablet7/    (max 8)
    ├── tablet10/   (max 8)
    ├── feature/    (1 image, 1024×500)
    └── icon/       (1 image, 512×512)
```

**App Store**:

```
screenshots/
└── en-US/
    ├── iphone/     (max 10, 6.5": 1284×2778 or 1242×2688)
    └── ipad/       (max 10, 13": 2064×2752 or 2048×2732)
```

Portrait and landscape are both accepted.

### Mockups

The `mockups:*` scripts take one folder per short language code and copy it to every matching store locale (`en` → `en-US`, `en-GB`…):

```
mockups/
├── phone/en/  phone/fr/ …      (Google)
├── icon/                        (Google, shared by all locales)
├── iphone/en/ iphone/fr/ …     (Apple)
└── ipad/en/   ipad/fr/ …
```

The language mapping is defined in `LANGUES` at the top of each `mockups.js`.

## Subscription prices

Both scripts read the **`Prix par pays`** sheet of an Excel file:

| Pays   | Code | Devise | Prix |
| ------ | ---- | ------ | ---- |
| France | FR   | EUR    | 4.99 |

Columns: `Pays` = country, `Code` = region code, `Devise` = currency, `Prix` = price.

- `Code`: region code (`FR` on Google, `FRA` on Apple)
- `Devise`: optional. On Google, the row is skipped if the currency doesn't match.
- **Google**: updates the `regionalConfigs` of the requested base plan.
- **Apple**: picks the closest Apple price point. The change is scheduled for **tomorrow**, and the row is skipped if the gap is over 25%.

Without `--apply`, the scripts only show what would change.

## Security

- `config/config.js`, `.p8` files and service account JSON files are in `.gitignore`. **Check `git status` before every commit.**
- If a key has ever been committed, even once: **revoke it** and create a new one. Removing it from history is not enough.
- Give the service account and the Apple key **only the permissions they need**.

## Known limitations

- **Key paths**: `google/index.js` resolves `KEY_FILE` from `google/`, while `google/lib/price.mjs` resolves it from `config/`. `apple/lib/api.js` reads `PRIVATE_KEY_PATH` from the folder you run the command in, while `apple/fetch.js` reads it from the project root. Absolute paths avoid the problem.
- **File paths**: `apple/index.js` reads the JSON and screenshots folder from the current directory. `google/index.js` reads them from `google/`.
- **No length check on Apple** in `update:ios`: text that is too long is rejected by Apple at upload time.
- **Only the 20 most recent iOS versions** are searched when looking up the requested version.
- **Apple screenshot sizes**: only 6.5" (iPhone) and 13" (iPad) are uploaded.

## Project structure

```
.
├── apple/
│   ├── index.js            # upload text + screenshots
│   ├── fetch.js            # read the live listing
│   └── lib/
│       ├── api.js          # App Store Connect client (JWT)
│       ├── version.js      # editable version lookup
│       ├── metadata.js     # localizations
│       ├── screenshots.js  # screenshots
│       ├── whatnews.js     # What's New only
│       ├── mockups.js
│       └── price.mjs
├── google/
│   ├── index.js
│   ├── fetch.js
│   └── lib/
│       ├── api.js          # client + edit handling
│       ├── metadata.js
│       ├── images.js
│       ├── mockups.js
│       └── price.mjs
├── config/
│   └── config.example.js   # copy to config.js
├── examples/               # sample JSON files
└── package.json
```
