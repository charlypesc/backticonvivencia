-- Quitar mi_establecimiento.ver (27) y mi_establecimiento.editar (28).
--
-- Ver no se exigía en ningún lado, y Editar solo protegía el PUT
-- /api/establecimiento, que llamaba únicamente una pantalla nunca conectada a
-- ruta ni menú. En la grilla de permisos aparecían como una tarjeta "Otros" sin
-- efecto real. Los datos de un colegio se editan desde Geo
-- (establecimiento.editar); el PUT y la pantalla se borraron junto con esto.
--
-- Aplicar justo al desplegar el back: verificarPermisos() aborta el arranque
-- si la tabla y src/constants/permisos.js no coinciden.

DELETE FROM USUARIO_PERMISOS WHERE permiso_id IN (27, 28);
DELETE FROM ROL_PERMISOS     WHERE permiso_id IN (27, 28);
DELETE FROM PERMISOS         WHERE permiso_id IN (27, 28);
