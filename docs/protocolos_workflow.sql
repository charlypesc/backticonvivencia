-- ============================================================================
-- Motor de protocolos configurable (workflow engine) — 2026-08-26
--
-- Tres niveles, según el documento técnico:
--   A. Plantilla  — catálogo global, edita solo el ADMIN.
--   B. Espejo     — copia del grafo por establecimiento; se crea SOLO cuando el
--                   colegio personaliza, no al adoptar. La existencia de filas
--                   para un id_protocolo_establecimiento ES el flag de
--                   "personalizado": si hay, la activación materializa desde
--                   ahí; si no, desde el catálogo global.
--   C. Ejecución  — copia congelada del grafo para un caso concreto. El texto
--                   se hereda en vivo (COALESCE), la estructura no: un caso
--                   abierto nunca cambia de reglas a mitad de camino.
--
-- id_establecimiento va denormalizado en las tablas de ejecución: derivar el
-- tenant por join en cadena (registro -> usuario -> establecimiento) es frágil
-- cuando un usuario cambia de colegio, y caro cuando hay millones de filas.
-- ============================================================================


-- ============================================================================
-- A. PLANTILLA (catálogo global)
-- ============================================================================

CREATE TABLE CATALOGO_PROTOCOLO_PASO (
  id_paso          INT NOT NULL AUTO_INCREMENT,
  id_protocolo     INT NOT NULL,
  nombre           VARCHAR(150) NOT NULL,
  descripcion      TEXT,
  tipo_paso        ENUM('informativo','formulario','adjunto',
                        'aprobacion','notificacion_externa')
                     NOT NULL DEFAULT 'informativo',
  plazo_valor      INT DEFAULT NULL,
  plazo_unidad     ENUM('horas','dias_habiles','dias_corridos') DEFAULT NULL,
  accion_al_vencer ENUM('notificar','escalar','marcar_alerta') DEFAULT 'notificar',
  es_paso_inicial  TINYINT(1) NOT NULL DEFAULT 0,
  es_paso_final    TINYINT(1) NOT NULL DEFAULT 0,
  orden_visual     INT DEFAULT 0,
  PRIMARY KEY (id_paso),
  KEY idx_paso_protocolo (id_protocolo),
  CONSTRAINT fk_paso_protocolo FOREIGN KEY (id_protocolo)
    REFERENCES CATALOGO_PROTOCOLOS_GENERICOS (id_protocolo) ON DELETE CASCADE
);

-- id_protocolo va denormalizado para poder validar en el controller que origen
-- y destino pertenecen al mismo protocolo sin dos joins extra por transición.
CREATE TABLE CATALOGO_PROTOCOLO_TRANSICION (
  id_transicion   INT NOT NULL AUTO_INCREMENT,
  id_protocolo    INT NOT NULL,
  id_paso_origen  INT NOT NULL,
  id_paso_destino INT NOT NULL,
  condicion       VARCHAR(255) DEFAULT NULL,  -- 'campo=valor' / 'campo!=valor'; NULL = incondicional
  etiqueta        VARCHAR(150) DEFAULT NULL,
  es_default      TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id_transicion),
  KEY idx_trans_protocolo (id_protocolo),
  KEY idx_trans_origen (id_paso_origen),
  KEY idx_trans_destino (id_paso_destino),
  CONSTRAINT fk_trans_protocolo FOREIGN KEY (id_protocolo)
    REFERENCES CATALOGO_PROTOCOLOS_GENERICOS (id_protocolo) ON DELETE CASCADE,
  CONSTRAINT fk_trans_origen FOREIGN KEY (id_paso_origen)
    REFERENCES CATALOGO_PROTOCOLO_PASO (id_paso) ON DELETE CASCADE,
  CONSTRAINT fk_trans_destino FOREIGN KEY (id_paso_destino)
    REFERENCES CATALOGO_PROTOCOLO_PASO (id_paso) ON DELETE CASCADE
);

CREATE TABLE CATALOGO_PROTOCOLO_PASO_ROL (
  id_paso            INT NOT NULL,
  rol_id             INT NOT NULL,
  tipo_participacion ENUM('ejecutor','aprobador','notificado')
                       NOT NULL DEFAULT 'ejecutor',
  PRIMARY KEY (id_paso, rol_id, tipo_participacion),
  KEY idx_pasorol_rol (rol_id),
  CONSTRAINT fk_pasorol_paso FOREIGN KEY (id_paso)
    REFERENCES CATALOGO_PROTOCOLO_PASO (id_paso) ON DELETE CASCADE,
  CONSTRAINT fk_pasorol_rol FOREIGN KEY (rol_id)
    REFERENCES ROLES (rol_id) ON DELETE RESTRICT
);

