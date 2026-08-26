-- ============================================================================
-- Roles globales que exige el catálogo estándar de protocolos — 2026-08-26
--
-- Los protocolos del catálogo global solo pueden referenciar roles globales
-- (id_establecimiento IS NULL), y hasta ahora solo existían cuatro: ADMIN,
-- DIRECTOR, ENCARGADO y PSICOLOGO. El catálogo Mineduc reparte los pasos entre
-- actores que el sistema todavía no nombraba — Inspectoría, UTP, el Comité de
-- Convivencia, el encargado de salud. Sin ellos habría que aplastar cinco
-- actores distintos sobre ENCARGADO y perder justamente lo que el protocolo
-- define: quién hace cada cosa.
--
-- Van con es_sistema = 0: son roles funcionales que un colegio puede desactivar
-- o no usar, no piezas del motor como ADMIN.
-- ============================================================================

INSERT INTO ROLES (nombre, codigo, descripcion, id_establecimiento, es_sistema, activo) VALUES
  ('Funcionario',              'FUNCIONARIO',        'Cualquier funcionario del establecimiento. Es el ejecutor de los pasos de recepción: los protocolos empiezan con quien recibe el relato, sea quien sea.', NULL, 0, 1),
  ('Profesor jefe',            'PROFESOR_JEFE',      'Profesor jefe del curso del estudiante involucrado.', NULL, 0, 1),
  ('Comité de convivencia',    'COMITE_CONVIVENCIA', 'Comité de sana convivencia escolar: investiga y resuelve de forma colegiada.', NULL, 0, 1),
  ('Orientador',               'ORIENTADOR',         'Orientación y acompañamiento del estudiante.', NULL, 0, 1),
  ('Trabajador social',        'TRABAJADOR_SOCIAL',  'Trabajo social y vínculo con las redes externas (OPD, Cesfam, OLN).', NULL, 0, 1),
  ('Encargado de salud',       'ENCARGADO_SALUD',    'Primeros auxilios y traslados a centro asistencial (TENS o encargado de enfermería).', NULL, 0, 1),
  ('Inspectoría',              'INSPECTORIA',        'Inspectoría general: accidentes escolares, seguro escolar y notificación a apoderados.', NULL, 0, 1),
  ('UTP',                      'UTP',                'Unidad Técnico Pedagógica: evaluación diferenciada, salidas pedagógicas.', NULL, 0, 1),
  ('Docente',                  'DOCENTE',            'Docente responsable de una actividad (salidas pedagógicas, giras).', NULL, 0, 1);


-- ============================================================================
-- Permisos operativos de los roles nuevos
--
-- Un rol sin permisos aparece en el grafo pero no puede hacer nada: la ruta lo
-- rechaza antes de llegar a mirar el paso. Se les da el mínimo para operar un
-- protocolo — ver el flujo, ver el caso, completar y omitir su paso, y leer la
-- bitácora — y nada de configuración ni de cierre del caso, que siguen siendo
-- de ENCARGADO y dirección.
-- ============================================================================

INSERT INTO ROL_PERMISOS (rol_id, permiso_id)
SELECT r.rol_id, p.permiso_id
FROM ROLES r
CROSS JOIN PERMISOS p
WHERE r.id_establecimiento IS NULL
  AND r.codigo IN ('FUNCIONARIO','PROFESOR_JEFE','COMITE_CONVIVENCIA','ORIENTADOR',
                   'TRABAJADOR_SOCIAL','ENCARGADO_SALUD','INSPECTORIA','UTP','DOCENTE')
  AND p.codigo IN ('protocolo_flujo.ver',
                   'protocolo_flujo_establecimiento.ver',
                   'protocolo_activado.ver',
                   'protocolo_activado.ver_bitacora',
                   'protocolo_activado.completar_paso',
                   'protocolo_activado.omitir_paso',
                   'registro.ver');

-- Los que aprueban en el catálogo estándar necesitan además el verbo de
-- aprobación. UTP aprueba el plan académico y la salida pedagógica; el Comité,
-- la resolución de medidas.
INSERT INTO ROL_PERMISOS (rol_id, permiso_id)
SELECT r.rol_id, p.permiso_id
FROM ROLES r
CROSS JOIN PERMISOS p
WHERE r.id_establecimiento IS NULL
  AND r.codigo IN ('UTP','COMITE_CONVIVENCIA')
  AND p.codigo = 'protocolo_activado.aprobar_paso';

-- DIRECTOR es el aprobador en casi todos los protocolos del catálogo. Hasta
-- ahora era un rol de solo lectura sobre protocolos; sin este permiso ninguno
-- de los diez podría avanzar más allá de su paso de resolución.
INSERT INTO ROL_PERMISOS (rol_id, permiso_id)
SELECT r.rol_id, p.permiso_id
FROM ROLES r CROSS JOIN PERMISOS p
WHERE r.codigo = 'DIRECTOR' AND r.id_establecimiento IS NULL
  AND p.codigo IN ('protocolo_activado.aprobar_paso', 'protocolo_activado.completar_paso');
