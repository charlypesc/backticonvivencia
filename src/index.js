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
app.use('/api/protocolos-genericos',       require('./routes/protocolosGenericos.routes'));
app.use('/api/protocolos-establecimiento', require('./routes/protocolosEstablecimiento.routes'));
app.use('/api/protocolos-activados',       require('./routes/protocolosActivados.routes'));
app.use('/api/cursos',         require('./routes/cursos.routes'));
app.use('/api/establecimiento', require('./routes/establecimiento.routes'));
app.use('/api/establecimientos', require('./routes/establecimientos.routes'));
app.use('/api/sostenedores',   require('./routes/sostenedor.routes'));
app.use('/api/geo/paises',     require('./routes/paises.routes'));
app.use('/api/geo/regiones',   require('./routes/regiones.routes'));
app.use('/api/geo/provincias', require('./routes/provincias.routes'));
app.use('/api/geo/comunas',    require('./routes/comunas.routes'));
app.use('/api/geo/establecimientos', require('./routes/establecimientosGeo.routes'));
// app.use('/api/estudiantes', require('./routes/estudiantes.routes'));
app.get('/health', (_, res) => res.json({ status: 'ok' }));
app.use('/api/dashboard', require('./routes/dashboard.routes'));

// Document IA
app.use('/api/documents', documentosRoutes);


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));