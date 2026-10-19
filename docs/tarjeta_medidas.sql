-- Tarjeta "Medidas": un paso donde aparecen TODOS los involucrados del caso y
-- a cada uno se le elige una medida (o "Sin medidas").
--
-- Las medidas elegidas se guardan en las tablas que ya existen
-- (MEDIDA_PROTECCION y MEDIDA_DISCIPLINARIA, atadas al paso por
-- id_activado_paso), para conservar sus plazos, vencimientos y el informe de
-- expulsión. Lo único nuevo es dónde consta que a una persona se decidió no
-- aplicarle ninguna medida, y por qué.
--
-- Requiere docs/acogida_relatos.sql. Correr en orden y abortar ante el primer error.

-- 1. El tipo de paso, en los tres niveles del grafo.
ALTER TABLE CATALOGO_PROTOCOLO_PASO MODIFY tipo_paso ENUM('informativo','formulario','adjunto','aprobacion','notificacion_externa','seguimiento','notificacion_apoderado','notificacion_estudiante','medida_proteccion','medida_disciplinaria','medida_cautelar','acogida_relatos','medidas') NOT NULL DEFAULT 'informativo';
ALTER TABLE PROTOCOLO_ESTABLECIMIENTO_PASO MODIFY tipo_paso ENUM('informativo','formulario','adjunto','aprobacion','notificacion_externa','seguimiento','notificacion_apoderado','notificacion_estudiante','medida_proteccion','medida_disciplinaria','medida_cautelar','acogida_relatos','medidas') NOT NULL DEFAULT 'informativo';
ALTER TABLE PROTOCOLO_ACTIVADO_PASO MODIFY tipo_paso ENUM('informativo','formulario','adjunto','aprobacion','notificacion_externa','seguimiento','notificacion_apoderado','notificacion_estudiante','medida_proteccion','medida_disciplinaria','medida_cautelar','acogida_relatos','medidas') NOT NULL;

-- 2. El evento de bitácora "sin medida".
ALTER TABLE PROTOCOLO_ACTIVADO_EVENTO MODIFY tipo_evento ENUM('activacion','inicio_paso','completado_paso','omitido_paso','transicion','vencimiento','cierre','anulacion','nota','medida_proteccion_aplicada','medida_proteccion_editada','medida_proteccion_finalizada','medida_proteccion_vencida','informe_expulsion_emitido','expulsion_resuelta','expediente_exportado','involucrado_agregado','involucrado_editado','gestion_involucrado','suspension_cautelar_aplicada','suspension_cautelar_editada','suspension_cautelar_reconsiderada','suspension_cautelar_resuelta','medida_disciplinaria_aplicada','medida_disciplinaria_cumplida','condicionalidad_por_revisar','seguimiento_registrado','suspension_cautelar_documento','plazo_investigacion_vencido','relato_decision','relato_acogido','relato_editado','acceso_otorgado','acceso_retirado','relato_asignado','sin_medida') NOT NULL;

-- 3. A quién se decidió no aplicarle medida en el paso, y por qué.
CREATE TABLE PROTOCOLO_ACTIVADO_SIN_MEDIDA (
  id_activado_paso INT NOT NULL,
  id_involucrado   INT NOT NULL,
  motivo           VARCHAR(1000) NULL,
  id_usuario       INT NULL,
  fecha_registro   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_activado_paso, id_involucrado),
  KEY idx_sin_medida_involucrado (id_involucrado),
  CONSTRAINT fk_sin_medida_paso FOREIGN KEY (id_activado_paso)
    REFERENCES PROTOCOLO_ACTIVADO_PASO (id_activado_paso) ON DELETE CASCADE,
  CONSTRAINT fk_sin_medida_involucrado FOREIGN KEY (id_involucrado)
    REFERENCES PROTOCOLO_ACTIVADO_INVOLUCRADO (id_involucrado) ON DELETE CASCADE,
  CONSTRAINT fk_sin_medida_usuario FOREIGN KEY (id_usuario)
    REFERENCES USUARIO (id_usuario) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 4. La resolución firmada por el director de una medida de la tarjeta
