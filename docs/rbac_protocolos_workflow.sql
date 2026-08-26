-- ============================================================================
-- Permisos del motor de protocolos (workflow engine) — 2026-08-26
-- Acompaña a docs/protocolos_workflow.sql
--
-- Tres recursos nuevos, uno por nivel de la arquitectura:
--
--   protocolo_flujo                 -- el grafo de la plantilla global (ADMIN)
--   protocolo_flujo_establecimiento -- la copia espejo del colegio
--   protocolo_activado.*            -- acciones del motor sobre un caso vivo
--                                      (el recurso ya existe; se le suman acciones)
--
-- El grafo de la plantilla NO se desglosa en permisos por tabla (paso,
-- transición, rol, campo): se edita siempre como una unidad — mover una arista
-- sin poder tocar el nodo no es una operación que alguien vaya a hacer — y
-- ocho permisos que se otorgan y revocan siempre juntos solo agregan formas de
-- configurarlo mal.
--
-- Los permiso_id van explícitos y no por AUTO_INCREMENT: son la fuente de
-- verdad que src/constants/permisos.js verifica al arrancar.
-- ============================================================================

INSERT INTO PERMISOS (permiso_id, codigo, recurso, accion, descripcion) VALUES
  -- Plantilla global: solo el ADMIN diseña el grafo estándar.
  (79, 'protocolo_flujo.ver',      'protocolo_flujo', 'ver',
       'Flujo de protocolos: ver el grafo de pasos, transiciones, roles y campos del catálogo global'),
  (80, 'protocolo_flujo.editar',   'protocolo_flujo', 'editar',
       'Flujo de protocolos: crear, editar y eliminar pasos, transiciones, roles y campos del catálogo global'),
  (81, 'protocolo_flujo.publicar', 'protocolo_flujo', 'publicar',
       'Flujo de protocolos: validar la coherencia del grafo y publicarlo para que pueda activarse'),

  -- Espejo por establecimiento. `personalizar` va aparte de `editar` por lo
  -- mismo que protocolo_establecimiento.crear_propio va aparte de .crear:
  -- clonar el grafo es la decisión de dejar de heredar las correcciones del
  -- ADMIN, y eso es una responsabilidad distinta de retocar la copia después.
  (82, 'protocolo_flujo_establecimiento.ver',          'protocolo_flujo_establecimiento', 'ver',
       'Flujo del establecimiento: ver el grafo vigente del protocolo (propio o heredado del catálogo)'),
  (83, 'protocolo_flujo_establecimiento.personalizar', 'protocolo_flujo_establecimiento', 'personalizar',
       'Flujo del establecimiento: clonar el grafo del catálogo para editarlo localmente (deja de heredar)'),
  (84, 'protocolo_flujo_establecimiento.editar',       'protocolo_flujo_establecimiento', 'editar',
       'Flujo del establecimiento: editar los pasos, transiciones, roles y campos de la copia propia'),
  (85, 'protocolo_flujo_establecimiento.restaurar',    'protocolo_flujo_establecimiento', 'restaurar',
       'Flujo del establecimiento: descartar la copia propia y volver a heredar el grafo del catálogo'),

  -- Ejecución. protocolo_activado ya tiene ver/crear/editar/eliminar; lo que
  -- falta son los verbos del motor, que sí se otorgan por separado: completar
  -- un paso, aprobarlo y anular el caso son actos distintos con firmas
  -- distintas en la bitácora.
  (86, 'protocolo_activado.completar_paso', 'protocolo_activado', 'completar_paso',
       'Protocolos activados: marcar un paso como completado y registrar sus datos de salida'),
  (87, 'protocolo_activado.aprobar_paso',   'protocolo_activado', 'aprobar_paso',
       'Protocolos activados: aprobar o rechazar un paso de tipo aprobación'),
  (88, 'protocolo_activado.omitir_paso',    'protocolo_activado', 'omitir_paso',
       'Protocolos activados: omitir un paso justificadamente sin completarlo'),
  (89, 'protocolo_activado.reasignar_paso', 'protocolo_activado', 'reasignar_paso',
       'Protocolos activados: cambiar el responsable de un paso en curso'),
  (90, 'protocolo_activado.cerrar',         'protocolo_activado', 'cerrar',
       'Protocolos activados: cerrar el protocolo una vez alcanzado un paso final'),
  (91, 'protocolo_activado.anular',         'protocolo_activado', 'anular',
       'Protocolos activados: anular un protocolo activado por error, conservando la bitácora'),
  (92, 'protocolo_activado.ver_bitacora',   'protocolo_activado', 'ver_bitacora',
       'Protocolos activados: ver la bitácora de eventos del protocolo (auditoría)');


-- ============================================================================
-- Asignación a roles
--
--   ADMIN (1)     — todo. Es el único que diseña la plantilla global.
--   DIRECTOR (2)  — hoy es un rol de solo lectura sobre protocolos; se mantiene
--                   así: ver los dos grafos y la bitácora, nada más.
--   ENCARGADO (3) — opera el motor y personaliza el grafo de su colegio. Ya
--   PSICOLOGO (5)   tenían el CRUD completo de protocolo_establecimiento y
--                   protocolo_activado, así que reciben lo mismo entre ambos.
-- ============================================================================

INSERT INTO ROL_PERMISOS (rol_id, permiso_id)
SELECT 1, permiso_id FROM PERMISOS WHERE permiso_id BETWEEN 79 AND 92;

INSERT INTO ROL_PERMISOS (rol_id, permiso_id)
SELECT 2, permiso_id FROM PERMISOS WHERE permiso_id IN (79, 82, 92);

INSERT INTO ROL_PERMISOS (rol_id, permiso_id)
SELECT r.rol_id, p.permiso_id
FROM (SELECT 3 AS rol_id UNION ALL SELECT 5) r
CROSS JOIN PERMISOS p
WHERE p.permiso_id IN (79, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92);
