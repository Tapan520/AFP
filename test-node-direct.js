// Test Node backend directly
const https = require('https');
const NODE = 'web-production-06875.up.railway.app';

function req(method, path, body, token) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const r = https.request({ hostname: NODE, path, method, headers }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d.substring(0, 200) }); }
      });
    });
    r.on('error', e => resolve({ status: 0, body: e.message }));
    if (payload) r.write(payload);
    r.end();
  });
}

async function run() {
  console.log('=== Testing Node Backend Directly ===\n');

  let r;
  // Health
  r = await req('GET', '/health');
  console.log('Health:', r.status, JSON.stringify(r.body));

  // Login super admin
  r = await req('POST', '/api/auth/login', { identifier: '9999999999', password: 'Admin@123' });
  console.log('SA Login:', r.status, JSON.stringify(r.body).substring(0, 150));
  const token = r.body.token || '';

  // Login with email
  r = await req('POST', '/api/auth/login', { identifier: 'admin@nagarnigam.gov.in', password: 'Admin@123' });
  console.log('SA Login (email):', r.status, JSON.stringify(r.body).substring(0, 150));

  // Geo cities (public)
  r = await req('GET', '/api/geo/cities');
  console.log('geo/cities:', r.status, JSON.stringify(r.body).substring(0, 150));

  // Geo zones (public)
  r = await req('GET', '/api/geo/zones?nigamId=1');
  console.log('geo/zones:', r.status, JSON.stringify(r.body).substring(0, 150));

  // Pet search (public)
  r = await req('GET', '/api/pets/search?q=dog&cityId=1');
  console.log('pets/search:', r.status, JSON.stringify(r.body).substring(0, 150));

  // Pet stats (public)
  r = await req('GET', '/api/pets/stats');
  console.log('pets/stats:', r.status, JSON.stringify(r.body).substring(0, 100));

  // Doctors (public)
  r = await req('GET', '/api/doctors?cityId=1');
  console.log('doctors:', r.status, JSON.stringify(r.body).substring(0, 100));

  // Shops (public)
  r = await req('GET', '/api/shops?cityId=1');
  console.log('shops:', r.status, JSON.stringify(r.body).substring(0, 100));

  // Register test
  const mob = '8' + Math.floor(100000000 + Math.random() * 900000000);
  r = await req('POST', '/api/auth/register', { name: 'Test', mobile: mob, email: mob+'@t.com', password: 'Test@123', address: 'addr' });
  console.log('register:', r.status, JSON.stringify(r.body).substring(0, 150));
}

run().catch(e => console.error('FATAL:', e.message));
