#!/usr/bin/env node

/**
 * Configuration Validation CLI Tool
 * 
 * This tool provides comprehensive validation of VoIP agent configurations
 * including provider compatibility, network connectivity, and codec testing.
 */

import { validateConfigFile } from '../dist/validation.js';
import { loadConfigWithProvider } from '../dist/config.js';
import { ConfigurationValidator } from '../dist/validation.js';

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }
  
  const configPath = args[0];
  const options = parseOptions(args.slice(1));
  
  console.log('🔍 VoIP Agent Configuration Validator\n');
  console.log(`📁 Validating configuration: ${configPath}\n`);
  
  try {
    if (options.detailed) {
      await runDetailedValidation(configPath, options);
    } else {
      await validateConfigFile(configPath);
    }
  } catch (error) {
    console.error(`❌ Validation failed: ${error.message}`);
    process.exit(1);
  }
}

function showHelp() {
  console.log(`
🔍 VoIP Agent Configuration Validator

Usage: node scripts/validate-config.js <config-file> [options]

Arguments:
  config-file    Path to the configuration file to validate

Options:
  --detailed     Run detailed validation with network tests
  --network      Test network connectivity (requires --detailed)
  --fix-suggestions  Show specific fix suggestions
  --provider <name>   Override provider detection
  --help, -h     Show this help message

Examples:
  # Basic validation
  node scripts/validate-config.js config.json
  
  # Detailed validation with network tests
  node scripts/validate-config.js config.json --detailed --network
  
  # Test provider example configurations
  node scripts/validate-config.js config.example.json --detailed        # Fritz Box
  node scripts/validate-config.js config.asterisk.example.json --detailed
  node scripts/validate-config.js config.cisco.example.json --detailed
  node scripts/validate-config.js config.3cx.example.json --detailed
  node scripts/validate-config.js config.generic.example.json --detailed
  
  # Override provider detection
  node scripts/validate-config.js config.json --provider asterisk
  
  # Get fix suggestions for issues
  node scripts/validate-config.js config.json --fix-suggestions

Available provider profiles:
  - fritz-box       AVM Fritz!Box (home/SMB routers)
  - asterisk        Asterisk PBX (FreePBX, Elastix, etc.)
  - cisco           Cisco CUCM (enterprise communications)
  - 3cx             3CX Phone System (business PBX)
  - generic         Generic SIP provider (standards-compliant)
`);
}

function parseOptions(args) {
  const options = {
    detailed: false,
    network: false,
    fixSuggestions: false,
    provider: null
  };
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--detailed':
        options.detailed = true;
        break;
      case '--network':
        options.network = true;
        break;
      case '--fix-suggestions':
        options.fixSuggestions = true;
        break;
      case '--provider':
        if (i + 1 < args.length) {
          options.provider = args[++i];
        }
        break;
    }
  }
  
  return options;
}

async function runDetailedValidation(configPath, options) {
  try {
    // Load configuration with provider
    console.log('🔧 Loading and processing configuration...');
    const configResult = await loadConfigWithProvider(configPath, {
      provider: options.provider
    });
    
    console.log(`📋 Provider: ${configResult.providerInfo.name}`);
    console.log(`🔍 Auto-detected: ${configResult.providerInfo.autoDetected ? 'Yes' : 'No'}`);
    
    if (configResult.warnings.length > 0) {
      console.log('\n⚠️  Configuration Warnings:');
      configResult.warnings.forEach(warning => {
        console.log(`   • ${warning}`);
      });
    }
    
    // Run comprehensive validation
    console.log('\n🔍 Running comprehensive validation...');
    const validator = new ConfigurationValidator();
    const report = await validator.validateConfiguration(configResult.config, {
      testConnectivity: options.network
    });
    
    // Print detailed results
    printDetailedReport(report, options);
    
    // Show provider-specific information
    if (configResult.config._providerProfile) {
      printProviderDetails(configResult.config._providerProfile);
    }
    
    // Final assessment
    console.log('\n📊 Final Assessment\n');
    if (report.isValid) {
      console.log('✅ Configuration is valid and ready for use!');
      console.log('\n🚀 Next steps:');
      console.log('   npm start call "<number>"');
    } else {
      console.log('❌ Configuration has issues that need to be resolved.');
      if (options.fixSuggestions) {
        printFixSuggestions(report);
      } else {
        console.log('\n💡 Run with --fix-suggestions for detailed fix instructions');
      }
    }
    
  } catch (error) {
    throw new Error(`Detailed validation failed: ${error.message}`);
  }
}

