-- Folios por año y por establecimiento. Aplicado el 2026-09-30.
--
-- Registros (REG-2026-013) y protocolos activados (PROT-2026-005) se numeran
-- 1, 2, 3... dentro de cada establecimiento y cada año, y vuelven a 1 el año
-- siguiente: así se archivan las carpetas y así los pide la Superintendencia.
-- El número nunca se reutiliza ni se corrige: un protocolo mal activado se
-- anula (conserva su folio), no se borra.
--
-- El año sale de la hora de Chile (el servidor corre en UTC): un registro de
-- las 22:00 del 31 de diciembre es del año que termina, no del siguiente.
-- Folio y año los asigna un trigger, no el código: funciona igual con un back
-- desplegado que todavía no los conoce.

-- ── Registros ─────────────────────────────────────────────────────────────
ALTER TABLE REGISTRO_CONVIVENCIA ADD COLUMN anio SMALLINT NULL AFTER folio;

UPDATE REGISTRO_CONVIVENCIA
   SET anio = YEAR(CONVERT_TZ(fecha_creacion, 'UTC', 'America/Santiago'));

UPDATE REGISTRO_CONVIVENCIA r
  JOIN (SELECT id_registro,
               ROW_NUMBER() OVER (PARTITION BY id_establecimiento, anio
                                  ORDER BY fecha_creacion, id_registro) AS n
          FROM REGISTRO_CONVIVENCIA) x ON x.id_registro = r.id_registro
   SET r.folio = x.n;

ALTER TABLE REGISTRO_CONVIVENCIA
  MODIFY COLUMN anio SMALLINT NOT NULL,
  ADD UNIQUE KEY uq_registro_folio_anio (id_establecimiento, anio, folio),
  DROP INDEX uq_registro_folio;

DROP TRIGGER trg_registro_folio;

CREATE TRIGGER trg_registro_folio BEFORE INSERT ON REGISTRO_CONVIVENCIA
FOR EACH ROW
SET NEW.anio = YEAR(CONVERT_TZ(NOW(), 'UTC', 'America/Santiago')),
    NEW.folio = (SELECT COALESCE(MAX(folio), 0) + 1 FROM REGISTRO_CONVIVENCIA
                  WHERE id_establecimiento = NEW.id_establecimiento
                    AND anio = YEAR(CONVERT_TZ(NOW(), 'UTC', 'America/Santiago')));

-- ── Protocolos activados ──────────────────────────────────────────────────
ALTER TABLE PROTOCOLO_ACTIVADO
  ADD COLUMN folio INT NULL AFTER id_protocolo_activado,
  ADD COLUMN anio SMALLINT NULL AFTER folio;

UPDATE PROTOCOLO_ACTIVADO
   SET anio = YEAR(CONVERT_TZ(fecha_activacion, 'UTC', 'America/Santiago'));

UPDATE PROTOCOLO_ACTIVADO pa
  JOIN (SELECT id_protocolo_activado,
               ROW_NUMBER() OVER (PARTITION BY id_establecimiento, anio
                                  ORDER BY fecha_activacion, id_protocolo_activado) AS n
          FROM PROTOCOLO_ACTIVADO) x ON x.id_protocolo_activado = pa.id_protocolo_activado
   SET pa.folio = x.n;

ALTER TABLE PROTOCOLO_ACTIVADO
  MODIFY COLUMN folio INT NOT NULL,
  MODIFY COLUMN anio SMALLINT NOT NULL,
  ADD UNIQUE KEY uq_protocolo_folio_anio (id_establecimiento, anio, folio);

CREATE TRIGGER trg_protocolo_folio BEFORE INSERT ON PROTOCOLO_ACTIVADO
FOR EACH ROW
SET NEW.anio = YEAR(CONVERT_TZ(NOW(), 'UTC', 'America/Santiago')),
    NEW.folio = (SELECT COALESCE(MAX(folio), 0) + 1 FROM PROTOCOLO_ACTIVADO
                  WHERE id_establecimiento = NEW.id_establecimiento
                    AND anio = YEAR(CONVERT_TZ(NOW(), 'UTC', 'America/Santiago')));

-- ── Código visible ────────────────────────────────────────────────────────
-- Columna calculada: REG-2026-013 / PROT-2026-005. La arma la base para que
-- ninguna pantalla ni PDF lo escriba distinto; con ceros a la izquierda para
-- que los archivos se ordenen solos en una carpeta.
ALTER TABLE REGISTRO_CONVIVENCIA
  ADD COLUMN codigo VARCHAR(20)
    GENERATED ALWAYS AS (CONCAT('REG-', anio, '-', LPAD(folio, 3, '0'))) VIRTUAL AFTER anio;

ALTER TABLE PROTOCOLO_ACTIVADO
  ADD COLUMN codigo VARCHAR(20)
    GENERATED ALWAYS AS (CONCAT('PROT-', anio, '-', LPAD(folio, 3, '0'))) VIRTUAL AFTER anio;