-- Schema de los campos que llena el usuario al completar el paso. `datos_salida`
-- no es JSON libre justamente por esta tabla: las condiciones de transición
-- evalúan contra `codigo`, así que el conjunto de claves tiene que ser estable
-- y validable al guardar la transición, no en runtime.
CREATE TABLE CATALOGO_PROTOCOLO_PASO_CAMPO (
  id_campo       INT NOT NULL AUTO_INCREMENT,
  id_paso        INT NOT NULL,
  codigo         VARCHAR(50) NOT NULL,   -- 'hubo_violencia_fisica' (lo que usa la condición)
  etiqueta       VARCHAR(150) NOT NULL,
  tipo_campo     ENUM('texto','numero','fecha','seleccion','booleano') NOT NULL,
  opciones       JSON DEFAULT NULL,      -- solo 'seleccion': ["leve","grave","gravisima"]
  es_obligatorio TINYINT(1) NOT NULL DEFAULT 0,
  orden          INT DEFAULT 0,
  PRIMARY KEY (id_campo),
  UNIQUE KEY uk_campo_paso (id_paso, codigo),
  KEY idx_campo_paso (id_paso),
  CONSTRAINT fk_campo_paso FOREIGN KEY (id_paso)
    REFERENCES CATALOGO_PROTOCOLO_PASO (id_paso) ON DELETE CASCADE
);


-- ============================================================================
-- B. ESPEJO POR ESTABLECIMIENTO
--
-- Tablas separadas y no las de catálogo con id_establecimiento nullable: un
-- UNIQUE que incluye una columna NULL no restringe nada en MySQL (el problema
-- que ya arrastra ROLES), y obligaría a colgar un `WHERE id_establecimiento IS
-- NULL` de cada consulta del catálogo global.
-- ============================================================================

CREATE TABLE PROTOCOLO_ESTABLECIMIENTO_PASO (
  id_paso_estab                INT NOT NULL AUTO_INCREMENT,
  id_protocolo_establecimiento INT NOT NULL,
  id_paso_origen_catalogo      INT DEFAULT NULL,  -- traza a la plantilla clonada; informativo
  nombre           VARCHAR(150) NOT NULL,
  descripcion      TEXT,
  tipo_paso        ENUM('informativo','formulario','adjunto',
                        'aprobacion','notificacion_externa')
                     NOT NULL DEFAULT 'informativo',
  plazo_valor      INT DEFAULT NULL,
  plazo_unidad     ENUM('horas','dias_habiles','dias_corridos') DEFAULT NULL,
  accion_al_vencer ENUM('notificar','escalar','marcar_alerta') DEFAULT 'notificar',
  es_paso_inicial  TINYINT(1) NOT NULL DEFAULT 0,
  es_paso_final    TINYINT(1) NOT NULL DEFAULT 0,
  orden_visual     INT DEFAULT 0,
  PRIMARY KEY (id_paso_estab),
  KEY idx_pep_protoest (id_protocolo_establecimiento),
  CONSTRAINT fk_pep_protoest FOREIGN KEY (id_protocolo_establecimiento)
    REFERENCES PROTOCOLO_ESTABLECIMIENTO (id_protocolo_establecimiento) ON DELETE CASCADE,
  CONSTRAINT fk_pep_catalogo FOREIGN KEY (id_paso_origen_catalogo)
    REFERENCES CATALOGO_PROTOCOLO_PASO (id_paso) ON DELETE SET NULL
);

