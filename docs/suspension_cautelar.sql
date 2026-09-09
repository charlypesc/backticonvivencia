-- ============================================================================
-- Suspensión cautelar del art. 6 letra d) del DFL 2/1998
-- (VACÍO 1 de PLAN-ADECUACION-LEY-21809.md)
--
-- La suspensión CAUTELAR y la suspensión DE PROTECCIÓN (art. 16 E letra j, que
-- vive en MEDIDA_PROTECCION) son dos institutos distintos y se confunden con
-- facilidad. No comparten tabla a propósito: mezclarlas hace imposible auditar
-- cuál se aplicó, que es justamente lo que se pregunta en una fiscalización.
--
--                  Cautelar (art. 6 d)          De protección (art. 16 E j)
--   Finalidad      mientras dura el             resguardar a la persona
--                  procedimiento sancionatorio  afectada
--   La decreta     el director                  el establecimiento
--   Tope           10 días hábiles para         15 días hábiles de duración
--                  RESOLVER, desde la
--                  notificación de la medida
--   Reconsideración 5 días desde la             —
--                  notificación, previa
--                  consulta al Consejo de
--                  Profesores por escrito
--   Efecto de       amplía la suspensión        —
--   reconsiderar    hasta culminar la
--                   tramitación
--
-- Aplicar paso a paso, abortando ante el primer error.
-- Backup previo: scratchpad/backup-suspension-cautelar.sql
-- ============================================================================


-- ── PASO 1 ──────────────────────────────────────────────────────────────────
-- Tabla nueva.
--
-- Cuelga de PROTOCOLO_ACTIVADO y no de REGISTRO_CONVIVENCIA (como sugería la
-- ficha original) porque el plazo de 10 días hábiles es para RESOLVER el
-- procedimiento sancionatorio, y en este sistema ese procedimiento es el caso.
-- Colgada del registro, el plazo no tendría nada que lo cierre.
--
-- Espeja a MEDIDA_PROTECCION en el par (id_estudiante, id_involucrado): la ley
-- faculta a suspender "a los alumnos Y miembros de la comunidad escolar", así
-- que el sujeto no siempre es un estudiante.

