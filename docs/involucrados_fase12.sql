-- ═══════════════════════════════════════════════════════════════════════════
-- Fase 12 — Involucrados del caso y pasos por persona
-- Aplicado 2026-08-27. Ver PLAN-LEY-PROTOCOLOS.md § Fase 12.
--
-- Por qué: hoy un caso se instruye contra nadie. Los involucrados viven en
-- REGISTRO_ESTUDIANTE (colgando del registro, no de la activación) y el
-- protocolo corre una sola vez para todos, pero el debido proceso es
-- individual: si hay dos estudiantes señalados y uno apela, el otro no; cada
-- apoderado se notifica por separado y cada plazo corre por su cuenta.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. El rol deja de ser texto libre y deja de prejuzgar ──────────────────
--
-- Dos razones distintas. Técnica: el rol pasa a decidir a qué involucrados se
-- les materializa un paso, así que deja de ser una etiqueta y pasa a ser una
-- llave — 'víctima' con y sin tilde serían dos roles y el paso no se crearía.
-- Legal: llamar "agresor" a un estudiante AL INICIO del protocolo es la
-- calificación que el establecimiento no puede hacer antes de investigar.

UPDATE REGISTRO_ESTUDIANTE SET rol_en_incidente = 'afectado'
  WHERE rol_en_incidente IN ('víctima', 'victima', 'afectado');
UPDATE REGISTRO_ESTUDIANTE SET rol_en_incidente = 'senalado'
  WHERE rol_en_incidente IN ('agresor', 'señalado', 'senalado', 'denunciado');
UPDATE REGISTRO_ESTUDIANTE SET rol_en_incidente = 'testigo'
  WHERE rol_en_incidente NOT IN ('afectado', 'senalado', 'denunciante');

ALTER TABLE REGISTRO_ESTUDIANTE
  MODIFY rol_en_incidente ENUM('afectado', 'senalado', 'testigo', 'denunciante')
    NOT NULL DEFAULT 'afectado';

-- ─── 2. Involucrados congelados en la activación ────────────────────────────
--
-- El nombre se copia aunque haya FK, mismo criterio que nombre_protocolo y
-- version_protocolo: el expediente se conserva 24 meses y el estudiante puede
-- egresar. Un expediente cuyo texto depende de un join vivo no acredita nada.
--
-- Admite adultos porque el catálogo tiene el protocolo de violencia entre
-- adultos de la comunidad educativa, donde no hay ningún estudiante. El
-- 'externo' (apoderado, tercero) va solo por nombre y RUT: no existe tabla de
-- apoderados en el sistema.

CREATE TABLE PROTOCOLO_ACTIVADO_INVOLUCRADO (
  id_involucrado        INT NOT NULL AUTO_INCREMENT,
  id_protocolo_activado INT NOT NULL,
  id_establecimiento    INT NOT NULL,
  tipo_persona          ENUM('estudiante', 'funcionario', 'externo') NOT NULL,
  id_estudiante         INT DEFAULT NULL,
  id_usuario            INT DEFAULT NULL,
  nombre                VARCHAR(150) NOT NULL,  -- snapshot al incorporarlo
  rut                   VARCHAR(15)  DEFAULT NULL,
  curso                 VARCHAR(60)  DEFAULT NULL,
  rol                   ENUM('afectado', 'senalado', 'testigo', 'denunciante') NOT NULL,
  -- Un involucrado puede incorporarse a mitad del caso (aparece un cuarto
  -- participante en una entrevista): se guarda cuándo, porque sus pasos
  -- pendientes se materializan desde esa fecha y los ya cumplidos no.
  fecha_incorporacion   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  id_usuario_registro   INT DEFAULT NULL,
  PRIMARY KEY (id_involucrado),
  KEY idx_pai_activado (id_protocolo_activado),
  KEY idx_pai_estudiante (id_estudiante),
  -- Un involucrado, un rol por caso. Si cambia de rol durante la
  -- investigación se actualiza la fila y el cambio queda en la bitácora.
  UNIQUE KEY uq_pai_caso_estudiante (id_protocolo_activado, id_estudiante),
  UNIQUE KEY uq_pai_caso_usuario (id_protocolo_activado, id_usuario),
  CONSTRAINT fk_pai_activado FOREIGN KEY (id_protocolo_activado)
    REFERENCES PROTOCOLO_ACTIVADO (id_protocolo_activado) ON DELETE CASCADE,
  CONSTRAINT fk_pai_estab FOREIGN KEY (id_establecimiento)
    REFERENCES ESTABLECIMIENTO (id_establecimiento) ON DELETE RESTRICT,
  -- SET NULL y no CASCADE: si el estudiante se elimina, el involucrado sigue
  -- existiendo con su nombre congelado. Borrarlo del expediente sería borrar
  -- contra quién se instruyó.
  CONSTRAINT fk_pai_estudiante FOREIGN KEY (id_estudiante)
    REFERENCES ESTUDIANTE (id_estudiante) ON DELETE SET NULL,
  CONSTRAINT fk_pai_usuario FOREIGN KEY (id_usuario)
    REFERENCES USUARIO (id_usuario) ON DELETE SET NULL,
  CONSTRAINT fk_pai_usuario_reg FOREIGN KEY (id_usuario_registro)
    REFERENCES USUARIO (id_usuario) ON DELETE SET NULL
);