CREATE TABLE PROTOCOLO_ESTABLECIMIENTO_TRANSICION (
  id_transicion_estab          INT NOT NULL AUTO_INCREMENT,
  id_protocolo_establecimiento INT NOT NULL,
  id_paso_origen               INT NOT NULL,
  id_paso_destino              INT NOT NULL,
  condicion                    VARCHAR(255) DEFAULT NULL,
  etiqueta                     VARCHAR(150) DEFAULT NULL,
  es_default                   TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id_transicion_estab),
  KEY idx_pet_protoest (id_protocolo_establecimiento),
  KEY idx_pet_origen (id_paso_origen),
  KEY idx_pet_destino (id_paso_destino),
  CONSTRAINT fk_pet_protoest FOREIGN KEY (id_protocolo_establecimiento)
    REFERENCES PROTOCOLO_ESTABLECIMIENTO (id_protocolo_establecimiento) ON DELETE CASCADE,
  CONSTRAINT fk_pet_origen FOREIGN KEY (id_paso_origen)
    REFERENCES PROTOCOLO_ESTABLECIMIENTO_PASO (id_paso_estab) ON DELETE CASCADE,
  CONSTRAINT fk_pet_destino FOREIGN KEY (id_paso_destino)
    REFERENCES PROTOCOLO_ESTABLECIMIENTO_PASO (id_paso_estab) ON DELETE CASCADE
);

CREATE TABLE PROTOCOLO_ESTABLECIMIENTO_PASO_ROL (
  id_paso_estab      INT NOT NULL,
  rol_id             INT NOT NULL,
  tipo_participacion ENUM('ejecutor','aprobador','notificado')
                       NOT NULL DEFAULT 'ejecutor',
  PRIMARY KEY (id_paso_estab, rol_id, tipo_participacion),
  KEY idx_peprol_rol (rol_id),
  CONSTRAINT fk_peprol_paso FOREIGN KEY (id_paso_estab)
    REFERENCES PROTOCOLO_ESTABLECIMIENTO_PASO (id_paso_estab) ON DELETE CASCADE,
  CONSTRAINT fk_peprol_rol FOREIGN KEY (rol_id)
    REFERENCES ROLES (rol_id) ON DELETE RESTRICT
);

CREATE TABLE PROTOCOLO_ESTABLECIMIENTO_PASO_CAMPO (
  id_campo_estab INT NOT NULL AUTO_INCREMENT,
  id_paso_estab  INT NOT NULL,
  codigo         VARCHAR(50) NOT NULL,
  etiqueta       VARCHAR(150) NOT NULL,
  tipo_campo     ENUM('texto','numero','fecha','seleccion','booleano') NOT NULL,
  opciones       JSON DEFAULT NULL,
  es_obligatorio TINYINT(1) NOT NULL DEFAULT 0,
  orden          INT DEFAULT 0,
  PRIMARY KEY (id_campo_estab),
  UNIQUE KEY uk_campoestab_paso (id_paso_estab, codigo),
  KEY idx_campoestab_paso (id_paso_estab),
  CONSTRAINT fk_campoestab_paso FOREIGN KEY (id_paso_estab)
    REFERENCES PROTOCOLO_ESTABLECIMIENTO_PASO (id_paso_estab) ON DELETE CASCADE
);


-- ============================================================================
-- C. EJECUCIÓN
-- ============================================================================

-- PROTOCOLO_ACTIVADO ya existe (era solo un timestamp): se expande con ALTER.
-- Las columnas NOT NULL entran primero como nullable, se rellenan y recién ahí
-- se endurecen; si no, el ALTER falla con la fila que ya hay.
ALTER TABLE PROTOCOLO_ACTIVADO
  ADD COLUMN id_establecimiento INT NULL AFTER id_registro,
  ADD COLUMN estado ENUM('activo','cerrado','anulado') NOT NULL DEFAULT 'activo' AFTER id_establecimiento,
  ADD COLUMN id_paso_actual INT DEFAULT NULL AFTER estado,   -- FK lógica a PROTOCOLO_ACTIVADO_PASO (dependencia circular)
  ADD COLUMN id_usuario_activo INT NULL AFTER id_paso_actual,
  ADD COLUMN fecha_cierre DATETIME DEFAULT NULL AFTER fecha_activacion;

UPDATE PROTOCOLO_ACTIVADO pa
  JOIN PROTOCOLO_ESTABLECIMIENTO pe
    ON pa.id_protocolo_establecimiento = pe.id_protocolo_establecimiento
  SET pa.id_establecimiento = pe.id_establecimiento
  WHERE pa.id_establecimiento IS NULL;

-- El autor del registro es el mejor dato disponible para las activaciones
-- previas a esta columna: antes no se guardaba quién activó.
UPDATE PROTOCOLO_ACTIVADO pa
  JOIN REGISTRO_CONVIVENCIA r ON pa.id_registro = r.id_registro
  SET pa.id_usuario_activo = r.id_usuario
  WHERE pa.id_usuario_activo IS NULL;

