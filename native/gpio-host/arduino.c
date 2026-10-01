#define _GNU_SOURCE
#include "Arduino.h"
#include "gpio-host.h"

#include <errno.h>
#include <gpiod.h>
#include <pthread.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#define MAX_PINS 40
#define ANALOG_MAX 255
#define DEFAULT_HZ 490
#define CONSUMER "gpio-host"

enum PinKind {
	PIN_NONE = 0,
	PIN_GPIO,
	PIN_POWER,
	PIN_GND,
	PIN_RESERVED,
	PIN_UNRESOLVED,
};

typedef struct {
	int analog;
	int hz;
	int is_tone;
	unsigned int line;
	struct gpiod_line_request *request;
	pthread_t thread;
	volatile int stop;
} PwmState;

typedef struct {
	enum PinKind kind;
	char chip[32];
	unsigned int line;
	int adc;
	int mode;
	int value;
	struct gpiod_line_request *request;
	PwmState *pwm;
} PinState;

static PinState pins[MAX_PINS + 1];
static struct timespec start_time;
static int analog_warned;
static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;

static void status_mark(void);

int A0, A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A11, A12, A13, A14, A15;

SerialClass Serial;

static void die(const char *msg) {
	fprintf(stderr, "gpio-host: %s\n", msg);
	exit(1);
}

