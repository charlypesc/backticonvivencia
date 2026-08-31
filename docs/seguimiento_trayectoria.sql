-- ============================================================================
-- Distinguir las DOS obligaciones del art. 16 E letra j sobre el estudiante
-- suspendido.
--
-- El texto legal, completo:
--
--   "El establecimiento deberá realizar un monitoreo pedagógico del estudiante
--    suspendido Y disponer medidas para resguardar la continuidad de su
--    trayectoria educativa."
--
-- Son dos deberes, no uno. La sección 3 del plan daba por cubierta la letra j
-- citando MEDIDA_PROTECCION_SEGUIMIENTO, pero esa tabla tiene una descripción
-- libre donde caben los dos sin distinguirse: no se puede responder "¿se hizo
-- el monitoreo?" por separado de "¿se resguardó la trayectoria?", que es
-- exactamente lo que se pregunta en una fiscalización.
--
-- Con el tipo explícito, el sistema puede señalar cuál de los dos falta en vez
-- de dar por cumplido el conjunto porque hay "algún" seguimiento cargado.
--
-- 'otro' existe para lo que el establecimiento quiera anotar además y que no
-- corresponda a ninguna de las dos obligaciones legales. Es el DEFAULT para no
-- atribuirle a las filas ya existentes un cumplimiento que nadie declaró.
-- ============================================================================

ALTER TABLE MEDIDA_PROTECCION_SEGUIMIENTO
  ADD COLUMN tipo enum('monitoreo_pedagogico','continuidad_trayectoria','otro')
    NOT NULL DEFAULT 'otro'
    COMMENT 'Cuál de los dos deberes del art. 16 E letra j acredita este registro'
    AFTER id_medida_proteccion;
