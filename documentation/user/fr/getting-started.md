# Démarrage

À la fin de ce guide, votre carte sera en ligne, associée à votre compte, reliée à GitHub et prête pour son premier projet.

Il vous faut une **carte gpio-companion configurée** et un compte GitHub. Si vous préparez vous-même l’image du système, suivez d’abord `documentation/host/device-image.md` dans le dépôt source.

## 1. Alimenter et connecter la carte

Branchez l’alimentation. Ethernet est la solution la plus simple pour la première connexion : branchez un câble réseau si possible et attendez environ deux minutes.

Pas d’Ethernet ? Aucun problème. Vous pourrez associer la carte proche en Bluetooth et lui envoyer les informations WiFi à l’étape 4. Consultez [WiFi et Bluetooth](./wifi-bluetooth.md) si votre navigateur ou votre téléphone ne la trouve pas.

## 2. Se connecter

Ouvrez gpio-companion dans l’application web, de bureau ou mobile, puis choisissez **Continuer avec GitHub**.

Sur le web, la page **Projet** présente un parcours court :

**Connexion → Associer une carte → Connecter GitHub → Prêt**

L’application de bureau peut ouvrir **Appareils** après la connexion, tandis que l’application mobile ouvre **Projet**. Les mêmes outils sont disponibles sur les trois plateformes.

## 3. Associer votre carte

Ouvrez **Appareils → Ma carte**, puis choisissez **Associer un appareil** ou **Ajouter une carte**.

La méthode la plus simple :

1. Choisissez **Connecter en Bluetooth** ou **Rechercher à proximité**.
2. Sélectionnez l’appareil nommé **gpio-companion**.
3. Vérifiez la carte détectée, puis choisissez **Associer l’appareil sélectionné**.
4. Donnez-lui un nom parlant, par exemple `Pi du bureau` ou `Banc Orange`.

Si le Bluetooth est indisponible, saisissez l’**URL de l’appareil**, l’**UUID d’association** et la **clé d’association** fournis avec la carte configurée. Traitez cette clé comme un mot de passe.

Si la carte a déjà un propriétaire, votre demande attend son accord. Une carte ne possède qu’un propriétaire à la fois.

## 4. Connecter le WiFi si nécessaire

Ignorez cette étape si la carte est déjà en ligne par Ethernet.

Ouvrez **Appareils → WiFi**, choisissez la carte associée, saisissez le nom du réseau et son mot de passe, puis choisissez **Connecter en Bluetooth** ou **Envoyer à la carte**. Attendez le message de connexion avant de retirer le câble Ethernet.

Les informations WiFi vont directement vers la carte proche. Elles ne sont pas ajoutées au projet. Pour les options selon le navigateur ou l’iPhone, consultez [WiFi et Bluetooth](./wifi-bluetooth.md).

## 5. Ouvrir Code

Dans **Appareils → Ma carte** ou **Projet**, choisissez **Ouvrir Code**. Cela ouvre la session intégrée de la carte sélectionnée. Aucun code d’association n’est nécessaire.

## 6. Connecter GitHub

Ouvrez **Profil → GitHub** et choisissez **Connecter l’application GitHub**. Sélectionnez les dépôts que gpio-companion peut utiliser, ou autorisez-les tous.

Vous n’avez pas besoin de créer ni de coller un jeton d’accès personnel. La carte reçoit un accès de courte durée lorsqu’elle doit enregistrer du travail.

## 7. Créer votre premier projet

Ouvrez **Projet** et choisissez **Nouveau projet**. Utilisez un nom simple comme `bonjour-led`, puis choisissez **Créer**.

Lorsque la carte est en ligne, gpio-companion crée le dépôt GitHub, le copie sur la carte et l’ajoute à Code. Sélectionnez la ligne du projet s’il ne s’ouvre pas automatiquement.

Choisissez maintenant **Ouvrir Code** et essayez cette demande :

> Aidez-moi à construire une LED clignotante sûre pour ma carte. Montrez-moi d’abord la breadboard, utilisez les numéros de broches physiques et attendez mon accord avant de l’exécuter.

L’agent doit reconnaître votre carte, préparer une breadboard visuelle et expliquer chaque fil. Continuez avec [Construire, exécuter et enregistrer](./workflows.md).

## Vérification rapide

Vous êtes prêt lorsque :

- la carte indique **En ligne** dans Appareils
- **Ouvrir Code** ouvre la session intégrée
- la connexion GitHub est active
- `bonjour-led` apparaît dans Projet

## En cas de blocage

| Ce que vous voyez | À essayer |
| --- | --- |
| Aucun appareil Bluetooth proche | Rapprochez-vous, autorisez le Bluetooth et fermez toute autre application connectée à la carte |
| La carte reste hors ligne | Gardez Ethernet branché ou renvoyez le WiFi depuis **Appareils → WiFi** |
| Les informations d’association sont refusées | Vérifiez que les trois informations proviennent de la même carte physique |
| Ouvrir Code ne répond pas | Laissez la carte en ligne, puis choisissez à nouveau **Ouvrir Code** |
| Le projet n’arrive pas sur la carte | Laissez la carte en ligne quelques minutes, puis actualisez Projet |
| Une fonction récente manque | Passez en mode **Expert**, ouvrez **Appareils → Débogage**, puis choisissez **Mettre à jour le compagnon** |
