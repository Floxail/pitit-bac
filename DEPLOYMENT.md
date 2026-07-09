# Guide de mise en ligne

Deux méthodes :

- **A. Docker + Nginx Proxy Manager** — si le serveur a déjà un reverse
  proxy Docker qui tient les ports 80/443 (ta config actuelle). Recommandé.
- **B. Serveur nu** (nginx hôte + systemd) — si les ports sont libres.

---

## A. Docker + Nginx Proxy Manager

Le jeu tourne en deux conteneurs (`pitit-bac-front` : statique + proxy
websocket interne, `pitit-bac-back` : serveur Node). NPM route le domaine et
gère le certificat.

### A.1. Raccorder NPM à un réseau partagé (une seule fois)

NPM doit pouvoir joindre le conteneur front par son nom :

```bash
docker network create proxy
docker network connect proxy nginx-proxy-manager
```

### A.2. Lancer le jeu

```bash
cd ~/pitit-bac
git pull
GAME_DOMAIN=pitit-bac.floxail.fr docker compose up -d --build
```

`GAME_DOMAIN` règle à la fois `ALLOWED_ORIGIN` (backend) et `VUE_APP_URL`
(previews sociales, au build). Défaut : `pitit-bac.floxail.fr`.

### A.3. Créer le proxy host dans NPM (interface web, port 81)

