/*
 * G.722 Codec Native Node.js Addon
 * 
 * This file provides a C++ wrapper around the G.722 codec implementation
 * from the sippy/libg722 repository (https://github.com/sippy/libg722).
 * 
 * License Information:
 * - Original G.722 C implementation: Mix of public domain (Steve Underwood)
 *   and permissive licenses (CMU, Sippy Software Inc.)
 * - See LICENSE_G722 file for complete license details
 * - This wrapper code follows the same permissive licensing
 */

#include <napi.h>

#ifdef G722_ENABLED
#include "g722_encoder.h"
#include "g722_decoder.h"

class G722Wrapper : public Napi::ObjectWrap<G722Wrapper> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    G722Wrapper(const Napi::CallbackInfo& info);
    ~G722Wrapper();

private:
    Napi::Value Encode(const Napi::CallbackInfo& info);
    Napi::Value Decode(const Napi::CallbackInfo& info);

    G722_ENC_CTX* encoder_state;
    G722_DEC_CTX* decoder_state;
};

Napi::Object G722Wrapper::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "G722", {
        InstanceMethod("encode", &G722Wrapper::Encode),
        InstanceMethod("decode", &G722Wrapper::Decode),
    });

    exports.Set("G722", func);
    exports.Set("g722Enabled", Napi::Boolean::New(env, true));
    return exports;
}

G722Wrapper::G722Wrapper(const Napi::CallbackInfo& info) : Napi::ObjectWrap<G722Wrapper>(info) {
    // Initialize G.722 contexts for 64kbps, standard mode
    this->encoder_state = g722_encoder_new(64000, 0);
    this->decoder_state = g722_decoder_new(64000, 0);
    
    if (!this->encoder_state || !this->decoder_state) {
        Napi::Error::New(info.Env(), "Failed to initialize G.722 codec").ThrowAsJavaScriptException();
    }
}

G722Wrapper::~G722Wrapper() {
    if (this->encoder_state) {
        g722_encoder_destroy(this->encoder_state);
    }
    if (this->decoder_state) {
        g722_decoder_destroy(this->decoder_state);
    }
}

Napi::Value G722Wrapper::Encode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() != 1 || !info[0].IsBuffer()) {
        Napi::TypeError::New(env, "PCM buffer expected").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Buffer<int16_t> pcm_buffer = info[0].As<Napi::Buffer<int16_t>>();
    int num_samples = pcm_buffer.Length();
    
    // G.722 encodes 2 samples into 1 byte at 64kbps
    int output_len = num_samples / 2;
    Napi::Buffer<uint8_t> encoded_buffer = Napi::Buffer<uint8_t>::New(env, output_len);

    int result = g722_encode(this->encoder_state, pcm_buffer.Data(), num_samples, encoded_buffer.Data());
    
    if (result != output_len) {
        Napi::Error::New(env, "G.722 encoding failed").ThrowAsJavaScriptException();
        return env.Null();
    }

    return encoded_buffer;
}

Napi::Value G722Wrapper::Decode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() != 1 || !info[0].IsBuffer()) {
        Napi::TypeError::New(env, "G.722 buffer expected").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Buffer<uint8_t> g722_buffer = info[0].As<Napi::Buffer<uint8_t>>();
    int input_len = g722_buffer.Length();

    // G.722 decodes 1 byte into 2 samples (4 bytes) at 64kbps
    int output_len = input_len * 2;
    Napi::Buffer<int16_t> pcm_buffer = Napi::Buffer<int16_t>::New(env, output_len);

    int result = g722_decode(this->decoder_state, g722_buffer.Data(), input_len, pcm_buffer.Data());
    
    if (result != output_len) {
        Napi::Error::New(env, "G.722 decoding failed").ThrowAsJavaScriptException();
        return env.Null();
    }

    return pcm_buffer;
}

#else

// Stub implementation when G722 is disabled
class G722Stub : public Napi::ObjectWrap<G722Stub> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "G722", {
            InstanceMethod("encode", &G722Stub::ThrowNotSupported),
            InstanceMethod("decode", &G722Stub::ThrowNotSupported),
        });

        exports.Set("G722", func);
        exports.Set("g722Enabled", Napi::Boolean::New(env, false));
        return exports;
    }

    G722Stub(const Napi::CallbackInfo& info) : Napi::ObjectWrap<G722Stub>(info) {}

private:
    Napi::Value ThrowNotSupported(const Napi::CallbackInfo& info) {
        Napi::Error::New(info.Env(), "G.722 codec not compiled in. Set ENABLE_G722=1 during build.").ThrowAsJavaScriptException();
        return info.Env().Null();
    }
};

#endif

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
#ifdef G722_ENABLED
    return G722Wrapper::Init(env, exports);
#else
    return G722Stub::Init(env, exports);
#endif
}

NODE_API_MODULE(g722, InitAll)