# Getting started

By the end of this guide, your board will be online, paired with your account, connected to GitHub, and ready for its first project.

You need a **configured gpio-companion board** and a GitHub account. If you are preparing the operating-system image yourself, follow `documentation/host/device-image.md` in the source repository first.

## 1. Power and connect the board

Connect the board to power. Ethernet is the easiest first connection: plug in a network cable if one is available and wait about two minutes.

No Ethernet? That is fine. You can pair the nearby board over Bluetooth and send its WiFi details in step 4. See [WiFi and Bluetooth](./wifi-bluetooth.md) if your browser or phone cannot find it.

## 2. Sign in

Open gpio-companion in the web, desktop, or mobile app and choose **Continue with GitHub**.

On the web, the **Project** page shows a short setup journey:

**Sign in → Tell us about you → Pair a board → Connect GitHub → Ready**

The second step opens **Profile → Experience**: pick your **skill level** (Beginner, Intermediate, Expert) and your **context** (home hobbyist, lab / daily PCB work, education). The on-device agent uses this to decide how much it explains, how small its steps are, and which safety notes it adds. It never changes the technical rules — the same correct hardware work happens either way. You can change it any time from **Profile → Experience**; the change syncs to your paired boards.

Desktop may open **Devices** after sign-in, while mobile opens **Project**. The same tools are available on all three.

## 3. Pair your board

Open **Devices → My board**, then choose **Pair a device** or **Add board**.

The easiest method is:

1. Choose **Connect over Bluetooth** or **Scan nearby**.
2. Select the device named **gpio-companion**.
3. Check the detected board, then choose **Pair selected device**.
4. Give it a friendly label such as `Desk Pi` or `Orange Bench`.

If Bluetooth is unavailable, enter the **Device URL**, **Pairing UUID**, and **Pairing key** supplied with the configured board. Treat the pairing key like a password.

If the board already has an owner, your request waits for that person to approve the transfer. One person owns a board at a time.

## 4. Connect WiFi if needed

Skip this step when the board is already online through Ethernet.

Open **Devices → WiFi**, choose your paired board, enter the network name and password, then choose **Connect over Bluetooth** or **Send to board**. Wait for the connected message before unplugging Ethernet.

The WiFi details go directly to the nearby board. They are not added to your project. For browser and iPhone options, see [WiFi and Bluetooth](./wifi-bluetooth.md).

## 5. Open Code

On **Devices → My board** or **Project**, choose **Open Code**. That opens the in-app session for the selected board. No pairing code is required.

## 6. Connect GitHub

Open **Profile → GitHub** and choose **Connect GitHub App**. Select the repositories gpio-companion may use, or allow all repositories.

You do not need to create or paste a personal access token. The board receives short-lived access when it needs to save work.

## 7. Create your first project

Open **Project** and choose **New project**. Use a simple name such as `hello-led`, then choose **Create**.

When your board is online, gpio-companion creates the GitHub repository, copies it to the board, and adds it to Code. Select the project row if it does not open automatically.

Now choose **Open Code** and try this prompt:

> Help me build a safe blinking LED for my board. Show me the breadboard first, use physical pin numbers, and wait for me before running it.

The agent should identify your board, prepare a visual breadboard, and explain where each wire goes. Continue with [Build, run, and save](./workflows.md).

## Quick check

You are ready when:

- your board shows **Online** in Devices
- **Open Code** opens the in-app session
- your GitHub connection shows as active
- `hello-led` appears in Project

## If you get stuck

| What you see | What to try |
| --- | --- |
| No nearby Bluetooth device | Move closer, enable Bluetooth permissions, and make sure no other app is connected to the board |
| Board remains offline | Keep Ethernet connected or send WiFi again from **Devices → WiFi** |
| Pairing details are rejected | Confirm all three details belong to the same physical board |
| Open Code does not answer | Keep the board online, then choose **Open Code** again |
| Project does not reach the board | Keep the board online for a few minutes, then reload Project |
| A new feature is missing | Switch to **Expert**, open **Devices → Debug**, and choose **Update companion** |
