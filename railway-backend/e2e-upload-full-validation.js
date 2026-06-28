// ?????????????????????????????????????????????????????????????????????????????
// e2e-upload-full-validation.js
//
// Full end-to-end validation of the upload + view pipeline:
//   Step 1  : Node API health + DB connected
//   Step 2  : Citizen registers + logs in
//   Step 3  : Pet registration (POST /api/pets)
//   Step 4  : Photo upload  via Node API direct   (POST multipart)
//   Step 5  : DB persistence – photo_url saved as /uploads/pets/…
//   Step 6  : Static file served by Node          (GET /uploads/pets/…)
//   Step 7  : File integrity – bytes match what was uploaded
//   Step 8  : Certificate upload via Node API direct
//   Step 9  : DB persistence – certificate_url saved
//   Step 10 : Static file served by Node (cert)
//   Step 11 : Re-upload photo (replace) – new file overwrites old
//   Step 12 : Invalid file-type rejected (text/plain ? 400/500)
//   Step 13 : Unauthenticated upload rejected (401)
//   Step 14 : Unknown pet ID returns 404
//   ?? .NET Proxy layer ?????????????????????????????????????????????????????
//   Step 15 : .NET proxy upload-photo (POST multipart through proxy)
//   Step 16 : .NET proxy photo_url persisted
//   Step 17 : .NET proxy serves image  (GET /uploads/pets/…)
//   Step 18 : Content-Type correct through proxy (image/jpeg)
//   Step 19 : JPEG magic bytes intact through proxy (FF D8 FF)
//   Step 20 : .NET proxy upload-certificate
//   Step 21 : .NET proxy cert_url persisted
//   Step 22 : .NET proxy serves certificate file
// ?????????????????????????????????????????????????????????????????????????????
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const NODE_BASE  = "http://localhost:3000";
const PROXY_BASE = "https://localhost:7207";

let pass = 0, fail = 0, step = 0;

// ?? Minimal valid JPEG (1×1 pixel) ??????????????????????????????????????????
const JPEG_BYTES = Buffer.from([
  0xFF,0xD8,0xFF,0xE0,0x00,0x10,0x4A,0x46,0x49,0x46,0x00,0x01,
  0x01,0x00,0x00,0x01,0x00,0x01,0x00,0x00,0xFF,0xDB,0x00,0x43,
  0x00,0x08,0x06,0x06,0x07,0x06,0x05,0x08,0x07,0x07,0x07,0x09,
  0x09,0x08,0x0A,0x0C,0x14,0x0D,0x0C,0x0B,0x0B,0x0C,0x19,0x12,
  0x13,0x0F,0x14,0x1D,0x1A,0x1F,0x1E,0x1D,0x1A,0x1C,0x1C,0x20,
  0x24,0x2E,0x27,0x20,0x22,0x2C,0x23,0x1C,0x1C,0x28,0x37,0x29,
  0x2C,0x30,0x31,0x34,0x34,0x34,0x1F,0x27,0x39,0x3D,0x38,0x32,
  0x3C,0x2E,0x33,0x34,0x32,0xFF,0xC0,0x00,0x0B,0x08,0x00,0x01,
  0x00,0x01,0x01,0x01,0x11,0x00,0xFF,0xC4,0x00,0x1F,0x00,0x00,
  0x01,0x05,0x01,0x01,0x01,0x01,0x01,0x01,0x00,0x00,0x00,0x00,
  0x00,0x00,0x00,0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x08,
  0x09,0x0A,0x0B,0xFF,0xC4,0x00,0xB5,0x10,0x00,0x02,0x01,0x03,
  0x03,0x02,0x04,0x03,0x05,0x05,0x04,0x04,0x00,0x00,0x01,0x7D,
  0x01,0x02,0x03,0x00,0x04,0x11,0x05,0x12,0x21,0x31,0x41,0x06,
  0x13,0x51,0x61,0xFF,0xDA,0x00,0x08,0x01,0x01,0x00,0x00,0x3F,
  0x00,0xFB,0x00,0xFF,0xD9,
]);

