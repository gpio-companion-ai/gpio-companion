# Apprendre gpio-companion

Bienvenue sur votre établi électronique. gpio-companion relie trois espaces :

- **Projet** conserve vos circuits et votre code sur GitHub.
- **Appareils** gère votre Raspberry Pi ou Orange Pi, le WiFi, Code et les mises à jour.
- **Code** ouvre l’agent intégré, où vous décrivez ce que vous souhaitez construire.

Vous n’avez pas besoin de connaître Linux, Git ou C pour commencer. Débutez avec une LED, posez des questions et laissez l’agent préparer le câblage et le code.

## Commencez ici

1. [Préparez votre établi](./getting-started.md) et créez votre premier projet.
2. Ouvrez le brochage de votre carte avant de brancher un fil.
3. Suivez [Construire, exécuter et enregistrer](./workflows.md) pour votre premier projet LED.

## Choisissez un guide

| Guide | Utilisez-le pour… |
| --- | --- |
| [Démarrage](./getting-started.md) | Associer votre carte et créer votre premier projet |
| [Construire, exécuter et enregistrer](./workflows.md) | Travailler avec l’agent, tester un circuit et enregistrer le résultat |
| [WiFi et Bluetooth](./wifi-bluetooth.md) | Connecter une carte ou résoudre un problème réseau |
| [Stockage amovible](./storage.md) | Utiliser une SD ou une clé USB dans Code |
| Brochage Raspberry Pi | Trouver des broches physiques sûres sur un Raspberry Pi |
| Brochage Orange Pi | Trouver des broches physiques sûres sur un Orange Pi |

## Votre premier kit

Pour la première activité, préparez :

- une carte gpio-companion configurée et son alimentation
- une breadboard
- une LED
- une résistance de **220 Ω à 1 kΩ**
- deux fils de connexion
- un compte GitHub

La résistance est importante : elle limite le courant et protège la LED ainsi que la broche GPIO.

## Trois règles pour protéger la carte

1. Coupez l’alimentation avant de déplacer des fils.
2. Le GPIO fonctionne en logique **3,3 V**. N’envoyez jamais 5 V dans une broche GPIO.
3. Utilisez les **numéros de broches physiques**, c’est-à-dire les trous numérotés du connecteur. Vérifiez le brochage de votre carte au lieu de deviner.

Si un composant chauffe, dégage une odeur ou réagit de façon inattendue, débranchez d’abord l’alimentation. Faire une pause prudente fait partie de l’électronique.

## Pour les créateurs d’images

Ces leçons supposent que gpio-companion est déjà installé sur votre carte. La création d’une image Armbian, la configuration Cloudflare et l’installation des services sont décrites dans `documentation/host/device-image.md` dans le dépôt source.
