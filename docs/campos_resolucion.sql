-- Campos redundantes de los pasos de resolución. Aplicado el 2026-09-30.
--
-- La medida de cada señalado (tipo, descripción, días y fundamento) se aplica
-- ahora en su tarjeta del paso, así que el texto "Fundamento de la medida" del
-- paso pedía lo mismo por segunda vez. Se quita del catálogo y de los pasos
-- abiertos; los ya completados lo conservan.
--
-- 'tipo_medida' NO se quita: decide el camino del protocolo (la vía de
-- expulsión) y el texto legal de la notificación. Se oculta en pantalla y el
-- front lo calcula desde las tarjetas. '¿Reconoció voluntariamente la falta?'
-- tampoco: es un atenuante del caso, no la medida.

-- 456 salida sin autorización · 567 porte de armas · 580 agresión física
-- 591 discriminación · 605 agresión a un funcionario
DELETE FROM CATALOGO_PROTOCOLO_PASO_CAMPO
 WHERE id_paso IN (456, 567, 580, 591, 605) AND codigo = 'observaciones';

-- El único paso abierto con ese campo al aplicar: caso 43, paso 232.
DELETE c FROM PROTOCOLO_ACTIVADO_PASO_CAMPO c
  JOIN PROTOCOLO_ACTIVADO_PASO p ON p.id_activado_paso = c.id_activado_paso
 WHERE p.id_activado_paso = 232 AND c.codigo = 'observaciones';
