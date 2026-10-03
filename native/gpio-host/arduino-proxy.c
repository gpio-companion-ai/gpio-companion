#define _GNU_SOURCE
#include "Arduino.h"
#include "gpio-host.h"

#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/select.h>
#include <termios.h>
#include <time.h>
#include <unistd.h>

#define MAX_PINS 128
#define START_SYSEX 0xF0
#define END_SYSEX 0xF7
#define SET_PIN_MODE 0xF4
#define SET_DIGITAL_PIN 0xF5
#define ANALOG_MESSAGE 0xE0
#define REPORT_ANALOG 0xC0
#define SYSTEM_RESET 0xFF
#define SYSEX_ANALOG_MAPPING_QUERY 0x69
#define SYSEX_ANALOG_MAPPING_RESPONSE 0x6A
#define SYSEX_I2C_REQUEST 0x76
#define SYSEX_I2C_CONFIG 0x78
#define SYSEX_SERIAL 0x60
#define SYSEX_SPI_DATA 0x80

enum PinKind {
	PIN_NONE = 0,
	PIN_GPIO,
	PIN_RESERVED,
};

typedef struct {
	enum PinKind kind;
	int adc;
	int pwm;
	int mode;
	int value;
	int used;
	int duty;
	int adc_read;
} PinState;

static PinState pins[MAX_PINS];
static struct timespec start_time;
static int serial_fd = -1;
static char serial_port[128];
static int serial_baud = 57600;
static int analog_channel[MAX_PINS];
static int analog_pin_by_channel[16];
static int analog_value[16];
static int analog_fresh[16];
static int analog_map_ready;
static int analog_map_from_fw;
static int analog_queried;
static int analog_warned;
static int analog_wait;
static unsigned char analog_cmd;
static unsigned char analog_lsb;
static int in_sysex;
static unsigned char sysex_buf[80];
static uint8_t sysex_len;

int A0, A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A11, A12, A13, A14, A15;

SerialClass Serial;

static void die(const char *msg) {
	fprintf(stderr, "gpio-host-proxy: %s\n", msg);
	exit(1);
}

static void sleep_ns(long ns) {
	if (ns <= 0) {
		return;
	}
	struct timespec ts = {
		.tv_sec = ns / 1000000000L,
		.tv_nsec = ns % 1000000000L,
	};
	while (clock_nanosleep(CLOCK_MONOTONIC, 0, &ts, &ts) == EINTR) {
		if (gpio_host_stopping()) {
			return;
		}
	}
}

static speed_t baud_flag(int baud) {
	switch (baud) {
	case 9600:
		return B9600;
	case 57600:
		return B57600;
	case 115200:
		return B115200;
	default:
		return B57600;
	}
}

static void serial_open(void) {
	if (serial_fd >= 0 || serial_port[0] == 0) {
		return;
	}
	serial_fd = open(serial_port, O_RDWR | O_NOCTTY | O_NONBLOCK);
	if (serial_fd < 0) {
		die("cannot open arduino-proxy serial");
	}
	struct termios tio;
	if (tcgetattr(serial_fd, &tio) == 0) {
		cfmakeraw(&tio);
		cfsetispeed(&tio, baud_flag(serial_baud));
		cfsetospeed(&tio, baud_flag(serial_baud));
		tio.c_cflag |= CLOCAL | CREAD;
		tcsetattr(serial_fd, TCSANOW, &tio);
	}
}

static void analog_map_from_pinmap(void) {
	for (int pin = 0; pin < MAX_PINS; pin++) {
		analog_channel[pin] = -1;
	}
	for (int i = 0; i < 16; i++) {
		analog_pin_by_channel[i] = -1;
	}
	int ch = 0;
	for (int pin = 0; pin < MAX_PINS && ch < 16; pin++) {
		if (pins[pin].adc) {
			analog_channel[pin] = ch;
			analog_pin_by_channel[ch] = pin;
			ch++;
		}
	}
	analog_map_ready = 1;
}

