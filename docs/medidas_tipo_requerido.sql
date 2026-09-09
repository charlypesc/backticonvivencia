-- ═══════════════════════════════════════════════════════════════════════════
-- Qué clase de medida ordena el paso, y los pasos de resolución que la ordenan
--
-- `requiere_medida` (docs/medidas_disciplinarias_plazos.sql § 6) dice que el
-- paso ordena una medida, pero no cuál. Con eso, el motor se conformaba con
-- cualquiera de las tres: un paso de resguardo del art. 16 E letra j se daba
-- por cumplido con una medida disciplinaria registrada en el mismo caso, y el
-- paso de resolución con una medida de protección. Son institutos distintos y
-- confundirlos es justo lo que la fiscalización lee mal.
--
-- Una clase por tabla, y ninguna cumple por otra:
--
--   'proteccion'    se cumple con MEDIDA_PROTECCION (Ley 21.809 art. 16 E letra j).
--   'cautelar'      se cumple con SUSPENSION_CAUTELAR (DFL 2/1998 art. 6 letra d,
--                   texto de la Ley 21.128 y modificación de la Ley 21.809).
--   'disciplinaria' se cumple con MEDIDA_DISCIPLINARIA. Es el paso que resuelve
--                   y sanciona.
--   'cualquiera'    se cumple con cualquiera de las tres. Es el comportamiento
--                   viejo, y queda disponible para el establecimiento que arma
--                   un paso propio y no quiere comprometerse a una vía.
--
-- La primera versión de esta migración juntaba protección y cautelar en un solo
-- valor 'resguardo', con el argumento de que la ley ofrece dos vías para lo
-- mismo. No es así, y por eso se separaron:
--
--                     Medida de protección          Medida cautelar
--   A favor de        la persona AFECTADA           el procedimiento
--   Recae sobre       separación de aula, o la      el SEÑALADO
--                     suspensión del denunciado
--   Requiere          tomar conocimiento de los     procedimiento sancionatorio
--                     hechos, nada más              iniciado por falta grave o
--                                                   gravísima
--   La adopta         el establecimiento            SOLO el director
--   Arrastra          tope de 15 días hábiles,      plazo de 10 días hábiles
--                     monitoreo pedagógico y        para RESOLVER
--                     continuidad de trayectoria
--
-- Decretar la cautelar no descarga el deber de proteger a la persona afectada.
-- Con las dos juntas, un caso donde solo se suspendió cautelarmente daba por
-- cumplido el paso de resguardo, y el sistema dejaba de avisar de un deber que
-- seguía vivo —incluidos el monitoreo pedagógico y la continuidad de la
-- trayectoria educativa, que la letra j impone por separado.
--
-- Nótese que la suspensión que la letra j autoriza COMO medida de protección se
-- registra en MEDIDA_PROTECCION y no en SUSPENSION_CAUTELAR: las dos tablas ya
-- estaban bien separadas, el que las juntaba era este ENUM.
--
-- Nulable: un paso sin `requiere_medida` no tiene clase que declarar.
--
-- Backup previo: scratchpad/backup-medidas-tipo-requerido.sql (las tres tablas
-- de pasos completas, DDL + filas).
-- Aplicar paso a paso, abortando ante el primer error.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── PASO 1 ──────────────────────────────────────────────────────────────────
-- La columna, en los tres niveles del grafo: el catálogo global, la copia del
-- establecimiento y la copia congelada de cada caso. Los tres la necesitan
-- porque el valor viaja con el paso cuando el colegio personaliza y cuando el
-- caso se activa; si faltara en el último, el motor tendría que ir a buscarlo
-- al catálogo y perdería la garantía de que un caso se juzga con las reglas
-- que regían el día que arrancó.

ALTER TABLE CATALOGO_PROTOCOLO_PASO
  ADD COLUMN tipo_medida_requerida ENUM('proteccion','cautelar','disciplinaria','cualquiera')
    DEFAULT NULL AFTER requiere_medida;

ALTER TABLE PROTOCOLO_ESTABLECIMIENTO_PASO
  ADD COLUMN tipo_medida_requerida ENUM('proteccion','cautelar','disciplinaria','cualquiera')
    DEFAULT NULL AFTER requiere_medida;

