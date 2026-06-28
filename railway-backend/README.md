# AFP Municipal Portal – Railway Backend API

Express + PostgreSQL backend for the AllForPets Municipal Portal.  
Deployed on Railway; proxied by the .NET Razor Pages frontend.

---

## Quick Deploy to Railway

1. Push the `railway-backend/` folder as its own Git repo (or Railway Service Source).
2. Add a **PostgreSQL** plugin inside Railway ? copy the `DATABASE_URL`.
3. Set the environment variables below in Railway ? **Variables**.
4. Railway auto-detects `package.json` and runs `npm start`.

---

## Environment Variables

| Variable       | Description                                          | Example                          |
|----------------|------------------------------------------------------|----------------------------------|
| `DATABASE_URL` | Railway PostgreSQL connection string (auto-provided) | `postgresql://user:pw@host/db`   |
| `JWT_SECRET`   | Long random string (? 32 chars)                      | `s3cr3t_k3y_change_me`           |
| `CORS_ORIGIN`  | Your .NET frontend URL                               | `https://your-app.railway.app`   |
| `PORT`         | HTTP port (Railway sets this automatically)          | `3000`                           |

---

## Database Setup

After the PostgreSQL plugin is provisioned, run the schema once:

```bash
# Option 1: Railway CLI
railway run psql $DATABASE_URL < schema.sql

# Option 2: Connect with psql
psql "$DATABASE_URL" < schema.sql
```

This creates all tables and seeds:
- A default **super_admin** account (`mobile: 9999999999`, `password: Admin@123`)
- Sample cities: Jaipur, Delhi, Mumbai

---

## API Reference

### Auth
| Method | Path                  | Body                                           | Auth    |
|--------|-----------------------|------------------------------------------------|---------|
| POST   | `/api/auth/register`  | `{name, mobile, email, password, address, cityId, nigamId, wardId}` | Public  |
| POST   | `/api/auth/login`     | `{identifier, password}`                       | Public  |

**Login response:**
```json
{ "token": "<JWT>", "user": { "id", "name", "mobile", "email", "role", "city_id", "nigam_id", "ward_id", "city_name", "nigam_name", "ward_number", ... } }
```

---

### User Management  `/api/admin/users`
Requires `Authorization: Bearer <token>` with role ? `ward_admin`.

| Method | Path                     | Query / Body                                                    | Min Role      |
|--------|--------------------------|-----------------------------------------------------------------|---------------|
| GET    | `/api/admin/users`       | `?role=citizen&cityId=&nigamId=&wardId=&q=`                    | ward_admin    |
| POST   | `/api/admin/users`       | `{name, mobile, email?, address?, role, cityId?, nigamId?, wardId?, password, is_active?}` | ward_admin |
| PUT    | `/api/admin/users/:id`   | same fields (all optional); `password` only updated if supplied | ward_admin    |
| DELETE | `/api/admin/users/:id`   | –                                                               | ward_admin    |

**Role hierarchy** (who can manage whom):

| Caller      | Can manage                                        |
|-------------|---------------------------------------------------|
| super_admin | super_admin, city_admin, nigam_admin, ward_admin, citizen |
| city_admin  | nigam_admin, ward_admin, citizen (own city)       |
| nigam_admin | ward_admin, citizen (own nigam)                   |
| ward_admin  | citizen (own ward)                                |

**GET response** (array of):
```json
{
  "id": 1,
  "name": "Ravi Kumar",
  "mobile": "9810000001",
  "email": "ravi@example.com",
  "address": "12 MG Road, Jaipur",
  "role": "citizen",
  "city_id": 1,   "city_name": "Jaipur",
  "nigam_id": 1,  "nigam_name": "Jaipur Municipal Corp",
  "ward_id": 3,   "ward_number": "Ward 7",
  "is_active": true,
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

### Geo  `/api/geo`
| Method | Path                          | Auth          |
|--------|-------------------------------|---------------|
| GET    | `/api/geo/cities`             | Public        |
| GET    | `/api/geo/cities/all`         | super_admin   |
| POST   | `/api/geo/cities`             | super_admin   |
| PUT    | `/api/geo/cities/:id`         | super_admin   |
| GET    | `/api/geo/nigams?cityId=`     | Public        |
| GET    | `/api/geo/nigams/all?cityId=` | super_admin   |
| POST   | `/api/geo/nigams`             | super_admin   |
| PUT    | `/api/geo/nigams/:id`         | super_admin   |
| GET    | `/api/geo/wards?nigamId=`     | Public        |
| GET    | `/api/geo/wards/all?nigamId=` | super_admin   |
| POST   | `/api/geo/wards`              | super_admin   |
| PUT    | `/api/geo/wards/:id`          | super_admin   |

---

### Pets  `/api/pets`
| Method | Path                             | Auth         |
|--------|----------------------------------|--------------|
| GET    | `/api/pets/my`                   | Authenticated|
| GET    | `/api/pets/search?q=&cityId=`    | Public       |
| GET    | `/api/pets/stats`                | Public       |
| GET    | `/api/pets/pending`              | ward_admin+  |
| GET    | `/api/pets/:id`                  | Authenticated|
| POST   | `/api/pets`                      | Authenticated|
| PATCH  | `/api/pets/:id/approve`          | ward_admin+  |
| PATCH  | `/api/pets/:id/reject`           | ward_admin+  |
| PATCH  | `/api/pets/:id/renew`            | Authenticated|
| PATCH  | `/api/pets/:id/vaccine`          | Authenticated|
| POST   | `/api/pets/:id/upload-photo`     | Authenticated|
| POST   | `/api/pets/:id/upload-certificate`| Authenticated|
| GET    | `/api/admin/pets`                | ward_admin+  |
| GET    | `/api/admin/stats`               | ward_admin+  |

---

### Doctors  `/api/doctors`
| Method | Path                 | Auth        |
|--------|----------------------|-------------|
| GET    | `/api/doctors?cityId=&q=` | Public |
| POST   | `/api/doctors`       | super_admin |
| PUT    | `/api/doctors/:id`   | super_admin |
| DELETE | `/api/doctors/:id`   | super_admin |

---

### Shops  `/api/shops`
| Method | Path               | Auth        |
|--------|--------------------|-------------|
| GET    | `/api/shops?cityId=&q=` | Public |
| POST   | `/api/shops`       | super_admin |
| PUT    | `/api/shops/:id`   | super_admin |
| DELETE | `/api/shops/:id`   | super_admin |

---

### Reports  `/api/reports`
| Method | Path           | Auth         |
|--------|----------------|--------------|
| POST   | `/api/reports` | Authenticated|
| GET    | `/api/reports` | ward_admin+  |

---

## Health Check
```
GET /health
? { "status": "ok", "db": "connected", "ts": "..." }
```

---

## Default Credentials (after schema seed)
| Field    | Value                         |
|----------|-------------------------------|
| Mobile   | `9999999999`                  |
| Password | `Admin@123`                   |
| Role     | `super_admin`                 |

> ?? Change the password immediately after first login.