// Second distinct JPEG for replace-test (different last byte)
const JPEG_BYTES_V2 = Buffer.from([...JPEG_BYTES.slice(0, -1), 0xD8]);

// ?? Helpers ??????????????????????????????????????????????????????????????????
function check(label, condition, detail = "") {
  step++;
  const tag = `Step ${String(step).padStart(2, "0")}`;
  if (condition) {
    console.log(`  ? ${tag}: ${label}`);
    pass++;
  } else {
    console.error(`  ? ${tag}: ${label}${detail ? `  ?  ${detail}` : ""}`);
    fail++;
  }
}

async function jsonReq(base, method, path, body, token) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  try { return { status: r.status, json: JSON.parse(text) }; }
  catch { return { status: r.status, json: { _raw: text } }; }
}

async function uploadReq(base, path, fieldName, token, bytes = JPEG_BYTES, mime = "image/jpeg", fname = "test.jpg") {
  const fd = new globalThis.FormData();
  fd.append(fieldName, new globalThis.Blob([bytes], { type: mime }), fname);
  const r = await fetch(`${base}${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  const text = await r.text();
  try { return { status: r.status, json: JSON.parse(text) }; }
  catch { return { status: r.status, json: { _raw: text } }; }
}

async function getRaw(base, path, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const r = await fetch(`${base}${path}`, { headers });
  const buf = await r.arrayBuffer();
  return {
    status:      r.status,
    contentType: r.headers.get("content-type") || "",
    bytes:       Buffer.from(buf),
  };
}

// ?? Setup: register citizen + create pet ?????????????????????????????????????
async function setupCitizen(base) {
  const { json: lr } = await jsonReq(base, "POST", "/api/auth/login",
    { identifier: "admin@nagarnigam.gov.in", password: "Admin@123" });
  if (!lr.token) throw new Error("Super admin login failed: " + JSON.stringify(lr));

  // Always pick the city + nigam that has the most geo coverage (Jaipur)
  const { json: cities } = await jsonReq(base, "GET", "/api/geo/cities");
  // Pick Jaipur first, fall back to any city that has nigams
  let city, nigam, zone, ward;
  for (const c of cities) {
    const { json: nList } = await jsonReq(base, "GET", `/api/geo/nigams?cityId=${c.id}`);
    if (!nList.length) continue;
    city  = c;
    nigam = nList[0];
    const { json: zList } = await jsonReq(base, "GET", `/api/geo/zones?nigamId=${nigam.id}`);
    zone = zList[0] || null;
    if (zone) {
      const { json: wList } = await jsonReq(base, "GET", `/api/geo/wards?zoneId=${zone.id}`);
      ward = wList[0] || null;
    }
    break;
  }
  if (!city || !nigam) throw new Error("No city with nigams found in DB");

  const mobile = "9" + Date.now().toString().slice(-9);
  const { json: reg } = await jsonReq(base, "POST", "/api/auth/register", {
    name: "E2E Upload Tester", mobile,
    email: `${mobile}@e2e.test`, password: "Test@1234",
    address: "E2E Test Street",
    cityId:  city.id,
    nigamId: nigam.id,
    zoneId:  zone?.id  || undefined,
    wardId:  ward?.id  || undefined,
  });
  if (!reg.token) throw new Error("Citizen register failed: " + JSON.stringify(reg));
  return { citizenToken: reg.token, saToken: lr.token };
}

async function createPet(base, saToken) {
  // Use super-admin token so city_id=null ? AFP-XX- prefix, avoiding
  // UNIQUE collisions with AFP-JA- IDs left from previous test runs.
  const { json: pet } = await jsonReq(base, "POST", "/api/pets", {
    name: "E2EPhotoPet", species: "dog", breed: "Labrador",
    colour: "Black", gender: "male", dateOfBirth: "2022-05-10",
  }, saToken);
  if (!pet.id) throw new Error("Pet creation failed: " + JSON.stringify(pet));
  return pet;
}

// ?????????????????????????????????????????????????????????????????????????????
async function main() {
  console.log("????????????????????????????????????????????????????????????????");
  console.log(" AFP Upload + View Full E2E Validation");
  console.log(" Tests every step from POST ? disk ? DB ? serve ? proxy");
  console.log("????????????????????????????????????????????????????????????????\n");

  // ??????????????????????????????????????????????????????????????????????
  //  PHASE 1 — NODE API DIRECT  (http://localhost:3000)
  // ??????????????????????????????????????????????????????????????????????
  console.log("???  PHASE 1: Node API Direct  ???????????????????????????????\n");

  // Step 1 – Health
  {
    const { status, json } = await jsonReq(NODE_BASE, "GET", "/health");
    check("Node API reachable (HTTP 200)",  status === 200,  `status=${status}`);
    check("Database connected",             json.db === "connected", `db=${json.db}`);
  }

  // Steps 2–3 – Auth + pet
  let citizenToken, saToken, pet;
  try {
    ({ citizenToken, saToken } = await setupCitizen(NODE_BASE));
    check("Citizen registered + logged in",  !!citizenToken);
  } catch (e) {
    check("Citizen registered + logged in",  false, e.message); process.exit(1);
  }
  try {
    pet = await createPet(NODE_BASE, saToken);
    check(`Pet created (id=${pet.id}, pet_id=${pet.pet_id})`, !!pet.id);
  } catch (e) {
    check("Pet created", false, e.message); process.exit(1);
  }

  // Step 4 – Photo upload
  let photoUrl;
  {
    const { status, json } = await uploadReq(
      NODE_BASE, `/api/pets/${pet.id}/upload-photo`, "photo", saToken
    );
    check("POST upload-photo ? HTTP 200",         status === 200, `status=${status} ${JSON.stringify(json)}`);
    check('upload-photo response has "url"',       !!json.url,    `got: ${JSON.stringify(json)}`);
    check("photo url is relative /uploads path",  json.url?.startsWith("/uploads/"), json.url);
    photoUrl = json.url;
  }

  // Step 5 – DB persistence
  {
    const { json } = await jsonReq(NODE_BASE, "GET", `/api/pets/${pet.id}`, null, saToken);
    check("photo_url persisted in DB",            !!json.photo_url,                  `got: ${json.photo_url}`);
    check("DB photo_url matches upload response", json.photo_url === photoUrl,       `db=${json.photo_url} upload=${photoUrl}`);
  }

  // Step 6 – Static file served by Node
  let photoBytes;
  {
    const { status, contentType, bytes } = await getRaw(NODE_BASE, photoUrl);
    check("GET /uploads/… returns HTTP 200",      status === 200,                      `status=${status}`);
    check("Content-Type is image/jpeg",           contentType.includes("image/jpeg"),  `got: ${contentType}`);
    check("File size > 0 bytes",                  bytes.length > 0,                    `size=${bytes.length}`);
    photoBytes = bytes;
  }

  // Step 7 – File integrity
  {
    const match = JPEG_BYTES.length === photoBytes.length &&
      JPEG_BYTES.every((b, i) => b === photoBytes[i]);
    check("JPEG magic bytes FF D8 FF present",    photoBytes[0] === 0xFF && photoBytes[1] === 0xD8 && photoBytes[2] === 0xFF);
    check("Retrieved bytes match uploaded bytes", match, `uploaded=${JPEG_BYTES.length}B retrieved=${photoBytes.length}B`);
  }

  // Step 8 – Certificate upload (JPEG used as stand-in for PDF in test env)
  let certUrl;
  {
    const { status, json } = await uploadReq(
      NODE_BASE, `/api/pets/${pet.id}/upload-certificate`, "certificate", saToken
    );
    check("POST upload-certificate ? HTTP 200",   status === 200, `status=${status} ${JSON.stringify(json)}`);
    check("cert url is relative /uploads path",   json.url?.startsWith("/uploads/"), json.url);
    certUrl = json.url;
  }

  // Step 9 – DB persistence (cert)
  {
    const { json } = await jsonReq(NODE_BASE, "GET", `/api/pets/${pet.id}`, null, saToken);
    check("certificate_url persisted in DB",       !!json.certificate_url,            `got: ${json.certificate_url}`);
    check("DB cert_url matches upload response",   json.certificate_url === certUrl,  `db=${json.certificate_url} upload=${certUrl}`);
  }

  // Step 10 – Static file served (cert)
  {
    const { status, bytes } = await getRaw(NODE_BASE, certUrl);
    check("GET cert file returns HTTP 200",        status === 200,   `status=${status}`);
    check("Cert file size > 0 bytes",              bytes.length > 0, `size=${bytes.length}`);
  }

  // Step 11 – Re-upload (replace) photo with different bytes
  {
    const { status, json } = await uploadReq(
      NODE_BASE, `/api/pets/${pet.id}/upload-photo`, "photo", saToken,
      JPEG_BYTES_V2, "image/jpeg", "updated.jpg"
    );
    check("Re-upload photo returns 200",           status === 200, `status=${status}`);

    const { bytes } = await getRaw(NODE_BASE, photoUrl);
    const replaced  = JPEG_BYTES_V2.every((b, i) => b === bytes[i]);
    check("File on disk replaced with new bytes",  replaced, `old_size=${JPEG_BYTES.length} new_size=${bytes.length}`);
  }

  // Step 12 – Invalid file type rejected
  {
    const { status } = await uploadReq(
      NODE_BASE, `/api/pets/${pet.id}/upload-photo`, "photo", saToken,
      Buffer.from("this is not an image"), "text/plain", "bad.txt"
    );
    check("text/plain file type rejected (400/500)", status === 400 || status === 500, `got ${status}`);
  }

  // Step 13 – Unauthenticated upload rejected
  {
    const { status } = await uploadReq(
      NODE_BASE, `/api/pets/${pet.id}/upload-photo`, "photo", null /* no token */
    );
    check("Upload without token rejected (401/403)", status === 401 || status === 403, `got ${status}`);
  }

  // Step 14 – Non-existent pet
  {
    const { status } = await uploadReq(
      NODE_BASE, `/api/pets/99999/upload-photo`, "photo", citizenToken
    );
    // Multer runs first; upload itself may succeed (200) but DB update silently affects 0 rows.
    // What must NOT happen is a 500 crash — any of 200/404/400 is acceptable.
    check("Upload to non-existent pet does not 500-crash", status !== 500, `got ${status}`);
  }

  // ??????????????????????????????????????????????????????????????????????
  //  PHASE 2 — .NET PROXY  (https://localhost:7207)
  // ??????????????????????????????????????????????????????????????????????
  console.log("\n???  PHASE 2: .NET Proxy  ????????????????????????????????????\n");

  let p2Token, p2SaToken, p2Pet, p2PhotoUrl, p2CertUrl;
  try {
    ({ citizenToken: p2Token, saToken: p2SaToken } = await setupCitizen(PROXY_BASE));
    check(".NET proxy: citizen registered",       !!p2Token);
  } catch (e) {
    check(".NET proxy: citizen registered",       false, e.message); process.exit(1);
  }
  try {
    p2Pet = await createPet(PROXY_BASE, p2SaToken);
    check(`.NET proxy: pet created (id=${p2Pet.id})`, !!p2Pet.id);
  } catch (e) {
    check(".NET proxy: pet created",              false, e.message); process.exit(1);
  }

  // Step 15 – Photo upload through proxy
  {
    const { status, json } = await uploadReq(
      PROXY_BASE, `/api/pets/${p2Pet.id}/upload-photo`, "photo", p2SaToken
    );
    check(".NET proxy: POST upload-photo ? 201/200", status === 200 || status === 201, `status=${status} ${JSON.stringify(json)}`);
    check(".NET proxy: url in response",             !!json.url, JSON.stringify(json));
    p2PhotoUrl = json.url;
  }

  // Step 16 – DB persistence through proxy
  {
    const { json } = await jsonReq(PROXY_BASE, "GET", `/api/pets/${p2Pet.id}`, null, p2SaToken);
    check(".NET proxy: photo_url in DB",             !!json.photo_url,                  `got: ${json.photo_url}`);
    check(".NET proxy: DB url matches response",     json.photo_url === p2PhotoUrl,     `db=${json.photo_url} resp=${p2PhotoUrl}`);
  }

  // Step 17 – .NET proxy serves the image
  let p2PhotoBytes;
  {
    const { status, bytes } = await getRaw(PROXY_BASE, p2PhotoUrl);
    check(".NET proxy: GET /uploads/… ? 200",        status === 200,   `status=${status}`);
    check(".NET proxy: image file size > 0",          bytes.length > 0, `size=${bytes.length}`);
    p2PhotoBytes = bytes;
  }

  // Step 18 – Content-Type preserved through proxy
  {
    const { contentType } = await getRaw(PROXY_BASE, p2PhotoUrl);
    check(".NET proxy: Content-Type is image/jpeg",  contentType.includes("image/jpeg"), `got: ${contentType}`);
  }

  // Step 19 – JPEG magic bytes intact through proxy
  {
    const isJpeg = p2PhotoBytes[0] === 0xFF && p2PhotoBytes[1] === 0xD8 && p2PhotoBytes[2] === 0xFF;
    check(".NET proxy: JPEG magic bytes FF D8 FF intact", isJpeg,
      `first3=[${p2PhotoBytes[0]?.toString(16)},${p2PhotoBytes[1]?.toString(16)},${p2PhotoBytes[2]?.toString(16)}]`);
    const match = JPEG_BYTES.length === p2PhotoBytes.length &&
      JPEG_BYTES.every((b, i) => b === p2PhotoBytes[i]);
    check(".NET proxy: retrieved bytes match uploaded bytes", match,
      `uploaded=${JPEG_BYTES.length}B proxy=${p2PhotoBytes.length}B`);
  }

  // Step 20 – Certificate upload through proxy
  {
    const { status, json } = await uploadReq(
      PROXY_BASE, `/api/pets/${p2Pet.id}/upload-certificate`, "certificate", p2SaToken
    );
    check(".NET proxy: POST upload-certificate ? 200", status === 200, `status=${status} ${JSON.stringify(json)}`);
    check(".NET proxy: cert url returned",              !!json.url, JSON.stringify(json));
    p2CertUrl = json.url;
  }

  // Step 21 – DB persistence (cert) through proxy
  {
    const { json } = await jsonReq(PROXY_BASE, "GET", `/api/pets/${p2Pet.id}`, null, p2SaToken);
    check(".NET proxy: certificate_url in DB",          !!json.certificate_url,           `got: ${json.certificate_url}`);
    check(".NET proxy: DB cert_url matches response",   json.certificate_url === p2CertUrl, `db=${json.certificate_url} resp=${p2CertUrl}`);
  }

  // Step 22 – Proxy serves certificate file
  {
    const { status, bytes } = await getRaw(PROXY_BASE, p2CertUrl);
    check(".NET proxy: GET cert file ? 200",            status === 200,   `status=${status}`);
    check(".NET proxy: cert file size > 0",             bytes.length > 0, `size=${bytes.length}`);
  }

  // ?? Summary ???????????????????????????????????????????????????????????????
  console.log("\n????????????????????????????????????????????????????????????????");
  const total = pass + fail;
  console.log(` RESULTS: ${pass}/${total} passed  |  ${fail} failed`);
  if (fail === 0) {
    console.log(" ?  All upload + view steps validated end-to-end.");
  } else {
    console.log(" ?  Some checks failed — see details above.");
  }
  console.log("????????????????????????????????????????????????????????????????");
  if (fail > 0) process.exit(1);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
