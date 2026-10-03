"""Minimal Firmata simulator for the companion emulator.

Creates a pty pair and links <root>/ttyACM99 to the slave end, then answers
the StandardFirmata handshake queries the companion sends on attach:
REPORT_FIRMWARE, CAPABILITY_QUERY, and ANALOG_MAPPING_QUERY. The board
presents as an Arduino Uno (20 pins, PWM on 3/5/6/9/10/11, A0-A5 on 14-19).
"""
import os
import pty
import select
import sys
import time
import tty

START_SYSEX = 0xF0
END_SYSEX = 0xF7
SYSEX_REPORT_FIRMWARE = 0x79
SYSEX_CAPABILITY_RESPONSE = 0x6C
SYSEX_ANALOG_MAPPING_RESPONSE = 0x6A

PIN_COUNT = 20
PWM_PINS = {3, 5, 6, 9, 10, 11}
ANALOG_FIRST = 14
ANALOG_COUNT = 6


def capability_reply():
    body = bytearray([SYSEX_CAPABILITY_RESPONSE])
    for pin in range(PIN_COUNT):
        body.append(0x00)
        body.append(0x01)
        body.append(0x01)
        body.append(0x01)
        if pin in PWM_PINS:
            body.append(0x03)
            body.append(0x08)
        if ANALOG_FIRST <= pin < ANALOG_FIRST + ANALOG_COUNT:
            body.append(0x02)
            body.append(0x0A)
        body.append(0x7F)
    return bytes([START_SYSEX]) + bytes(body) + bytes([END_SYSEX])


def analog_map_reply():
    body = bytearray([SYSEX_ANALOG_MAPPING_RESPONSE])
    for pin in range(PIN_COUNT):
        if ANALOG_FIRST <= pin < ANALOG_FIRST + ANALOG_COUNT:
            body.append(pin - ANALOG_FIRST)
        else:
            body.append(0x7F)
    return bytes([START_SYSEX]) + bytes(body) + bytes([END_SYSEX])


FIRMWARE_REPLY = bytes([START_SYSEX, SYSEX_REPORT_FIRMWARE, 2, 5, ord("S"), 0, ord("i"), 0, ord("m"), 0, END_SYSEX])


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    master, slave = pty.openpty()
    tty.setraw(slave)
    link = os.path.join(root, "ttyACM99")
    try:
        os.unlink(link)
    except FileNotFoundError:
        pass
    os.symlink(os.ttyname(slave), link)
    sys.stderr.write(f"firmata-sim: {link}\n")
    sys.stderr.flush()
    buf = b""
    while True:
        ready, _, _ = select.select([master], [], [], 1.0)
        if not ready:
            continue
        try:
            data = os.read(master, 256)
        except OSError:
            # slave fully released (proxy hold during a sketch run) - wait it out
            time.sleep(0.05)
            continue
        if not data:
            continue
        buf += data
        while True:
            start = buf.find(bytes([START_SYSEX]))
            if start < 0:
                buf = buf[-1:]
                break
            end = buf.find(bytes([END_SYSEX]), start)
            if end < 0:
                buf = buf[start:]
                break
            frame = buf[start : end + 1]
            buf = buf[end + 1 :]
            if len(frame) >= 2:
                command = frame[1]
                try:
                    if command == SYSEX_REPORT_FIRMWARE:
                        os.write(master, FIRMWARE_REPLY)
                    elif command == SYSEX_CAPABILITY_RESPONSE:
                        os.write(master, capability_reply())
                    elif command == 0x69:
                        os.write(master, analog_map_reply())
                except OSError:
                    pass


if __name__ == "__main__":
    main()
