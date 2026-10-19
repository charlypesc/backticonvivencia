-- Acogida de relatos: paso estándar de todos los protocolos.
--
-- Un paso de tipo 'acogida_relatos' recoge, en un solo lugar, el relato de cada
-- involucrado del caso. Primero se decide a quién se le acoge (y si a alguien
-- no, por qué); después se registra cada relato con la fecha y hora en que se
-- ingresó. Un relato se puede corregir, pero el texto anterior no se pierde: va
-- a RELATO_VERSION y sale en el expediente.
--
-- No reusa PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO: esas filas se materializan por
-- rol al activar (y los testigos no entran en 'todos'), y acá la lista es
-- siempre la de todos los involucrados del caso, incluidos los que se
-- incorporen después. Una persona puede tener varios relatos.
--
-- Correr en orden y abortar ante el primer error.

-- 1. El tipo de paso, en los tres niveles del grafo.
ALTER TABLE CATALOGO_PROTOCOLO_PASO MODIFY tipo_paso
  ENUM('informativo','formulario','adjunto','aprobacion','notificacion_externa','seguimiento',
       'notificacion_apoderado','notificacion_estudiante','medida_proteccion','medida_disciplinaria',
       'medida_cautelar','acogida_relatos') NOT NULL DEFAULT 'informativo';

ALTER TABLE PROTOCOLO_ESTABLECIMIENTO_PASO MODIFY tipo_paso
  ENUM('informativo','formulario','adjunto','aprobacion','notificacion_externa','seguimiento',
       'notificacion_apoderado','notificacion_estudiante','medida_proteccion','medida_disciplinaria',
       'medida_cautelar','acogida_relatos') NOT NULL DEFAULT 'informativo';

ALTER TABLE PROTOCOLO_ACTIVADO_PASO MODIFY tipo_paso
  ENUM('informativo','formulario','adjunto','aprobacion','notificacion_externa','seguimiento',
       'notificacion_apoderado','notificacion_estudiante','medida_proteccion','medida_disciplinaria',
       'medida_cautelar','acogida_relatos') NOT NULL;

-- 2. Los eventos de bitácora: cada decisión, relato y corrección deja rastro.
ALTER TABLE PROTOCOLO_ACTIVADO_EVENTO MODIFY tipo_evento
  ENUM('activacion','inicio_paso','completado_paso','omitido_paso','transicion','vencimiento','cierre',
       'anulacion','nota','medida_proteccion_aplicada','medida_proteccion_editada',
       'medida_proteccion_finalizada','medida_proteccion_vencida','informe_expulsion_emitido',
       'expulsion_resuelta','expediente_exportado','involucrado_agregado','involucrado_editado',
       'gestion_involucrado','suspension_cautelar_aplicada','suspension_cautelar_editada',
       'suspension_cautelar_reconsiderada','suspension_cautelar_resuelta','medida_disciplinaria_aplicada',
       'medida_disciplinaria_cumplida','condicionalidad_por_revisar','seguimiento_registrado',
       'suspension_cautelar_documento','plazo_investigacion_vencido',
       'relato_decision','relato_acogido','relato_editado') NOT NULL;

-- 3. A quién se le acoge el relato en el paso, y por qué no a quien no.
CREATE TABLE PROTOCOLO_ACTIVADO_RELATO_DECISION (
  id_decision        INT NOT NULL AUTO_INCREMENT,
  id_activado_paso   INT NOT NULL,
  id_involucrado     INT NOT NULL,
  se_acoge           TINYINT(1) NOT NULL,
  motivo             VARCHAR(1000) NULL,
  id_usuario         INT NULL,
  fecha_registro     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_modificacion DATETIME NULL,
  PRIMARY KEY (id_decision),
  UNIQUE KEY uq_relato_decision (id_activado_paso, id_involucrado),
  KEY idx_relato_decision_involucrado (id_involucrado),
  CONSTRAINT fk_relato_decision_paso FOREIGN KEY (id_activado_paso)
    REFERENCES PROTOCOLO_ACTIVADO_PASO (id_activado_paso) ON DELETE CASCADE,
  CONSTRAINT fk_relato_decision_involucrado FOREIGN KEY (id_involucrado)
    REFERENCES PROTOCOLO_ACTIVADO_INVOLUCRADO (id_involucrado) ON DELETE CASCADE,
  CONSTRAINT fk_relato_decision_usuario FOREIGN KEY (id_usuario)
    REFERENCES USUARIO (id_usuario) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 4. Los relatos. fecha_registro es la fecha y hora en que se ingresó.
CREATE TABLE PROTOCOLO_ACTIVADO_RELATO (
  id_relato               INT NOT NULL AUTO_INCREMENT,
  id_activado_paso        INT NOT NULL,
  id_involucrado          INT NOT NULL,
  relato                  TEXT NOT NULL,
  id_usuario              INT NULL,
  fecha_registro          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  id_usuario_modificacion INT NULL,
  fecha_modificacion      DATETIME NULL,
  PRIMARY KEY (id_relato),
  KEY idx_relato_paso (id_activado_paso, id_involucrado),
  KEY idx_relato_involucrado (id_involucrado),
  CONSTRAINT fk_relato_paso FOREIGN KEY (id_activado_paso)
    REFERENCES PROTOCOLO_ACTIVADO_PASO (id_activado_paso) ON DELETE CASCADE,
  CONSTRAINT fk_relato_involucrado FOREIGN KEY (id_involucrado)
    REFERENCES PROTOCOLO_ACTIVADO_INVOLUCRADO (id_involucrado) ON DELETE CASCADE,
  CONSTRAINT fk_relato_usuario FOREIGN KEY (id_usuario)
    REFERENCES USUARIO (id_usuario) ON DELETE SET NULL,
  CONSTRAINT fk_relato_usuario_mod FOREIGN KEY (id_usuario_modificacion)
    REFERENCES USUARIO (id_usuario) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 5. El texto que tenía un relato antes de cada corrección.
CREATE TABLE PROTOCOLO_ACTIVADO_RELATO_VERSION (
  id_version     INT NOT NULL AUTO_INCREMENT,
  id_relato      INT NOT NULL,
  relato         TEXT NOT NULL,
  id_usuario     INT NULL,
  fecha          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_version),
  KEY idx_relato_version_relato (id_relato),
  CONSTRAINT fk_relato_version_relato FOREIGN KEY (id_relato)
    REFERENCES PROTOCOLO_ACTIVADO_RELATO (id_relato) ON DELETE CASCADE,
  CONSTRAINT fk_relato_version_usuario FOREIGN KEY (id_usuario)
    REFERENCES USUARIO (id_usuario) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