ALTER TABLE PROTOCOLO_ACTIVADO
  MODIFY COLUMN id_establecimiento INT NOT NULL,
  MODIFY COLUMN id_usuario_activo INT NOT NULL;

ALTER TABLE PROTOCOLO_ACTIVADO
  ADD UNIQUE KEY uk_activo_registro (id_registro, id_protocolo_establecimiento),
  ADD KEY idx_pa_estab_estado (id_establecimiento, estado),
  ADD CONSTRAINT fk_pa_estab FOREIGN KEY (id_establecimiento)
    REFERENCES ESTABLECIMIENTO (id_establecimiento) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pa_usuario FOREIGN KEY (id_usuario_activo)
    REFERENCES USUARIO (id_usuario) ON DELETE RESTRICT;

-- Copia congelada de cada paso del grafo para este caso.
CREATE TABLE PROTOCOLO_ACTIVADO_PASO (
  id_activado_paso        INT NOT NULL AUTO_INCREMENT,
  id_protocolo_activado   INT NOT NULL,
  id_establecimiento      INT NOT NULL,
  id_paso_origen_catalogo INT DEFAULT NULL,  -- traza a la plantilla; sin FK a propósito:
  id_paso_origen_estab    INT DEFAULT NULL,  -- la plantilla puede borrarse sin tocar casos vivos
  nombre           VARCHAR(150) NOT NULL,
  descripcion      TEXT,
  tipo_paso        ENUM('informativo','formulario','adjunto',
                        'aprobacion','notificacion_externa') NOT NULL,
  estado           ENUM('pendiente','en_curso','completado','omitido','vencido')
                     NOT NULL DEFAULT 'pendiente',
  es_paso_inicial  TINYINT(1) NOT NULL DEFAULT 0,
  es_paso_final    TINYINT(1) NOT NULL DEFAULT 0,
  plazo_valor      INT DEFAULT NULL,
  plazo_unidad     ENUM('horas','dias_habiles','dias_corridos') DEFAULT NULL,
  accion_al_vencer ENUM('notificar','escalar','marcar_alerta') DEFAULT 'notificar',
  fecha_inicio        DATETIME DEFAULT NULL,  -- cuando pasó a en_curso
  fecha_limite        DATETIME DEFAULT NULL,  -- calculada al iniciar
  fecha_completado    DATETIME DEFAULT NULL,
  id_usuario_completo INT DEFAULT NULL,
  datos_salida        JSON DEFAULT NULL,      -- respuestas de los campos del paso
  PRIMARY KEY (id_activado_paso),
  KEY idx_pap_activado (id_protocolo_activado),
  KEY idx_pap_estab_estado (id_establecimiento, estado),
  KEY idx_pap_limite (fecha_limite, estado),  -- job de vencimientos
  KEY idx_pap_usuario (id_usuario_completo),
  CONSTRAINT fk_pap_activado FOREIGN KEY (id_protocolo_activado)
    REFERENCES PROTOCOLO_ACTIVADO (id_protocolo_activado) ON DELETE CASCADE,
  CONSTRAINT fk_pap_estab FOREIGN KEY (id_establecimiento)
    REFERENCES ESTABLECIMIENTO (id_establecimiento) ON DELETE RESTRICT,
  CONSTRAINT fk_pap_usuario FOREIGN KEY (id_usuario_completo)
    REFERENCES USUARIO (id_usuario) ON DELETE SET NULL
);

CREATE TABLE PROTOCOLO_ACTIVADO_TRANSICION (
  id_activado_transicion INT NOT NULL AUTO_INCREMENT,
  id_protocolo_activado  INT NOT NULL,
  id_paso_origen         INT NOT NULL,
  id_paso_destino        INT NOT NULL,
  condicion              VARCHAR(255) DEFAULT NULL,
  etiqueta               VARCHAR(150) DEFAULT NULL,
  es_default             TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id_activado_transicion),
  KEY idx_pat_activado (id_protocolo_activado),
  KEY idx_pat_origen (id_paso_origen),
  KEY idx_pat_destino (id_paso_destino),
  CONSTRAINT fk_pat_activado FOREIGN KEY (id_protocolo_activado)
    REFERENCES PROTOCOLO_ACTIVADO (id_protocolo_activado) ON DELETE CASCADE,
  CONSTRAINT fk_pat_origen FOREIGN KEY (id_paso_origen)
    REFERENCES PROTOCOLO_ACTIVADO_PASO (id_activado_paso) ON DELETE CASCADE,
  CONSTRAINT fk_pat_destino FOREIGN KEY (id_paso_destino)
    REFERENCES PROTOCOLO_ACTIVADO_PASO (id_activado_paso) ON DELETE CASCADE
);

