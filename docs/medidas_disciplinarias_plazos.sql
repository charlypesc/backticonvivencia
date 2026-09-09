-- ============================================================================
-- Medidas disciplinarias con plazo, y la bandera del paso que las ordena
--
-- Por qué: una sanción entraba como `tipo_medida` VARCHAR de texto libre con una
-- sola fecha (`fecha_aplicacion`). "Suspensión de 3 días hábiles" quedaba escrita
-- en prosa: nada sabía cuándo volvía el estudiante, nada avisaba cuándo
-- correspondía reevaluar, y `resultado` / `fecha_resultado` — que el informe
-- previo de expulsión necesita "con indicación de los resultados obtenidos" —
-- quedaban vacíos porque nada los pedía a tiempo.
--
-- Las tres suspensiones del sistema escolar chileno son institutos distintos y
-- no comparten tabla a propósito:
--
--                   Sancionatoria           De protección        Cautelar
--   Fuente          Circular 482 p. 47      Ley 21.809 16 E j    DFL 2 art 6 d
--   Tope            5 días + 1 prórroga     15 días hábiles      10 d. para
--                   por igual plazo         de duración          RESOLVER
--   Requisito       peligro real para la    resguardar a la      procedimiento
--                   integridad              persona afectada     sancionatorio
--   Tabla           MEDIDA_DISCIPLINARIA    MEDIDA_PROTECCION    SUSPENSION_
--                   (esta migración)        (ya existía)         CAUTELAR
--
-- La expulsión y la cancelación de matrícula NO entran acá: van por
-- INFORME_EXPULSION, con su comisión de tres y sus plazos propios.
--
-- Aplicar paso a paso, abortando ante el primer error.
-- Backup previo: scratchpad/backup-medidas-fase-a.sql
-- ============================================================================


-- ── PASO 1 ──────────────────────────────────────────────────────────────────
-- Normalizar el texto libre antes de convertir la columna en ENUM: un valor
-- fuera del ENUM hace fallar el MODIFY con STRICT_ALL_TABLES (lo está).
--
-- 'Citacion al Apoderado' es la única fila que había, y entra al catálogo como
-- tipo propio en vez de aplanarse a 'otra': es una medida corriente en los RICE
-- y perder el dato para ganar un ENUM más corto no tiene sentido.

UPDATE MEDIDA_DISCIPLINARIA SET tipo_medida = 'citacion_apoderado'
  WHERE tipo_medida IN ('Citacion al Apoderado', 'Citación al Apoderado');

-- Red de seguridad para cualquier valor libre que quede sin mapear: 'otra' es
-- la verdad ("no se sabe qué tipo era"), no una atribución.
UPDATE MEDIDA_DISCIPLINARIA SET tipo_medida = 'otra'
  WHERE tipo_medida IS NULL OR tipo_medida NOT IN (
    'amonestacion', 'citacion_apoderado', 'medida_formativa', 'medida_reparatoria',
    'servicio_comunitario', 'derivacion', 'condicionalidad',
    'suspension', 'reduccion_jornada', 'separacion_temporal',
    'asistencia_solo_evaluaciones', 'otra');


-- ── PASO 2 ──────────────────────────────────────────────────────────────────
-- El tipo deja de ser texto libre porque de él dependen dos reglas que el
-- sistema tiene que poder aplicar sola: cuáles medidas tienen duración y cuál
-- exige revisión al final de cada semestre.
--
-- Los cuatro últimos antes de 'otra' son las "medidas excepcionales" de la
-- Circular 482 p. 47: solo proceden "si existe un peligro real para la
-- integridad física o psicológica de algún miembro de la comunidad educativa",
-- y son las que llevan días hábiles.

ALTER TABLE MEDIDA_DISCIPLINARIA
  MODIFY tipo_medida ENUM(
    'amonestacion', 'citacion_apoderado', 'medida_formativa', 'medida_reparatoria',
    'servicio_comunitario', 'derivacion', 'condicionalidad',
    'suspension', 'reduccion_jornada', 'separacion_temporal',
    'asistencia_solo_evaluaciones', 'otra'
  ) NOT NULL DEFAULT 'otra';


