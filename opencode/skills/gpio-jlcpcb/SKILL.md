---
name: gpio-jlcpcb
description: >-
  Search JLCPCB parts and write an order draft for the current project. Use
  when the user wants an LCSC id, a keyword search, or order data for PCB, 3D
  parts, parts, and assembly. Credentials stay on the dashboard. Do not order.
---

# gpio-jlcpcb

Search parts and write `order/jlcpcb.json`. The application keys are dashboard Pages secrets. This Pi never stores them, and this skill never contains them.

Use the `gpio-jlcpcb` command. You run it yourself. **Never** tell the user to curl loopback.

## Login

```sh
gpio-jlcpcb whoami
```

If that says not logged in, stop. Tell the user to open Devices and choose Authenticate CLI on this board. That starts the OpenAuthster login. The dashboard callback sends the code back to this board. Do not use the AI device token for this login.

Stop when any of these are true for a code lookup, a quote, or a confirm:

- `data.configured` is not true and the query is an LCSC code (`C` plus digits)
- the error is `jlcpcb credentials required`

Keyword search may run when `configured=false`. Do not invent `appId`, `accessKey`, or `secretKey`. Do not ask the user to paste keys on Profile.

`gpio-jlcpcb login` without `--dashboard` is the OpenAuthster CLI login, same issuer and client as the dashboard. Use it only when the user asks to sign in that way. Prefer `--dashboard` on this Pi.

## Search

```sh
gpio-jlcpcb parts C2040
gpio-jlcpcb parts 10k 0603
```

A code query is `components.getDetailsByCode`. Any other text is a keyword search. Do not invent an `open.jlcpcb.com` search path.

Report only `componentCode`, `name`, `package`, and `stock` when present. Do not invent a price. If a price column is present you may say it; do not treat it as an offer.

## Draft

```sh
gpio-jlcpcb draft init --repo owner/name
gpio-jlcpcb draft add-part C2040 --qty 2
gpio-jlcpcb draft push
```

`draft init` records `pcb/` gerber files and every part in `model/manifest.json` (each `.glb` as `model/<stem>.stl`). `add-part` adds the part and an assembly line. `push` stores the draft for the signed-in user so Project can show it.

Assembly is a list only. JLCPCB has no assembly API. Do not submit it.

## Do not

- Order, cart, or pay. Never call `createOrder`. The user confirms a PCB or 3D print on Project.
- Put a JLCPCB key on this Pi, in this skill, or in git.
- Quote `127.0.0.1` to the user. They use Project when JLCPCB is available.
