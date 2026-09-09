-- ============================================================================
-- Los estudiantes entran inactivos — 2026-09-08
--
-- "Activo" no significa matriculado. El padrón se carga entero (851 estudiantes
-- en el primer colegio, importados desde el archivo del curso), y tenerlos a
-- todos activos hacía que el estado no dijera nada: si todos están activos, la
-- marca no distingue a nadie.
--
-- El criterio nuevo es: activo = el establecimiento tiene algo abierto con esa
-- persona, y eso empieza cuando entra a un registro de convivencia. Hasta
-- entonces es matrícula, no un caso.
--
-- Tres piezas sostienen la regla, y las tres tienen que estar:
--   1. El DEFAULT de la columna (este archivo).
--   2. `activo = 0` explícito en las dos altas — estudiantes.controller.js
--      (de a uno) y cursos.controller.js (importación masiva). Explícito y no
--      heredado del DEFAULT: quien lee el INSERT tiene que ver la decisión.
--   3. La activación automática al entrar a un registro
--      (activarEstudiantes en registros.controller.js, en el alta y en la
--      edición). Sin esto la regla se rompe sola: el primer registro nuevo
--      dejaría a un estudiante con caso en curso figurando como inactivo.
--
-- Backup previo: scratchpad/backup_ddl_estudiante.sql (DDL) y
-- scratchpad/backup_estudiantes_activo.sql (el estado fila por fila, como
-- UPDATE de rollback).
-- ============================================================================


-- ── PASO 1 ──────────────────────────────────────────────────────────────────
-- El DEFAULT, para que un INSERT que no nombre la columna tampoco active.

ALTER TABLE ESTUDIANTE MODIFY activo tinyint(1) NOT NULL DEFAULT 0;

-- ROLLBACK: ALTER TABLE ESTUDIANTE MODIFY activo tinyint(1) NOT NULL DEFAULT 1;


-- ── PASO 2 ──────────────────────────────────────────────────────────────────
-- Alinear lo ya cargado con la regla: activos solo los que están en algún
-- registro. Se aplicó en dos pasos separados (desactivar todo, reactivar los
-- que tienen registro) y no con un CASE, para poder abortar entre medio.
--
-- Resultado: 843 desactivados, 8 activos.

UPDATE ESTUDIANTE SET activo = 0 WHERE activo <> 0;

UPDATE ESTUDIANTE e
   SET e.activo = 1
 WHERE EXISTS (SELECT 1 FROM REGISTRO_ESTUDIANTE re WHERE re.id_estudiante = e.id_estudiante);


-- ── VERIFICACIÓN ────────────────────────────────────────────────────────────
-- Las dos tienen que dar 0.

SELECT COUNT(*) AS activos_sin_registro FROM ESTUDIANTE e
 WHERE e.activo = 1
   AND NOT EXISTS (SELECT 1 FROM REGISTRO_ESTUDIANTE re WHERE re.id_estudiante = e.id_estudiante);

SELECT COUNT(*) AS inactivos_con_registro FROM ESTUDIANTE e
 WHERE e.activo = 0
   AND EXISTS (SELECT 1 FROM REGISTRO_ESTUDIANTE re WHERE re.id_estudiante = e.id_estudiante);
