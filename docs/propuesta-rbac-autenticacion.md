# Propuesta: modelo RBAC (autenticación/autorización) enviado por Carlos

Estado: **borrador para revisar con Carlos** — nada de esto está aplicado a la BD.

## Contexto: cómo funciona hoy

Hoy la autenticación es simple, todo vive en una sola tabla `USUARIO`:

- `USUARIO` tiene columna `rol` (VARCHAR, un solo valor: `DIRECTOR`, `ENCARGADO`)
  y `id_establecimiento` (scope multi-tenant).
- El JWT lleva `{ id, correo, rol, id_establecimiento }` tal cual sale de la fila
  (`auth.controller.js`).
- El middleware `requireRole(...roles)` (`src/middleware/auth.js`) compara
  `req.user.rol` (string único) contra una lista fija de roles permitidos, y está
  hardcodeado en cada archivo de rutas (`estudiantes.routes.js`,
  `sostenedor.routes.js`, `cursos.routes.js`, etc. — 10 archivos hoy).
- Un usuario **no puede tener más de un rol** ni hay permisos granulares: todo el
  control de acceso es "¿tu rol está en esta lista?".

## Resumen de la propuesta de Carlos (RBAC)

Reemplaza el modelo de un solo `rol` por 5 tablas:

- **`usuarios`** — credenciales/datos básicos (equivalente a `USUARIO`, pero sin
  `id_establecimiento`).
- **`roles`** — catálogo dinámico de roles (`codigo`, `es_sistema` para roles
  protegidos).
- **`permisos`** — catálogo granular `recurso.accion` (ej. `caso.crear`,
  `caso.cerrar`).
- **`usuario_roles`** — tabla puente N:N, un usuario puede tener **varios roles a
  la vez**, con auditoría (`asignado_por`) y vigencia opcional (`expira_at`).
- **`rol_permisos`** — tabla puente N:N entre roles y permisos.
- Vista `vw_permisos_efectivos` que resuelve usuario → roles activos → permisos
  en una sola consulta.

Reglas de negocio clave del informe: un permiso solo se obtiene vía rol (no hay
excepciones por usuario), roles `es_sistema=1` no son editables desde la UI, y
los permisos efectivos son la unión de todos los roles activos del usuario.

## Gaps de compatibilidad con el proyecto actual

Antes de generar el DDL definitivo hay puntos que **no vienen resueltos en el
informe de Carlos** porque su modelo es genérico (no conoce este proyecto):

1. **Falta el scope de `id_establecimiento`.** Todo el sistema hoy filtra por
   establecimiento (`estudiantes`, `registros`, `cursos`, `protocolos...`, etc.
   vía `req.user.id_establecimiento`). El modelo de Carlos no tiene ese campo en
   ninguna tabla. ¿Dónde vive el establecimiento de un usuario si ahora puede
   tener varios roles? Opciones: (a) columna `id_establecimiento` en `usuarios`
   (un usuario sigue perteneciendo a un solo colegio, como hoy), o (b) mover el
   scope a `usuario_roles` (un rol podría estar acotado a un establecimiento
   distinto por asignación — más flexible pero más complejo).
2. **Convención de nombres.** El proyecto usa tablas en MAYÚSCULA singular
   (`USUARIO`, `ESTABLECIMIENTO`) con columnas `id_usuario`, `id_establecimiento`.
   El informe usa minúscula plural (`usuarios`, `roles`). Si se adopta, hay que
   decidir si se respeta la convención existente o se adopta la de Carlos.
3. **Impacto en `requireRole`.** Con multi-rol, el JWT ya no puede llevar un
   `rol` string único — pasaría a llevar un array de roles/permisos, y
   `requireRole` (y sus ~10 usos en `*.routes.js`) tendría que reescribirse para
   chequear pertenencia a un array, o migrar a `requirePermission('caso.crear')`
   para aprovechar la granularidad que ofrece `permisos`. Si solo se cambia la
   tabla pero se sigue chequeando por nombre de rol hardcodeado, la granularidad
   de `permisos`/`rol_permisos` queda sin usarse.
4. **Migración de datos existentes.** Hay usuarios reales hoy en `USUARIO` con
   un `rol` string. Habría que mapear cada rol actual (`DIRECTOR`, `ENCARGADO`)
   a una fila en `roles` + una fila en `usuario_roles` por usuario.

## DDL propuesto (tal como lo envió Carlos, para revisar)

