const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do Multer para upload de arquivos
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = './uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Nome do arquivo: timestamp_nomeoriginal
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '_' + file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: function (req, file, cb) {
        // Aceitar apenas PDF e DOC/DOCX
        const allowedMimes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];
        
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Apenas arquivos PDF e DOC/DOCX são permitidos'), false);
        }
    },
    limits: {
        fileSize: 5 * 1024 * 1024 // Limite de 5MB
    }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Middleware para tratamento de erros do multer
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'Arquivo muito grande. Tamanho máximo permitido: 5MB'
            });
        }
    }
    next(error);
});

// Rota para servir a página principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rota para processar o formulário
app.post('/enviar-candidatura', upload.single('resume'), async (req, res) => {
    let resumeFile = null;
    
    try {
        const { name, email, position } = req.body;
        resumeFile = req.file;

        // Validação dos campos
        if (!name || !email || !position || !resumeFile) {
            // Se houver arquivo mas validação falhar, remove o arquivo
            if (resumeFile && fs.existsSync(resumeFile.path)) {
                fs.unlinkSync(resumeFile.path);
            }
            return res.status(400).json({ 
                success: false, 
                message: 'Todos os campos são obrigatórios' 
            });
        }

        // Validação de email simples
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            if (resumeFile && fs.existsSync(resumeFile.path)) {
                fs.unlinkSync(resumeFile.path);
            }
            return res.status(400).json({
                success: false,
                message: 'E-mail inválido'
            });
        }

        // Configuração do transporter de e-mail (USE VARIÁVEIS DE AMBIENTE)
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.hostinger.com',
            port: process.env.SMTP_PORT || 587,
            secure: false,
            auth: {
                user: process.env.SMTP_USER || 'seu-email@pereirawesolutions.com.br',
                pass: process.env.SMTP_PASS || 'sua-senha'
            },
            tls: {
                rejectUnauthorized: false // Apenas para desenvolvimento
            }
        });

        // Verificar conexão com o servidor de email
        await transporter.verify();

        // Configuração do e-mail
        const mailOptions = {
            from: process.env.FROM_EMAIL || 'contato@pereirawesolutions.com.br',
            to: process.env.TO_EMAIL || 'rh@pereirawesolutions.com.br',
            replyTo: email,
            subject: `Nova Candidatura - ${position}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #323232ff;">Nova Candidatura Recebida</h2>
                    <div style="background: #f5f5f5; padding: 20px; border-radius: 5px;">
                        <p><strong>Nome:</strong> ${name}</p>
                        <p><strong>E-mail:</strong> ${email}</p>
                        <p><strong>Cargo desejado:</strong> ${position}</p>
                        <p><strong>Data do envio:</strong> ${new Date().toLocaleString('pt-BR')}</p>
                    </div>
                    <p style="margin-top: 20px; color: #666;">
                        Este e-mail foi enviado automaticamente através do sistema de candidaturas.
                    </p>
                </div>
            `,
            attachments: [
                {
                    filename: resumeFile.originalname,
                    path: resumeFile.path,
                    contentType: resumeFile.mimetype
                }
            ]
        };

        // Enviar e-mail
        await transporter.sendMail(mailOptions);

        // Excluir o arquivo após o envio bem-sucedido
        if (fs.existsSync(resumeFile.path)) {
            fs.unlinkSync(resumeFile.path);
        }

        console.log(`Candidatura enviada: ${name} - ${position}`);

        res.json({ 
            success: true, 
            message: 'Candidatura enviada com sucesso! Entraremos em contato em breve.' 
        });

    } catch (error) {
        console.error('Erro ao processar candidatura:', error);
        
        // Limpar arquivo em caso de erro
        if (resumeFile && fs.existsSync(resumeFile.path)) {
            fs.unlinkSync(resumeFile.path);
        }

        let errorMessage = 'Erro interno do servidor';
        
        if (error.code === 'ECONNECTION' || error.code === 'EAUTH') {
            errorMessage = 'Erro de configuração do servidor de e-mail';
        } else if (error.code === 'ENOENT') {
            errorMessage = 'Erro ao processar o arquivo anexo';
        }

        res.status(500).json({ 
            success: false, 
            message: errorMessage 
        });
    }
});

// Rota de health check
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString() 
    });
});

// Middleware para rotas não encontradas
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Rota não encontrada'
    });
});

// Middleware global de tratamento de erros
app.use((error, req, res, next) => {
    console.error('Erro não tratado:', error);
    res.status(500).json({
        success: false,
        message: 'Erro interno do servidor'
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Ambiente: ${process.env.NODE_ENV || 'desenvolvimento'}`);
});