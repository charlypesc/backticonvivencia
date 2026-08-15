-- Modelo RBAC (autenticación/autorización) — según informe de Carlos Paredes Escobar
-- Ver docs/propuesta-rbac-autenticacion.md para contexto y preguntas abiertas.
-- Para correr manualmente en la BD (Aiven MySQL 8.x) — no se aplica desde la app.

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
  CONSTRAINT fk_usuario_roles_usuario   FOREIGN KEY (usuario_id)   REFERENCES usuarios(usuario_id),
  CONSTRAINT fk_usuario_roles_rol       FOREIGN KEY (rol_id)       REFERENCES roles(rol_id),
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
