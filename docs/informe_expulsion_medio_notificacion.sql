-- ═══════════════════════════════════════════════════════════════════════════
-- La vía por la que se notificó al apoderado la expulsión o la cancelación
--
-- El informe guardaba sólo `fecha_notificacion_apoderado`. La fecha por sí sola
-- prueba cuándo dice el establecimiento que notificó, no cómo lo hizo, y el
-- "cómo" es exactamente lo que se discute cuando la familia reclama que nunca
-- se enteró: de esa notificación cuelgan el plazo de reconsideración y los 5
-- días hábiles para informar a la Superintendencia y a la SEREMI.
--
-- Mismo enum que SUSPENSION_CAUTELAR y por la misma razón: SIN 'telefono'. Una
-- llamada no deja constancia de qué se comunicó, y ésta es la notificación de
-- la medida más grave que puede tomar un establecimiento.
--
-- Nulable: los informes ya decididos no tienen cómo saber por qué vía fue, y
-- rellenarlos con un valor por defecto sería inventar la constancia que
-- justamente falta.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE INFORME_EXPULSION
  ADD COLUMN medio_notificacion_apoderado
    ENUM('presencial', 'correo', 'plataforma', 'carta') DEFAULT NULL
    AFTER fecha_notificacion_apoderado;
