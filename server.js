const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const xlsx = require('xlsx');
const cors = require('cors');
const cron = require('node-cron'); // Планировщик
const nodemailer = require('nodemailer'); // Почта

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Настройки почты (берем из Render)
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_TO = process.env.EMAIL_TO; // Куда отправлять отчет

app.use(bodyParser.json());
app.use(cors());
app.use(express.static('public'));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// --- ЛОГИКА ГЕНЕРАЦИИ EXCEL С РАЗДЕЛИТЕЛЯМИ ---
async function generateExcelBuffer() {
    // Получаем задачи, отсортированные по дате (сначала старые)
    const result = await pool.query('SELECT * FROM tasks ORDER BY due_date ASC');
    const tasks = result.rows;

    const dataForExcel = [];
    let currentWeekStart = null;

    tasks.forEach(task => {
        const taskDate = new Date(task.due_date);
        // Вычисляем начало недели (Воскресенье) для этой задачи
        const day = taskDate.getDay();
        const diff = taskDate.getDate() - day; 
        const weekStart = new Date(taskDate.setDate(diff));
        weekStart.setHours(0,0,0,0);
        const weekKey = weekStart.toDateString();

        // Если неделя изменилась - добавляем разделитель
        if (weekKey !== currentWeekStart) {
            currentWeekStart = weekKey;
            // Форматируем дату для заголовка
            const dateStr = weekStart.toLocaleDateString('he-IL');
            dataForExcel.push({}); // Пустая строка для отступа
            dataForExcel.push({
                "תיאור משימה": `--- נתונים עבור שבוע המתחיל ב: ${dateStr} ---`
            });
        }

        // Добавляем саму задачу
        dataForExcel.push({
            "מזהה": task.id,
            "תיאור משימה": task.description,
            "עדיפות": task.priority,
            "מבצע": task.performer,
            "קבלן": task.contractor,
            "פרטי קשר קבלן": task.contractor_contact,
            "אחראי": task.person_in_charge,
            "תאריך התחלה": task.start_date,
            "תאריך יעד": task.due_date,
            "סיבת הארכה": task.extension_reason,
            "סטטוס": task.status
        });
    });

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(dataForExcel);
    
    // Настройка ширины (визуально)
    ws['!cols'] = [{wch:5}, {wch:40}, {wch:10}, {wch:15}, {wch:15}, {wch:20}, {wch:15}, {wch:15}, {wch:15}, {wch:25}, {wch:10}];

    xlsx.utils.book_append_sheet(wb, ws, "Weekly Report");
    return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// --- ПЛАНИРОВЩИК (CRON) ---
// Каждое воскресенье в 07:00 по Иерусалиму
cron.schedule('0 7 * * 0', async () => {
    console.log('⏳ Running weekly email job...');
    
    if (!EMAIL_USER || !EMAIL_PASS || !EMAIL_TO) {
        console.error('❌ Email settings are missing in environment variables!');
        return;
    }

    try {
        const excelBuffer = await generateExcelBuffer();

        // Настройка отправителя
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: EMAIL_USER, pass: EMAIL_PASS }
        });

        // Письмо
        const mailOptions = {
            from: EMAIL_USER,
            to: EMAIL_TO,
            subject: '📊 TaskFlow - דוח שבועי (Weekly Report)',
            text: 'מצורף הדוח השבועי שלך עם חלוקה לפי שבועות.\n\nבברכה,\nTaskFlow Bot',
            attachments: [
                {
                    filename: `Weekly_Report_${new Date().toLocaleDateString('he-IL').replace(/\./g, '-')}.xlsx`,
                    content: excelBuffer
                }
            ]
        };

        await transporter.sendMail(mailOptions);
        console.log('✅ Email sent successfully!');

    } catch (error) {
        console.error('❌ Error sending email:', error);
    }
}, {
    timezone: "Asia/Jerusalem"
});


// --- ОБЫЧНЫЕ API (БЕЗ ИЗМЕНЕНИЙ) ---
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) res.json({ success: true });
    else res.status(401).json({ success: false });
});

app.get('/api/tasks', async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM tasks ORDER BY CASE WHEN priority = 'חשוב' THEN 0 ELSE 1 END, CASE WHEN status = 'בתהליך' THEN 0 ELSE 1 END, due_date ASC`);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/tasks', async (req, res) => {
    const { description, performer, contractor, contractor_contact, person_in_charge, start_date, due_date, priority } = req.body;
    try {
        const result = await pool.query(`INSERT INTO tasks (description, performer, contractor, contractor_contact, person_in_charge, start_date, due_date, priority, status, extension_reason) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'בתהליך', '') RETURNING id`, [description, performer, contractor, contractor_contact, person_in_charge, start_date, due_date, priority]);
        res.json({ id: result.rows[0].id });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;
    const { due_date, extension_reason, status } = req.body;
    let sql = `UPDATE tasks SET status = $1`;
    let values = [status];
    let count = 2;
    if (due_date) { sql += `, due_date = $${count}`; values.push(due_date); count++; }
    if (extension_reason) { sql += `, extension_reason = $${count}`; values.push(extension_reason); count++; }
    sql += ` WHERE id = $${count}`; values.push(id);
    try { await pool.query(sql, values); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/tasks/:id', async (req, res) => {
    try { await pool.query('DELETE FROM tasks WHERE id = $1', [req.params.id]); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// Кнопка скачать Excel вручную (теперь использует ту же функцию генерации)
app.get('/api/export', async (req, res) => {
    try {
        const buffer = await generateExcelBuffer();
        res.setHeader('Content-Disposition', 'attachment; filename="Tasks_Export.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});