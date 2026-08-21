const router = require('express').Router();
const { getAll, create, update, remove } = require('../controllers/protocolosGenericos.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { Permiso } = require('../constants/permisos');

// El catálogo genérico es global: no se filtra por establecimiento, así que
// aquí no corren resolverScope/requireEstablecimiento. Un ADMIN puede listarlo
// sin haber elegido un colegio.
router.use(verifyToken);

router.get('/',       requirePermission(Permiso.ProtocoloGenericoVer), getAll);      // todos los roles: es el catálogo del que se elige
router.post('/',      requirePermission(Permiso.ProtocoloGenericoCrear), create);    // solo ADMIN
router.put('/:id',    requirePermission(Permiso.ProtocoloGenericoEditar), update);   // solo ADMIN
router.delete('/:id', requirePermission(Permiso.ProtocoloGenericoEliminar), remove); // solo ADMIN

module.exports = router;
