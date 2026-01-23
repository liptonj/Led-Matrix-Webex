/**
 * mDNS Discovery Test Script
 * 
 * This script tests mDNS service discovery to verify that the bridge
 * is correctly advertising itself on the network.
 */

const { Bonjour } = require('bonjour-service');

console.log('=== mDNS Discovery Test ===\n');
console.log('Searching for _webex-bridge._tcp services on the local network...');
console.log('Press Ctrl+C to stop\n');

const bonjour = new Bonjour();

// Browse for webex-bridge services
const browser = bonjour.find({ type: 'webex-bridge', protocol: 'tcp' }, (service) => {
    console.log('✓ Found webex-bridge service:');
    console.log(`  Name: ${service.name}`);
    console.log(`  Host: ${service.host}`);
    console.log(`  Port: ${service.port}`);
    console.log(`  Type: ${service.type}`);
    console.log(`  Full Name: ${service.fqdn}`);
    
    if (service.addresses && service.addresses.length > 0) {
        console.log(`  IP Addresses:`);
        service.addresses.forEach(addr => {
            console.log(`    - ${addr}`);
        });
    }
    
    if (service.txt) {
        console.log(`  TXT Records:`);
        Object.keys(service.txt).forEach(key => {
            console.log(`    ${key}: ${service.txt[key]}`);
        });
    }
    console.log('');
});

browser.on('up', (service) => {
    console.log(`[UP] Service appeared: ${service.name}`);
});

browser.on('down', (service) => {
    console.log(`[DOWN] Service disappeared: ${service.name}`);
});

// Timeout after 10 seconds
setTimeout(() => {
    console.log('\n=== Search complete ===');
    if (browser.services.length === 0) {
        console.log('⚠ No webex-bridge services found!');
        console.log('\nTroubleshooting:');
        console.log('1. Make sure the bridge server is running');
        console.log('2. Verify the bridge is advertising mDNS on the same network');
        console.log('3. Check firewall settings (port 5353/UDP for mDNS)');
        console.log('4. Ensure multicast is enabled on your network interface');
    } else {
        console.log(`✓ Found ${browser.services.length} service(s)`);
    }
    
    browser.stop();
    bonjour.destroy();
    process.exit(0);
}, 10000);

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
    console.log('\n\nStopping...');
    browser.stop();
    bonjour.destroy();
    process.exit(0);
});