static void handle_analog_map(const unsigned char *data, uint8_t len) {
	for (int pin = 0; pin < MAX_PINS; pin++) {
		analog_channel[pin] = -1;
	}
	for (int i = 0; i < 16; i++) {
		analog_pin_by_channel[i] = -1;
	}
	for (uint8_t pin = 0; pin < len && pin < MAX_PINS; pin++) {
		uint8_t ch = data[pin];
		if (ch < 16) {
			analog_channel[pin] = ch;
			analog_pin_by_channel[ch] = pin;
		}
	}
	analog_map_from_fw = 1;
	analog_map_ready = 1;
}

static void handle_rx_byte(unsigned char value) {
	if (in_sysex) {
		if (value == END_SYSEX) {
			in_sysex = 0;
			if (sysex_len >= 1 && sysex_buf[0] == SYSEX_ANALOG_MAPPING_RESPONSE) {
				handle_analog_map(sysex_buf + 1, (uint8_t)(sysex_len - 1));
			}
			sysex_len = 0;
			return;
		}
		if (sysex_len < sizeof(sysex_buf)) {
			sysex_buf[sysex_len++] = value;
		}
		return;
	}
	if (value == START_SYSEX) {
		in_sysex = 1;
		sysex_len = 0;
		return;
	}
	if (analog_wait) {
		if (analog_wait == 2) {
			analog_lsb = value;
			analog_wait = 1;
			return;
		}
		int ch = analog_cmd & 0x0f;
		analog_value[ch] = analog_lsb | ((value & 0x7f) << 7);
		analog_fresh[ch] = 1;
		analog_wait = 0;
		return;
	}
	if ((value & 0xF0) == ANALOG_MESSAGE) {
		analog_cmd = value;
		analog_wait = 2;
	}
}

static void serial_drain(void) {
	serial_open();
	if (serial_fd < 0) {
		return;
	}
	unsigned char buf[64];
	for (;;) {
		ssize_t n = read(serial_fd, buf, sizeof(buf));
		if (n <= 0) {
			break;
		}
		for (ssize_t i = 0; i < n; i++) {
			handle_rx_byte(buf[i]);
		}
	}
}

static int serial_wait(int timeout_ms) {
	serial_open();
	if (serial_fd < 0) {
		return -1;
	}
	fd_set rfds;
	FD_ZERO(&rfds);
	FD_SET(serial_fd, &rfds);
	struct timeval tv;
	tv.tv_sec = timeout_ms / 1000;
	tv.tv_usec = (timeout_ms % 1000) * 1000L;
	int r = select(serial_fd + 1, &rfds, NULL, NULL, &tv);
	if (r > 0) {
		serial_drain();
		return 1;
	}
	return 0;
}

static void serial_send(const unsigned char *bytes, size_t n) {
	serial_open();
	if (serial_fd < 0) {
		return;
	}
	(void)write(serial_fd, bytes, n);
}

static void send_mode(int pin, int mode) {
	unsigned char buf[3] = {SET_PIN_MODE, (unsigned char)(pin & 0x7f),
		(unsigned char)mode};
	serial_send(buf, 3);
}

static void send_digital(int pin, int value) {
	unsigned char buf[3] = {SET_DIGITAL_PIN, (unsigned char)(pin & 0x7f),
		(unsigned char)(value ? 1 : 0)};
	serial_send(buf, 3);
}

static void analog_map_query(void) {
	if (analog_map_from_fw) {
		return;
	}
	if (!analog_map_ready) {
		analog_map_from_pinmap();
	}
	if (analog_queried) {
		return;
	}
	analog_queried = 1;
	unsigned char q[] = {START_SYSEX, SYSEX_ANALOG_MAPPING_QUERY, END_SYSEX};
	serial_send(q, 3);
	unsigned long start = millis();
	while (!analog_map_from_fw && millis() - start < 80) {
		if (gpio_host_stopping()) {
			return;
		}
		serial_wait(20);
	}
}

