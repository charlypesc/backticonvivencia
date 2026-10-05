-- Permiso usuario.eliminar (2026-10-05).
--
-- Borra la cuenta de verdad, a diferencia de usuario.activar que solo la
-- suspende. Solo procede si la persona no firmó nada (registros, medidas,
-- protocolos…): esas FKs no tienen cascada y el expediente tiene que conservar
-- quién hizo cada cosa. En ese caso el backend responde 409 y sugiere
-- desactivarla.
--
-- Lo reciben el ADMIN (que igual pasa todos los chequeos) y el Coordinador de
-- convivencia (ENCARGADO), que es quien administra usuarios en cada colegio.

INSERT INTO PERMISOS (permiso_id, codigo, recurso, accion, descripcion) VALUES
  (117, 'usuario.eliminar', 'usuario', 'eliminar',
   'Usuarios: eliminar una cuenta sin historial (si tiene registros a su nombre, se desactiva)');

INSERT INTO ROL_PERMISOS (rol_id, permiso_id)
SELECT rol_id, 117 FROM ROLES WHERE codigo IN ('ADMIN', 'ENCARGADO') AND id_establecimiento IS NULL;
