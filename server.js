const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const xlsx = require('xlsx');
const cors = require('cors');
const cron = require('node-cron');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_TO = process.env.EMAIL_TO;

app.use(bodyParser.json());
app.use(cors());
app.use(express.static('public'));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// --- ЛОГИКА EXCEL (RTL + Закрепление + Порядок) ---
async function generateExcelBuffer() {
    // Берем все задачи, даже удаленные (чтобы были в отчете)
    const result = await pool.query('SELECT * FROM tasks ORDER BY due_date ASC');
    const tasks = result.rows;

    const dataForExcel = [];
    let currentWeekStart = null;

    tasks.forEach(task => {
        const taskDate = new Date(task.due_date);
        const day = taskDate.getDay();
        const diff = taskDate.getDate() - day; 
        const weekStart = new Date(taskDate.setDate(diff));
        weekStart.setHours(0,0,0,0);
        const weekKey = weekStart.toDateString();

        if (weekKey !== currentWeekStart) {
            currentWeekStart = weekKey;
            const dateStr = weekStart.toLocaleDateString('he-IL');
            dataForExcel.push({});
            // Заголовок разделителя пишем в колонку "Дата начала" (самую правую)
            dataForExcel.push({
                "תאריך התחלה": `--- שבוע: ${dateStr} ---`
            });
        }

        // ПОРЯДОК КОЛОНОК (Справа налево для Excel RTL: A, B, C...)
        dataForExcel.push({
            "תאריך התחלה": task.start_date,      // A (Самая правая)
            "תאריך יעד": task.due_date,          // B
            "סיבת הארכה": task.extension_reason, // C
            "סטטוס": task.status,                // D
            "עדיפות": task.priority,             // E
            "תיאור משימה": task.description,     // F
            "מבצע": task.performer,              // G
            "אחראי": task.person_in_charge,      // H
            "קבלן": task.contractor,             // I
            "פרטי קשר קבלן": task.contractor_contact, // J
            "מזהה": task.id                      // K
        });
    });

    const wb = xlsx.utils.book_new();
    
    // Включаем RTL для всей книги
    wb.Workbook = { Views: [{ RTL: true }] };
    
    const ws = xlsx.utils.json_to_sheet(dataForExcel);

    // Закрепляем верхнюю строку (Freeze Top Row)
    // xSplit: 0 (колонок слева), ySplit: 1 (строк сверху)
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };

    // Ширина колонок
    ws['!cols'] = [
        {wch:15}, {wch:15}, {wch:25}, {wch:10}, {wch:10}, 
        {wch:40}, {wch:15}, {wch:15}, {wch:15}, {wch:20}, {wch:5}
    ];

    xlsx.utils.book_append_sheet(wb, ws, "Tasks Report");
    return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// --- CRON ---
cron.schedule('0 7 * * 0', async () => {
    if (!EMAIL_USER || !EMAIL_PASS || !EMAIL_TO) return;
    try {
        const excelBuffer = await generateExcelBuffer();
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: EMAIL_USER, pass: EMAIL_PASS }
        });
        const mailOptions = {
            from: EMAIL_USER,
            to: EMAIL_TO, // Nodemailer сам поймет запятые
            subject: '📊 TaskFlow - דוח שבועי (Weekly Report)',
            text: 'מצורף הדוח השבועי.',
            attachments: [{ filename: `Weekly_Report.xlsx`, content: excelBuffer }]
        };
        await transporter.sendMail(mailOptions);
    } catch (error) { console.error(error); }
}, { timezone: "Asia/Jerusalem" });

// --- API ---
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) res.json({ success: true });
    else res.status(401).json({ success: false });
});

app.get('/api/tasks', async (req, res) => {
    try {
        // Сортировка: Сначала важные, потом обычные. Удаленные - в самом конце.
        const result = await pool.query(`
            SELECT * FROM tasks 
            ORDER BY 
            CASE WHEN status = 'נמחק' THEN 2 WHEN status = 'בוצע' THEN 1 ELSE 0 END,
            CASE WHEN priority = 'חשוב' THEN 0 ELSE 1 END,
            due_date ASC
        `);
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

// 🔥 МЯГКОЕ УДАЛЕНИЕ (Вместо DELETE делаем UPDATE)
app.delete('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // Не удаляем строку, а ставим статус 'נמחק'
        await pool.query("UPDATE tasks SET status = 'נמחק' WHERE id = $1", [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

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