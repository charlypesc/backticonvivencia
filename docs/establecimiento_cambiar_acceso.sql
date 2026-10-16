-- Geo: separar "suspender/restablecer el acceso de un colegio" de editarlo.
--
-- El interruptor de acceso iba con establecimiento.editar. Los usuarios de
-- ventas (Geo, sin colegio) tienen que poder corregir fichas, observaciones y
-- estado de correo sin poder dejar a un colegio entero sin entrar.
--
--   123 establecimiento.cambiar_acceso  PATCH /api/geo/establecimientos/:id/acceso
--
-- Se le da a todo rol que ya tenía establecimiento.editar, para que nadie
-- pierda lo que hoy hace (en producción, al 2026-10-16, solo ADMIN, que pasa
-- por bypass igual).
--
-- Aplicar justo al desplegar el back: verificarPermisos() aborta el arranque
-- si la tabla y src/constants/permisos.js no coinciden.

INSERT INTO PERMISOS (permiso_id, codigo, recurso, accion, descripcion) VALUES
  (123, 'establecimiento.cambiar_acceso', 'establecimiento', 'cambiar_acceso',
   'Establecimientos: suspender o restablecer el acceso de sus usuarios');

INSERT INTO ROL_PERMISOS (rol_id, permiso_id)
SELECT rol_id, 123 FROM ROL_PERMISOS WHERE permiso_id = 19;