```sql
CREATE TABLE usuarios (
  usuario_id        INT AUTO_INCREMENT PRIMARY KEY,
  username          VARCHAR(100) NOT NULL UNIQUE,
  email             VARCHAR(255) NOT NULL UNIQUE,
  password_hash     VARCHAR(500) NOT NULL,
  nombre            VARCHAR(150),
  apellido          VARCHAR(150),
  activo            BOOLEAN NOT NULL DEFAULT TRUE,
  email_verificado  BOOLEAN NOT NULL DEFAULT FALSE,
  ultimo_login      DATETIME NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE roles (
  rol_id      INT AUTO_INCREMENT PRIMARY KEY,
  nombre      VARCHAR(100) NOT NULL,
  codigo      VARCHAR(50)  NOT NULL UNIQUE,
  descripcion VARCHAR(255),
  es_sistema  BOOLEAN NOT NULL DEFAULT FALSE,
  activo      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE permisos (
  permiso_id  INT AUTO_INCREMENT PRIMARY KEY,
  codigo      VARCHAR(100) NOT NULL UNIQUE,
  recurso     VARCHAR(100) NOT NULL,
  accion      VARCHAR(50)  NOT NULL,
  descripcion VARCHAR(255)
);

CREATE TABLE usuario_roles (
  usuario_id    INT NOT NULL,
  rol_id        INT NOT NULL,
  asignado_por  INT NULL,
  asignado_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_at     DATETIME NULL,
  PRIMARY KEY (usuario_id, rol_id),
  CONSTRAINT fk_usuario_roles_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(usuario_id),
  CONSTRAINT fk_usuario_roles_rol     FOREIGN KEY (rol_id)     REFERENCES roles(rol_id),
  CONSTRAINT fk_usuario_roles_asignador FOREIGN KEY (asignado_por) REFERENCES usuarios(usuario_id)
);

CREATE TABLE rol_permisos (
  rol_id      INT NOT NULL,
  permiso_id  INT NOT NULL,
  asignado_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (rol_id, permiso_id),
  CONSTRAINT fk_rol_permisos_rol     FOREIGN KEY (rol_id)     REFERENCES roles(rol_id),
  CONSTRAINT fk_rol_permisos_permiso FOREIGN KEY (permiso_id) REFERENCES permisos(permiso_id)
);

CREATE VIEW vw_permisos_efectivos AS
SELECT DISTINCT ur.usuario_id, rp.permiso_id
FROM usuario_roles ur
INNER JOIN rol_permisos rp ON rp.rol_id = ur.rol_id
INNER JOIN roles r ON r.rol_id = ur.rol_id AND r.activo = TRUE
WHERE ur.expira_at IS NULL OR ur.expira_at > NOW();
```

## Preguntas abiertas para Carlos

1. **Scope de establecimiento** (gap 1): ¿`id_establecimiento` va en `usuarios`
   (un usuario = un colegio, como hoy) o en `usuario_roles` (un rol puede estar
   acotado a un establecimiento distinto por asignación)?
2. **Convención de nombres** (gap 2): ¿mantenemos `usuarios`/`roles` en
   minúscula tal como lo mandó Carlos, o se adaptan a mayúscula singular como el
   resto del proyecto (`USUARIO`, `ROL`, `PERMISO`, ...)?
3. **Nivel de granularidad real a usar**: ¿vale la pena migrar los ~10 usos de
   `requireRole('DIRECTOR', 'ENCARGADO')` a `requirePermission('caso.crear')`
   ahora, o se empieza dejando `roles`/`usuario_roles` funcionando igual que hoy
   (multi-rol, pero rutas siguen chequeando por código de rol) y se deja
   `permisos`/`rol_permisos` para una segunda etapa?
4. **Migración de usuarios existentes**: ¿quién arma el mapeo `USUARIO.rol` →
   fila en `roles` + `usuario_roles` para los usuarios reales que ya existen?

## Qué falta si se aprueba

- Resolver las 4 preguntas abiertas antes de tocar código.
- Crear las tablas (`usuarios`, `roles`, `permisos`, `usuario_roles`,
  `rol_permisos`) y la vista — Carlos/Rodrigo, no vía migración automática.
- Reescribir `auth.controller.js` (login) para armar el JWT con el/los roles
  (y opcionalmente permisos) resueltos vía `vw_permisos_efectivos`.
- Reescribir `requireRole` en `src/middleware/auth.js` para aceptar múltiples
  roles por usuario (o agregar `requirePermission` en paralelo).
- Actualizar los ~10 archivos de rutas que hoy usan `requireRole(...)` con
  nombres de rol hardcodeados.
- Migrar los usuarios existentes de `USUARIO.rol` al nuevo esquema.
