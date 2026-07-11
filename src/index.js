require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const documentosRoutes = require('./routes/documents.routes');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth',        require('./routes/auth.routes'));
app.use('/api/registros',   require('./routes/registros.routes'));
app.use('/api/estudiantes', require('./routes/estudiantes.routes'));
app.use('/api/usuarios',    require('./routes/usuarios.routes'));
app.use('/api/tipos-falta', require('./routes/tiposFalta.routes'));
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// Document IA
app.use('/api/documents', documentosRoutes);


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));