# Construire, exécuter et enregistrer

Voici la boucle quotidienne : décrivez une idée, vérifiez le circuit visuel, construisez-le en sécurité, exécutez-le et enregistrez le résultat.

## 1. Commencer avec une demande utile

Ouvrez un projet, choisissez **Ouvrir Code** et décrivez le résultat souhaité. Précisez les composants disponibles et demandez à l’agent d’attendre avant d’alimenter quoi que ce soit.

Par exemple :

> J’ai une LED rouge, une résistance de 330 Ω et des fils. Faites-la clignoter chaque seconde. Montrez la breadboard, indiquez les broches physiques et attendez que je confirme le câblage avant l’exécution.

Une bonne demande décrit le but et les contraintes. Vous n’avez pas besoin d’imposer des noms de fichiers, des API ou des commandes.

## 2. Lire le circuit avant de le construire

Revenez dans **Projet** et examinez la breadboard. Vérifiez que :

- la carte et les composants correspondent à ceux de votre établi
- chaque GPIO est identifié par un **numéro de broche physique**
- la LED possède une résistance en série
- aucun GPIO n’est relié au 5 V
- les connexions d’alimentation et de masse correspondent au brochage de votre carte

Interrogez l’agent si un symbole ou un fil n’est pas clair. Un schéma visuel est un plan, pas la preuve que le montage réel est correct.

## 3. Construire hors tension

Débranchez l’alimentation avant de placer ou déplacer des fils. Réalisez une connexion à la fois et tirez doucement sur chaque fil pour vérifier sa tenue.

Pour une LED :

- la patte la plus longue est généralement le côté positif, appelé **anode**
- le bord plat de la LED indique le côté négatif, appelé **cathode**
- la résistance peut être placée d’un côté ou de l’autre de la LED, tant qu’elle reste en série

Comparez le montage terminé avec le schéma, puis rebranchez l’alimentation.

## 4. Choisir comment la commander

Ouvrez le projet, dépliez **Outils de la carte** et sélectionnez la bonne carte en ligne.

### Exécuter sur la carte

Utilisez **Exécuter sur la carte** pour un comportement durable : clignotement, variation de luminosité, lecture d’un bouton ou tonalité. Sélectionnez le croquis préparé par l’agent et choisissez **Démarrer**.

Les messages de `Serial.print` apparaissent dans **Série (hôte)**. Choisissez **Arrêter**, ou utilisez **Arrêter le croquis** en haut du projet, avant de modifier le câblage.

### GPIO en direct

Utilisez **GPIO en direct** pour un test rapide :

1. Sélectionnez **Compagnon** pour le connecteur du Pi ou **Arduino** pour un proxy connecté.
2. Touchez une broche GPIO sûre.
3. Choisissez **Entrée**, **Mettre à 1**, **Mettre à 0**, **PWM** ou **Tonalité** selon le besoin.
4. Choisissez **Désactivé** ou arrêtez la tonalité à la fin du test.

GPIO en direct sert aux essais courts. Demandez un croquis à l’agent si le comportement doit continuer ou faire partie du projet.

## 5. Vérifier le câblage

Si le projet contient un schéma de breadboard, ouvrez **Vérifier le circuit** et choisissez **Vérifier**. Arrêtez d’abord tout croquis en cours.

| Résultat | Signification |
| --- | --- |
| **Réussi** | La connexion mesurée correspond au plan |
| **Échec** | La connexion mesurée ne correspond pas au plan |
| **Appuyer** | Maintenez le bouton indiqué, puis recommencez |
| **Dangereux** | Cette connexion ne doit pas être pilotée ; coupez l’alimentation et inspectez-la |
| **Inconnu** | La carte ne peut pas mesurer ce réseau correctement ; inspectez-le à la main |

Une connexion avec seulement une LED peut rester **Inconnue**, car le connecteur ne peut pas mesurer tous les composants. Inconnu ne signifie pas échec.

## 6. Utiliser un Arduino USB

gpio-companion propose deux modes Arduino différents.

### Graver Arduino comme proxy

Utilisez ce mode pour commander les broches Arduino depuis GPIO en direct ou un croquis compagnon :

1. Branchez l’Arduino en USB.
2. Ouvrez **Appareils → Ma carte**.
3. Trouvez **Proxy Arduino** et choisissez **Graver Arduino comme proxy**.
4. Revenez dans Projet. **Arduino** doit maintenant être proposé dans GPIO en direct.

