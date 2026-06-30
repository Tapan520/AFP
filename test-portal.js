// Comprehensive portal test script
const https = require('https');

const BASE = 'afp.up.railway.app';
let SA_TOKEN = '';
let CITIZEN_TOKEN = '';
let testPetId = null;
let testDiscussionId = null;

const PASS = '\x1b[32mPASS\x1b[0m';
const FAIL = '\x1b[31mFAIL\x1b[0m';
const WARN = '\x1b[33mWARN\x1b[0m';

let passed = 0, failed = 0, warned = 0;

function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const options = { hostname: BASE, path, method, headers };
    const r = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function check(name, status, body, expectedStatus, check) {
  const ok = status === expectedStatus && (!check || check(body));
  if (ok) { console.log(`${PASS} ${name}`); passed++; }
  else { console.log(`${FAIL} ${name} ? HTTP ${status} ${JSON.stringify(body).substring(0,120)}`); failed++; }
  return ok;
}

async function run() {
  console.log('\n=== AFP Portal Comprehensive Test ===\n');

  // 1. DB Status
  let r = await req('GET', '/api/dbstatus');
  check('DB connected', r.status, r.body, 200, b => b.db === 'connected' && b.users > 0);

  // 2. Super Admin Login
  r = await req('POST', '/api/auth/login', { identifier: '9999999999', password: 'Admin@123' });
  const loginOk = check('Super Admin login', r.status, r.body, 200, b => b.token && b.user && b.user.role === 'super_admin');
  if (loginOk) SA_TOKEN = r.body.token;

  // 3. Wrong password
  r = await req('POST', '/api/auth/login', { identifier: '9999999999', password: 'wrongpass' });
  check('Reject wrong password', r.status, r.body, 401);

  // 4. Register citizen
  const mob = '9' + Math.floor(100000000 + Math.random() * 900000000);
  r = await req('POST', '/api/auth/register', {
    name: 'Test Citizen', mobile: mob, email: `test${mob}@test.com`,
    password: 'Test@123', address: '123 Test Street'
  });
  const regOk = check('Register new citizen', r.status, r.body, 201, b => b.token && b.user && b.user.role === 'citizen');
  if (regOk) CITIZEN_TOKEN = r.body.token;

  // 5. Duplicate mobile
  r = await req('POST', '/api/auth/register', {
    name: 'Dup', mobile: mob, email: 'dup@test.com', password: 'Test@123', address: 'addr'
  });
  check('Reject duplicate mobile', r.status, r.body, 409);

  // 6. Geo - cities
  r = await req('GET', '/api/geo/cities');
  check('GET geo/cities', r.status, r.body, 200, b => Array.isArray(b) && b.length >= 1);

  // 7. Geo - nigams
  r = await req('GET', '/api/geo/nigams?cityId=1');
  check('GET geo/nigams', r.status, r.body, 200, b => Array.isArray(b) && b.length >= 1);

  // 8. Geo - zones
  r = await req('GET', '/api/geo/zones?nigamId=1');
  check('GET geo/zones', r.status, r.body, 200, b => Array.isArray(b) && b.length >= 1);

  // 9. Geo - wards
  r = await req('GET', '/api/geo/wards?zoneId=10');
  check('GET geo/wards by zone', r.status, r.body, 200, b => Array.isArray(b) && b.length >= 1);

  // 10. Geo - all cities (admin)
  r = await req('GET', '/api/geo/cities/all', null, SA_TOKEN);
  check('GET geo/cities/all (admin)', r.status, r.body, 200, b => Array.isArray(b) && b.length >= 3);

  // 11. Register pet (citizen)
  if (CITIZEN_TOKEN) {
    r = await req('POST', '/api/pets', {
      name: 'TestDog', species: 'dog', breed: 'Labrador',
      colour: 'Golden', gender: 'male', dateOfBirth: '2022-01-15'
    }, CITIZEN_TOKEN);
    const petOk = check('Register pet (citizen)', r.status, r.body, 201, b => b.id && b.registration_status === 'pending');
    if (petOk) testPetId = r.body.id;
  }

  // 12. Get my pets
  if (CITIZEN_TOKEN) {
    r = await req('GET', '/api/pets/my', null, CITIZEN_TOKEN);
    check('GET my pets', r.status, r.body, 200, b => Array.isArray(b));
  }

  // 13. Get pending pets (admin)
  if (SA_TOKEN) {
    r = await req('GET', '/api/pets/pending', null, SA_TOKEN);
    check('GET pending pets (admin)', r.status, r.body, 200, b => Array.isArray(b));
  }

  // 14. Approve pet (admin)
  if (SA_TOKEN && testPetId) {
    r = await req('PATCH', `/api/pets/${testPetId}/approve`, { note: 'Auto approved in test' }, SA_TOKEN);
    check('Approve pet (admin)', r.status, r.body, 200, b => b.message);
  }

  // 15. Pet search (public)
  r = await req('GET', '/api/pets/search?q=TestDog&cityId=1');
  check('Pet search (public)', r.status, r.body, 200, b => Array.isArray(b));

  // 16. Breeding opt-in
  if (CITIZEN_TOKEN && testPetId) {
    r = await req('PATCH', `/api/pets/${testPetId}/breeding-opt-in`, { optIn: true }, CITIZEN_TOKEN);
    check('Breeding opt-in', r.status, r.body, 200, b => b.breeding_opt_in === true);
  }

  // 17. Breeding search
  r = await req('GET', '/api/pets/breeding?species=dog&cityId=1');
  check('Breeding search', r.status, r.body, 200, b => Array.isArray(b));

  // 18. Pet stats
  r = await req('GET', '/api/pets/stats');
  check('Pet stats (public)', r.status, r.body, 200, b => b.totalPets !== undefined);

  // 19. Admin stats
  if (SA_TOKEN) {
    r = await req('GET', '/api/admin/stats', null, SA_TOKEN);
    check('Admin stats', r.status, r.body, 200, b => b.total !== undefined);
  }

  // 20. Admin all pets
  if (SA_TOKEN) {
    r = await req('GET', '/api/admin/pets', null, SA_TOKEN);
    check('Admin all pets', r.status, r.body, 200, b => Array.isArray(b));
  }

  // 21. Submit report
  if (CITIZEN_TOKEN) {
    r = await req('POST', '/api/reports', {
      reportType: 'stray', lastSeenAddress: '123 Test Road', reporterMobile: mob
    }, CITIZEN_TOKEN);
    check('Submit report (citizen)', r.status, r.body, 201, b => b.id);
  }

  // 22. Get reports (admin)
  if (SA_TOKEN) {
    r = await req('GET', '/api/reports', null, SA_TOKEN);
    check('GET reports (admin)', r.status, r.body, 200, b => Array.isArray(b));
  }

  // 23. Doctors (public)
  r = await req('GET', '/api/doctors?cityId=1');
  check('GET doctors (public)', r.status, r.body, 200, b => Array.isArray(b));

  // 24. Add doctor (admin)
  if (SA_TOKEN) {
    r = await req('POST', '/api/admin/doctors', {
      name: 'Dr. Test Vet', qualification: 'BVSc', specialization: 'Small animals',
      clinicName: 'Test Clinic', address: '456 Vet Lane', mobile: '9811111111',
      timings: '9am-6pm', is24hr: false, cityId: 1, nigamId: 1
    }, SA_TOKEN);
    check('Add doctor (admin)', r.status, r.body, 201, b => b.id);
  }

  // 25. Shops (public)
  r = await req('GET', '/api/shops?cityId=1');
  check('GET shops (public)', r.status, r.body, 200, b => Array.isArray(b));

  // 26. Add shop (admin)
  if (SA_TOKEN) {
    r = await req('POST', '/api/admin/shops', {
      name: 'Test Pet Shop', ownerName: 'Owner', address: '789 Shop St',
      mobile: '9822222222', timings: '10am-8pm', speciality: 'Dog food', cityId: 1, nigamId: 1
    }, SA_TOKEN);
    check('Add shop (admin)', r.status, r.body, 201, b => b.id);
  }

  // 27. Admin users list
  if (SA_TOKEN) {
    r = await req('GET', '/api/admin/users', null, SA_TOKEN);
    check('GET admin/users', r.status, r.body, 200, b => Array.isArray(b) && b.length > 0);
  }

  // 28. Discussions - create
  if (CITIZEN_TOKEN) {
    r = await req('POST', '/api/discussions', {
      title: 'Test Discussion', body: 'This is a test discussion body', category: 'general'
    }, CITIZEN_TOKEN);
    const discOk = check('Create discussion', r.status, r.body, 201, b => b.id);
    if (discOk) testDiscussionId = r.body.id;
  }

  // 29. Discussions - list
  r = await req('GET', '/api/discussions');
  check('GET discussions (public)', r.status, r.body, 200, b => Array.isArray(b));

  // 30. Discussion - get single
  if (testDiscussionId) {
    r = await req('GET', `/api/discussions/${testDiscussionId}`);
    check('GET single discussion', r.status, r.body, 200, b => b.id === testDiscussionId);
  }

  // 31. Discussion reply
  if (CITIZEN_TOKEN && testDiscussionId) {
    r = await req('POST', `/api/discussions/${testDiscussionId}/replies`, { body: 'Test reply' }, CITIZEN_TOKEN);
    check('Post discussion reply', r.status, r.body, 201, b => b.id);
  }

  // 32. Discussion category filter
  r = await req('GET', '/api/discussions?category=general');
  check('GET discussions by category', r.status, r.body, 200, b => Array.isArray(b));

  // 33. Discussion search
  r = await req('GET', '/api/discussions?q=Test');
  check('GET discussions search', r.status, r.body, 200, b => Array.isArray(b));

  // 34. Unauthenticated discussion create (should fail)
  r = await req('POST', '/api/discussions', { title: 'No auth', body: 'body', category: 'general' });
  check('Reject unauthenticated discussion', r.status, r.body, 401);

  // 35. Pet renew
  if (CITIZEN_TOKEN && testPetId) {
    r = await req('PATCH', `/api/pets/${testPetId}/renew`, {}, CITIZEN_TOKEN);
    check('Renew pet licence', r.status, r.body, 200, b => b.message);
  }

  // 36. Health check (Node backend)
  r = await req('GET', '/api/geo/cities/all', null, SA_TOKEN);
  check('Node backend reachable via geo proxy', r.status, r.body, 200, b => Array.isArray(b));

  // 37. Geo - add city (super_admin)
  if (SA_TOKEN) {
    r = await req('POST', '/api/geo/cities', { name: 'TestCity_' + Date.now(), state: 'TestState' }, SA_TOKEN);
    check('Add city (super_admin)', r.status, r.body, 201, b => b.id);
  }

  // 38. Ward all
  r = await req('GET', '/api/geo/wards/all?zoneId=10', null, SA_TOKEN);
  check('GET wards/all for zone 10', r.status, r.body, 200, b => Array.isArray(b) && b.length > 0);

  // Summary
  const total = passed + failed;
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
  console.log(`${'='.repeat(40)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
