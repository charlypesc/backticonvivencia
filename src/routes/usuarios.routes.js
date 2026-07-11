const router = require('express').Router();
const { getAll, create, toggleActivo } = require('../controllers/usuarios.controller');
const { verifyToken, requireRole } = require('../middleware/auth');

router.use(verifyToken);
router.use(requireRole('DIRECTOR')); // todo este router es solo DIRECTOR

router.get('/',                getAll);
router.post('/',               create);
router.patch('/:id/toggle',    toggleActivo);

module.exports = router;