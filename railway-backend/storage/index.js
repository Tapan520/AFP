// ?????????????????????????????????????????????????????????????????????????????
// storage/index.js — Provider-agnostic file storage.
//
// Exposes a small, unified API:
//   put(key, buffer, mimetype)  ? { url, key }
//   remove(key)                 ? void
//   readStream(key)             ? ReadableStream   (backups upload)
//
// Provider chosen by process.env.STORAGE_PROVIDER:
//   • local       — filesystem under ./uploads (default; no extra deps)
//   • s3          — AWS S3            (requires @aws-sdk/client-s3)
//   • azure       — Azure Blob        (requires @azure/storage-blob)
//   • cloudinary  — Cloudinary        (requires cloudinary)
//
// The cloud SDKs are lazy-required so the app boots even when they aren't
// installed, as long as the provider is `local`.
// ?????????????????????????????????????????????????????????????????????????????
const fs   = require("fs");
const path = require("path");

const PROVIDER = (process.env.STORAGE_PROVIDER || "local").toLowerCase();
const BASE_URL = process.env.PUBLIC_UPLOADS_BASE_URL || "/uploads";

function _publicUrl(key) {
  // Strip a leading slash from key so we don't end up with "…//foo"
  const clean = key.replace(/^\/+/, "");
  return `${BASE_URL.replace(/\/+$/, "")}/${clean}`;
}

// ?? Local filesystem ????????????????????????????????????????????????????????
const LOCAL_ROOT = path.join(__dirname, "..", "uploads");
if (PROVIDER === "local" && !fs.existsSync(LOCAL_ROOT)) {
  fs.mkdirSync(LOCAL_ROOT, { recursive: true });
}

const localProvider = {
  async put(key, buffer /*, mimetype */) {
    const abs = path.join(LOCAL_ROOT, key);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    await fs.promises.writeFile(abs, buffer);
    return { url: _publicUrl(key), key };
  },
  async remove(key) {
    const abs = path.join(LOCAL_ROOT, key);
    try { await fs.promises.unlink(abs); } catch { /* ignore */ }
  },
  readStream(key) { return fs.createReadStream(path.join(LOCAL_ROOT, key)); },
  // Local dev fallback: tell the client to POST the file back to our multer
  // endpoint. It is NOT a true presigned URL, just a compatibility shim so
  // the mobile app codepath works the same in dev and prod.
  async presignPut(key, mimetype, expiresIn = 900) {
    return {
      uploadUrl: null,   // client should fall back to the multer route
      method:    "POST",
      headers:   {},
      key,
      publicUrl: _publicUrl(key),
      provider:  "local",
      expiresIn,
    };
  },
  publicUrl(key)  { return _publicUrl(key); },
  provider:       "local",
};

// ?? AWS S3 ??????????????????????????????????????????????????????????????????
function makeS3Provider() {
  const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } =
    require("@aws-sdk/client-s3");
  const region  = process.env.AWS_REGION;
  const bucket  = process.env.S3_BUCKET;
  if (!bucket || !region) throw new Error("S3 provider requires AWS_REGION and S3_BUCKET.");
  const client  = new S3Client({ region });
  const publicUrl = (key) => {
    if (BASE_URL && BASE_URL !== "/uploads") return _publicUrl(key);
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  };
  return {
    async put(key, buffer, mimetype) {
      await client.send(new PutObjectCommand({
        Bucket: bucket, Key: key, Body: buffer,
        ContentType: mimetype || "application/octet-stream",
      }));
      return { url: publicUrl(key), key };
    },
    async remove(key) {
      try { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); } catch {}
    },
    readStream(key) {
      const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
      return client.send(cmd).then(r => r.Body);
    },
    // Return a presigned PUT URL so the mobile app can upload directly to S3
    // without the file passing through the API server. Saves egress + CPU.
    async presignPut(key, mimetype, expiresIn = 900) {
      const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
      const cmd = new PutObjectCommand({
        Bucket: bucket, Key: key,
        ContentType: mimetype || "application/octet-stream",
      });
      const uploadUrl = await getSignedUrl(client, cmd, { expiresIn });
      return {
        uploadUrl,
        method:    "PUT",
        headers:   { "Content-Type": mimetype || "application/octet-stream" },
        key,
        publicUrl: publicUrl(key),
        provider:  "s3",
        expiresIn,
      };
    },
    publicUrl,
    provider: "s3",
  };
}

