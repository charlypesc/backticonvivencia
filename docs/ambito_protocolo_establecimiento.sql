-- ============================================================================
-- Backfill de PROTOCOLO_ESTABLECIMIENTO.ambito
--
-- La columna existía desde que se agregó el techo legal, pero ningún controller
-- la escribía: al adoptar un protocolo del catálogo el ámbito no se copiaba, y
-- las 12 filas del establecimiento 6258 quedaron en NULL.
--
-- El ámbito decide contra qué plazo se valida un protocolo:
--   'estudiante' / 'mixto' → 2 meses (art. 16 E letra g, Ley 21.809)
--   'personal'             → Título V del Estatuto Administrativo (Ley 18.883
--                            para municipales; art. 16 E, inciso final)
--
-- Con el ámbito en NULL, el protocolo de personal se validaba con el techo del
-- estudiante. Los protocolos propios (id_protocolo NULL) no tienen genérico del
-- cual heredar y se quedan en NULL a propósito: sin ámbito declarado se aplica
-- el techo más estricto, que es el correcto por defecto.
--
-- Backup previo (rollback fila por fila): scratchpad/backup-ambito.sql
-- ============================================================================

UPDATE PROTOCOLO_ESTABLECIMIENTO pe
  JOIN CATALOGO_PROTOCOLOS_GENERICOS cp ON cp.id_protocolo = pe.id_protocolo
   SET pe.ambito = cp.ambito
 WHERE pe.ambito IS NULL AND cp.ambito IS NOT NULL;
