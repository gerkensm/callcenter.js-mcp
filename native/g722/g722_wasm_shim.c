#include <stdint.h>
#include <emscripten/emscripten.h>

#include "g722_encoder.h"
#include "g722_decoder.h"

EMSCRIPTEN_KEEPALIVE G722_ENC_CTX* g722_wasm_enc_new(int rate, int options) {
    return g722_encoder_new(rate, options);
}

EMSCRIPTEN_KEEPALIVE void g722_wasm_enc_destroy(G722_ENC_CTX* ctx) {
    if (ctx != NULL) {
        g722_encoder_destroy(ctx);
    }
}

EMSCRIPTEN_KEEPALIVE int g722_wasm_encode(G722_ENC_CTX* ctx, const int16_t* amp, int len, uint8_t* out_bytes) {
    if (ctx == NULL || amp == NULL || out_bytes == NULL) {
        return -1;
    }
    return g722_encode(ctx, amp, len, out_bytes);
}

EMSCRIPTEN_KEEPALIVE G722_DEC_CTX* g722_wasm_dec_new(int rate, int options) {
    return g722_decoder_new(rate, options);
}

EMSCRIPTEN_KEEPALIVE void g722_wasm_dec_destroy(G722_DEC_CTX* ctx) {
    if (ctx != NULL) {
        g722_decoder_destroy(ctx);
    }
}

EMSCRIPTEN_KEEPALIVE int g722_wasm_decode(G722_DEC_CTX* ctx, const uint8_t* data, int len, int16_t* out_samples) {
    if (ctx == NULL || data == NULL || out_samples == NULL) {
        return -1;
    }
    return g722_decode(ctx, data, len, out_samples);
}
