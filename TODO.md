## dashboard ( multi platform )

### improvmement

- the user must be notified when the companion-board the user try to pair to is already paired with someone or himself.
- when the wifi connection setting via bluetooth. the success/fail message is displayed in plain json format, it should be a success/failed with reason message in a text format with associated success/error colors.

## bugfix

- when unpairing a device, the DELETE request to the web dashboard fail ( bug found in the desktop dashboard version )
- script `scripts/first-setup.sh` open-vicking installing part, it crash. ( bug found on a rasberry pi 4 model b rev1.5 ).