-- ── PASO 3 ──────────────────────────────────────────────────────────────────
-- El plazo.
--
-- `fecha_termino` es calculada, no digitada: días hábiles desde
-- `fecha_aplicacion` descontando los feriados de la región del establecimiento,
-- con el mismo `calcularFechaLimite` que usan los pasos y las medidas de
-- protección. Digitarla a mano es cómo se producen las suspensiones que en el
-- papel duran tres días y en el calendario cinco.
--
-- `fecha_revision` es para la condicionalidad de matrícula: la Circular 482
-- exige que "siempre debe ser revisada por el establecimiento al final de cada
-- semestre, independiente de la fecha en la cual se haya aplicado". Es la única
-- medida con una obligación de revisión periódica, y no tenía dónde vivir.
--
-- `fundamento` separado de `descripcion`: la descripción cuenta qué se aplicó,
-- el fundamento por qué correspondía. Para las medidas excepcionales la Circular
-- pide que estén "justificadas y debidamente acreditadas (...) ANTES de su
-- adopción", así que son dos datos distintos y uno de ellos es exigible.

ALTER TABLE MEDIDA_DISCIPLINARIA
  ADD COLUMN dias_habiles   INT  DEFAULT NULL AFTER tipo_medida,
  ADD COLUMN fundamento     TEXT DEFAULT NULL AFTER descripcion,
  ADD COLUMN fecha_termino  DATE DEFAULT NULL AFTER fecha_aplicacion,
  ADD COLUMN fecha_revision DATE DEFAULT NULL AFTER fecha_termino;


-- ── PASO 4 ──────────────────────────────────────────────────────────────────
-- La prórroga. "Podrá prorrogarse por una sola vez por el mismo plazo, por
-- causa justificada": se modela como una medida nueva que apunta a la original,
-- igual que `id_medida_sustituye` en MEDIDA_PROTECCION. Así la prórroga tiene su
-- propio fundamento y su propia fecha, que es lo que hay que acreditar.
--
-- El sistema ADVIERTE si es la segunda prórroga o si es por más días que la
-- original, pero no lo rechaza: el tope viene de una circular y no de la ley, y
-- bloquear el registro no consigue el cumplimiento, consigue que no se registre.

ALTER TABLE MEDIDA_DISCIPLINARIA
  ADD COLUMN es_prorroga          TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN id_medida_prorrogada INT DEFAULT NULL,
  ADD KEY idx_md_prorrogada (id_medida_prorrogada),
  ADD CONSTRAINT fk_md_prorrogada FOREIGN KEY (id_medida_prorrogada)
    REFERENCES MEDIDA_DISCIPLINARIA (id_medida) ON DELETE SET NULL;


-- ── PASO 5 ──────────────────────────────────────────────────────────────────
-- El estado, con los dos índices que le sirven al job de vencimientos y a las
-- tarjetas del dashboard.
--
-- 'cumplida' y 'vencida' NO son lo mismo, y es la diferencia con la medida de
-- protección: que una sanción llegue a su fecha de término significa que se
-- sirvió (cumplida), no que haya una infracción. Lo que vence es la revisión de
-- la condicionalidad que nadie hizo.
--
-- Las filas existentes quedan 'vigente' por el DEFAULT: hay que revisarlas a
-- mano, no adivinar si ya se cumplieron.

ALTER TABLE MEDIDA_DISCIPLINARIA
  ADD COLUMN estado ENUM('vigente', 'cumplida', 'vencida', 'revocada')
    NOT NULL DEFAULT 'vigente',
  ADD KEY idx_md_vigencia (estado, fecha_termino),
  ADD KEY idx_md_revision (estado, fecha_revision);


