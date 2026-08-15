-- RBAC — Fase 1: catálogo de roles y permisos (según informe de Carlos Paredes Escobar)
-- Alcance acotado para revisar con Carlos antes de tocar `USUARIO`/login:
--   - Se crean roles, permisos y rol_permisos.
--   - NO se crea `usuarios` ni `usuario_roles` todavía: la tabla `USUARIO` actual
--     (con su columna `rol` enum) sigue intacta y el login no se toca en esta fase.
--   - Catálogo GLOBAL (sin id_establecimiento), igual que PAIS/REGION/PROVINCIA/COMUNA.
-- Para correr manualmente en la BD (Aiven MySQL 8.x) — no se aplica desde la app.

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

CREATE TABLE rol_permisos (
  rol_id      INT NOT NULL,
  permiso_id  INT NOT NULL,
  asignado_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (rol_id, permiso_id),
  CONSTRAINT fk_rol_permisos_rol     FOREIGN KEY (rol_id)     REFERENCES roles(rol_id),
  CONSTRAINT fk_rol_permisos_permiso FOREIGN KEY (permiso_id) REFERENCES permisos(permiso_id)
);

-- Pendiente para una fase 2 (fuera de este script), una vez resueltas con Carlos
-- las preguntas abiertas de docs/propuesta-rbac-autenticacion.md:
--   - `usuarios` / `usuario_roles` y su relación con la tabla `USUARIO` actual
--     (¿se reemplaza, convive, o se mapea 1:1?).
--   - Dónde vive el scope de id_establecimiento para un usuario multi-rol.
--   - Migración de `USUARIO.rol` (DIRECTOR/ENCARGADO) a filas reales
--     en `roles` + `usuario_roles`.
--   - Vista `vw_permisos_efectivos` (depende de `usuario_roles`, se agrega en fase 2).
