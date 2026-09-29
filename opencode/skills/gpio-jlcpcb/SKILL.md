---
name: gpio-jlcpcb
description: >-
  Look up JLCPCB parts for the current project through the dashboard. Use when
  the user wants an LCSC id, name, package, or stock. Credentials stay on the
  dashboard. Do not order parts.
---

# gpio-jlcpcb

Look up parts by LCSC component code. The application keys are dashboard Pages secrets. This Pi never stores them, and this skill never contains them.

## Refuse

Before any lookup, read credential status yourself:

```sh
curl -s http://127.0.0.1:4150/v1/jlcpcb
```

You call loopback yourself. **Never** tell the user to curl it.

Stop when any of these are true:

- `data.configured` is not `true`
- the status is not 200
- the error is `jlcpcb credentials required`

Do not POST a search. Do not invent `appId`, `accessKey`, or `secretKey`. Do not call JLCPCB, and do not put a key in the project, in `secrets.env`, or in git. JLCPCB is unavailable until the host sets dashboard Pages secrets. Do not ask the user to paste keys on Profile.

## Lookup

Only after `data.configured` is `true`:

```sh
curl -s -X POST http://127.0.0.1:4150/v1/jlcpcb \
  -H 'content-type: application/json' \
  -d '{"componentCodes":["C2040"]}'
```

`componentCodes` is one or more LCSC codes (`C2040`). This route is `components.getDetailsByCode`. It is not a keyword search. Do not invent a search method the client does not expose.

A hit is `data.parts[]`. Report only:

- `componentCode` — the LCSC id
- `name`
- `package`
- `stock`

Omit a field the response does not include. Do not invent a price. If `price` is present you may say it; do not treat it as an offer.

`jlcpcb credentials required` on this POST means the same refuse as above. Stop.

## Do not

- Order, cart, or pay. There is no order call on this route.
- `PUT` credentials through loopback. Keys are dashboard Pages secrets, not a Profile form.
- Quote `127.0.0.1` to the user. They use Project parts search when JLCPCB is available.
