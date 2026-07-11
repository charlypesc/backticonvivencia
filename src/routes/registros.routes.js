const router = require('express').Router();
const { getAll, getById, create, validar, update, remove, confirmar } = require('../controllers/registros.controller');
const { verifyToken, requireRole } = require('../middleware/auth');

router.use(verifyToken);

router.get('/',           getAll);
router.get('/:id',        getById);
router.post('/',          requireRole('ENCARGADO'),          create);
router.put('/:id',        requireRole('ENCARGADO', 'DIRECTOR'), update);
router.patch('/:id/validar', requireRole('DIRECTOR'),        validar);
router.delete('/:id',     requireRole('ENCARGADO'),          remove);
router.patch('/:id/confirmar', requireRole('ENCARGADO'), confirmar);

module.exports = router;