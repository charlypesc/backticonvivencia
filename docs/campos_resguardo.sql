-- Campos redundantes de los pasos de resguardo. Aplicado el 2026-09-30.
--
-- Desde que la medida de protección se aplica en la tarjeta de cada afectado
-- (tipo, descripción y, si es suspensión, días y fundamento), los campos de
-- texto del paso pedían lo mismo por segunda vez. Se quitan del catálogo y de
-- los pasos todavía abiertos. Los pasos ya completados conservan su campo:
-- es lo que se llenó en su momento y el expediente lo muestra.
--
-- Se dejan '¿Cesa el trato directo con estudiantes?' y '¿El presunto agresor
-- es funcionario?': son preguntas del caso, no la medida.

-- 576: Medidas de resguardo para el estudiante afectado (agresión física)
-- 587: Medidas de resguardo para la persona afectada (discriminación)
-- 596: Medidas inmediatas de resguardo del funcionario afectado
DELETE FROM CATALOGO_PROTOCOLO_PASO_CAMPO
 WHERE id_paso IN (576, 587, 596) AND codigo IN ('observaciones', 'medida_aplicada');

-- El único paso abierto con esos campos al aplicar: caso 43, paso 228.
DELETE FROM PROTOCOLO_ACTIVADO_PASO_CAMPO
 WHERE id_activado_paso = 228 AND codigo = 'observaciones';
