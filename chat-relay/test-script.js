const axios = require('axios');
const WebSocket = require('ws');

const BASE_URL = 'http://127.0.0.1:3000';
const ADMIN_USER = 'millan';
const ADMIN_PASS = 'ymy-1984';

async function testSystem() {
    try {
        const loginRes = await axios.post(`${BASE_URL}/auth/admin`, 
            `username=${ADMIN_USER}&password=${ADMIN_PASS}`,
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        const token = loginRes.data.match(/token=([a-f0-9]+)/)[1];
        console.log('Token:', token);

        const wsUrl = `ws://127.0.0.1:3000?token=${token}`;
        const ws = new WebSocket(wsUrl);

        ws.on('open', () => {
            console.log('WS Connected');
            setTimeout(() => {
                ws.send(JSON.stringify({
                    type: 'req', id: 'test-' + Date.now(),
                    method: 'chat.send',
                    params: { 
                        message: 'Say "HELLO" once', 
                        thinking: 'low',
                        sessionKey: 'agent:main:webchat:testing_123'
                    }
                }));
            }, 1000);
        });

        ws.on('message', (data) => {
            const raw = data.toString();
            console.log('<<', raw);
            const msg = JSON.parse(raw);
            if (msg.payload && msg.payload.stream === 'assistant') {
                console.log('CONTENT >>', msg.payload.data.delta);
            }
            if (msg.payload && msg.payload.stream === 'lifecycle' && msg.payload.data.phase === 'end') {
                console.log('DONE.');
                ws.close();
            }
        });

        setTimeout(() => { console.log('Timeout'); ws.close(); }, 15000);
    } catch (e) { console.error(e); }
}
testSystem();
