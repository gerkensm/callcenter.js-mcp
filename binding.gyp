{
  "targets": [
    {
      "target_name": "g722",
      "conditions": [
        ["'<!(echo ${ENABLE_G722:-1})'!='0'", {
          "sources": [
            "native/g722_addon.cpp",
            "native/g722/g722_encode.c",
            "native/g722/g722_decode.c"
          ],
          "include_dirs": [
            "<!@(node -p \"require('node-addon-api').include_dir\")",
            "native/g722"
          ],
          "defines": [
            "NAPI_DISABLE_CPP_EXCEPTIONS",
            "G722_ENABLED"
          ]
        }, {
          "sources": [
            "native/g722_addon_stub.cpp"
          ],
          "include_dirs": [
            "<!@(node -p \"require('node-addon-api').include_dir\")"
          ],
          "defines": [
            "NAPI_DISABLE_CPP_EXCEPTIONS"
          ]
        }]
      ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "CLANG_CXX_LIBRARY": "libc++",
        "MACOSX_DEPLOYMENT_TARGET": "10.7"
      },
      "msvs_settings": {
        "VCCLCompilerTool": { "ExceptionHandling": 1 }
      }
    }
  ]
}