#!/usr/bin/env node

// Quick test to verify codec integration
import { getSupportedPayloadTypes, getCodec, G722Codec } from './dist/codecs/index.js';

console.log('🧪 Testing codec integration...\n');

// Test supported payload types
const supportedTypes = getSupportedPayloadTypes();
console.log(`📋 Supported payload types: ${supportedTypes.join(', ')}`);

// Test each supported codec
for (const pt of supportedTypes) {
    const codec = getCodec(pt);
    if (codec) {
        console.log(`✅ PT ${pt}: ${codec.name} (${codec.sampleRate}Hz sample rate, ${codec.clockRate}Hz clock rate)`);
        
        // Test encode/decode for non-G.722 codecs (to avoid requiring G.722 build)
        if (pt !== 9) {
            try {
                const testData = new Int16Array([1000, -1000, 2000, -2000]);
                const encoded = codec.encode(testData);
                const decoded = codec.decode(encoded);
                console.log(`   📊 Test: ${testData.length} samples → ${encoded.length} bytes → ${decoded.length} samples`);
            } catch (error) {
                console.log(`   ❌ Test failed: ${error.message}`);
            }
        }
    } else {
        console.log(`❌ PT ${pt}: Failed to create codec`);
    }
}

// Test G.722 availability
console.log(`\n🔊 G.722 codec availability: ${G722Codec.isAvailable() ? 'Available' : 'Not available'}`);
if (!G722Codec.isAvailable()) {
    console.log(`   Reason: ${G722Codec.getUnavailableReason()}`);
    console.log(`   To enable: npm run build:g722`);
}

console.log('\n✨ Codec integration test complete!');