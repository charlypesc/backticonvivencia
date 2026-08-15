-- RBAC — Propuesta de migración completa (para revisar con Carlos Paredes Escobar)
-- Basado en su informe "Modelo de Base de Datos — Capa de Autenticación" (v1.0, 2026-08-13).
-- SOLO PROPUESTA: no se ha aplicado a la BD de Aiven ni se aplicará sin aprobación.

-- ============================================================================
-- DECISIONES PROPUESTAS sobre las 4 preguntas abiertas de
-- docs/propuesta-rbac-autenticacion.md — a confirmar con Carlos:
-- ============================================================================
-- 1) Scope de id_establecimiento: no se crea una tabla `usuarios` nueva (el
--    informe de Carlos la propone, pero duplicaría la identidad que ya vive
--    en `USUARIO`). Las tablas RBAC cuelgan de `USUARIO.id_usuario`, que
--    sigue siendo la única fuente de verdad y mantiene su
--    `id_establecimiento` como hoy. roles/permisos/rol_permisos quedan como
--    catálogo GLOBAL (sin id_establecimiento), igual al patrón ya usado en
--    PAIS/REGION/PROVINCIA/COMUNA.
-- 2) Convención de nombres: se mantiene el naming de Carlos en minúscula
--    (`roles`, `permisos`, `usuario_roles`, `rol_permisos`) por ser un
--    subsistema nuevo y sin ambigüedad, en vez de forzarlo a mayúscula
--    singular como el resto del proyecto.
-- 3) Granularidad: esta propuesta solo crea tablas + vista. No toca
--    `middleware/auth.js` ni ninguna ruta — eso queda para una fase de
--    código aparte, una vez la BD esté aprobada y migrada (ver "FUERA DE
--    ALCANCE" al final).
-- 4) Migración de usuarios existentes: ver FASE 2 más abajo (comentada,
--    revisar antes de correr).
--
-- Ya pasó por 2 revisiones (corrección SQL + compatibilidad con el código
-- real) y las correcciones quedaron incorporadas directo en el DDL: FKs con
-- ON DELETE/UPDATE explícito, normalización en la migración de datos (FASE
-- 2.1/2.2), vw_permisos_efectivos filtrando por USUARIO.activo, y el punto
-- 2.4 (sincronizar usuarios.controller.js) movido de "fuera de alcance" a
-- requisito de esta misma fase.
-- ============================================================================
-- FASE 1 — catálogo (ya generado antes en rbac_roles_permisos_fase1.sql)
-- ============================================================================

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
  INDEX idx_rol_permisos_permiso (permiso_id),
  CONSTRAINT fk_rol_permisos_rol     FOREIGN KEY (rol_id)     REFERENCES roles(rol_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_rol_permisos_permiso FOREIGN KEY (permiso_id) REFERENCES permisos(permiso_id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- ============================================================================
-- FASE 1.5 — tabla puente usuario↔rol, apoyada en el USUARIO real del
-- proyecto (a diferencia de rbac_roles_permisos_fase1.sql: agrega
-- usuario_roles + la vista, referenciando USUARIO en vez de una tabla
-- `usuarios` paralela)
-- ============================================================================

-- Antes de aplicar: confirmar que USUARIO.id_usuario es INT (no UNSIGNED) y
-- que USUARIO es InnoDB — si difiere, estos FOREIGN KEY fallan al crearse.
CREATE TABLE usuario_roles (
  id_usuario    INT NOT NULL,
  rol_id        INT NOT NULL,
  asignado_por  INT NULL,
  asignado_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_at     DATETIME NULL,
  PRIMARY KEY (id_usuario, rol_id),
  INDEX idx_usuario_roles_rol (rol_id),
  CONSTRAINT fk_usuario_roles_usuario   FOREIGN KEY (id_usuario)   REFERENCES USUARIO(id_usuario)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_usuario_roles_rol       FOREIGN KEY (rol_id)       REFERENCES roles(rol_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_usuario_roles_asignador FOREIGN KEY (asignado_por) REFERENCES USUARIO(id_usuario)
    ON DELETE SET NULL ON UPDATE CASCADE
);

-- Filtra por USUARIO.activo: un usuario desactivado no debe figurar con
-- permisos vigentes aunque sus filas de usuario_roles sigan ahí.
CREATE VIEW vw_permisos_efectivos AS
SELECT DISTINCT ur.id_usuario, rp.permiso_id
FROM usuario_roles ur
INNER JOIN USUARIO u ON u.id_usuario = ur.id_usuario AND u.activo = TRUE
INNER JOIN rol_permisos rp ON rp.rol_id = ur.rol_id
INNER JOIN roles r ON r.rol_id = ur.rol_id AND r.activo = TRUE
WHERE ur.expira_at IS NULL OR ur.expira_at > NOW();

-- ============================================================================
-- FASE 2 — migración de datos existentes (COMENTADA — no ejecutar sin revisar)
-- Mapea USUARIO.rol (string único actual) a roles + usuario_roles.
-- Requiere que FASE 1/1.5 ya estén aplicadas.
-- ============================================================================

-- -- 2.1 Un rol de catálogo por cada valor distinto de USUARIO.rol.
-- -- es_sistema = TRUE porque vienen del enum original (DIRECTOR/ENCARGADO) y
-- -- no deben poder borrarse/editarse desde la UI. UPPER(TRIM(...)) evita que
-- -- 'Director'/'DIRECTOR '/etc. generen filas "distintas" para SELECT DISTINCT
-- -- pero "iguales" para el UNIQUE de codigo (colación case-insensitive de
-- -- MySQL), lo que abortaría el INSERT completo. También descarta valores vacíos.
-- INSERT INTO roles (nombre, codigo, descripcion, es_sistema, activo)
-- SELECT DISTINCT UPPER(TRIM(rol)), UPPER(TRIM(rol)),
--        CONCAT('Rol migrado automáticamente desde USUARIO.rol = ', UPPER(TRIM(rol))), TRUE, TRUE
-- FROM USUARIO
-- WHERE rol IS NOT NULL AND TRIM(rol) <> '';
--
-- -- 2.2 Asignar a cada usuario existente su rol migrado (mismo UPPER(TRIM())
-- -- en ambos lados del JOIN — si no matchea, el usuario queda sin fila sin
-- -- error visible, por eso el chequeo 2.3).
-- INSERT INTO usuario_roles (id_usuario, rol_id, asignado_por, asignado_at)
-- SELECT u.id_usuario, r.rol_id, NULL, NOW()
-- FROM USUARIO u
-- JOIN roles r ON r.codigo = UPPER(TRIM(u.rol));
--
-- -- 2.3 Verificación obligatoria antes de seguir a la fase de código —
-- -- cualquier fila con rol_migrado NULL es un usuario que quedó sin migrar:
-- --     SELECT u.id_usuario, u.correo, u.rol AS rol_legacy, r.codigo AS rol_migrado
-- --     FROM USUARIO u
-- --     LEFT JOIN usuario_roles ur ON ur.id_usuario = u.id_usuario
-- --     LEFT JOIN roles r ON r.rol_id = ur.rol_id;
--
-- -- 2.4 A partir de acá, usuarios.controller.js → create() (y cualquier
-- -- update() futuro) DEBE escribir también en usuario_roles, no solo en
-- -- USUARIO.rol — si no, todo usuario creado después queda sin permisos
-- -- efectivos. Se hace en esta misma fase, no se deja para después.

-- ============================================================================
-- FUERA DE ALCANCE de este documento (fases futuras, requieren aprobación
-- aparte porque tocan código de auth, no solo BD):
--   - auth.controller.js: JWT con roles[]/permisos[] en vez de un `rol` string.
--   - middleware/auth.js: requireRole ya no compara un string único; evaluar
--     sumar requirePermission(codigo).
--   - Actualizar los ~15 archivos de rutas que hoy llaman requireRole(...).
--   - Frontend: RolesEnum, AuthService.hasRole() y roleGuard() asumen un solo
--     rol por usuario — revisar si un usuario puede tener varios a la vez.
--   - Decidir si USUARIO.rol se elimina una vez migrado, o queda como
--     columna legacy de solo lectura por un tiempo (rollback más fácil).