CREATE TABLE PROTOCOLO_ACTIVADO_PASO_ROL (
  id_activado_paso   INT NOT NULL,
  rol_id             INT NOT NULL,
  tipo_participacion ENUM('ejecutor','aprobador','notificado') NOT NULL DEFAULT 'ejecutor',
  PRIMARY KEY (id_activado_paso, rol_id, tipo_participacion),
  KEY idx_papr_rol (rol_id),
  CONSTRAINT fk_papr_paso FOREIGN KEY (id_activado_paso)
    REFERENCES PROTOCOLO_ACTIVADO_PASO (id_activado_paso) ON DELETE CASCADE,
  CONSTRAINT fk_papr_rol FOREIGN KEY (rol_id)
    REFERENCES ROLES (rol_id) ON DELETE RESTRICT
);

-- El schema de campos también se congela, como tabla y no como JSON dentro del
-- paso: validar `datos_salida` al completar es una consulta, y así la validación
-- corre igual que en la plantilla en vez de tener dos formatos distintos.
CREATE TABLE PROTOCOLO_ACTIVADO_PASO_CAMPO (
  id_campo_activado INT NOT NULL AUTO_INCREMENT,
  id_activado_paso  INT NOT NULL,
  codigo         VARCHAR(50) NOT NULL,
  etiqueta       VARCHAR(150) NOT NULL,
  tipo_campo     ENUM('texto','numero','fecha','seleccion','booleano') NOT NULL,
  opciones       JSON DEFAULT NULL,
  es_obligatorio TINYINT(1) NOT NULL DEFAULT 0,
  orden          INT DEFAULT 0,
  PRIMARY KEY (id_campo_activado),
  UNIQUE KEY uk_campoact_paso (id_activado_paso, codigo),
  CONSTRAINT fk_campoact_paso FOREIGN KEY (id_activado_paso)
    REFERENCES PROTOCOLO_ACTIVADO_PASO (id_activado_paso) ON DELETE CASCADE
);

-- Bitácora de eventos (auditoría Mineduc). Solo se inserta: no hay UPDATE ni
-- DELETE sobre esta tabla desde el código.
CREATE TABLE PROTOCOLO_ACTIVADO_EVENTO (
  id_evento             INT NOT NULL AUTO_INCREMENT,
  id_protocolo_activado INT NOT NULL,
  id_establecimiento    INT NOT NULL,
  id_activado_paso      INT DEFAULT NULL,
  tipo_evento           ENUM('activacion','inicio_paso','completado_paso','omitido_paso',
                             'transicion','vencimiento','cierre','anulacion','nota') NOT NULL,
  descripcion           TEXT,
  id_usuario            INT DEFAULT NULL,  -- NULL = evento del sistema (job de plazos)
  fecha                 DATETIME NOT NULL,
  PRIMARY KEY (id_evento),
  KEY idx_ev_activado (id_protocolo_activado),
  KEY idx_ev_estab (id_establecimiento),
  KEY idx_ev_paso (id_activado_paso),
  KEY idx_ev_usuario (id_usuario),
  CONSTRAINT fk_ev_activado FOREIGN KEY (id_protocolo_activado)
    REFERENCES PROTOCOLO_ACTIVADO (id_protocolo_activado) ON DELETE CASCADE,
  CONSTRAINT fk_ev_estab FOREIGN KEY (id_establecimiento)
    REFERENCES ESTABLECIMIENTO (id_establecimiento) ON DELETE RESTRICT,
  CONSTRAINT fk_ev_paso FOREIGN KEY (id_activado_paso)
    REFERENCES PROTOCOLO_ACTIVADO_PASO (id_activado_paso) ON DELETE SET NULL,
  CONSTRAINT fk_ev_usuario FOREIGN KEY (id_usuario)
    REFERENCES USUARIO (id_usuario) ON DELETE SET NULL
);
