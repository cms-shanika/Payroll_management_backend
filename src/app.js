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

/** ------Security / Middleware ------- */

//If you'll sed cookies form the front end , enable credentials.

const corsOptions = {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',         //new chnages
    credentials: true,                                                   //new chnages
    methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],            //new changes
    allowedHeaders: ['Content-Type','Authorization'],                   //new changes
};


// global middleware

app.use(cors(corsOptions));

app.use(cors(corsOptions));               //new chnages

app.use(helmet());

//body parsers
app.use(express.json({ limit: '10mb'}));
app.use(express.urlencoded({ extended: true }));

//logs
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





