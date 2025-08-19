/*
 * G.722 Codec Stub - Empty implementation when G.722 is disabled
 */

#include <napi.h>

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

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
    return G722Stub::Init(env, exports);
}

NODE_API_MODULE(g722, InitAll)