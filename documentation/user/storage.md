# Removable storage

An extra SD card or USB drive gives Code more room for files, references, and projects. There is no separate storage page in the app; you open the drive from Open Code.

## Find your drive

1. Plug the extra drive into the gpio-companion board.
2. Wait a few seconds.
3. Open **Code** and browse to:

   `~/storage`

4. Open the folder named after the drive, for example `~/storage/MY-USB`.

If a drive has no volume name, gpio-companion gives it a name beginning with `USB-` or `SD-`. A second drive with the same name receives `-2`.

## What belongs there

Removable storage works well for:

- component datasheets and reference images
- large design exports or backups
- experiments you want to open manually in Code

Dashboard projects normally live in `~/projects/<name>` and synchronize with GitHub. A folder under `~/storage` does not automatically become a dashboard project. Create ordinary projects from **Project** when you want dashboard previews and automatic board synchronization.

## Remove it safely

Close files and stop sketches that use the drive. Ask the agent to unmount it safely, wait for confirmation, and then unplug it.

Removing a drive makes its shortcut disappear; the `~/storage` folder remains. The SD card or eMMC that boots the board never appears here as removable storage.

## If the drive does not appear

1. Reconnect it and wait ten seconds.
2. Check whether the drive needs more power than the board's USB port can supply.
3. Try a common filesystem such as FAT, exFAT, NTFS, or ext4. Encrypted and unusual filesystems may not open automatically.
4. Open **Devices → Debug** in Expert mode and check free space or recent messages.
5. Ask the agent: `Help me find the removable drive without formatting or erasing it.`

Never format a drive as a troubleshooting step unless its files are backed up and you explicitly intend to erase it.
