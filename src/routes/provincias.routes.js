const router = require('express').Router();
const { getAll, create, update, remove } = require('../controllers/provincias.controller');
const { verifyToken, requireRole } = require('../middleware/auth');

router.use(verifyToken);

router.get('/',       getAll);                            // ambos roles
router.post('/',      requireRole('ENCARGADO'), create);
router.put('/:id',    requireRole('ENCARGADO'), update);
router.delete('/:id', requireRole('ENCARGADO'), remove);

module.exports = router;
