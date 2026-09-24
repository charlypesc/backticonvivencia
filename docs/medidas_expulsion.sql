-- ═══════════════════════════════════════════════════════════════════════════
-- Expulsión y cancelación de matrícula como medidas disciplinarias
--
-- El paso "Decisión de expulsión o cancelación de matrícula" las resolvía, pero
-- no existían como tipo de medida: el caso quedaba con la expulsión aprobada en
-- la bitácora y sin ninguna medida registrada, así que el paso de resolución
-- seguía reclamándola y el cierre pedía un motivo por la falta.
--
-- Desde ahora, al aprobar ese paso con expulsión o cancelación el motor
-- registra la medida solo (protocolosActivados.controller.js,
-- registrarMedidaDeExpulsion). Los valores nuevos van al final del enum:
-- agregar al final no reescribe las filas existentes.
--
-- Aplicada el 2026-09-24.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE MEDIDA_DISCIPLINARIA MODIFY tipo_medida
  ENUM('amonestacion','citacion_apoderado','medida_formativa','medida_reparatoria',
       'servicio_comunitario','derivacion','retiro_sala','suspension_actividades',
       'condicionalidad','suspension','reduccion_jornada','separacion_temporal',
       'asistencia_solo_evaluaciones','otra','expulsion','cancelacion_matricula')
  NOT NULL DEFAULT 'otra';