-- ─── 3. Pasos por involucrado, en los tres niveles del grafo ────────────────
--
-- 'por_involucrado_rol' NULL = paso del caso (se hace una vez). Con un rol, el
-- paso se cumple una vez POR CADA involucrado con ese rol.
--
-- El paso sigue siendo UN nodo del grafo. Materializarlo como N nodos rompería
-- el motor, que es de un solo token (PROTOCOLO_ACTIVADO.id_paso_actual es uno
-- y elegirTransicion devuelve un destino): con tres copias en paralelo, la
-- primera en completarse arrastraría el caso al paso siguiente. Lo que se
-- multiplica son filas hijas de cumplimiento (tabla del punto 4).
--
-- 'requiere_notificacion': el paso no está completo hasta que conste que se
-- notificó a la persona. Lo traen la notificación al apoderado y todo paso que
-- entregue un documento.
--
-- RENOMBRADO 2026-09-01 (antes 'requiere_acuse'): no se le pide firma a la
-- persona. La Superintendencia exige constancia, no firma — la fecha y la vía
-- acreditan igual que un papel firmado, y pedir la firma solo conseguía que no
-- se registrara nada. Las dos únicas actuaciones que sí exigen firma son la
-- expulsión y la cancelación de matrícula, que van por INFORME_EXPULSION con la
-- firma de los tres integrantes de la comisión. Ver PLAN-ADECUACION-LEY-21809.md
-- sección 7.

ALTER TABLE CATALOGO_PROTOCOLO_PASO
  ADD COLUMN por_involucrado_rol ENUM('afectado', 'senalado', 'testigo', 'denunciante', 'todos')
    DEFAULT NULL AFTER tipo_paso,
  ADD COLUMN requiere_notificacion TINYINT(1) NOT NULL DEFAULT 0 AFTER por_involucrado_rol;

ALTER TABLE PROTOCOLO_ESTABLECIMIENTO_PASO
  ADD COLUMN por_involucrado_rol ENUM('afectado', 'senalado', 'testigo', 'denunciante', 'todos')
    DEFAULT NULL AFTER tipo_paso,
  ADD COLUMN requiere_notificacion TINYINT(1) NOT NULL DEFAULT 0 AFTER por_involucrado_rol;

ALTER TABLE PROTOCOLO_ACTIVADO_PASO
  ADD COLUMN por_involucrado_rol ENUM('afectado', 'senalado', 'testigo', 'denunciante', 'todos')
    DEFAULT NULL AFTER tipo_paso,
  ADD COLUMN requiere_notificacion TINYINT(1) NOT NULL DEFAULT 0 AFTER por_involucrado_rol;

-- ─── 4. Cumplimiento de un paso para cada involucrado ───────────────────────
--
-- Una fila por (paso, involucrado). El paso del grafo avanza igual que
-- siempre; estas filas registran a quién se le cumplió y a quién falta.
--
-- Decisión de producto (2026-08-27): una fila pendiente NO detiene el
-- protocolo. Queda marcada en rojo con "falta notificar" hasta que se registre
-- la notificación. Es la misma decisión de la fase 11a para la constancia del
-- RICE, y por la misma razón: obligar la constancia para avanzar no la
-- consigue, consigue que marquen el paso como hecho para destrabar el caso. Un
-- apoderado inubicable no puede detener la investigación de los otros dos
-- involucrados. La garantía se conserva en el cierre: cerrar con notificaciones
-- pendientes exige motivo, igual que cerrar sin llegar al paso final.