static int resolve_analog(int pin, int *channel) {
	analog_map_query();
	if (pin >= 0 && pin < MAX_PINS && analog_channel[pin] >= 0) {
		*channel = analog_channel[pin];
		return pin;
	}
	if (pin >= 0 && pin < 16 && analog_pin_by_channel[pin] >= 0) {
		*channel = pin;
		return analog_pin_by_channel[pin];
	}
	return -1;
}

static void fill_analog_aliases(void) {
	int *aliases[] = {&A0, &A1, &A2, &A3, &A4, &A5, &A6, &A7, &A8, &A9, &A10,
		&A11, &A12, &A13, &A14, &A15};
	int n = 0;
	for (int pin = 0; pin < MAX_PINS && n < 16; pin++) {
		if (pins[pin].adc) {
			*aliases[n++] = pin;
		}
	}
}

#define STATUS_MS 100
#define STATUS_PATH_MAX 256

static char status_path[STATUS_PATH_MAX];
static long long status_started_ms;
static volatile int status_dirty = 1;
static pthread_t status_thread;
static volatile int status_thread_running;

static void status_mark(void) {
	status_dirty = 1;
}

static long long wall_ms(void) {
	struct timespec now;
	clock_gettime(CLOCK_REALTIME, &now);
	return (long long)now.tv_sec * 1000L + now.tv_nsec / 1000000L;
}

static void write_status_file(void) {
	if (!status_path[0]) {
		return;
	}
	char buf[MAX_PINS * 128 + 256];
	size_t pos = (size_t)snprintf(buf, sizeof(buf),
		"{\"pid\":%d,\"started\":%lld,\"pins\":[", getpid(),
		status_started_ms);
	if (pos >= sizeof(buf)) {
		return;
	}
	int first = 1;
	for (int pin = 0; pin < MAX_PINS; pin++) {
		PinState *state = &pins[pin];
		if (state->kind != PIN_GPIO || !state->used) {
			continue;
		}
		int out = state->duty >= 0 || state->mode == OUTPUT;
		int value = state->duty >= 0
			? (state->duty >= 128 ? 1 : 0)
			: (state->value ? 1 : 0);
		int n = snprintf(buf + pos, sizeof(buf) - pos,
			"%s{\"physical\":%d,\"mode\":\"%s\",\"value\":%d",
			first ? "" : ",", pin, out ? "out" : "in", value);
		if (n < 0 || pos + (size_t)n >= sizeof(buf)) {
			break;
		}
		pos += (size_t)n;
		first = 0;
		if (state->duty >= 0) {
			n = snprintf(buf + pos, sizeof(buf) - pos, ",\"analog\":%d",
				state->duty);
			if (n < 0 || pos + (size_t)n >= sizeof(buf)) {
				break;
			}
			pos += (size_t)n;
		}
		if (state->adc && state->adc_read) {
			int channel = pin < MAX_PINS ? analog_channel[pin] : -1;
			if (channel >= 0 && channel < 16) {
				n = snprintf(buf + pos, sizeof(buf) - pos, ",\"adc\":%d",
					analog_value[channel]);
				if (n < 0 || pos + (size_t)n >= sizeof(buf)) {
					break;
				}
				pos += (size_t)n;
			}
		}
		n = snprintf(buf + pos, sizeof(buf) - pos, "}");
		if (n < 0 || pos + (size_t)n >= sizeof(buf)) {
			break;
		}
		pos += (size_t)n;
	}
	pos += (size_t)snprintf(buf + pos, sizeof(buf) - pos, "]}\n");
	char tmp[STATUS_PATH_MAX + 8];
	snprintf(tmp, sizeof(tmp), "%s.tmp", status_path);
	FILE *file = fopen(tmp, "w");
	if (!file) {
		return;
	}
	fwrite(buf, 1, pos, file);
	fclose(file);
	rename(tmp, status_path);
}

static void *status_loop(void *arg) {
	(void)arg;
	while (!gpio_host_stopping()) {
		struct timespec ts = {
			.tv_sec = STATUS_MS / 1000,
			.tv_nsec = (STATUS_MS % 1000) * 1000000L,
		};
		while (clock_nanosleep(CLOCK_MONOTONIC, 0, &ts, &ts) == EINTR) {
		}
		if (status_dirty) {
			status_dirty = 0;
			write_status_file();
		}
	}
	return NULL;
}