ALTER TABLE PROTOCOLO_ACTIVADO_PASO
  ADD COLUMN tipo_medida_requerida ENUM('proteccion','cautelar','disciplinaria','cualquiera')
    DEFAULT NULL AFTER requiere_medida;


-- ── PASO 2 ──────────────────────────────────────────────────────────────────
-- Los pasos que ya pedían medida son los cinco de resguardo que marcó
-- docs/medidas_vinculo_paso.sql, y son pasos del art. 16 E letra j: piden la
-- medida de PROTECCIÓN. Que además se haya decretado una cautelar sobre el
-- señalado no los cumple.
--
-- Los casos ya activados quedan en NULL y así se quedan: ninguno tiene hoy
-- `requiere_medida = 1` (la bandera llegó al catálogo después de que se
-- activaran), y aunque lo tuvieran, el grafo de un caso en curso no se toca.

UPDATE CATALOGO_PROTOCOLO_PASO        SET tipo_medida_requerida = 'proteccion' WHERE requiere_medida = 1;
UPDATE PROTOCOLO_ESTABLECIMIENTO_PASO SET tipo_medida_requerida = 'proteccion' WHERE requiere_medida = 1;


-- ── PASO 3 ──────────────────────────────────────────────────────────────────
-- Los pasos de resolución, que ordenan la medida disciplinaria y hasta ahora no
-- pedían nada.
--
-- Era el hueco grande: el paso donde el colegio decide la sanción se daba por
-- completado sin que la sanción constara en ninguna parte, y el informe previo
-- de expulsión —que debe enumerar las medidas aplicadas "con indicación de los
-- resultados obtenidos"— salía vacío sin que nadie se enterara a tiempo.
--
-- Se identifican por nombre, que es lo que el catálogo y las copias de cada
-- establecimiento comparten (mismo criterio que docs/medidas_vinculo_paso.sql).
--
-- Quedan FUERA a propósito dos pasos que también se llaman "Resolución":
--
--   'Resolución y medidas (disciplinarias o administrativas)'
--       → protocolo de violencia entre adultos de la comunidad. La medida no es
--         contra un estudiante, y MEDIDA_DISCIPLINARIA lo es.
--   'Resolución y derivación al procedimiento laboral o administrativo'
--       → maltrato de un funcionario hacia un estudiante. Termina en sumario o
--         procedimiento laboral, que el sistema no modela como medida.
--
-- Los pasos de expulsión y cancelación de matrícula tampoco entran: van por
-- INFORME_EXPULSION, con su comisión y sus plazos propios.

UPDATE CATALOGO_PROTOCOLO_PASO
   SET requiere_medida = 1, tipo_medida_requerida = 'disciplinaria'
 WHERE nombre IN ('Resolución y aplicación de medidas',
                  'Resolución y medidas formativas o disciplinarias',
                  'Resolución: medidas formativas, reparatorias o disciplinarias',
                  'Resolución: medidas formativas y reparatorias',
                  'Resolución: medidas formativas y compromiso');

UPDATE PROTOCOLO_ESTABLECIMIENTO_PASO
   SET requiere_medida = 1, tipo_medida_requerida = 'disciplinaria'
 WHERE nombre IN ('Resolución y aplicación de medidas',
                  'Resolución y medidas formativas o disciplinarias',
                  'Resolución: medidas formativas, reparatorias o disciplinarias',
                  'Resolución: medidas formativas y reparatorias',
                  'Resolución: medidas formativas y compromiso');


-- ── Nota sobre 'sin_medida' ─────────────────────────────────────────────────
-- Varios de esos pasos de resolución preguntan `tipo_medida` y ofrecen
-- 'sin_medida': resolver que no corresponde sanción es una resolución válida y
-- no puede quedar reclamando para siempre una medida que no existe. Eso no se
-- arregla acá sino en el motor — medidaPendienteDe() da por cumplido el
-- paso cuyo datos_salida trae tipo_medida = 'sin_medida' — porque es una
-- pregunta sobre lo que el caso respondió, no sobre cómo está definido el paso.
