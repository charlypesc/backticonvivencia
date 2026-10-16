// Roles que solo un ADMIN puede otorgar, quitar o ver, y cuyas cuentas solo un
// ADMIN puede administrar (editar, desactivar, restablecer la clave, borrar).
//
// ADMIN, porque da acceso a todo el sistema.
//
// VENTAS, porque da Geo: todos los colegios del país con sus notas comerciales.
// Es un rol del Colegio MiConvivencia (docs/rol_ventas.sql), y ese colegio
// tiene cuentas demo con ENCARGADO, que trae usuario.crear, asignar_rol y
// restablecer_password. Sin esta lista, cualquiera que entre a la demo podría
// darse VENTAS a sí mismo o quedarse con la cuenta de un vendedor.
const ROLES_SOLO_ADMIN = Object.freeze(['ADMIN', 'VENTAS']);

const esRolSoloAdmin = (codigo) => ROLES_SOLO_ADMIN.includes(codigo);

module.exports = { ROLES_SOLO_ADMIN, esRolSoloAdmin };
