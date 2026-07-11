const router = require('express').Router();
const { getAll } = require('../controllers/estudiantes.controller');
const { verifyToken } = require('../middleware/auth');

router.use(verifyToken);
router.get('/', getAll);

module.exports = router;