--    (excepcionales y condicionalidad). Una por medida; si se vuelve a subir,
--    reemplaza.
CREATE TABLE MEDIDA_DISCIPLINARIA_ARCHIVO (
  id_medida      INT NOT NULL,
  tipo_documento ENUM('resolucion_director') NOT NULL,
  nombre_archivo VARCHAR(255) NOT NULL,
  mime_type      VARCHAR(100) NOT NULL,
  peso_bytes     INT NOT NULL,
  contenido      LONGBLOB NOT NULL,
  id_usuario     INT NULL,
  fecha_subida   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_medida),
  CONSTRAINT fk_md_archivo_medida FOREIGN KEY (id_medida)
    REFERENCES MEDIDA_DISCIPLINARIA (id_medida) ON DELETE CASCADE,
  CONSTRAINT fk_md_archivo_usuario FOREIGN KEY (id_usuario)
    REFERENCES USUARIO (id_usuario) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 5. El evento de bitácora al subir ese documento.
ALTER TABLE PROTOCOLO_ACTIVADO_EVENTO MODIFY tipo_evento ENUM('activacion','inicio_paso','completado_paso','omitido_paso','transicion','vencimiento','cierre','anulacion','nota','medida_proteccion_aplicada','medida_proteccion_editada','medida_proteccion_finalizada','medida_proteccion_vencida','informe_expulsion_emitido','expulsion_resuelta','expediente_exportado','involucrado_agregado','involucrado_editado','gestion_involucrado','suspension_cautelar_aplicada','suspension_cautelar_editada','suspension_cautelar_reconsiderada','suspension_cautelar_resuelta','medida_disciplinaria_aplicada','medida_disciplinaria_cumplida','condicionalidad_por_revisar','seguimiento_registrado','suspension_cautelar_documento','plazo_investigacion_vencido','relato_decision','relato_acogido','relato_editado','acceso_otorgado','acceso_retirado','relato_asignado','sin_medida','medida_documento') NOT NULL;

-- 6. Las medidas de protección vigentes de pasos anteriores que se decidió
--    MANTENER en la tarjeta. La medida no cambia de paso (sigue constando dónde
--    se adoptó); acá queda que en este paso se revisó y se mantiene, y cuenta
--    como la medida de esa persona. Si después se concluye, deja de contar.
CREATE TABLE PROTOCOLO_ACTIVADO_MEDIDA_MANTENIDA (
  id_activado_paso     INT NOT NULL,
  id_medida_proteccion INT NOT NULL,
  id_usuario           INT NULL,
  fecha_registro       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_activado_paso, id_medida_proteccion),
  KEY idx_mantenida_medida (id_medida_proteccion),
  CONSTRAINT fk_mantenida_paso FOREIGN KEY (id_activado_paso)
    REFERENCES PROTOCOLO_ACTIVADO_PASO (id_activado_paso) ON DELETE CASCADE,
  CONSTRAINT fk_mantenida_medida FOREIGN KEY (id_medida_proteccion)
    REFERENCES MEDIDA_PROTECCION (id_medida_proteccion) ON DELETE CASCADE,
  CONSTRAINT fk_mantenida_usuario FOREIGN KEY (id_usuario)
    REFERENCES USUARIO (id_usuario) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 7. El evento de bitácora al mantener (o dejar de mantener) una de esas medidas.
ALTER TABLE PROTOCOLO_ACTIVADO_EVENTO MODIFY tipo_evento ENUM('activacion','inicio_paso','completado_paso','omitido_paso','transicion','vencimiento','cierre','anulacion','nota','medida_proteccion_aplicada','medida_proteccion_editada','medida_proteccion_finalizada','medida_proteccion_vencida','informe_expulsion_emitido','expulsion_resuelta','expediente_exportado','involucrado_agregado','involucrado_editado','gestion_involucrado','suspension_cautelar_aplicada','suspension_cautelar_editada','suspension_cautelar_reconsiderada','suspension_cautelar_resuelta','medida_disciplinaria_aplicada','medida_disciplinaria_cumplida','condicionalidad_por_revisar','seguimiento_registrado','suspension_cautelar_documento','plazo_investigacion_vencido','relato_decision','relato_acogido','relato_editado','acceso_otorgado','acceso_retirado','relato_asignado','sin_medida','medida_documento','medida_mantenida') NOT NULL;