- **Domain Names** : `pitit-bac.floxail.fr`
- **Scheme** : `http` · **Forward Hostname** : `pitit-bac-front` · **Port** : `80`
- ✅ **Websockets Support** — obligatoire, sinon personne ne peut jouer
- ✅ Block Common Exploits
- Onglet **SSL** : Request a new SSL Certificate (Let's Encrypt),
  ✅ Force SSL, ✅ HTTP/2

### A.4. Vérifier

1. `https://pitit-bac.floxail.fr` : le jeu s'affiche.
2. Deux appareils : créer une partie, jouer une manche, voter, kick.
3. Logs : `docker logs -f pitit-bac-back`.

### A.5. Mettre à jour

```bash
cd ~/pitit-bac
git pull
# si les fontes ont été retirées du dépôt (cf. section 7), les remettre :
ls front/src/assets/fonts/*.ttf || echo "MANQUE LES FONTES — scp avant build"
GAME_DOMAIN=pitit-bac.floxail.fr docker compose up -d --build
```

Les statistiques cumulées survivent (volume `back-data`). Redémarrer le back
coupe les parties en cours (état en mémoire).

---

## B. Serveur nu (nginx hôte + systemd)

## 1. Prérequis serveur

- Linux avec systemd (Debian/Ubuntu…)
- **Node.js ≥ 18** (`node -v`) — plus besoin de nvm ni de Node 16
- nginx
- git, make
- Un domaine pointant sur le serveur + certbot pour le TLS
  (le front en production parle en `wss://`, le HTTPS est obligatoire)

## 2. Cloner et installer

```bash
cd /opt   # ou où tu veux
git clone https://github.com/Floxail/pitit-bac.git
cd pitit-bac
make install
```

## 3. Configurer ton domaine (3 fichiers)

Remplace `ton-domaine.fr` partout ci-dessous.

### `front/.env.production` — avant le build

```
VUE_APP_WS_URL=wss://{hostname}/ws        # ne pas toucher, {hostname} est résolu au runtime
VUE_APP_URL=https://ton-domaine.fr        # previews réseaux sociaux (og:image)
```

### `production/pitit-bac.service`

```ini
Environment=ALLOWED_ORIGIN=https://ton-domaine.fr
Environment=PITIT_BAC_WS_PORT=62868
WorkingDirectory=/opt/pitit-bac
ExecStart=/opt/pitit-bac/production/start-back.sh
User=www-data        # un utilisateur qui possède le dossier
Group=www-data
```

⚠️ `ALLOWED_ORIGIN` : le backend **rejette** toute connexion websocket venant
d'un autre origin. Placeholder laissé tel quel = personne ne peut jouer.
Schéma inclus, pas de slash final.

### `production/nginx.conf`

- `server_name ton-domaine.fr;` (les deux blocs server)
- `root /opt/pitit-bac/front/dist/;`
- `include ssl_params;` / `include gzip_params;` : remplace par tes snippets
  TLS/gzip habituels, ou laisse certbot injecter le TLS et supprime ces lignes.

```bash
cp production/nginx.conf /etc/nginx/sites-available/pitit-bac
ln -s /etc/nginx/sites-available/pitit-bac /etc/nginx/sites-enabled/
certbot --nginx -d ton-domaine.fr
nginx -t && systemctl reload nginx
```

## 4. Builder le front

```bash
make build-front     # produit front/dist/, servi par nginx
```

## 5. Lancer le backend

```bash
chmod +x production/start-back.sh
cp production/pitit-bac.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now pitit-bac
systemctl status pitit-bac     # doit afficher « Server is listening on port 62868 »
```

## 6. Vérifications

1. `https://ton-domaine.fr` s'ouvre, logo affiché, toggle clair/sombre OK.
2. Deux appareils (PC + téléphone en 4G) : créer une partie, rejoindre via le
   lien, jouer une manche complète, voter, kick un joueur, finir la partie.
3. `journalctl -u pitit-bac -f` pendant le test : pas d'erreurs.

## 7. Retirer les fontes du dépôt (après le clone serveur)

Les fichiers `front/src/assets/fonts/MSW98UI-*.ttf` sont une fan font dont la
licence de redistribution n'est pas établie : ils sont dans le dépôt le temps
du premier clone, puis retirés.

**Sur ton PC, une fois le serveur cloné :**

```bash
git rm --cached front/src/assets/fonts/MSW98UI-Regular.ttf front/src/assets/fonts/MSW98UI-Bold.ttf
echo "front/src/assets/fonts/*.ttf" >> .gitignore
git add .gitignore
git commit -m "chore: stop tracking MSW98UI font files"
git push
```

Les fichiers restent sur ton PC (seul le suivi git est retiré).

**⚠️ Sur le serveur :** un `git pull` ultérieur de ce commit **supprime
physiquement les .ttf** du dossier. Le build en a besoin. Après chaque pull
qui les fait disparaître, les renvoyer depuis ton PC avant de rebuilder :

```bash
scp front/src/assets/fonts/*.ttf user@serveur:/opt/pitit-bac/front/src/assets/fonts/
```

(Alternative durable : garder une copie sur le serveur hors du dépôt, p. ex.
`/opt/assets-fonts/`, et `cp` avant chaque `make build-front`.)

## 8. Mettre à jour le jeu

```bash
cd /opt/pitit-bac
git pull
make install                                   # si les dépendances ont changé
ls front/src/assets/fonts/*.ttf || scp …       # remettre les fontes si disparues (cf. §7)
make build-front
systemctl restart pitit-bac
```

Le front est statique : pas de redémarrage nginx nécessaire. Redémarrer le
backend coupe les parties en cours — les clients se reconnectent, mais l'état
des parties est perdu (tout est en mémoire).

## 9. Munin (optionnel)

Métriques exposées sur `/munin/running_games`, `/munin/all_games`,
`/munin/clients` (proxifiées par nginx). Installation côté Munin :
voir `munin/README.md`. Si tu n'utilises pas Munin, rien à faire.

## Notes

- Tout l'état (parties, scores) est **en mémoire** : pas de base de données,
  un restart = parties perdues. `back/data/statistics.json` (compteurs
  cumulés) est le seul fichier écrit — l'utilisateur systemd doit pouvoir
  écrire dans `back/data/`.
- Les vulnérabilités npm restantes concernent la chaîne de build front
  (Vue 2 / webpack 4, EOL) : rien ne tourne côté serveur, le risque
  d'exécution est limité au poste qui builde.