CREATE TABLE PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO (
  id_paso_involucrado INT NOT NULL AUTO_INCREMENT,
  id_activado_paso    INT NOT NULL,
  id_involucrado      INT NOT NULL,
  estado              ENUM('pendiente', 'cumplido', 'no_aplica') NOT NULL DEFAULT 'pendiente',
  fecha_cumplido      DATETIME DEFAULT NULL,
  -- La fecha real del hecho, que casi nunca es la de digitación: la entrevista
  -- fue el martes y se registra el jueves. Sin esto el sistema informa como
  -- atrasado algo que se hizo a tiempo.
  fecha_gestion       DATE     DEFAULT NULL,
  observacion         VARCHAR(500) DEFAULT NULL,
  -- Cuándo y por qué vía se le notificó. No hay firma de la persona: la
  -- constancia es esto (renombradas 2026-09-01 desde fecha_acuse/medio_acuse).
  fecha_notificacion  DATETIME DEFAULT NULL,
  medio_notificacion  ENUM('presencial', 'correo', 'telefono', 'plataforma', 'carta')
                        DEFAULT NULL,
  id_usuario          INT DEFAULT NULL,
  fecha_registro      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_paso_involucrado),
  UNIQUE KEY uq_papi_paso_involucrado (id_activado_paso, id_involucrado),
  KEY idx_papi_involucrado (id_involucrado),
  KEY idx_papi_notificacion (estado, fecha_notificacion),  -- métrica de personas sin notificar
  CONSTRAINT fk_papi_paso FOREIGN KEY (id_activado_paso)
    REFERENCES PROTOCOLO_ACTIVADO_PASO (id_activado_paso) ON DELETE CASCADE,
  CONSTRAINT fk_papi_involucrado FOREIGN KEY (id_involucrado)
    REFERENCES PROTOCOLO_ACTIVADO_INVOLUCRADO (id_involucrado) ON DELETE CASCADE,
  CONSTRAINT fk_papi_usuario FOREIGN KEY (id_usuario)
    REFERENCES USUARIO (id_usuario) ON DELETE SET NULL
);

-- El binario del acuse va en tabla 1:1 aparte, como el resto de los archivos
-- del sistema (CONSTANCIA_RECEPCION_ARCHIVO, DOCUMENTO_INSTITUCIONAL_ARCHIVO):
-- así ningún listado de pasos arrastra megabytes.
CREATE TABLE PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO_ARCHIVO (
  id_paso_involucrado INT NOT NULL,
  nombre_archivo      VARCHAR(255) NOT NULL,
  mime_type           VARCHAR(100) NOT NULL,
  peso_bytes          INT NOT NULL,
  contenido           MEDIUMBLOB NOT NULL,
  fecha_subida        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_paso_involucrado),
  CONSTRAINT fk_papia_paso_inv FOREIGN KEY (id_paso_involucrado)
    REFERENCES PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO (id_paso_involucrado) ON DELETE CASCADE
);

-- ─── 5. El protocolo de violencia entre adultos no es de ámbito estudiante ──
--
-- Los 10 protocolos del catálogo quedaron como 'estudiante', así que
-- validarTechoLegal le aplicaba a este el techo de 2 meses del art. 16 E letra
-- g, que a un procedimiento contra un funcionario no le corresponde: va por el
-- Título V de la Ley 18.834 o la Ley 18.883, con sus propios plazos.

UPDATE CATALOGO_PROTOCOLOS_GENERICOS
  SET ambito = 'personal'
  WHERE nombre = 'Protocolo de violencia entre adultos de la comunidad educativa';

-- ─── 6. Tipos de evento de la bitácora que el código ya usaba ───────────────
--
-- BUG PREEXISTENTE, encontrado al implementar esta fase. El ENUM se quedó en
-- los 9 tipos originales, pero desde entonces seis funcionalidades escriben
-- tipos nuevos en la bitácora. Con STRICT_ALL_TABLES activo (lo está), ese
-- INSERT no es una advertencia sino un error, y como todos ocurren dentro de
-- la transacción de su operación, la operación completa se revierte:
--
--   medida_proteccion_aplicada     → registrar una medida de protección
--   medida_proteccion_finalizada   → finalizarla
--   medida_proteccion_vencida      → el job de vencimientos
--   informe_expulsion_emitido      → emitir el informe previo de expulsión
--   expulsion_resuelta             → la decisión del director
--   expediente_exportado           → exportar el expediente
--
-- Es decir: las fases 4, 6 y 7 estaban devolviendo 500 al guardar. Se agregan
-- junto con los tres tipos nuevos de esta fase.

ALTER TABLE PROTOCOLO_ACTIVADO_EVENTO
  MODIFY tipo_evento ENUM(
    'activacion', 'inicio_paso', 'completado_paso', 'omitido_paso',
    'transicion', 'vencimiento', 'cierre', 'anulacion', 'nota',
    'medida_proteccion_aplicada', 'medida_proteccion_finalizada',
    'medida_proteccion_vencida', 'informe_expulsion_emitido',
    'expulsion_resuelta', 'expediente_exportado',
    'involucrado_agregado', 'involucrado_editado', 'gestion_involucrado'
  ) NOT NULL;
