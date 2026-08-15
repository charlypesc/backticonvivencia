const router = require('express').Router();
const { getAll, getById, create, update, remove } = require('../controllers/establecimiento.controller');
const { verifyToken, requireRole } = require('../middleware/auth');

router.use(verifyToken);

router.get('/',       getAll);                             // ambos roles
router.get('/:id',    getById);                             // ambos roles
router.post('/',      requireRole('ENCARGADO'), create);
router.put('/:id',    requireRole('ENCARGADO'), update);
router.delete('/:id', requireRole('ENCARGADO'), remove);

module.exports = router;