function printDetailedReport(report, options) {
  console.log('\n📋 Detailed Validation Report\n');
  
  // Errors
  if (report.errors.length > 0) {
    console.log('❌ Configuration Errors:');
    report.errors.forEach((error, index) => {
      console.log(`   ${index + 1}. ${error.message}`);
      if (error.field) {
        console.log(`      Field: ${error.field}`);
      }
      if (error.suggestion) {
        console.log(`      💡 ${error.suggestion}`);
      }
    });
    console.log('');
  }
  
  // Warnings
  if (report.warnings.length > 0) {
    console.log('⚠️  Configuration Warnings:');
    report.warnings.forEach((warning, index) => {
      console.log(`   ${index + 1}. ${warning.message}`);
      if (warning.suggestion) {
        console.log(`      💡 ${warning.suggestion}`);
      }
    });
    console.log('');
  }
  
  // Suggestions
  if (report.suggestions.length > 0) {
    console.log('💡 Optimization Suggestions:');
    report.suggestions.forEach((suggestion, index) => {
      const priority = suggestion.priority || 'medium';
      const icon = priority === 'high' ? '🔥' : priority === 'low' ? '💭' : '💡';
      
      // Add clarification for G.722 message
      if (suggestion.type === 'g722-available') {
        console.log(`   ${icon} ${suggestion.message} (already enabled in your config)`);
      } else {
        console.log(`   ${icon} ${suggestion.message}`);
      }
    });
    console.log('');
  }
  
  // Provider Compatibility
  console.log(`🎯 Provider Compatibility Score: ${report.providerCompatibility.score}%`);
  if (report.providerCompatibility.provider) {
    console.log(`   Provider: ${report.providerCompatibility.provider}`);
  }
  if (report.providerCompatibility.issues.length > 0) {
    console.log(`   Issues: ${report.providerCompatibility.issues.join(', ')}`);
  }
  
  // Network Connectivity
  if (report.networkConnectivity) {
    console.log('\n🌐 Network Connectivity Test Results:');
    const net = report.networkConnectivity;
    
    if (net.sipServer.reachable) {
      console.log(`   ✅ SIP Server: Reachable (${net.sipServer.latency}ms latency)`);
    } else {
      console.log(`   ❌ SIP Server: ${net.sipServer.error || 'Unreachable'}`);
    }
    
    if (net.stunServers.length > 0) {
      console.log('   STUN Servers:');
      net.stunServers.forEach((stun, index) => {
        if (stun.reachable) {
          console.log(`     ✅ Server ${index + 1}: ${stun.server}`);
          if (stun.natType) {
            console.log(`        NAT Type: ${stun.natType}`);
          }
        } else {
          console.log(`     ❌ Server ${index + 1}: ${stun.server} - ${stun.error}`);
        }
      });
    }
    
    if (net.recommendations.length > 0) {
      console.log('   📝 Network Recommendations:');
      net.recommendations.forEach(rec => {
        console.log(`     • ${rec}`);
      });
    }
  }
}

function printProviderDetails(profile) {
  console.log('\n📋 Provider Profile Details\n');
  console.log(`Name: ${profile.name}`);
  console.log(`Description: ${profile.description}`);
  
  console.log('\n🔧 Technical Requirements:');
  const reqs = profile.requirements;
  console.log(`   Transport: ${reqs.transport.join(', ')}`);
  console.log(`   Session Timers: ${reqs.sessionTimers ? 'Required' : 'Optional'}`);
  console.log(`   PRACK Support: ${reqs.prackSupport}`);
  console.log(`   Keepalive: ${reqs.keepAliveMethod} every ${reqs.keepAliveInterval}s`);
  
  if (reqs.stunServers && reqs.stunServers.length > 0) {
    console.log(`   STUN Servers: ${reqs.stunServers.join(', ')}`);
  }
  
  console.log('\n🎵 Media Configuration:');
  const sdp = profile.sdpOptions;
  console.log(`   Preferred Codecs: ${sdp.preferredCodecs.join(', ')}`);
  console.log(`   DTMF Method: ${sdp.dtmfMethod}`);
  console.log(`   Media Timeout: ${sdp.mediaTimeout}s`);
  
  if (profile.quirks && Object.keys(profile.quirks).length > 0) {
    console.log('\n⚠️  Provider-Specific Notes:');
    Object.entries(profile.quirks).forEach(([key, value]) => {
      console.log(`   • ${key}: ${value}`);
    });
  }
}

function printFixSuggestions(report) {
  console.log('\n🔧 Detailed Fix Suggestions\n');
  
  const allIssues = [...report.errors, ...report.warnings];
  
  if (allIssues.length === 0) {
    console.log('✅ No issues found that need fixing!');
    return;
  }
  
  allIssues.forEach((issue, index) => {
    console.log(`${index + 1}. Issue: ${issue.message}`);
    if (issue.field) {
      console.log(`   Field: ${issue.field}`);
    }
    if (issue.suggestion) {
      console.log(`   🔧 Fix: ${issue.suggestion}`);
    }
    
    // Add specific fix examples based on issue type
    switch (issue.type) {
      case 'missing-username':
        console.log(`   📝 Example: "username": "your_sip_extension"`);
        break;
      case 'missing-password':
        console.log(`   📝 Example: "password": "your_sip_password"`);
        break;
      case 'missing-server':
        console.log(`   📝 Example: "serverIp": "192.168.1.1" or "serverIp": "sip.provider.com"`);
        break;
      case 'missing-stun-servers':
        console.log(`   📝 Example: "stunServers": ["stun:stun.l.google.com:19302"]`);
        break;
      case 'session-timers-recommended':
        console.log(`   📝 Example: "sessionTimers": {"enabled": true, "expires": 1800}`);
        break;
      case 'prack-required':
        console.log(`   📝 Example: "prackSupport": "required"`);
        break;
    }
    console.log('');
  });
  
  // Provider-specific quick fixes
  if (report.providerCompatibility.score < 85) {
    console.log('🎯 Quick Provider Optimization:');
    console.log('   1. Ensure all required fields are filled');
    console.log('   2. Add STUN servers if using NAT');
    console.log('   3. Enable session timers for stability');
    console.log('   4. Check transport requirements');
    console.log('   5. Verify codec preferences');
  }
}

// Run the CLI tool
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(`❌ CLI tool failed: ${error.message}`);
    process.exit(1);
  });
}