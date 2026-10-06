-- Canal de denuncias con reserva de identidad (2026-10-06).
--
-- Ley 21.809, art. 46 letra e) de la Ley General de Educación: el reglamento
-- interno debe contemplar "un canal seguro y confidencial para recibir
-- denuncias con reserva de identidad", que resguarde al denunciante, no
-- revictimice y lleve a medidas concretas.
--
-- Una denuncia NO es un registro: todavía no está verificada, así que no toma
-- folio REG ni cuenta en el dashboard. Entra a una bandeja, y el coordinador
-- decide si crea el registro (y desde ahí deriva/activa protocolo) o la
-- desestima con motivo.
--
-- Anonimato real: no se guarda IP ni user-agent en ninguna tabla.

-- 1. Token del link público por colegio. Se genera la primera vez que alguien
--    abre la pantalla del canal; regenerarlo invalida un QR que circuló donde
--    no debía.
ALTER TABLE ESTABLECIMIENTO
  ADD COLUMN token_denuncia CHAR(22) NULL,
  ADD UNIQUE KEY uq_establecimiento_token_denuncia (token_denuncia);

-- 2. La denuncia. Folio por año y colegio, mismo esquema que registros y
--    protocolos (folios_anuales.sql): lo asigna el trigger.
CREATE TABLE DENUNCIA (
  id_denuncia           INT NOT NULL AUTO_INCREMENT,
  id_establecimiento    INT NOT NULL,
  anio                  SMALLINT NOT NULL,
  folio                 INT NOT NULL,
  codigo                VARCHAR(20) AS (CONCAT('DEN-', anio, '-', LPAD(folio, 3, '0'))) VIRTUAL,
  modo                  ENUM('anonima','reservada') NOT NULL,
  relato                TEXT NOT NULL,
  lugar                 VARCHAR(200) NULL,
  fecha_hechos          DATE NULL,
  personas_involucradas VARCHAR(500) NULL,
  urgente               TINYINT(1) NOT NULL DEFAULT 0,
  estado                ENUM('nueva','en_revision','convertida','desestimada') NOT NULL DEFAULT 'nueva',
  motivo_desestimacion  VARCHAR(500) NULL,
  id_registro           INT NULL,
  id_usuario_gestiona   INT NULL,
  fecha_gestion         DATETIME NULL,
  fecha_creacion        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_denuncia),
  UNIQUE KEY uq_denuncia_folio_anio (id_establecimiento, anio, folio),
  KEY idx_denuncia_estado (id_establecimiento, estado),
  CONSTRAINT fk_denuncia_estab FOREIGN KEY (id_establecimiento)
    REFERENCES ESTABLECIMIENTO (id_establecimiento),
  CONSTRAINT fk_denuncia_registro FOREIGN KEY (id_registro)
    REFERENCES REGISTRO_CONVIVENCIA (id_registro) ON DELETE SET NULL,
  CONSTRAINT fk_denuncia_usuario FOREIGN KEY (id_usuario_gestiona)
    REFERENCES USUARIO (id_usuario) ON DELETE SET NULL
);

CREATE TRIGGER trg_denuncia_folio BEFORE INSERT ON DENUNCIA
FOR EACH ROW
SET NEW.anio = YEAR(CONVERT_TZ(NOW(), 'UTC', 'America/Santiago')),
    NEW.folio = (SELECT COALESCE(MAX(folio), 0) + 1 FROM DENUNCIA
                  WHERE id_establecimiento = NEW.id_establecimiento
                    AND anio = YEAR(CONVERT_TZ(NOW(), 'UTC', 'America/Santiago')));

-- 3. Identidad de quien denunció con reserva. Tabla aparte a propósito: así
--    ninguna consulta de la bandeja la arrastra por accidente con un JOIN.
CREATE TABLE DENUNCIA_IDENTIDAD (
  id_denuncia INT NOT NULL,
  nombre      VARCHAR(150) NOT NULL,
  curso       VARCHAR(60) NULL,
  contacto    VARCHAR(150) NULL,
  PRIMARY KEY (id_denuncia),
  CONSTRAINT fk_denuncia_identidad FOREIGN KEY (id_denuncia)
    REFERENCES DENUNCIA (id_denuncia) ON DELETE CASCADE
);

-- 4. Quién miró la identidad y cuándo. Resguardar la identidad incluye poder
--    responder a quién se le mostró.
CREATE TABLE DENUNCIA_IDENTIDAD_ACCESO (
  id_acceso   INT NOT NULL AUTO_INCREMENT,
  id_denuncia INT NOT NULL,
  id_usuario  INT NULL,
  fecha       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_acceso),
  KEY idx_identidad_acceso_denuncia (id_denuncia),
  CONSTRAINT fk_identidad_acceso_denuncia FOREIGN KEY (id_denuncia)
    REFERENCES DENUNCIA (id_denuncia) ON DELETE CASCADE,
  CONSTRAINT fk_identidad_acceso_usuario FOREIGN KEY (id_usuario)
    REFERENCES USUARIO (id_usuario) ON DELETE SET NULL
);

-- 5. Adjuntos (fotos de pantalla, fotos). Ya comprimidos por comprimirArchivo.
CREATE TABLE DENUNCIA_ARCHIVO (
  id_archivo     INT NOT NULL AUTO_INCREMENT,
  id_denuncia    INT NOT NULL,
  nombre_archivo VARCHAR(255) NOT NULL,
  tipo_archivo   VARCHAR(100) NOT NULL,
  bytes          INT NOT NULL,
  contenido      MEDIUMBLOB NOT NULL,
  fecha_subida   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_archivo),
  KEY idx_denuncia_archivo (id_denuncia),
  CONSTRAINT fk_denuncia_archivo FOREIGN KEY (id_denuncia)
    REFERENCES DENUNCIA (id_denuncia) ON DELETE CASCADE
);

-- 6. Aviso a los coordinadores de que entró una denuncia.
ALTER TABLE NOTIFICACION
  MODIFY COLUMN tipo ENUM('paso_en_curso','paso_vencido','paso_reasignado','protocolo_activado',
    'protocolo_cerrado','protocolo_anulado','medida_proteccion_vencida',
    'medida_disciplinaria_por_terminar','medida_disciplinaria_cumplida',
    'condicionalidad_por_revisar',
    'registro_nuevo','registro_derivado','derivacion_vencida','derivacion_atendida',
    'denuncia_nueva') NOT NULL;

-- 7. Permisos.
--    118 denuncia.ver: el ítem "QR denuncias" del menú, el QR/link y la bandeja.
--    119 denuncia.gestionar: crear el registro, desestimar, regenerar el QR.
--    120 denuncia.ver_identidad: ver quién denunció con reserva (queda registrado).
INSERT INTO PERMISOS (permiso_id, codigo, recurso, accion, descripcion) VALUES
  (118, 'denuncia.ver', 'denuncia', 'ver',
   'Canal de denuncias: ver el QR, el link y la bandeja de denuncias'),
  (119, 'denuncia.gestionar', 'denuncia', 'gestionar',
   'Canal de denuncias: crear el registro o desestimar una denuncia, y regenerar el QR'),
  (120, 'denuncia.ver_identidad', 'denuncia', 'ver_identidad',
   'Canal de denuncias: ver quién denunció con reserva de identidad (queda registrado)');

INSERT INTO ROL_PERMISOS (rol_id, permiso_id)
SELECT r.rol_id, p.permiso_id FROM ROLES r
  JOIN PERMISOS p ON p.permiso_id IN (118, 119, 120)
 WHERE r.codigo IN ('ADMIN', 'ENCARGADO') AND r.id_establecimiento IS NULL;