CREATE TABLE SUSPENSION_CAUTELAR (
  id_suspension_cautelar   int          NOT NULL AUTO_INCREMENT,
  id_protocolo_activado    int          NOT NULL,
  id_establecimiento       int          NOT NULL,
  id_estudiante            int          DEFAULT NULL,
  id_involucrado           int          DEFAULT NULL,

  -- "El director deberá notificar la decisión de suspender al alumno, JUNTO A
  -- SUS FUNDAMENTOS". Sin esto la medida no se sostiene, por eso NOT NULL.
  fundamento               text         NOT NULL,

  -- La notificación arranca los dos plazos. La ley exige que sea POR ESCRITO,
  -- por eso el enum de medio_notificacion va acá SIN 'telefono': una llamada no
  -- acredita notificación escrita.
  fecha_notificacion       datetime     NOT NULL,
  medio_notificacion       enum('presencial','correo','plataforma','carta') NOT NULL,

  -- Calculada, no digitada: 10 días hábiles desde fecha_notificacion,
  -- descontando feriados de la región del establecimiento.
  fecha_limite_resolucion  date         NOT NULL,
  fecha_resolucion         date         DEFAULT NULL,

  -- 'ampliada_por_reconsideracion': la ley dice que interponerla "ampliará el
  -- plazo de suspensión del alumno hasta culminar su tramitación". No borra
  -- fecha_limite_resolucion (queda como hecho histórico), pero mientras se
  -- tramita el caso no está en infracción.
  estado enum('vigente','resuelta','ampliada_por_reconsideracion','vencida')
                           NOT NULL DEFAULT 'vigente',

  -- ── Reconsideración ───────────────────────────────────────────────────────
  -- El texto legal dice "cinco días" a secas, dos líneas después de decir
  -- "diez días hábiles". Se computan en días HÁBILES por regla supletoria, no
  -- por criterio: Ley 19.880 art. 25 y el glosario de la Supereduc (entrada
  -- "Plazos") — "los plazos de días son de días hábiles, entendiéndose que son
  -- inhábiles los días sábados, domingos y festivos".
  --
  -- El dato es informativo igual: el sistema avisa si la reconsideración llegó
  -- fuera de plazo, pero nunca la rechaza sola. Rechazarla es un vicio de forma
  -- que se lleva puesta la resolución completa.
  fecha_limite_reconsideracion date      NOT NULL,
  fecha_reconsideracion        date      DEFAULT NULL,

  -- "quien resolverá previa consulta al Consejo de Profesores, el que deberá
  -- pronunciarse POR ESCRITO". Este campo es ese pronunciamiento.
  consejo_profesores_acta      text      DEFAULT NULL,
  fecha_consejo                date      DEFAULT NULL,
  resultado_reconsideracion    enum('acogida','rechazada') DEFAULT NULL,

  id_usuario               int          NOT NULL,
  fecha_registro           datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id_suspension_cautelar),
  KEY idx_sc_caso        (id_protocolo_activado),
  KEY idx_sc_estab       (id_establecimiento),
  -- El índice que sirve a la alerta de vencimiento del dashboard.
  KEY idx_sc_vigencia    (estado, fecha_limite_resolucion),
  KEY fk_sc_estudiante   (id_estudiante),
  KEY fk_sc_involucrado  (id_involucrado),
  KEY fk_sc_usuario      (id_usuario),

  CONSTRAINT fk_sc_caso        FOREIGN KEY (id_protocolo_activado)
    REFERENCES PROTOCOLO_ACTIVADO (id_protocolo_activado) ON DELETE RESTRICT,
  CONSTRAINT fk_sc_estab       FOREIGN KEY (id_establecimiento)
    REFERENCES ESTABLECIMIENTO (id_establecimiento),
  CONSTRAINT fk_sc_estudiante  FOREIGN KEY (id_estudiante)
    REFERENCES ESTUDIANTE (id_estudiante) ON DELETE SET NULL,
  CONSTRAINT fk_sc_involucrado FOREIGN KEY (id_involucrado)
    REFERENCES PROTOCOLO_ACTIVADO_INVOLUCRADO (id_involucrado) ON DELETE SET NULL,
  CONSTRAINT fk_sc_usuario     FOREIGN KEY (id_usuario)
    REFERENCES USUARIO (id_usuario)
);


-- ── PASO 2 ──────────────────────────────────────────────────────────────────
-- Bitácora del caso: sin estos tipos de evento la cautelar no deja rastro en la
-- línea de tiempo. Es un ALTER aditivo — los 18 valores previos van completos.

ALTER TABLE PROTOCOLO_ACTIVADO_EVENTO
  MODIFY tipo_evento enum(
    'activacion','inicio_paso','completado_paso','omitido_paso','transicion',
    'vencimiento','cierre','anulacion','nota',
    'medida_proteccion_aplicada','medida_proteccion_finalizada',
    'medida_proteccion_vencida','informe_expulsion_emitido',
    'expulsion_resuelta','expediente_exportado','involucrado_agregado',
    'involucrado_editado','gestion_involucrado',
    'suspension_cautelar_aplicada','suspension_cautelar_reconsiderada',
    'suspension_cautelar_resuelta'
  ) NOT NULL;


-- ── PASO 3 ──────────────────────────────────────────────────────────────────
-- Permisos nuevos. Los ids son fijos y tienen que coincidir con el enum de
-- src/constants/permisos.js: verificarPermisos() compara tabla contra código al
-- arrancar y se queja si difieren.

INSERT INTO PERMISOS (permiso_id, codigo, recurso, accion, descripcion) VALUES
  (110, 'suspension_cautelar.ver',                       'suspension_cautelar', 'ver',
   'Ver las suspensiones cautelares de un caso'),
  (111, 'suspension_cautelar.crear',                     'suspension_cautelar', 'crear',
   'Decretar una suspension cautelar (facultad del director, art. 6 letra d)'),
  (112, 'suspension_cautelar.registrar_reconsideracion', 'suspension_cautelar', 'registrar_reconsideracion',
   'Registrar la reconsideracion y el pronunciamiento del Consejo de Profesores'),
  (113, 'suspension_cautelar.resolver',                  'suspension_cautelar', 'resolver',
   'Resolver el procedimiento sancionatorio y cerrar la cautelar');