// ?? Azure Blob ??????????????????????????????????????????????????????????????
function makeAzureProvider() {
  const { BlobServiceClient } = require("@azure/storage-blob");
  const conn      = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const container = process.env.AZURE_BLOB_CONTAINER;
  if (!conn || !container) throw new Error("Azure provider requires AZURE_STORAGE_CONNECTION_STRING and AZURE_BLOB_CONTAINER.");
  const svc = BlobServiceClient.fromConnectionString(conn);
  const ctr = svc.getContainerClient(container);
  const publicUrl = (key) => {
    if (BASE_URL && BASE_URL !== "/uploads") return _publicUrl(key);
    return ctr.getBlobClient(key).url;
  };
  return {
    async put(key, buffer, mimetype) {
      const block = ctr.getBlockBlobClient(key);
      await block.uploadData(buffer, { blobHTTPHeaders: { blobContentType: mimetype || "application/octet-stream" } });
      return { url: publicUrl(key), key };
    },
    async remove(key) {
      try { await ctr.getBlockBlobClient(key).deleteIfExists(); } catch {}
    },
    async readStream(key) {
      const dl = await ctr.getBlobClient(key).download();
      return dl.readableStreamBody;
    },
    // Azure SAS URL: mobile client PUTs the blob directly to storage.
    async presignPut(key, mimetype, expiresIn = 900) {
      const { generateBlobSASQueryParameters, BlobSASPermissions, StorageSharedKeyCredential } =
        require("@azure/storage-blob");
      const acct = process.env.AZURE_STORAGE_ACCOUNT;
      const skey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
      if (!acct || !skey) {
        throw new Error("Azure presign requires AZURE_STORAGE_ACCOUNT + AZURE_STORAGE_ACCOUNT_KEY.");
      }
      const cred    = new StorageSharedKeyCredential(acct, skey);
      const expires = new Date(Date.now() + expiresIn * 1000);
      const sas = generateBlobSASQueryParameters({
        containerName: container,
        blobName:      key,
        permissions:   BlobSASPermissions.parse("cw"), // create+write
        expiresOn:     expires,
        contentType:   mimetype || "application/octet-stream",
      }, cred).toString();
      const blobUrl = ctr.getBlockBlobClient(key).url;
      return {
        uploadUrl: `${blobUrl}?${sas}`,
        method:    "PUT",
        headers:   {
          "x-ms-blob-type":  "BlockBlob",
          "Content-Type":    mimetype || "application/octet-stream",
        },
        key,
        publicUrl: publicUrl(key),
        provider:  "azure",
        expiresIn,
      };
    },
    publicUrl,
    provider: "azure",
  };
}

// ?? Cloudinary ??????????????????????????????????????????????????????????????
function makeCloudinaryProvider() {
  const cloudinary = require("cloudinary").v2;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure:     true,
  });
  if (!process.env.CLOUDINARY_CLOUD_NAME) throw new Error("Cloudinary provider requires CLOUDINARY_CLOUD_NAME.");
  return {
    async put(key, buffer, mimetype) {
      const publicId = key.replace(/\.[^.]+$/, "");
      const dataUrl  = `data:${mimetype || "application/octet-stream"};base64,${buffer.toString("base64")}`;
      const r = await cloudinary.uploader.upload(dataUrl, { public_id: publicId, resource_type: "auto", overwrite: true });
      return { url: r.secure_url, key };
    },
    async remove(key) {
      try { await cloudinary.uploader.destroy(key.replace(/\.[^.]+$/, ""), { resource_type: "image" }); } catch {}
    },
    readStream(_key) { throw new Error("Cloudinary readStream not supported directly."); },
    // Cloudinary signed upload: the client POSTs a multipart form to the
    // upload endpoint with the returned signature. We tell it the public_id
    // and folder so the resulting URL is stable and predictable.
    async presignPut(key, _mimetype, expiresIn = 900) {
      const publicId  = key.replace(/\.[^.]+$/, "");
      const timestamp = Math.floor(Date.now() / 1000);
      const paramsToSign = { public_id: publicId, timestamp, overwrite: true };
      const signature = cloudinary.utils.api_sign_request(paramsToSign, process.env.CLOUDINARY_API_SECRET);
      const uploadUrl = `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/auto/upload`;
      return {
        uploadUrl,
        method:    "POST",
        headers:   {},                        // client uses multipart/form-data
        formFields: {                         // include these fields in the FormData
          public_id: publicId,
          timestamp: String(timestamp),
          overwrite: "true",
          signature,
          api_key:   process.env.CLOUDINARY_API_KEY,
        },
        key,
        publicUrl: null,                      // resolved after upload from response.secure_url
        provider:  "cloudinary",
        expiresIn,
      };
    },
    publicUrl(_key)  { return null; },
    provider: "cloudinary",
  };
}

// ?? Factory ????????????????????????????????????????????????????????????????
let _instance = null;
function getStorage() {
  if (_instance) return _instance;
  switch (PROVIDER) {
    case "s3":         _instance = makeS3Provider();         break;
    case "azure":      _instance = makeAzureProvider();      break;
    case "cloudinary": _instance = makeCloudinaryProvider(); break;
    default:           _instance = localProvider;
  }
  console.log(`? Storage provider: ${_instance.provider}`);
  return _instance;
}

module.exports = { getStorage, PROVIDER };
