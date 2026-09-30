-- Folio del registro por establecimiento. Aplicado el 2026-09-30.
--
-- id_registro es el AUTO_INCREMENT de toda la plataforma: con varios colegios,
-- el primer registro de uno nuevo podía ser el #250 y los números de cada
-- colegio salían salteados. El folio es correlativo dentro del
-- establecimiento (1, 2, 3...) y es lo que se muestra en pantallas y PDF.
-- id_registro sigue siendo la llave interna (URLs, FK).
--
-- El folio de un registro nuevo lo asigna un trigger (MAX + 1 del colegio) y
-- no el código: así funciona también con el back que ya está desplegado, que
-- no sabe del folio. La UNIQUE garantiza que dos guardados simultáneos no se
-- lleven el mismo número: el segundo choca y el controller reintenta.

ALTER TABLE REGISTRO_CONVIVENCIA ADD COLUMN folio INT NULL AFTER id_registro;

-- Los existentes, numerados por orden de creación dentro de cada colegio.
UPDATE REGISTRO_CONVIVENCIA r
  JOIN (SELECT id_registro,
               ROW_NUMBER() OVER (PARTITION BY id_establecimiento
                                  ORDER BY fecha_creacion, id_registro) AS n
          FROM REGISTRO_CONVIVENCIA) x ON x.id_registro = r.id_registro
   SET r.folio = x.n;

ALTER TABLE REGISTRO_CONVIVENCIA
  MODIFY COLUMN folio INT NOT NULL,
  ADD UNIQUE KEY uq_registro_folio (id_establecimiento, folio);

-- (sin DELIMITER: el script de aplicación manda cada sentencia por separado)
CREATE TRIGGER trg_registro_folio BEFORE INSERT ON REGISTRO_CONVIVENCIA
FOR EACH ROW
SET NEW.folio = (SELECT COALESCE(MAX(folio), 0) + 1 FROM REGISTRO_CONVIVENCIA
                  WHERE id_establecimiento = NEW.id_establecimiento);
