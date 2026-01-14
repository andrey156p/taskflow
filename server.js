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

// АВТО-ОБНОВЛЕНИЕ ТАБЛИЦЫ
async function updateTableSchema() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS tasks (
                id SERIAL PRIMARY KEY,
                description TEXT,
                performer TEXT,
                contractor TEXT,
                contractor_contact TEXT,
                person_in_charge TEXT,
                start_date TEXT,
                due_date TEXT,
                extension_reason TEXT,
                priority TEXT DEFAULT 'רגיל',
                status TEXT DEFAULT 'בתהליך',
                materials TEXT,
                supplier TEXT,
                supplier_contact TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS materials TEXT");
        await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS supplier TEXT");
        await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS supplier_contact TEXT");
        console.log("✅ Database schema updated");
    } catch (e) { console.log("ℹ️ Schema update info:", e.message); }
}
updateTableSchema();

// --- EXCEL LOGIC ---
async function generateExcelBuffer() {
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
            dataForExcel.push({ "תאריך התחלה": `--- שבוע: ${dateStr} ---` });
        }

        dataForExcel.push({
            "תאריך התחלה": task.start_date,      
            "תאריך יעד": task.due_date,          
            "סיבת הארכה": task.extension_reason, 
            "סטטוס": task.status,                
            "עדיפות": task.priority,             
            "תיאור משימה": task.description,     
            "חומרים דרושים": task.materials,     
            "מבצע": task.performer,              
            "אחראי": task.person_in_charge,      
            "קבלן": task.contractor,             
            "פרטי קשר קבלן": task.contractor_contact, 
            "ספק": task.supplier,                
            "פרטי קשר ספק": task.supplier_contact, 
            "מזהה": task.id                      
        });
    });

    const wb = xlsx.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    const ws = xlsx.utils.json_to_sheet(dataForExcel);
    ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
    ws['!cols'] = [{wch:12}, {wch:12}, {wch:20}, {wch:10}, {wch:8}, {wch:35}, {wch:20}, {wch:15}, {wch:15}, {wch:15}, {wch:15}, {wch:15}, {wch:15}, {wch:5}];

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
            to: EMAIL_TO,
            subject: '📊 TaskFlow - דוח שבועי',
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
        const result = await pool.query(`
            SELECT * FROM tasks 
            WHERE status != 'נמחק'
            ORDER BY 
            CASE WHEN status = 'בוצע' THEN 1 ELSE 0 END,
            CASE WHEN priority = 'חשוב' THEN 0 ELSE 1 END,
            due_date ASC
        `);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/tasks', async (req, res) => {
    const { description, performer, contractor, contractor_contact, person_in_charge, start_date, due_date, priority, materials, supplier, supplier_contact } = req.body;
    try {
        const sql = `
            INSERT INTO tasks (description, performer, contractor, contractor_contact, person_in_charge, start_date, due_date, priority, materials, supplier, supplier_contact, status, extension_reason) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'בתהליך', '') 
            RETURNING id
        `;
        const values = [description, performer, contractor, contractor_contact, person_in_charge, start_date, due_date, priority, materials, supplier, supplier_contact];
        const result = await pool.query(sql, values);
        res.json({ id: result.rows[0].id });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 🔥 ОБНОВЛЕННЫЙ PUT (РЕДАКТИРОВАНИЕ)
app.put('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;
    
    // Мы ожидаем получить ВСЕ поля для обновления
    const { 
        description, performer, contractor, contractor_contact, 
        person_in_charge, start_date, due_date, priority, 
        materials, supplier, supplier_contact, status, extension_reason 
    } = req.body;

    // Если пришел запрос только на продление срока (старый функционал)
    if (!description) {
        // Логика простого продления или смены статуса
        let sql = `UPDATE tasks SET status = $1`;
        let values = [status];
        let count = 2;
        if (due_date) { sql += `, due_date = $${count}`; values.push(due_date); count++; }
        if (extension_reason) { sql += `, extension_reason = $${count}`; values.push(extension_reason); count++; }
        sql += ` WHERE id = $${count}`; values.push(id);
        
        try { await pool.query(sql, values); res.json({ success: true }); } 
        catch (err) { res.status(500).json({ error: err.message }); }
        return;
    }

    // ЛОГИКА ПОЛНОГО РЕДАКТИРОВАНИЯ
    const sql = `
        UPDATE tasks SET 
        description = $1, performer = $2, contractor = $3, contractor_contact = $4,
        person_in_charge = $5, start_date = $6, due_date = $7, priority = $8,
        materials = $9, supplier = $10, supplier_contact = $11
        WHERE id = $12
    `;
    const values = [
        description, performer, contractor, contractor_contact, 
        person_in_charge, start_date, due_date, priority, 
        materials, supplier, supplier_contact, id
    ];

    try {
        await pool.query(sql, values);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query("UPDATE tasks SET status = 'נמחק' WHERE id = $1", [id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
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