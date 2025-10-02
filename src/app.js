require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const authRoutes = require('./routes/auth.routes');
const employeeRoutes = require('./routes/employee.routes');
const salaryRoutes = require('./routes/salary.routes');

const app = express();

// global middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// static serving of uploaded files (so UI can load images/docs)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// routes
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/salary', salaryRoutes);

// health
app.get('/health', (req, res) => res.json({ ok:true, status: 'UP' }));

// 404
app.use((req,res)=>res.status(404).json({ ok:false, message: 'Route not found'}));

module.exports = app;