-- ── PASO 4 ──────────────────────────────────────────────────────────────────
-- Reparación aparte del VACÍO 1, hecha acá porque sin ella la cautelar nace
-- muerta igual que el resto.
--
-- Los permisos 93-109 (medidas de protección, informe de expulsión, expediente,
-- feriados, documentos institucionales, constancias) se crearon en PERMISOS
-- pero nunca se asignaron a ningún rol: ROL_PERMISOS llegaba hasta el id 92. O
-- sea, todas esas features estaban construidas y devolvían 403 a todo el mundo.
--
-- Criterio de asignación: donde la ley nombra al actor, se respeta (el director
-- decide la expulsión; la comisión de tres la elabora). Donde no, se espeja el
-- permiso análogo que el rol ya tenía.

INSERT INTO ROL_PERMISOS (rol_id, permiso_id) VALUES
  -- 1 Administrador del sistema: superusuario, recibe todo.
  (1,93),(1,94),(1,95),(1,96),(1,97),(1,98),(1,99),(1,100),(1,101),(1,102),
  (1,103),(1,104),(1,105),(1,106),(1,107),(1,108),(1,109),

  -- 93 tipo_falta.vincular_protocolo → quienes ya administran tipos de falta.
  (3,93),(5,93),

  -- 94-97 medida_proteccion: ven los que ven el caso; aplican y hacen
  -- seguimiento los que ya operan el protocolo (completar/cerrar pasos).
  (2,94),(3,94),(5,94),(15,94),(18,94),
  (3,95),(5,95),
  (3,96),(5,96),
  (3,97),(5,97),

  -- 98-99 medida_disciplinaria: mismo criterio.
  (2,98),(3,98),(5,98),(15,98),(18,98),
  (3,99),(5,99),

  -- 100-102 informe_expulsion. La comisión que la ley tasa es "profesor jefe
  -- del estudiante, coordinador de convivencia educativa y un integrante del
  -- equipo técnico pedagógico" → elaborar va a esos tres roles y a nadie más.
  -- Y "la decisión de expulsar sólo podrá ser adoptada por el director" →
  -- decidir va solo al Director.
  (2,100),(3,100),(5,100),
  (3,101),(17,101),(23,101),
  (2,102),

  -- 103-104 expediente: es la acreditación ante la Superintendencia.
  (2,103),(3,103),(5,103),
  (2,104),(3,104),

  -- 105 feriado.administrar: define los días hábiles de todos los plazos
  -- legales. Se queda en convivencia, que es quien responde por esos plazos.
  (3,105),

  -- 106-107 documento_institucional (RICE y Plan de Gestión).
  (2,106),(3,106),(5,106),(15,106),(18,106),
  (2,107),(3,107),

  -- 108-109 constancia de recepción del RICE.
  (2,108),(3,108),(5,108),
  (3,109),(15,109);


-- ── PASO 5 ──────────────────────────────────────────────────────────────────
-- Roles de los permisos nuevos.
--
-- resolver va SOLO al Director (más el admin del sistema): la ley lo obliga a
-- resolver el procedimiento previa consulta al Consejo de Profesores.
--
-- crear incluye además al Coordinador de convivencia (rol 3), por decisión
-- expresa del usuario (31-ago-2026), porque en la práctica del establecimiento
-- es quien carga la medida cuando el director no está.
-- OJO — la ley dice "el director tendrá la facultad de suspender, como medida
-- cautelar" (art. 6 letra d, DFL 2/1998): la facultad es nominativa del
-- director. El permiso acá solo habilita a registrarla en el sistema; el acto
-- notificado debe salir firmado por el director (o por quien lo subrogue
-- formalmente), o la medida queda expuesta en fiscalización por incompetencia
-- de quien la decretó.
--
-- registrar_reconsideracion incluye al Coordinador: la reconsideración se
-- presenta ante el director, pero transcribir el acta del Consejo de
-- Profesores es trabajo administrativo, no la decisión.

INSERT INTO ROL_PERMISOS (rol_id, permiso_id) VALUES
  (1,110),(2,110),(3,110),(5,110),(15,110),(18,110),
  (1,111),(2,111),(3,111),
  (1,112),(2,112),(3,112),
  (1,113),(2,113);
