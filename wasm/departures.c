/*
 * BSAG Abfahrten – portable Countdown-Kernlogik.
 * Aus der ESP32-Logik BSAG_Abfahrten.ino abgeleitet.
 * Nur Standard-C, keine Arduino-Abhängigkeiten.
 * Emscripten: emcc -O3 -nostdlib -Wl,--no-entry ... -o assets/departures.wasm
 */
#if defined(__wasm__)
#define API __attribute__((visibility("default")))
#else
#define API
#endif

/* -999 = unbekannt / entfallen, -1 = abgefahren, 0 = JETZT, 1.. = Minuten */
API int minutes_until(double departure_epoch, double now_epoch, int cancelled) {
    if (cancelled || departure_epoch <= 0 || now_epoch <= 0) return -999;
    double seconds = departure_epoch - now_epoch;
    if (seconds > 0) {
        if (seconds > 2147483580.0) return 2147483647;
        return ((int)seconds + 59) / 60;
    }
    if (seconds >= -60) return 0;
    return -1;
}

/* muted 0, gruen 1, gelb 2, rot 3 */
API int color_code(double departure_epoch, double now_epoch, int cancelled) {
    if (cancelled) return 3;
    int minutes = minutes_until(departure_epoch, now_epoch, 0);
    if (minutes == -999) return 0;
    if (minutes >= 10) return 1;
    if (minutes >= 6) return 2;
    return 3;
}

/* Verspaetung: eine Sekunde an, eine Sekunde aus. */
API int delay_blink_on(double now_epoch) {
    return ((int)now_epoch & 1) == 0;
}
