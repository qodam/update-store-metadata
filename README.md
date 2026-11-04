# store-metadata-updater

Met à jour les fiches **Google Play** et **App Store** (textes, captures, prix des abonnements) directement par les API, **sans refaire de build**.

Tous les scripts sont interactifs : ils posent leurs questions dans le terminal.
**Entrée** garde la valeur proposée entre crochets, **`-`** saute l'étape.

---

## Sommaire

- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration](#configuration)
- [Commandes](#commandes)
- [Flux de travail conseillé](#flux-de-travail-conseillé)
- [Formats des fichiers](#formats-des-fichiers)
- [Organisation des images](#organisation-des-images)
- [Prix des abonnements](#prix-des-abonnements)
- [Sécurité](#sécurité)
- [Limites connues](#limites-connues)
- [Structure du projet](#structure-du-projet)

---

## Prérequis

- **Node.js 18 ou plus** (utilise `fetch` natif et `await` au niveau racine)
- **Google Play** : un compte de service Google Cloud avec l'API _Google Play Android Developer_ activée, invité dans la Play Console avec les droits sur l'app
- **App Store** : une clé API App Store Connect (rôle _App Manager_ ou _Admin_) au format `.p8`

## Installation

```bash
git clone <url-du-depot>
cd store-metadata-updater
npm install
cp config/config.example.js config/config.js
```

Puis remplis `config/config.js` (voir ci-dessous).

## Configuration

Toute la config est dans `config/config.js` (ignoré par git) :

| Clé                | Store  | Description                                                  |
| ------------------ | ------ | ------------------------------------------------------------ |
| `KEY_FILE`         | Google | Chemin du JSON du compte de service                          |
| `SEND_FOR_REVIEW`  | Google | `false` : enregistré sans examen · `true` : envoyé en examen |
| `ISSUER_ID`        | Apple  | Issuer ID de la clé API                                      |
| `KEY_ID`           | Apple  | Key ID de la clé API                                         |
| `PRIVATE_KEY_PATH` | Apple  | Chemin du fichier `AuthKey_XXXX.p8`                          |

> ⚠️ **Utilise des chemins absolus** pour `KEY_FILE` et `PRIVATE_KEY_PATH`. Selon le script, un chemin relatif n'est pas résolu depuis le même dossier (voir [Limites connues](#limites-connues)).

### Où trouver les clés

- **Google** : Google Cloud Console → _IAM et administration_ → _Comptes de service_ → _Clés_ → _Ajouter une clé (JSON)_. Invite ensuite l'e-mail du compte de service dans la Play Console (_Utilisateurs et autorisations_).
- **Apple** : App Store Connect → _Utilisateurs et accès_ → _Intégrations_ → _Clés API de l'App Store Connect_. Le `.p8` ne se télécharge **qu'une seule fois**.

## Commandes

| Commande                  | Ce qu'elle fait                                                                  |
| ------------------------- | -------------------------------------------------------------------------------- |
| `npm run fetch:android`   | Récupère la fiche Google Play actuelle → JSON + images (ne modifie rien)         |
| `npm run fetch:ios`       | Récupère la fiche App Store actuelle → JSON + captures (ne modifie rien)         |
| `npm run mockups:android` | Copie tes mockups dans `screenshots/<langue>/<appareil>` pour toutes les langues |
| `npm run mockups:ios`     | Pareil pour iPhone / iPad                                                        |
| `npm run update:android`  | Envoie textes et/ou images sur Google Play                                       |
| `npm run update:ios`      | Envoie textes et/ou captures sur l'App Store                                     |
| `npm run whatsnew:ios`    | Met à jour uniquement « Nouveautés » d'une version iOS                           |
| `npm run price:android`   | Prix d'un abonnement Google Play depuis un Excel (essai à blanc)                 |
| `npm run price:ios`       | Prix d'un abonnement App Store depuis un Excel (essai à blanc)                   |

Pour appliquer réellement les prix, ajoute `--apply` :

```bash
npm run price:ios -- --apply
```

`whatsnew:ios` accepte aussi des arguments directs :

```bash
node apple/lib/whatnews.js <appId> <version> [fichier.json] [--yes]
```

## Flux de travail conseillé

1. **Récupérer l'existant** : `npm run fetch:android` / `fetch:ios`. Tu obtiens un JSON au bon format, prêt à modifier.
2. **Modifier** le JSON (textes) et/ou préparer les images (`mockups:*`).
3. **Envoyer** : `npm run update:android` / `update:ios`.
4. **Publier** :
   - Google : _Play Console → Vue d'ensemble de la publication_ (sauf si `SEND_FOR_REVIEW: true`)
   - Apple : soumettre la version dans App Store Connect

### Ce qui protège tes fiches

- **Tout est vérifié avant l'envoi** : longueurs des textes Google, nombre et dimensions des images.
- **Google** : tout passe dans une seule _édition_. En cas d'erreur, elle est supprimée et rien n'est publié à moitié.
- **Apple** : seule une version en préparation (`PREPARE_FOR_SUBMISSION`, `REJECTED`…) est modifiée. Si la version demandée n'existe pas, elle est créée, sauf si une autre est déjà en préparation.
- **Un champ absent du JSON garde sa valeur actuelle.**

## Formats des fichiers

Exemples complets dans [`examples/`](examples/).

**Google Play** (`metadata.json`) :

```json
{
  "details": {
    "contactEmail": "support@example.com",
    "contactWebsite": "https://example.com"
  },
  "locales": {
    "fr-FR": {
      "title": "≤ 30",
      "shortDescription": "≤ 80",
      "fullDescription": "≤ 4000"
    }
  }
}
```

**App Store** (`metadata.json`) :

```json
{
  "copyright": "2026 Mon Entreprise",
  "locales": {
    "fr-FR": {
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

`name`, `subtitle`, `privacyPolicyUrl` et `privacyChoicesUrl` vont dans l'_App Info_. Tous les autres champs vont dans la version.

**Nouveautés iOS** (`whatsnew.json`), trois formes acceptées :

```json
{ "fr-FR": "texte", "en-US": "text" }
{ "*": "même texte pour toutes les langues existantes" }
{ "locales": { "fr-FR": { "whatsNew": "texte" } } }
```

## Organisation des images

Les fichiers sont envoyés **dans l'ordre de leur nom** (`1.png`, `2.png`, … `10.png`). Les images existantes du même type sont **remplacées**.

**Google Play** :

```
screenshots/
└── fr-FR/
    ├── phone/      (max 8, côtés entre 320 et 3840 px)
    ├── tablet7/    (max 8)
    ├── tablet10/   (max 8)
    ├── feature/    (1 image, 1024×500)
    └── icon/       (1 image, 512×512)
```

**App Store** :

```
screenshots/
└── fr-FR/
    ├── iphone/     (max 10, 6,5" : 1284×2778 ou 1242×2688)
    └── ipad/       (max 10, 13" : 2064×2752 ou 2048×2732)
```

Le portrait et le paysage sont acceptés.

### Mockups

Les scripts `mockups:*` partent d'un dossier par langue courte et le copient vers chaque langue du store (`fr` → `fr-FR`, `fr-CA`…) :

```
mockups/
├── phone/fr/  phone/en/ …      (Google)
├── icon/                        (Google, commun à toutes les langues)
├── iphone/fr/ iphone/en/ …     (Apple)
└── ipad/fr/   ipad/en/ …
```

La correspondance des langues est définie dans `LANGUES`, en haut de chaque `mockups.js`.

## Prix des abonnements

Les deux scripts lisent l'onglet **`Prix par pays`** d'un fichier Excel :

| Pays   | Code | Devise | Prix |
| ------ | ---- | ------ | ---- |
| France | FR   | EUR    | 4.99 |

- `Code` : code région (`FR` chez Google, `FRA` chez Apple)
- `Devise` : facultatif. Côté Google, la ligne est ignorée si la devise ne correspond pas.
- **Google** : met à jour les `regionalConfigs` du forfait de base demandé.
- **Apple** : choisit le palier de prix le plus proche. Le changement est programmé pour **demain**, et la ligne est ignorée si l'écart dépasse 25 %.

Sans `--apply`, les scripts affichent seulement ce qui changerait.

## Sécurité

- `config/config.js`, les `.p8` et les JSON de compte de service sont dans `.gitignore`. **Vérifie avec `git status` avant chaque commit.**
- Si une clé a déjà été commitée, même une seule fois : **révoque-la** et génères-en une nouvelle. La supprimer de l'historique ne suffit pas.
- Donne au compte de service et à la clé Apple **les droits minimum** nécessaires.

## Limites connues

- **Chemins des clés** : `google/index.js` résout `KEY_FILE` depuis `google/`, alors que `google/lib/price.mjs` le résout depuis `config/`. `apple/lib/api.js` lit `PRIVATE_KEY_PATH` depuis le dossier d'où tu lances la commande, alors que `apple/fetch.js` le lit depuis la racine du projet. Avec des chemins absolus, le problème disparaît.
- **Chemins des fichiers** : `apple/index.js` lit le JSON et le dossier des captures depuis le dossier courant. `google/index.js` les lit depuis `google/`.
- **Pas de contrôle de longueur côté Apple** dans `update:ios` : un texte trop long est refusé par Apple au moment de l'envoi.
- **Seules les 20 dernières versions iOS** sont parcourues pour retrouver la version demandée.
- **Formats de captures Apple** : seuls le 6,5" (iPhone) et le 13" (iPad) sont envoyés.

## Structure du projet

```
.
├── apple/
│   ├── index.js            # envoi textes + captures
│   ├── fetch.js            # lecture de la fiche en ligne
│   └── lib/
│       ├── api.js          # client App Store Connect (JWT)
│       ├── version.js      # version modifiable
│       ├── metadata.js     # localisations
│       ├── screenshots.js  # captures
│       ├── whatnews.js     # nouveautés seules
│       ├── mockups.js
│       └── price.mjs
├── google/
│   ├── index.js
│   ├── fetch.js
│   └── lib/
│       ├── api.js          # client + gestion des éditions
│       ├── metadata.js
│       ├── images.js
│       ├── mockups.js
│       └── price.mjs
├── config/
│   └── config.example.js   # à copier en config.js
├── examples/               # JSON d'exemple
└── package.json
```
