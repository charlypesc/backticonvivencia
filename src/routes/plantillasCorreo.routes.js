const router = require('express').Router();
const { listar, actualizar } = require('../controllers/plantillasCorreo.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { Permiso } = require('../constants/permisos');

router.use(verifyToken);

// Mismo criterio que el listado de establecimientos de Geo: leer, cualquiera
// que entre a Geo; editar, quien puede editar establecimientos (es quien marca
// el estado del correo de contacto).
router.get('/',    listar);
router.put('/:id', requirePermission(Permiso.EstablecimientoEditar), actualizar);

module.exports = router;
