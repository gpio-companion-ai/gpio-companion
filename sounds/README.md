# Board notification sounds

The board presence alerts on dashboard, desktop, and mobile use:

- `board-online.wav`: Kenney Interface Sounds 1.0 `Audio/open_001.ogg`, converted to mono 44.1 kHz PCM WAV.
- `board-offline.wav`: Kenney Interface Sounds 1.0 `Audio/close_001.ogg`, converted the same way.

Source: https://kenney.nl/assets/interface-sounds

License: CC0. The original pack and license are in `kenney-interface/`.
Dashboard copies live in `apps/dashboard/assets/`; mobile copies live in `apps/mobile/assets/`.
Desktop imports these root WAV files through Vite. Keep the copies synchronized when replacing a sound.

Profile → Board alerts provides a local sound toggle and previews. Visual alerts remain enabled when sound is muted.