static char *chip_path(const char *chip, char *path, size_t size) {
	if (chip[0] == '/') {
		snprintf(path, size, "%s", chip);
		return path;
	}
	snprintf(path, size, "/dev/%s", chip);
	return path;
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

static PinState *require_gpio(int pin, const char *op) {
	if (pin < 1 || pin > MAX_PINS) {
		fprintf(stderr, "gpio-host: %s pin %d is invalid\n", op, pin);
		exit(1);
	}
	PinState *state = &pins[pin];
	if (state->kind == PIN_POWER || state->kind == PIN_GND) {
		fprintf(stderr, "gpio-host: %s pin %d is power/gnd\n", op, pin);
		exit(1);
	}
	if (state->kind == PIN_RESERVED) {
		fprintf(stderr, "gpio-host: %s pin %d is reserved\n", op, pin);
		exit(1);
	}
	if (state->kind != PIN_GPIO || state->chip[0] == '\0') {
		fprintf(stderr, "gpio-host: %s pin %d is unresolved\n", op, pin);
		exit(1);
	}
	return state;
}

static void release_request(struct gpiod_line_request **request) {
	if (*request) {
		gpiod_line_request_release(*request);
		*request = NULL;
	}
}

static struct gpiod_line_request *request_line(PinState *state, int mode,
	int value) {
	char path[128];
	struct gpiod_chip *chip = gpiod_chip_open(chip_path(state->chip, path, sizeof(path)));
	if (!chip) {
		die("cannot open gpiochip");
	}
	struct gpiod_line_settings *settings = gpiod_line_settings_new();
	struct gpiod_line_config *config = gpiod_line_config_new();
	struct gpiod_request_config *req_cfg = gpiod_request_config_new();
	if (!settings || !config || !req_cfg) {
		die("gpiod alloc failed");
	}
	if (mode == INPUT || mode == INPUT_PULLUP) {
		gpiod_line_settings_set_direction(settings, GPIOD_LINE_DIRECTION_INPUT);
		if (mode == INPUT_PULLUP) {
			gpiod_line_settings_set_bias(settings, GPIOD_LINE_BIAS_PULL_UP);
		}
	} else {
		gpiod_line_settings_set_direction(settings, GPIOD_LINE_DIRECTION_OUTPUT);
		gpiod_line_settings_set_output_value(settings,
			value ? GPIOD_LINE_VALUE_ACTIVE : GPIOD_LINE_VALUE_INACTIVE);
	}
	unsigned int offsets[1] = {state->line};
	if (gpiod_line_config_add_line_settings(config, offsets, 1, settings) < 0) {
		die("line config failed");
	}
	gpiod_request_config_set_consumer(req_cfg, CONSUMER);
	struct gpiod_line_request *request =
		gpiod_chip_request_lines(chip, req_cfg, config);
	gpiod_line_settings_free(settings);
	gpiod_line_config_free(config);
	gpiod_request_config_free(req_cfg);
	gpiod_chip_close(chip);
	if (!request) {
		die("request lines failed");
	}
	return request;
}

static void stop_pwm(PinState *state) {
	if (!state->pwm) {
		return;
	}
	state->pwm->stop = 1;
	pthread_join(state->pwm->thread, NULL);
	release_request(&state->pwm->request);
	free(state->pwm);
	state->pwm = NULL;
	status_mark();
}

static void set_line(struct gpiod_line_request *request, unsigned int line,
	int high) {
	enum gpiod_line_value value =
		high ? GPIOD_LINE_VALUE_ACTIVE : GPIOD_LINE_VALUE_INACTIVE;
	gpiod_line_request_set_value(request, line, value);
}

static void *pwm_loop(void *arg) {
	PwmState *pwm = arg;
	while (!pwm->stop && !gpio_host_stopping()) {
		pthread_mutex_lock(&lock);
		int duty = pwm->analog;
		int hz = pwm->hz;
		pthread_mutex_unlock(&lock);
		if (hz < 1) {
			hz = 1;
		}
		if (duty <= 0) {
			set_line(pwm->request, pwm->line, 0);
			sleep_ns(1000000L);
			continue;
		}
		if (duty >= ANALOG_MAX) {
			set_line(pwm->request, pwm->line, 1);
			sleep_ns(1000000L);
			continue;
		}
		long period_ns = 1000000000L / hz;
		long high_ns = (period_ns * duty) / ANALOG_MAX;
		long low_ns = period_ns - high_ns;
		set_line(pwm->request, pwm->line, 1);
		sleep_ns(high_ns);
		if (pwm->stop) {
			break;
		}
		set_line(pwm->request, pwm->line, 0);
		sleep_ns(low_ns);
	}
	set_line(pwm->request, pwm->line, 0);
	return NULL;
}

static void start_pwm(PinState *state, int analog, int hz, int is_tone) {
	if (state->pwm) {
		pthread_mutex_lock(&lock);
		state->pwm->analog = analog;
		state->pwm->hz = hz;
		state->pwm->is_tone = is_tone;
		pthread_mutex_unlock(&lock);
		status_mark();
		return;
	}
	release_request(&state->request);
	PwmState *pwm = calloc(1, sizeof(*pwm));
	if (!pwm) {
		die("pwm alloc failed");
	}
	pwm->analog = analog;
	pwm->hz = hz;
	pwm->is_tone = is_tone;
	pwm->line = state->line;
	pwm->request = request_line(state, OUTPUT, 0);
	if (pthread_create(&pwm->thread, NULL, pwm_loop, pwm) != 0) {
		die("pwm thread failed");
	}
	state->pwm = pwm;
	state->mode = OUTPUT;
	status_mark();
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

static void parse_pinmap(const char *path) {
	FILE *file = fopen(path, "r");
	if (!file) {
		die("cannot open pinmap");
	}
	char line[256];
	while (fgets(line, sizeof(line), file)) {
		if (line[0] == '#' || line[0] == '\n' || strncmp(line, "hardware ", 9) == 0) {
			continue;
		}
		int physical = 0;
		char kind[32] = {0};
		char chip[32] = {0};
		unsigned int offset = 0;
		char extra[16] = {0};
		int n = sscanf(line, "%d %31s %31s %u %15s", &physical, kind, chip, &offset,
			extra);
		if (n < 2 || physical < 1 || physical > MAX_PINS) {
			continue;
		}
		PinState *state = &pins[physical];
		if (strcmp(kind, "power") == 0) {
			state->kind = PIN_POWER;
		} else if (strcmp(kind, "gnd") == 0) {
			state->kind = PIN_GND;
		} else if (strcmp(kind, "reserved") == 0) {
			state->kind = PIN_RESERVED;
		} else if (strcmp(kind, "unresolved") == 0) {
			state->kind = PIN_UNRESOLVED;
		} else if (strcmp(kind, "gpio") == 0 && n >= 4) {
			state->kind = PIN_GPIO;
			snprintf(state->chip, sizeof(state->chip), "%s", chip);
			state->line = offset;
			if (strcmp(extra, "adc") == 0) {
				state->adc = 1;
			}
		}
	}
	fclose(file);
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
	pthread_mutex_lock(&lock);
	for (int pin = 1; pin <= MAX_PINS; pin++) {
		PinState *state = &pins[pin];
		if (state->kind != PIN_GPIO || (!state->request && !state->pwm)) {
			continue;
		}
		int out = state->pwm || state->mode == OUTPUT;
		int value = state->pwm
			? (state->pwm->analog >= ANALOG_MAX / 2 ? 1 : 0)
			: (state->value ? 1 : 0);
		int n = snprintf(buf + pos, sizeof(buf) - pos,
			"%s{\"physical\":%d,\"chip\":\"%s\",\"line\":%u,\"mode\":\"%s\","
			"\"value\":%d",
			first ? "" : ",", pin, state->chip, state->line, out ? "out" : "in",
			value);
		if (n < 0 || pos + (size_t)n >= sizeof(buf)) {
			break;
		}
		pos += (size_t)n;
		first = 0;
		if (state->pwm) {
			n = state->pwm->is_tone
				? snprintf(buf + pos, sizeof(buf) - pos, ",\"hz\":%d",
					state->pwm->hz)
				: snprintf(buf + pos, sizeof(buf) - pos, ",\"analog\":%d",
					state->pwm->analog);
			if (n < 0 || pos + (size_t)n >= sizeof(buf)) {
				break;
			}
			pos += (size_t)n;
		}
		n = snprintf(buf + pos, sizeof(buf) - pos, "}");
		if (n < 0 || pos + (size_t)n >= sizeof(buf)) {
			break;
		}
		pos += (size_t)n;
	}
	pthread_mutex_unlock(&lock);
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

void gpio_host_init(int argc, char **argv) {
	const char *pinmap = getenv("GPIO_HOST_PINMAP");
	for (int i = 1; i < argc; i++) {
		if (strcmp(argv[i], "--pinmap") == 0 && i + 1 < argc) {
			pinmap = argv[++i];
		}
	}
	if (!pinmap || !pinmap[0]) {
		die("usage: sketch --pinmap FILE");
	}
	parse_pinmap(pinmap);
	clock_gettime(CLOCK_MONOTONIC, &start_time);
	Serial.begin = serial_begin;
	Serial.print = serial_print;
	Serial.println = serial_println;
	Serial.printf = serial_printf;
	status_start();
}

void gpio_host_shutdown(void) {
	status_stop();
	for (int pin = 1; pin <= MAX_PINS; pin++) {
		stop_pwm(&pins[pin]);
		release_request(&pins[pin].request);
	}
}

void pinMode(int pin, int mode) {
	PinState *state = require_gpio(pin, "pinMode");
	stop_pwm(state);
	release_request(&state->request);
	state->mode = mode;
	state->request = request_line(state, mode, 0);
	status_mark();
}

void digitalWrite(int pin, int value) {
	PinState *state = require_gpio(pin, "digitalWrite");
	stop_pwm(state);
	int high = value ? 1 : 0;
	state->value = high;
	if (!state->request || state->mode == INPUT || state->mode == INPUT_PULLUP) {
		release_request(&state->request);
		state->mode = OUTPUT;
		state->request = request_line(state, OUTPUT, high);
		status_mark();
		return;
	}
	set_line(state->request, state->line, high);
	status_mark();
}

int digitalRead(int pin) {
	PinState *state = require_gpio(pin, "digitalRead");
	if (state->pwm) {
		return state->pwm->analog > ANALOG_MAX / 2 ? HIGH : LOW;
	}
	if (!state->request) {
		state->mode = INPUT;
		state->request = request_line(state, INPUT, 0);
		status_mark();
	}
	if (state->mode == OUTPUT) {
		return state->value ? HIGH : LOW;
	}
	enum gpiod_line_value value =
		gpiod_line_request_get_value(state->request, state->line);
	int read = value == GPIOD_LINE_VALUE_ACTIVE ? HIGH : LOW;
	if (state->value != read) {
		state->value = read;
		status_mark();
	}
	return read;
}

void analogWrite(int pin, int value) {
	PinState *state = require_gpio(pin, "analogWrite");
	if (value < 0) {
		value = 0;
	}
	if (value > ANALOG_MAX) {
		value = ANALOG_MAX;
	}
	start_pwm(state, value, DEFAULT_HZ, 0);
}

int analogRead(int pin) {
	PinState *state = require_gpio(pin, "analogRead");
	if (!state->adc) {
		if (!analog_warned) {
			analog_warned = 1;
			fprintf(stderr, "gpio-host: analogRead is unavailable on this header\n");
		}
		return 0;
	}
	return 0;
}

void tone(int pin, unsigned int frequency) {
	PinState *state = require_gpio(pin, "tone");
	int hz = (int)frequency;
	if (hz < 31) {
		hz = 31;
	}
	if (hz > 65535) {
		hz = 65535;
	}
	start_pwm(state, 128, hz, 1);
}

void noTone(int pin) {
	PinState *state = require_gpio(pin, "noTone");
	stop_pwm(state);
	release_request(&state->request);
	state->mode = OUTPUT;
	state->value = 0;
	state->request = request_line(state, OUTPUT, 0);
	status_mark();
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
