const router = require('express').Router();
const { getAll, create, update, remove } = require('../controllers/tiposFalta.controller');
const { verifyToken, requireRole } = require('../middleware/auth');

router.use(verifyToken);

router.get('/',       getAll);                            // ambos roles
router.post('/',      requireRole('ENCARGADO'), create);  // solo ENCARGADO
router.put('/:id',    requireRole('ENCARGADO'), update);  // solo ENCARGADO
router.delete('/:id', requireRole('ENCARGADO'), remove);  // solo ENCARGADO

module.exports = router;