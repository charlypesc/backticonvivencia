-- ═══════════════════════════════════════════════════════════════════════════
-- Fase 12.5 — Medidas e informe de expulsión colgando del involucrado
-- Aplicado 2026-08-27. Ver PLAN-LEY-PROTOCOLOS.md § Fase 12.5.
--
-- Las tres tablas ya tenían id_estudiante, pero un caso con dos señalados
-- permitía atribuirle una medida al que no era: nada ataba la medida al rol que
-- esa persona tenía EN ESE CASO. Con id_involucrado, la medida apunta a la
-- persona tal como quedó congelada en el caso, con su rol y su nombre.
--
-- La columna es nulable a propósito: MEDIDA_DISCIPLINARIA cuelga del registro y
-- no del caso (el hecho es el que la motiva), así que puede existir sin ningún
-- protocolo activado detrás.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE MEDIDA_PROTECCION
  ADD COLUMN id_involucrado INT DEFAULT NULL AFTER id_estudiante,
  ADD KEY idx_mp_involucrado (id_involucrado),
  ADD CONSTRAINT fk_mp_involucrado FOREIGN KEY (id_involucrado)
    REFERENCES PROTOCOLO_ACTIVADO_INVOLUCRADO (id_involucrado) ON DELETE SET NULL;

ALTER TABLE MEDIDA_DISCIPLINARIA
  ADD COLUMN id_involucrado INT DEFAULT NULL AFTER id_estudiante,
  ADD KEY idx_md_involucrado (id_involucrado),
  ADD CONSTRAINT fk_md_involucrado FOREIGN KEY (id_involucrado)
    REFERENCES PROTOCOLO_ACTIVADO_INVOLUCRADO (id_involucrado) ON DELETE SET NULL;

ALTER TABLE INFORME_EXPULSION
  ADD COLUMN id_involucrado INT DEFAULT NULL AFTER id_estudiante,
  ADD KEY idx_ie_involucrado (id_involucrado),
  ADD CONSTRAINT fk_ie_involucrado FOREIGN KEY (id_involucrado)
    REFERENCES PROTOCOLO_ACTIVADO_INVOLUCRADO (id_involucrado) ON DELETE SET NULL;

-- Relleno de lo ya existente: se ata por (caso, estudiante), que es la única
-- correspondencia que se puede afirmar sin inventar. Lo que no calce queda en
-- NULL, que es la verdad: no se sabe a qué involucrado correspondía.
UPDATE MEDIDA_PROTECCION m
  JOIN PROTOCOLO_ACTIVADO_INVOLUCRADO i
    ON i.id_protocolo_activado = m.id_protocolo_activado AND i.id_estudiante = m.id_estudiante
  SET m.id_involucrado = i.id_involucrado
  WHERE m.id_involucrado IS NULL;

UPDATE MEDIDA_DISCIPLINARIA m
  JOIN PROTOCOLO_ACTIVADO_PASO p ON p.id_activado_paso = m.id_activado_paso
  JOIN PROTOCOLO_ACTIVADO_INVOLUCRADO i
    ON i.id_protocolo_activado = p.id_protocolo_activado AND i.id_estudiante = m.id_estudiante
  SET m.id_involucrado = i.id_involucrado
  WHERE m.id_involucrado IS NULL;

UPDATE INFORME_EXPULSION f
  JOIN PROTOCOLO_ACTIVADO_INVOLUCRADO i
    ON i.id_protocolo_activado = f.id_protocolo_activado AND i.id_estudiante = f.id_estudiante
  SET f.id_involucrado = i.id_involucrado
  WHERE f.id_involucrado IS NULL;
