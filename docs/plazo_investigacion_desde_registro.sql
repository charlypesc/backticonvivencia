-- ============================================================================
-- Plazo legal de investigación contado desde el registro — 2026-10-13
--
-- fecha_limite_investigacion se calculaba desde la activación del protocolo:
-- un registro del 25-07 cuyo protocolo se activó el 02-09 quedaba con límite el
-- 02-11, más de tres meses después de que el colegio supo del hecho. Ahora
-- corre desde el registro (o desde la denuncia del canal, si salió de una):
-- 2 meses para estudiantes (art. 16 E letra g) y 60 días hábiles para
-- personal (Título V de la Ley 18.834 / 18.883), que antes quedaba sin límite.
--
-- Además el plazo deja de ser solo un contador del dashboard: el job de
-- vencimientos avisa un mes antes, al vencer y cada 7 días después, y avisa a
-- los coordinadores de los registros que llevan una semana pendientes.
-- ============================================================================

-- 1. Marcas de aviso del plazo de investigación (una por tipo de aviso; la de
--    vencido se reescribe con cada recordatorio semanal).
ALTER TABLE PROTOCOLO_ACTIVADO
  ADD COLUMN aviso_plazo_previo_at  DATETIME NULL AFTER fecha_limite_investigacion,
  ADD COLUMN aviso_plazo_vencido_at DATETIME NULL AFTER aviso_plazo_previo_at;

-- 2. Marca del aviso de registro pendiente (una sola vez por registro).
ALTER TABLE REGISTRO_CONVIVENCIA
  ADD COLUMN aviso_pendiente_at DATETIME NULL AFTER fecha_atencion;

-- 3. Tipos de notificación nuevos.
ALTER TABLE NOTIFICACION
  MODIFY COLUMN tipo ENUM(
    'paso_en_curso','paso_vencido','paso_reasignado','protocolo_activado','protocolo_cerrado',
    'protocolo_anulado','medida_proteccion_vencida','medida_disciplinaria_por_terminar',
    'medida_disciplinaria_cumplida','condicionalidad_por_revisar','registro_nuevo',
    'registro_derivado','derivacion_vencida','derivacion_atendida','denuncia_nueva',
    'plazo_investigacion_por_vencer','plazo_investigacion_vencido','registro_pendiente') NOT NULL;

-- 4. Evento de bitácora para el vencimiento del plazo.
ALTER TABLE PROTOCOLO_ACTIVADO_EVENTO
  MODIFY COLUMN tipo_evento ENUM(
    'activacion','inicio_paso','completado_paso','omitido_paso','transicion','vencimiento',
    'cierre','anulacion','nota','medida_proteccion_aplicada','medida_proteccion_editada',
    'medida_proteccion_finalizada','medida_proteccion_vencida','informe_expulsion_emitido',
    'expulsion_resuelta','expediente_exportado','involucrado_agregado','involucrado_editado',
    'gestion_involucrado','suspension_cautelar_aplicada','suspension_cautelar_editada',
    'suspension_cautelar_reconsiderada','suspension_cautelar_resuelta',
    'medida_disciplinaria_aplicada','medida_disciplinaria_cumplida','condicionalidad_por_revisar',
    'seguimiento_registrado','suspension_cautelar_documento','plazo_investigacion_vencido') NOT NULL;

-- 5. Recalcular el límite de los casos existentes de estudiantes desde el
--    registro. DATE_ADD con INTERVAL 2 MONTH ya cae en el último día si el mes
--    de destino es más corto, igual que calcularLimiteInvestigacion. Los casos
--    de personal no se tocan: no había ninguno, y su plazo en días hábiles
--    necesita los feriados de la región, que calcula el código al activar.
UPDATE PROTOCOLO_ACTIVADO pa
  JOIN REGISTRO_CONVIVENCIA r ON r.id_registro = pa.id_registro
  JOIN PROTOCOLO_ESTABLECIMIENTO pe ON pe.id_protocolo_establecimiento = pa.id_protocolo_establecimiento
  LEFT JOIN CATALOGO_PROTOCOLOS_GENERICOS cp ON cp.id_protocolo = pe.id_protocolo
  SET pa.fecha_limite_investigacion = DATE_ADD(
        DATE(CONVERT_TZ(
          LEAST(r.fecha_creacion,
                COALESCE((SELECT MIN(d.fecha_creacion) FROM DENUNCIA d WHERE d.id_registro = r.id_registro),
                         r.fecha_creacion)),
          'UTC', 'America/Santiago')),
        INTERVAL 2 MONTH)
  WHERE COALESCE(pe.ambito, cp.ambito, 'estudiante') <> 'personal';

-- 6. La reaplicación de una suspensión adelanta el límite al término del nuevo
--    plazo (medidasProteccion.controller): el paso 5 lo pisó, se vuelve a aplicar.
UPDATE PROTOCOLO_ACTIVADO pa
  JOIN (SELECT id_protocolo_activado, MIN(fecha_termino) AS termino
          FROM MEDIDA_PROTECCION
         WHERE es_reaplicacion = 1 AND tipo = 'suspension' AND fecha_termino IS NOT NULL
         GROUP BY id_protocolo_activado) m ON m.id_protocolo_activado = pa.id_protocolo_activado
  SET pa.fecha_limite_investigacion = LEAST(COALESCE(pa.fecha_limite_investigacion, m.termino), m.termino);