Le proxy est un micrologiciel spécial de gpio-companion. Si la commande n’apparaît pas, vérifiez le câble et le port USB, puis actualisez la carte.

### Graver Arduino

Utilisez **Projet → Outils de la carte → Gravure Arduino** lorsque l’Arduino doit exécuter seul le micrologiciel du projet. Sélectionnez le type de carte, le croquis et le port USB, puis choisissez **Graver**.

Le micrologiciel du projet remplace celui du proxy. Pour retrouver Arduino dans GPIO en direct, revenez dans Appareils et choisissez **Regraver Arduino comme proxy**.

Les messages série USB apparaissent dans **Série (USB)**. Sélectionnez le port et la vitesse, puis choisissez **Ouvrir le port série**. La gravure peut fermer brièvement la connexion pendant le redémarrage de la carte.

## 7. Examiner et enregistrer

Pendant le travail, l’agent utilise une branche séparée. Vous pouvez ainsi examiner le résultat sans remplacer immédiatement la version enregistrée.

Utilisez **Actualiser** pour voir une nouvelle branche. Vérifiez la breadboard, le PCB, les fiches techniques et le comportement. Lorsque tout vous convient, dites à l’agent :

> Enregistrez ce projet.

L’agent fusionne alors le travail terminé dans la branche principale. **Enregistrer sur GitHub** valide et envoie seulement les fichiers actuels de la carte ; cette action n’approuve ni ne fusionne la fonctionnalité à elle seule.

## Emplacements utiles du projet

Vous n’avez normalement pas besoin de modifier ces chemins à la main, mais ils expliquent le contenu affiché dans Projet :

| Dossier | Contenu |
| --- | --- |
| `breadboard/` | Plan visuel de branchement |
| `pcb/` | Conception et aperçu du PCB |
| `technical/` | Notes de câblage et fiches techniques |
| `host/` | Croquis C exécutés par le compagnon |
| `firmware/` | Croquis C gravés sur un Arduino USB |
| `app/` | Applis de carte personnalisées servies par l’agent pour ce projet |

## Applis de carte personnalisées

Quand un projet demande son propre panneau de contrôle ou sa propre vue en
direct — curseurs, graphiques, assistant — l’agent peut construire une petite
appli de carte et la servir depuis le projet. Demandez-le dans Open Code
(« fais un panneau qui… ») : l’agent démarre l’appli sur la carte et vous
l’ouvre.

- La **vue fractionnée** s’ouvre à côté du chat dans Open Code (là où les
  aperçus de fichiers apparaissent). La **boîte de dialogue** s’ouvre
  par-dessus la page actuelle, et la **page** l’ouvre dans sa propre vue
  (`/devices/app` sur le web).
- L’appli tourne sur votre carte et est joignable par un lien privé à durée
  limitée ; le navigateur ne conserve jamais vos identifiants de carte.
- Le lien se renouvelle automatiquement. Si une appli s’arrête, ses vues
  affichent une note d’erreur — demandez à l’agent de la relancer.
- Une appli de carte est une surface personnalisée pour ce projet. Le
  contrôle du matériel passe toujours par les croquis, la gravure et le GPIO
  en direct habituels.

## Mises à jour et dépannage

Les mises à jour s’installent normalement seules. Pour en demander une, passez en mode **Expert**, ouvrez **Appareils → Débogage**, sélectionnez une carte en ligne et choisissez **Mettre à jour le compagnon**. La carte peut apparaître brièvement hors ligne pendant le redémarrage des services.

- **Aucun croquis dans la liste :** demandez à l’agent d’envoyer le projet, puis actualisez Projet.
- **Exécution occupée :** arrêtez d’abord le croquis ou la vérification en cours.
- **Port Arduino absent :** utilisez un câble USB de données, reconnectez-le et rechargez les ports.
- **Aucun message série :** vérifiez que le croquis produit des messages et que la vitesse sélectionnée correspond.
- **Nouvelle branche absente :** choisissez **Actualiser** ou rouvrez Projet.

## Sécurité sur l’établi

- Débranchez l’alimentation avant de modifier les fils.
- N’envoyez jamais 5 V dans une broche GPIO.
- Ne reliez jamais directement 3,3 V au 5 V ou à la masse.
- Utilisez une résistance adaptée avec toute LED ordinaire.
- Restez près de l’établi lorsque des moteurs, relais, éléments chauffants ou autres équipements alimentés fonctionnent.
- Gardez les informations d’association privées et n’ajoutez jamais de mot de passe ou de clé au projet.
