const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');

const BASE_URL = 'http://127.0.0.1:3000';
const ADMIN_USER = 'millan';
const ADMIN_PASS = 'ymy-1984';

async function testUpload() {
    console.log('--- Phase 1: Login ---');
    const loginRes = await axios.post(`${BASE_URL}/auth/admin`, 
        `username=${ADMIN_USER}&password=${ADMIN_PASS}`,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const token = loginRes.data.match(/token=([a-f0-9]+)/)[1];
    console.log('Token:', token);

    console.log('\n--- Phase 2: Upload File ---');
    const form = new FormData();
    const testFileContent = 'Hello Wendy, this is a test file ' + Date.now();
    const filePath = path.join(__dirname, 'test-upload.txt');
    fs.writeFileSync(filePath, testFileContent);
    
    form.append('files', fs.createReadStream(filePath));

    const uploadRes = await axios.post(`${BASE_URL}/upload?token=${token}`, form, {
        headers: form.getHeaders()
    });
    console.log('Upload status:', uploadRes.status);
    console.log('Upload response:', JSON.stringify(uploadRes.data));

    console.log('\n--- Phase 3: Verify Listing ---');
    const listRes = await axios.get(`${BASE_URL}/list-files?token=${token}`);
    const found = listRes.data.files.includes('test-upload.txt');
    console.log('File found in list:', found);

    if (found) {
        console.log('SUCCESS: Upload and List verified!');
    } else {
        console.error('FAILED: File not found in list after upload');
    }
    
    fs.unlinkSync(filePath);
}

testUpload().catch(console.error);