static void status_start(void) {
	const char *path = getenv("GPIO_HOST_STATUS");
	if (!path || !path[0]) {
		return;
	}
	snprintf(status_path, sizeof(status_path), "%s", path);
	status_started_ms = wall_ms();
	write_status_file();
	if (pthread_create(&status_thread, NULL, status_loop, NULL) == 0) {
		status_thread_running = 1;
	}
}

static void status_stop(void) {
	if (status_thread_running) {
		status_thread_running = 0;
		pthread_join(status_thread, NULL);
	}
	if (!status_path[0]) {
		return;
	}
	char tmp[STATUS_PATH_MAX + 8];
	snprintf(tmp, sizeof(tmp), "%s.tmp", status_path);
	unlink(tmp);
	unlink(status_path);
}

static PinState *require_gpio(int pin, const char *op) {
	if (pin < 0 || pin >= MAX_PINS || pins[pin].kind != PIN_GPIO) {
		fprintf(stderr, "gpio-host-proxy: %s refused pin %d\n", op, pin);
		exit(1);
	}
	return &pins[pin];
}

static void parse_pinmap(const char *path) {
	FILE *file = fopen(path, "r");
	if (!file) {
		die("cannot open pinmap");
	}
	char line[256];
	while (fgets(line, sizeof(line), file)) {
		if (line[0] == '#' || line[0] == '\n') {
			continue;
		}
		if (strncmp(line, "port ", 5) == 0) {
			sscanf(line + 5, "%127s", serial_port);
			continue;
		}
		if (strncmp(line, "baud ", 5) == 0) {
			sscanf(line + 5, "%d", &serial_baud);
			continue;
		}
		int physical = 0;
		char kind[32] = {0};
		char extra[32] = {0};
		if (sscanf(line, "%d %31s %31s", &physical, kind, extra) < 2) {
			continue;
		}
		if (physical < 0 || physical >= MAX_PINS) {
			continue;
		}
		PinState *state = &pins[physical];
		if (strcmp(kind, "reserved") == 0) {
			state->kind = PIN_RESERVED;
		} else {
			state->kind = PIN_GPIO;
			if (strstr(line, "adc")) {
				state->adc = 1;
			}
			if (strstr(line, "pwm")) {
				state->pwm = 1;
			}
		}
	}
	fclose(file);
}

static void serial_begin(unsigned long baud) {
	(void)baud;
}

static void serial_print(const char *text) {
	fputs(text ? text : "", stdout);
	fflush(stdout);
}

static void serial_println(const char *text) {
	fputs(text ? text : "", stdout);
	fputc('\n', stdout);
	fflush(stdout);
}

static int serial_printf(const char *fmt, ...) {
	va_list args;
	va_start(args, fmt);
	int n = vprintf(fmt, args);
	va_end(args);
	fflush(stdout);
	return n;
}

void gpio_host_init(int argc, char **argv) {
	const char *pinmap = NULL;
	for (int i = 1; i < argc; i++) {
		if (strcmp(argv[i], "--pinmap") == 0 && i + 1 < argc) {
			pinmap = argv[++i];
		}
	}
	if (!pinmap) {
		die("missing --pinmap");
	}
	memset(pins, 0, sizeof(pins));
	for (int pin = 0; pin < MAX_PINS; pin++) {
		pins[pin].duty = -1;
	}
	parse_pinmap(pinmap);
	fill_analog_aliases();
	analog_map_from_pinmap();
	clock_gettime(CLOCK_MONOTONIC, &start_time);
	Serial.begin = serial_begin;
	Serial.print = serial_print;
	Serial.println = serial_println;
	Serial.printf = serial_printf;
	serial_open();
	status_start();
}

