# MiConvivencia — Backend

API REST para la gestión de convivencia escolar: registro de incidentes, digitalización de actas manuscritas vía OCR + LLM, catálogo de estudiantes, tipos de falta, protocolos y usuarios por establecimiento.

## Stack

- Node.js + Express
- MySQL (`mysql2/promise`, pool de conexiones)
- Autenticación: JWT (`jsonwebtoken`) + `bcryptjs` para passwords
- Subida de archivos: `multer` (memoria, máx. 20MB, solo PDF/JPEG/PNG)
- OCR: Google Cloud Document AI
- Estructuración de texto OCR → JSON: OpenAI (`gpt-4o-mini`)

## Estructura

```
src/
  index.js                 # bootstrap de Express, monta todas las rutas
  db/connection.js         # pool mysql2, config por variables de entorno
  middleware/auth.js       # verifyToken, requireRole(...roles)
  routes/                  # un archivo por recurso, define permisos por rol
  controllers/             # lógica de cada endpoint
  services/
    documentai.service.js  # llama a Document AI, devuelve texto + confianza
    gemini.service.js      # llama a OpenAI, estructura el texto OCR en JSON
```

Cada request autenticado trae en `req.user` el payload del JWT: `{ id, correo, rol, id_establecimiento }`. Casi todas las queries filtran por `id_establecimiento`, por lo que los datos están aislados por establecimiento (multi-tenant simple).

## Roles

Dos roles: `DIRECTOR` y `ENCARGADO` (ver `RolesEnum` en el frontend). En general:
- `ENCARGADO`: crea/edita registros, estudiantes, tipos de falta, protocolos.
- `DIRECTOR`: valida registros, administra usuarios del establecimiento.
- Rutas de solo lectura (`GET`) normalmente permiten ambos roles.

Los permisos por endpoint están declarados en cada archivo de `routes/` con `requireRole(...)`.

## Endpoints

| Recurso | Base | Notas |
|---|---|---|
| Auth | `/api/auth` | `POST /login`, `GET /me` |
| Registros | `/api/registros` | CRUD + `PATCH /:id/validar` (DIRECTOR), `PATCH /:id/confirmar` (ENCARGADO) |
| Estudiantes | `/api/estudiantes` | CRUD + `GET /cursos`, `GET /rut/:rut` (ficha + historial de registros) |
| Usuarios | `/api/usuarios` | Solo DIRECTOR. CRUD de usuarios del establecimiento |
| Tipos de falta | `/api/tipos-falta` | CRUD, catálogo por establecimiento |
| Protocolos genéricos | `/api/protocolos-genericos` | Catálogo global (no filtra por establecimiento) |
| Protocolos de establecimiento | `/api/protocolos-establecimiento` | Adopción de un protocolo genérico por el establecimiento |
| Protocolos activados | `/api/protocolos-activados` | Activación de un protocolo sobre un registro puntual |
| Documentos | `/api/documents` | `POST /` sube un acta (PDF/imagen) y dispara el flujo OCR→LLM; `GET /registro/:id_registro` |
| Dashboard | `/api/dashboard` | Resumen: registros del mes, pendientes, estudiantes activos, últimos 5 |
| Health | `/health` | Sin auth, chequeo simple |

Todas las rutas (excepto `/api/auth/login` y `/health`) requieren `Authorization: Bearer <token>`.

## Flujo de digitalización de actas (`POST /api/documents`)

1. Se recibe el archivo (multer, memoria) y se valida que el usuario tenga `id_establecimiento` en el token.
2. Se cargan los catálogos del establecimiento (tipos de falta, estudiantes activos) — son necesarios para que el LLM pueda resolver IDs, no solo texto libre.
3. `documentai.service.js` envía el archivo a Document AI y devuelve el texto OCR crudo + un nivel de confianza promedio (por bloques de cada página).
4. `gemini.service.js` envía ese texto + los catálogos a OpenAI (`gpt-4o-mini`), que devuelve un JSON estructurado (fecha, temática, antecedentes, acuerdos, `id_tipo_falta`, estudiantes con `id_estudiante` ya resuelto por nombre).
5. Todo corre en una transacción: se crea un `REGISTRO_CONVIVENCIA` placeholder, se guarda el `DOCUMENTO_DIGITALIZADO`, se actualiza el registro con los datos estructurados y se insertan las relaciones `REGISTRO_ESTUDIANTE`.
6. La respuesta incluye texto crudo, datos estructurados y nivel de confianza — el frontend permite revisar/corregir antes de confirmar (`PATCH /:id/confirmar`).

> Nota: `gemini.service.js` conserva comentado un primer intento con la API de Gemini; la implementación activa usa OpenAI. El nombre del archivo quedó desactualizado respecto al proveedor real.

## Variables de entorno (`.env`)

```
PORT=
DB_HOST=
DB_PORT=
DB_USER=
DB_PASSWORD=
DB_NAME=
JWT_SECRET=
JWT_EXPIRES_IN=
GOOGLE_CREDENTIALS_JSON=   # JSON de credenciales de servicio de Google, como string
OPENAI_API_KEY=
```

`documentai.service.js` tiene además `PROJECT_ID`, `LOCATION` y `PROCESSOR_ID` de Document AI hardcodeados en el archivo (no en `.env`).

## Correr en local

```bash
npm install
npm run dev     # nodemon
npm start        # node
```

Requiere una base de datos MySQL con el esquema ya creado (no hay migraciones versionadas en el repo — ver `TODO` para el estado del diseño de tablas nuevas).
