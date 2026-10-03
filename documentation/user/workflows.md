# Build, run, and save

This is the everyday loop: describe an idea, check the visual circuit, build it safely, run it, and save the result.

## 1. Start with a useful prompt

Open a project, choose **Open Code**, and tell the agent the outcome you want. Include the parts you have and ask it to pause before powering anything.

For example:

> I have one red LED, a 330 Ω resistor, and jumper wires. Make it blink once per second. Show the breadboard, label physical pins, and wait for me to confirm the wiring before you run it.

Good prompts describe the goal and constraints. You do not need to prescribe file names, APIs, or commands.

## 2. Read the circuit before building it

Return to **Project** and inspect the breadboard view. Check that:

- the board and parts match what is on your desk
- every GPIO is identified by a **physical pin number**
- an LED has a series resistor
- no GPIO is connected to 5 V
- power and ground connections match your board's pinout

Ask the agent when a symbol or wire is unclear. A visual diagram is a plan, not proof that the physical circuit is correct.

## 3. Build with power off

Disconnect board power before placing or moving wires. Build one connection at a time and gently tug each jumper to check that it is seated.

For an LED, remember:

- the longer leg is usually the positive side, called the **anode**
- the flat edge of the LED marks the negative side, called the **cathode**
- the resistor can go on either side of the LED as long as it is in series

Compare the finished circuit with the diagram, then reconnect power.

## 4. Choose how to control it

Open the project, expand **Board tools**, and select the correct online board.

### Run on board

Use **Run on board** for a lasting behavior such as blinking, fading, reading a button, or playing a tone. Select the sketch prepared by the agent and choose **Start**.

Output from `Serial.print` appears under **Serial (host)**. Choose **Stop**, or use **Stop sketch** at the top of the project, before rewiring.

### Live GPIO

Use **Live GPIO** for a quick bench test:

1. Select **Companion** for the Pi header or **Arduino** for a connected proxy.
2. Tap a safe GPIO pin.
3. Choose **In**, **Set high**, **Set low**, **PWM**, or **Tone** as appropriate.
4. Choose **Off** or stop the tone when the test is finished.

Live GPIO is for short tests. Ask the agent for a sketch when the behavior should continue or become part of the project.

## 5. Verify the wiring

If the project has a breadboard diagram, open **Verify circuit** and choose **Verify**. Stop any running sketch first.

Results mean:

| Result | Meaning |
| --- | --- |
| **Pass** | The measured connection matches the plan |
| **Fail** | The measured connection does not match the plan |
| **Press** | Hold the indicated button, then test again |
| **Unsafe** | The connection must not be driven; disconnect power and inspect it |
| **Unknown** | The board cannot measure this net reliably; inspect it by hand |

An LED-only connection may be **Unknown** because the header cannot measure every component. Unknown is not the same as failed.

## 6. Use a USB Arduino

gpio-companion offers two different Arduino modes.

### Flash Arduino as proxy

Use this when you want Live GPIO or a companion sketch to control Arduino pins:

1. Connect the Arduino by USB.
2. Open **Devices → My board**.
3. Find **Arduino proxy** and choose **Flash Arduino as proxy**.
4. Return to Project. **Arduino** should now be available in Live GPIO.

The proxy is special gpio-companion firmware. If the proxy control is missing, check the USB cable and port, then reload the board.

### Flash Arduino

Use **Project → Board tools → Arduino flash** when the Arduino should run your project's own firmware by itself. Select the board type, sketch, and USB port, then choose **Flash**.

Project firmware replaces proxy firmware. To use Arduino Live GPIO again later, return to Devices and choose **Re-flash Arduino as proxy**.

USB serial output appears under **Serial (USB)**. Select the port and speed, then choose **Open serial**. Flashing may close the serial connection briefly while the board restarts.

## 7. Review and save

The agent works on a separate feature branch while a circuit or sketch is in progress. This lets you inspect the result without replacing the saved version immediately.

Use **Reload** to see a newly pushed branch. Check the breadboard, PCB, technical sheets, and behavior. When you are happy, tell the agent:

> Save this project.

The agent merges the finished work into the main branch. **Save to GitHub** only commits and pushes the board's current files; it does not approve or merge the feature by itself.

## Useful project locations

You normally do not need to edit these paths manually, but they help explain what appears in Project:

| Folder | What it contains |
| --- | --- |
| `breadboard/` | The visual plug map |
| `pcb/` | PCB design and preview |
| `technical/` | Wiring notes and technical sheets |
| `host/` | C sketches run by the companion |
| `firmware/` | C sketches flashed to a USB Arduino |
| `app/` | Custom board apps the agent serves for this project |

## Custom board apps

When a project needs its own control panel or live view — sliders, charts, a
wizard — the agent can build a small board app inside the project (`app/`
folder, one folder per app) and serve it from the board. Ask for it in Open
Code ("make a panel that…"), and the agent starts the app and opens it for
you.

You can also start and open board apps yourself:

- Open a project on **Project** and expand **Custom server** (or the
  equivalent board-tools section). The picker lists the project's apps by
  their package name. Choose **Start server**, then **Open** to show it in
  the preview pane beside the Open Code chat.
- The dock actions tab has **Stop custom server** to stop it again.
- **Split view** opens beside the chat in Open Code. **Dialog** opens it over
  the current page, and **page** opens it as its own view (web
  `/devices/app`).
- The app runs on your board and is reached through a private, short-lived
  link; the browser never holds your board credentials, and the link renews
  automatically.
- If an app stops, its views show an error note — start it again here or ask
  the agent.
- A board app is a custom surface for that project. Hardware control still
  goes through the usual sketches, flashing, and Live GPIO.

## SSH into your board

In Expert mode, the dock has an **SSH** tab. Select your board, choose
**Connect SSH**, and a terminal opens a shell on the board itself. Sign-in
prompts appear right in the terminal — type your board password (masked) or
use its configured SSH keys. Choose **Disconnect** to close the session. The
same tab exists on web, desktop, and mobile.

## Updates and troubleshooting

Updates normally install automatically. To request one manually, switch the app to **Expert** mode, open **Devices → Debug**, select an online board, and choose **Update companion**. The board may appear offline briefly while services restart.

Try these checks before rebuilding a circuit:

- **No sketches listed:** ask the agent to push the project, then reload Project.
- **Run says busy:** stop the current sketch or circuit verification first.
- **Arduino port missing:** use a data-capable USB cable, reconnect it, and load ports again.
- **No serial text:** confirm the sketch prints output and that the selected speed matches it.
- **New branch missing:** choose **Reload** or leave and reopen Project.

## Bench safety

- Disconnect power before changing wires.
- Never feed 5 V into a GPIO pin.
- Never connect 3.3 V directly to 5 V or ground.
- Use a suitable resistor with every ordinary LED.
- Stay near the bench while motors, relays, heaters, or other powered hardware run.
- Keep pairing details private and never add passwords or keys to a project.
