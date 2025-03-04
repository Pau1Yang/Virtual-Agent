const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');  // 导入session中间件
const OpenAI = require('openai');
const dotenv = require('dotenv');
const { SourceTextModule } = require('vm');
const mysql = require('mysql'); // 导入 MySQL 模块
const cron = require('node-cron');
const Excel = require('exceljs');
const nodemailer = require('nodemailer');

// 定时任务，例如每周日午夜执行
cron.schedule('0 0 * * 0', function() {
    console.log('Running a task every week');
    fetchDataAndSendEmail();
});


async function fetchDataAndSendEmail() {
    const query = 'SELECT * FROM chat'; // 获取所有聊天记录
    connection.query(query, async (error, results) => {
        if (error) {
            return console.error('Error fetching data:', error);
        }
        const workbook = new Excel.Workbook();
        const worksheet = workbook.addWorksheet('Chat History');
        worksheet.columns = [
            { header: 'Question', key: 'question', width: 30 },
            { header: 'Response', key: 'response', width: 30 }
        ];
        // Add array rows
        worksheet.addRows(results);

        // Write to a file
        try {
            await workbook.xlsx.writeFile('ChatHistory.xlsx');
            console.log('File is written');
            sendEmail(); // Send email after file is written
        } catch (err) {
            console.error('Error writing file:', err);
        }
    });
}

function sendEmail() {
    const transporter = nodemailer.createTransport({
        host: 'smtp-mail.outlook.com',
        port: 587,
        secure: false, // true for 465, false for other ports
        auth: {
            user: process.env.OUTLOOK_USER,
            pass: process.env.OUTLOOK_PASS
        },
        tls: {
            ciphers:'SSLv3'
        }
    });
    

    const mailOptions = {
        from: 'testoskoala@outlook.com',
        to: '313431672yys@gmail.com',
        subject: 'Weekly Chat History',
        text: 'Attached is this week\'s chat history.',
        attachments: [
            {
                filename: 'ChatHistory.xlsx',
                path: './ChatHistory.xlsx'
            }
        ]
    };

    transporter.sendMail(mailOptions, function(error, info){
        if (error) {
            console.log('Error sending mail:', error);
        } else {
            console.log('Email sent: ' + info.response);
            clearDatabase();
            // Optionally, clear the database here if needed
        }
    });
}

function clearDatabase() {
    console.log('start clear');
    const query = 'DELETE FROM chat'; // 清空聊天表
    connection.query(query, (error, results) => {
        if (error) {
            return console.error('Error clearing database:', error);
        }
        console.log('Database cleared');
    });
}

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const messageStore = new Map();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// 创建 MySQL 连接
// const connection = mysql.createConnection({
//     host: 'localhost',
//     user: 'root',
//     password: '',
//     database: 'chat_history'
// });
const dbConfig = process.env.JAWSDB_URL;
const connection = mysql.createConnection(dbConfig);
// 连接到 MySQL 数据库
connection.connect();

app.use(express.static('src/public'));
app.use(session({
    secret: process.env.SESSION_SECRET, // 用于签名session ID的密钥
    saveUninitialized: true,
    resave: true
}));

// 主页面路由
app.get('/', (req, res) => {
    res.sendFile('mainPage.html', { root: __dirname + '/src/public' });  // 发送mainpage.html作为主页
});

// 聊天页面路由
app.get('/chatPage', (req, res) => {
    if (req.session.authorized) {  // 检查session中的授权状态
        res.sendFile(__dirname + '/src/public/chatPage.html'); // 发送chatPage.html
    } else {
        res.redirect('/');  // 重定向回主页面
    }
});

// 当点击开始按钮时设置session
app.get('/start-chat', (req, res) => {
    req.session.authorized = true;  // 设置session中的授权标记
    res.redirect('/chatPage');  // 重定向到聊天页面
});
messages: [
    {"role": "system", "content": "You are a helpful assistant."}
]
io.on('connection', (socket) => {
    const initialMessages = [
        {"role": "system", "content": "You are a helpful assistant."}
    ];
    messageStore.set(socket.id, initialMessages);
    console.log("Connect!")
    socket.on('askQuestion', async (question) => {
        try {
            console.log(question)
            const messages = messageStore.get(socket.id);
            const completion = await openai.chat.completions.create({
                // messages: [
                //     {"role": "system", "content": "You are a helpful assistant."},
                //     {"role": "user", "content": question}
                // ],
                messages: messages.concat([
                    {"role": "user", "content": question}
                ]),
                model: "ft:gpt-3.5-turbo-1106:chesm:ver1:9RejJ94f"
            });
            console.log("Respond!")
            const response = completion.choices[0].message["content"];
            // 将问题和回答插入到 MySQL 数据库中
            const sql = 'INSERT INTO chat (question, response) VALUES (?, ?)';
            connection.query(sql, [question, response], (error, results, fields) => {
                if (error) {
                    console.error('Error inserting into database:', error);
                } else {
                    console.log('Question and response inserted into database successfully.');
                    console.log(question);
                    console.log(response);
                }
            });
            // 更新消息存储
            if (messages.length > 6) {  // 最大存储量为1个初始消息+5个交互消息
                messages.splice(2, 1);  // 删除出了初始消息以外的第一条消息
            }
            messages.push(
                {"role": "user", "content": question},
                {"role": "system", "content": response}
            );
            messageStore.set(socket.id, messages);
            socket.emit('response', completion.choices[0].message);
            console.log(completion.choices[0].message);
        } catch (error) {
            console.error('Error calling OpenAI API:', error);
            socket.emit('response', "Sorry, I couldn't process your request.");
        }
    });
    socket.on('disconnect', () => {
        // 当用户断开连接时，清理其聊天历史
        messageStore.delete(socket.id);
        console.log("Disconnected!");
    });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