void gpio_host_shutdown(void) {
	status_stop();
	if (serial_fd < 0) {
		return;
	}
	for (int ch = 0; ch < 16; ch++) {
		unsigned char report[2] = {
			(unsigned char)(REPORT_ANALOG | (ch & 0x0f)),
			0,
		};
		serial_send(report, 2);
	}
	for (int pin = 0; pin < MAX_PINS; pin++) {
		if (pins[pin].kind != PIN_GPIO || !pins[pin].used) {
			continue;
		}
		send_mode(pin, 1);
		send_digital(pin, 0);
	}
	unsigned char reset = SYSTEM_RESET;
	serial_send(&reset, 1);
	tcdrain(serial_fd);
	close(serial_fd);
	serial_fd = -1;
}

void pinMode(int pin, int mode) {
	PinState *state = require_gpio(pin, "pinMode");
	state->used = 1;
	state->mode = mode;
	state->duty = -1;
	status_mark();
	if (mode == INPUT_PULLUP) {
		send_mode(pin, 11);
	} else if (mode == OUTPUT) {
		send_mode(pin, 1);
	} else {
		send_mode(pin, 0);
	}
}

void digitalWrite(int pin, int value) {
	PinState *state = require_gpio(pin, "digitalWrite");
	state->used = 1;
	state->value = value ? 1 : 0;
	state->duty = -1;
	status_mark();
	send_digital(pin, state->value);
}

int digitalRead(int pin) {
	PinState *state = require_gpio(pin, "digitalRead");
	return state->value ? HIGH : LOW;
}

void analogWrite(int pin, int value) {
	PinState *state = require_gpio(pin, "analogWrite");
	state->used = 1;
	if (value < 0) {
		value = 0;
	}
	if (value > 255) {
		value = 255;
	}
	state->value = value >= 128;
	state->duty = value;
	status_mark();
	send_mode(pin, 3);
	unsigned char buf[3] = {
		(unsigned char)(ANALOG_MESSAGE | (pin & 0x0f)),
		(unsigned char)(value & 0x7f),
		(unsigned char)((value >> 7) & 0x7f),
	};
	serial_send(buf, 3);
}

int analogRead(int pin) {
	int channel = -1;
	int digital = resolve_analog(pin, &channel);
	if (digital < 0 || channel < 0 || channel >= 16) {
		if (!analog_warned) {
			analog_warned = 1;
			fprintf(stderr, "gpio-host-proxy: analogRead is unavailable for pin %d\n",
				pin);
		}
		return 0;
	}
	if (digital < MAX_PINS && pins[digital].kind == PIN_GPIO) {
		pins[digital].used = 1;
		pins[digital].mode = INPUT;
	}
	analog_fresh[channel] = 0;
	send_mode(digital, 2);
	unsigned char report[2] = {
		(unsigned char)(REPORT_ANALOG | (channel & 0x0f)),
		1,
	};
	serial_send(report, 2);
	unsigned long start = millis();
	while (millis() - start < 150) {
		if (gpio_host_stopping()) {
			break;
		}
		serial_wait(20);
		if (analog_fresh[channel]) {
			if (digital < MAX_PINS && pins[digital].kind == PIN_GPIO) {
				pins[digital].adc_read = 1;
			}
			status_mark();
			return analog_value[channel];
		}
	}
	return analog_value[channel];
}

void tone(int pin, unsigned int frequency) {
	(void)frequency;
	analogWrite(pin, 128);
}

void noTone(int pin) {
	digitalWrite(pin, LOW);
}

void delay(unsigned long ms) {
	sleep_ns((long)ms * 1000000L);
}

void delayMicroseconds(unsigned int us) {
	sleep_ns((long)us * 1000L);
}

unsigned long millis(void) {
	struct timespec now;
	clock_gettime(CLOCK_MONOTONIC, &now);
	return (unsigned long)((now.tv_sec - start_time.tv_sec) * 1000L +
		(now.tv_nsec - start_time.tv_nsec) / 1000000L);
}

unsigned long micros(void) {
	struct timespec now;
	clock_gettime(CLOCK_MONOTONIC, &now);
	return (unsigned long)((now.tv_sec - start_time.tv_sec) * 1000000L +
		(now.tv_nsec - start_time.tv_nsec) / 1000L);
}
