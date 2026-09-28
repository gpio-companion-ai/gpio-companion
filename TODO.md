# Dashboard

- P0: custom implementation of opencode removing totaly T3code. T3code is too complex for the usage gpio-companion needs. OpenCode has a great API endpoint surface that can accept custom authentication and complete integration with a intergrated UI removing the need of a iframe/webview integration in the dashboard web/native.
  - remove T3code from the project. remove T3code from the first-setup/update scripts.
  - starting a Opencode server service.
  - create or use the Opencode webUI directly from the source

- P1: 3d part integration. Used for 3d model + pcb/arduino/Rpi integrations
  - Companion SKILL to create 3d models.
  - 3d viewer on the dashboard
  - Chatbox with the companion on the same page of the 3d viewer for modification of the 3d models.

- P1: Bug report section
  - Send email to support@gpio-companion.com from the dashboard.

- P2: jlcpcb API intergration. Used for electronics part search, create orders for PCB assembly/3D print.
  - use API client: https://github.com/shpaw415/community_jlcpcb_api_client -> use the npm package `@community-jlcpcb/client`
  - UI integration for searching parts.
  - Companion AIagent SKILL to search parts.
  - UI integration for placing an order. ( this may includes the addition of a profile setting: address )

# Marketplace

## Kits

- Educational Car kit. Kids/beginers starter kit
  - specification:
    1. buying thic kit will create a github
  - Parts:
    1. frame with direction
    2. custom socket for arduino/companion-board to fit on the frame
    3. motors + controller
    4. proximity IR emetor/receptor kit ( for colision detection )
  - digital
    1. 3d model of the car with all pices for the 3d model viewer.
    2. open-viking seed for the project
    3. 10$ in AI credits

## community share (selling point)

- P2: customer can publish there work on the marketplace community platform for selling it. gpio-comapnion keep a poucentage out of a sell.
