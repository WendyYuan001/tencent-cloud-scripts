const axios = require('axios');
const WebSocket = require('ws');

const BASE_URL = 'http://127.0.0.1:3000';
const ADMIN_USER = 'millan';
const ADMIN_PASS = 'ymy-1984';

async function testZhipuInjection() {
    try {
        console.log('--- Phase 1: Login & Set API Key ---');
        const loginRes = await axios.post(`${BASE_URL}/auth/admin`, 
            `username=${ADMIN_USER}&password=${ADMIN_PASS}`,
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        const token = loginRes.data.match(/token=([a-f0-9]+)/)[1];
        
        // Set a dummy API Key
        const dummyKey = 'test_key_123456789';
        await axios.post(`${BASE_URL}/update-settings?token=${token}`, 
            { zhipu_api_key: dummyKey }
        );
        console.log('Dummy API Key set successfully');

        console.log('\n--- Phase 2: Verify Injection via WS ---');
        const wsUrl = `ws://127.0.0.1:3000?token=${token}`;
        const ws = new WebSocket(wsUrl);

        ws.on('open', () => {
            console.log('WS Connected');
            // We wait a bit for the relay to handshake with gateway
            setTimeout(() => {
                ws.send(JSON.stringify({
                    type: 'req', id: 'zhipu-test',
                    method: 'chat.send',
                    params: { message: 'Test message for key injection', thinking: 'minimal' }
                }));
                console.log('Test message sent');
            }, 2000);
        });

        ws.on('message', (data) => {
            // We don't necessarily need a success response from Gateway (since key is dummy)
            // But we can check the relay logs in the background process
            const msg = JSON.parse(data.toString());
            console.log('Received from relay:', msg.type, msg.ok ? 'OK' : 'Error');
            if (msg.error) console.log('Error details:', JSON.stringify(msg.error));
            ws.close();
        });

        setTimeout(() => {
            console.log('\n--- Test Results ---');
            console.log('Please check server logs for "[Relay] Injecting Zhipu Key" message.');
            process.exit(0);
        }, 5000);

    } catch (e) {
        console.error('Test failed:', e.message);
        process.exit(1);
    }
}

testZhipuInjection();
