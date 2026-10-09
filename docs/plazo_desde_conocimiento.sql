-- ============================================================================
-- Plazo desde el conocimiento del hecho — 2026-10-08
--
-- Los pasos de denuncia a la autoridad tienen 24 horas (art. 176 del Código
-- Procesal Penal), contadas desde que el establecimiento supo del hecho. El
-- motor calculaba cada plazo desde que empezaba el paso, así que las horas de
-- los pasos previos (acogida, traslado, aviso a dirección) quedaban fuera: la
-- denuncia podía estar "en plazo" en el sistema y fuera de plazo ante la ley.
--
-- plazo_desde = 'conocimiento' hace que el paso cuente desde lo primero entre
-- la denuncia recibida por el canal, la creación del registro y la activación
-- del protocolo (ver momentoDeConocimiento en protocolosActivados.controller).
--
-- Además, la obligación de denunciar no es solo del director: el art. 175
-- letra e alcanza a "los directores, inspectores y profesores", y la denuncia
-- de uno exime al resto. Los pasos donde el director era el único ejecutor
-- suman al coordinador de convivencia y a Inspectoría, para que el paso no se
-- trabe si el director no está. La excepción es la agresión a un funcionario:
-- ahí el Estatuto Docente (art. 8 bis, texto de la Ley 21.809) dice que el
-- sostenedor denuncia "a través del director del establecimiento".
--
-- Solo se toca el catálogo global. Los espejos de los establecimientos y los
-- casos ya activados quedan como estaban.
-- ============================================================================

ALTER TABLE CATALOGO_PROTOCOLO_PASO
  ADD COLUMN plazo_desde ENUM('inicio_paso','conocimiento') NOT NULL DEFAULT 'inicio_paso' AFTER plazo_unidad;
ALTER TABLE PROTOCOLO_ESTABLECIMIENTO_PASO
  ADD COLUMN plazo_desde ENUM('inicio_paso','conocimiento') NOT NULL DEFAULT 'inicio_paso' AFTER plazo_unidad;
ALTER TABLE PROTOCOLO_ACTIVADO_PASO
  ADD COLUMN plazo_desde ENUM('inicio_paso','conocimiento') NOT NULL DEFAULT 'inicio_paso' AFTER plazo_unidad;

-- Los pasos de denuncia penal del catálogo: los once "Denuncia..." con 24 horas.
-- (La denuncia a la Defensoría de la Niñez no tiene plazo y no es del art. 175.)
UPDATE CATALOGO_PROTOCOLO_PASO
  SET plazo_desde = 'conocimiento'
  WHERE nombre LIKE 'Denuncia%' AND tipo_paso = 'notificacion_externa'
    AND plazo_valor = 24 AND plazo_unidad = 'horas';

-- Descripción con el fundamento, en los que no tenían. Vulneración de derechos
-- va primero porque además lleva el aviso al Tribunal de Familia.
UPDATE CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  SET p.descripcion = 'Cuando los hechos pueden constituir delito, denunciar ante el Ministerio Público, Carabineros, la PDI o un tribunal con competencia penal dentro de las 24 horas siguientes a que el establecimiento tomó conocimiento (Código Procesal Penal, arts. 175 letra e y 176). Están obligados los directores, inspectores y profesores; la denuncia que presenta uno de ellos exime al resto (art. 175, inciso final). Si es una vulneración de derechos que no constituye delito, se pone en conocimiento del Tribunal de Familia tan pronto se advierta (Circular 482 de la Superintendencia). El plazo de este paso se cuenta desde que el colegio supo del hecho, no desde que empieza el paso. Adjuntar el comprobante.'
  WHERE p.plazo_desde = 'conocimiento' AND p.descripcion IS NULL
    AND p.nombre = 'Denuncia a autoridad externa'
    AND c.nombre = 'Protocolo de vulneración de derechos de estudiantes';

UPDATE CATALOGO_PROTOCOLO_PASO
  SET descripcion = 'Cuando los hechos pueden constituir delito, denunciar ante el Ministerio Público, Carabineros, la PDI o un tribunal con competencia penal dentro de las 24 horas siguientes a que el establecimiento tomó conocimiento (Código Procesal Penal, arts. 175 letra e y 176). Están obligados los directores, inspectores y profesores; la denuncia que presenta uno de ellos exime al resto (art. 175, inciso final). El plazo de este paso se cuenta desde que el colegio supo del hecho, no desde que empieza el paso. Adjuntar el comprobante de la denuncia.'
  WHERE plazo_desde = 'conocimiento' AND descripcion IS NULL;

-- Los que ya tenían descripción: se agrega desde cuándo corre el plazo.
UPDATE CATALOGO_PROTOCOLO_PASO
  SET descripcion = CONCAT(descripcion, ' El plazo de 24 horas (art. 176 del Código Procesal Penal) se cuenta desde que el colegio supo del hecho, no desde que empieza este paso.')
  WHERE plazo_desde = 'conocimiento' AND descripcion NOT LIKE '%desde que el colegio supo del hecho%';

-- Ejecutores alternativos: coordinador de convivencia e Inspectoría, en los
-- pasos de denuncia donde el director era el único ejecutor. El coordinador que
-- estaba como notificado pasa a ejecutor (un ejecutor ya recibe el aviso).
UPDATE CATALOGO_PROTOCOLO_PASO_ROL pr
  JOIN CATALOGO_PROTOCOLO_PASO p ON p.id_paso = pr.id_paso
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  JOIN ROLES r ON r.rol_id = pr.rol_id
  SET pr.tipo_participacion = 'ejecutor'
  WHERE p.plazo_desde = 'conocimiento' AND r.codigo = 'ENCARGADO' AND pr.tipo_participacion = 'notificado'
    AND c.nombre <> 'Protocolo de agresión de un estudiante a un funcionario';

INSERT IGNORE INTO CATALOGO_PROTOCOLO_PASO_ROL (id_paso, rol_id, tipo_participacion)
  SELECT p.id_paso, r.rol_id, 'ejecutor'
  FROM CATALOGO_PROTOCOLO_PASO p
  JOIN CATALOGO_PROTOCOLOS_GENERICOS c ON c.id_protocolo = p.id_protocolo
  JOIN ROLES r ON r.codigo IN ('ENCARGADO', 'INSPECTORIA') AND r.id_establecimiento IS NULL
  WHERE p.plazo_desde = 'conocimiento'
    AND c.nombre <> 'Protocolo de agresión de un estudiante a un funcionario';
