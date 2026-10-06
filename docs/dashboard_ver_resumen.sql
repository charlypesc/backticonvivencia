-- Inicio: separar los pendientes propios del resumen del colegio.
--
-- Hasta ahora dashboard.ver se mostraba en Roles pero no se exigía: Inicio lo
-- veía cualquiera con sesión, y con él las cifras de todo el establecimiento.
-- Al empezar a exigirlo, los roles que no lo tenían (Orientador, Trabajador
-- social, Docente...) perdían también su bandeja de derivaciones, que solo
-- aparece en Inicio. Por eso se parte en dos:
--
--    65 dashboard.ver          entrar a Inicio y ver los pendientes propios
--                              (registros por atender, derivaciones recibidas).
--                              Se le da a todos los roles.
--   121 dashboard.ver_resumen  las cifras del establecimiento: resumen del mes,
--                              alertas por estudiante, cumplimiento, últimos
--                              registros y estadísticas. Solo a los roles que
--                              ya tenían dashboard.ver, que hoy ven todo eso.
--
-- Aplicar justo al desplegar el back: verificarPermisos() aborta el arranque
-- si la tabla y src/constants/permisos.js no coinciden, y la base es la misma
-- que usa producción.

-- Primero ver_resumen a quienes ya tenían el panel completo; recién después
-- dashboard.ver a todos (al revés, todos quedarían con el resumen).
INSERT INTO PERMISOS (permiso_id, codigo, recurso, accion, descripcion) VALUES
  (121, 'dashboard.ver_resumen', 'dashboard', 'ver_resumen',
   'Inicio: ver el resumen del mes, alertas, cumplimiento y estadísticas del establecimiento');

INSERT INTO ROL_PERMISOS (rol_id, permiso_id)
SELECT rol_id, 121 FROM ROL_PERMISOS WHERE permiso_id = 65;

INSERT INTO ROL_PERMISOS (rol_id, permiso_id)
SELECT r.rol_id, 65 FROM ROLES r
 WHERE NOT EXISTS (SELECT 1 FROM ROL_PERMISOS rp WHERE rp.rol_id = r.rol_id AND rp.permiso_id = 65);
