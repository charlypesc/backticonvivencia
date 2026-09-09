-- ═══════════════════════════════════════════════════════════════════════════
-- El paso del protocolo que ordenó la medida
--
-- `requiere_medida` existía desde docs/medidas_disciplinarias_plazos.sql § 6,
-- pero solo MEDIDA_DISCIPLINARIA tenía cómo decir de qué paso salía. Las otras
-- dos colgaban del caso entero, así que un paso de resguardo ("Medidas de
-- resguardo a la víctima") no tenía forma de darse por cumplido: se registraba
-- la medida de protección y el paso seguía reclamándola.
--
-- Con esto las tres tablas responden la misma pregunta —¿qué paso ordenó esto?—
-- y el motor puede cerrar el círculo.
--
-- Nulable, y así se queda: la medida de protección se puede adoptar apenas se
-- toma conocimiento de los hechos, antes de que el protocolo esté activado o
-- fuera de todo paso (art. 16 E letra j: "desde el momento en que el
-- establecimiento tome conocimiento"). Exigir el paso convertiría en obligatorio
-- algo que la ley deja disponible desde el minuto cero.
--
-- ON DELETE SET NULL y no CASCADE: si el paso se va, la medida se queda. La
-- medida existió y produjo efectos sobre una persona; borrarla porque cambió el
-- grafo del protocolo sería perder el hecho por perder la referencia.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE MEDIDA_PROTECCION
  ADD COLUMN id_activado_paso INT DEFAULT NULL,
  ADD KEY idx_mp_paso (id_activado_paso),
  ADD CONSTRAINT fk_mp_paso FOREIGN KEY (id_activado_paso)
    REFERENCES PROTOCOLO_ACTIVADO_PASO (id_activado_paso) ON DELETE SET NULL;

ALTER TABLE SUSPENSION_CAUTELAR
  ADD COLUMN id_activado_paso INT DEFAULT NULL,
  ADD KEY idx_sc_paso (id_activado_paso),
  ADD CONSTRAINT fk_sc_paso FOREIGN KEY (id_activado_paso)
    REFERENCES PROTOCOLO_ACTIVADO_PASO (id_activado_paso) ON DELETE SET NULL;


-- ── Los pasos de resguardo que ahora exigen la medida ───────────────────────
--
-- La definición vive en scripts/seed_protocolos.js (`medida:1`), pero el seed
-- es idempotente: un protocolo ya sembrado se salta, así que la bandera no
-- llegaría sin --recargar, y recargar rehace el grafo entero para arreglar una
-- columna. Estos UPDATE hacen lo mismo sin tocar nada más.
--
-- Son los pasos de resguardo del art. 16 E letra j: acoso, vulneración de
-- derechos, connotación sexual, agresión física y discriminación. Se identifican
-- por nombre porque es lo que el catálogo y las copias de cada establecimiento
-- comparten.
--
-- Los casos YA activados no se tocan: cada uno lleva su propia copia del grafo,
-- congelada el día que arrancó, y esa es justamente la garantía de que un caso
-- se juzga con las reglas que regían cuando ocurrió.

UPDATE CATALOGO_PROTOCOLO_PASO SET requiere_medida = 1
 WHERE nombre IN ('Medidas de resguardo a la víctima',
                  'Medidas de resguardo',
                  'Medidas de resguardo y contención (evitar revictimización)',
                  'Medidas de resguardo para el estudiante afectado',
                  'Medidas de resguardo para la persona afectada');

UPDATE PROTOCOLO_ESTABLECIMIENTO_PASO SET requiere_medida = 1
 WHERE nombre IN ('Medidas de resguardo a la víctima',
                  'Medidas de resguardo',
                  'Medidas de resguardo y contención (evitar revictimización)',
                  'Medidas de resguardo para el estudiante afectado',
                  'Medidas de resguardo para la persona afectada');