-- ── PASO 6 ──────────────────────────────────────────────────────────────────
-- La bandera del paso que ordena la medida, en los tres niveles del grafo.
--
-- Espeja `requiere_notificacion` de la fase 12 y funciona igual: el paso con
-- `requiere_medida` no está completo del todo hasta que conste la medida, pero
-- NO se bloquea el avance — queda marcado, y cerrar el caso con medidas sin
-- registrar exige motivo. Misma decisión y misma razón que la constancia de
-- notificación: obligar para avanzar no consigue el registro, consigue que se
-- marque el paso como hecho para destrabar el caso.
--
-- Se descartó un `tipo_paso` nuevo ('medida'): un paso que ordena una medida casi
-- siempre además tiene campos, y `tipo_paso` es excluyente. La bandera compone.

ALTER TABLE CATALOGO_PROTOCOLO_PASO
  ADD COLUMN requiere_medida TINYINT(1) NOT NULL DEFAULT 0 AFTER requiere_notificacion;

ALTER TABLE PROTOCOLO_ESTABLECIMIENTO_PASO
  ADD COLUMN requiere_medida TINYINT(1) NOT NULL DEFAULT 0 AFTER requiere_notificacion;

ALTER TABLE PROTOCOLO_ACTIVADO_PASO
  ADD COLUMN requiere_medida TINYINT(1) NOT NULL DEFAULT 0 AFTER requiere_notificacion;


-- ── PASO 7 ──────────────────────────────────────────────────────────────────
-- Tipos de evento de la bitácora que las medidas disciplinarias necesitan.
-- ALTER aditivo: los 23 valores previos van completos.
--
-- Ojo: la lista escrita originalmente acá omitía 'medida_proteccion_editada' y
-- 'suspension_cautelar_editada', que sí están en el ENUM vivo y que insertan
-- medidasProteccion.controller.js:322 y suspensionCautelar.controller.js:346.
-- Aplicarla así habría convertido las ediciones de esas dos entidades en un
-- INSERT fallido bajo STRICT. Al reescribir un ENUM hay que leer el ENUM real
-- de la BD, no la lista de la migración anterior.

ALTER TABLE PROTOCOLO_ACTIVADO_EVENTO
  MODIFY tipo_evento enum(
    'activacion', 'inicio_paso', 'completado_paso', 'omitido_paso', 'transicion',
    'vencimiento', 'cierre', 'anulacion', 'nota',
    'medida_proteccion_aplicada', 'medida_proteccion_editada',
    'medida_proteccion_finalizada',
    'medida_proteccion_vencida', 'informe_expulsion_emitido',
    'expulsion_resuelta', 'expediente_exportado', 'involucrado_agregado',
    'involucrado_editado', 'gestion_involucrado',
    'suspension_cautelar_aplicada', 'suspension_cautelar_editada',
    'suspension_cautelar_reconsiderada',
    'suspension_cautelar_resuelta',
    'medida_disciplinaria_aplicada', 'medida_disciplinaria_cumplida',
    'condicionalidad_por_revisar'
  ) NOT NULL;


-- ── PASO 8 ──────────────────────────────────────────────────────────────────
-- BUG PREEXISTENTE, encontrado al planificar esta migración. Misma familia que
-- el del ENUM de PROTOCOLO_ACTIVADO_EVENTO documentado en
-- docs/involucrados_fase12.sql § 6, pero con un síntoma peor: silencioso.
--
-- NOTIFICACION.tipo tenía 6 valores y no incluía 'medida_proteccion_vencida',
-- que vencimientos.service.js inserta desde la fase 4. Como
-- notificaciones.service.js → crear() captura el error y solo lo loguea (a
-- propósito: un aviso que falla no debe deshacer la operación que lo generó),
-- el INSERT fallaba en silencio y el aviso de suspensión vencida NUNCA llegó a
-- la campana de nadie. No había forma de notarlo desde la aplicación.
--
-- Se agrega el que faltaba y los tres de esta migración.

ALTER TABLE NOTIFICACION
  MODIFY tipo enum(
    'paso_en_curso', 'paso_vencido', 'paso_reasignado',
    'protocolo_activado', 'protocolo_cerrado', 'protocolo_anulado',
    'medida_proteccion_vencida',
    'medida_disciplinaria_por_terminar', 'medida_disciplinaria_cumplida',
    'condicionalidad_por_revisar'
  ) NOT NULL;
