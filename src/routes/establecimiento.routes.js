const router = require('express').Router();
const { getMine, updateMine } = require('../controllers/establecimiento.controller');
const { verifyToken, requireRole } = require('../middleware/auth');

router.use(verifyToken);

router.get('/',  getMine);                            // ambos roles
router.put('/',  requireRole('DIRECTOR'), updateMine); // solo DIRECTOR

module.exports = router;
