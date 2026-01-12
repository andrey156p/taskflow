const express = require('express');
const { Pool } = require('pg'); // Подключаем PostgreSQL
const bodyParser = require('body-parser');
const xlsx = require('xlsx');
const cors = require('cors');
const path = require('path');

const app = express();
// Порт берется из настроек Render или 3000 для локалки
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(cors());
app.use(express.static('public'));

// Настройка подключения к базе данных
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Создание таблицы (Синтаксис для Postgres немного отличается от SQLite)
pool.query(`
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`, (err, res) => {
    if (err) {
        console.error('Error creating table:', err);
    } else {
        console.log('Table "tasks" is ready in PostgreSQL');
    }
});

// --- API ROUTES ---

// GET: Список задач
app.get('/api/tasks', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM tasks 
            ORDER BY 
            CASE WHEN priority = 'חשוב' THEN 0 ELSE 1 END,
            CASE WHEN status = 'בתהליך' THEN 0 ELSE 1 END, 
            due_date ASC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST: Новая задача
app.post('/api/tasks', async (req, res) => {
    const { description, performer, contractor, contractor_contact, person_in_charge, start_date, due_date, priority } = req.body;
    
    // В Postgres вместо ? используются $1, $2... и нужно писать RETURNING id, чтобы получить номер новой задачи
    const sql = `
        INSERT INTO tasks (description, performer, contractor, contractor_contact, person_in_charge, start_date, due_date, priority, status, extension_reason) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'בתהליך', '') 
        RETURNING id
    `;
    const values = [description, performer, contractor, contractor_contact, person_in_charge, start_date, due_date, priority];

    try {
        const result = await pool.query(sql, values);
        res.json({ id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT: Обновление задачи
app.put('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;
    const { due_date, extension_reason, status } = req.body;
    
    let sql = `UPDATE tasks SET status = $1`;
    let values = [status];
    let count = 2; // Счетчик для $2, $3...

    if (due_date) {
        sql += `, due_date = $${count}`;
        values.push(due_date);
        count++;
    }
    if (extension_reason) {
        sql += `, extension_reason = $${count}`;
        values.push(extension_reason);
        count++;
    }

    sql += ` WHERE id = $${count}`;
    values.push(id);

    try {
        await pool.query(sql, values);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE: Удаление
app.delete('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// EXPORT: Выгрузка в Excel
app.get('/api/export', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM tasks ORDER BY created_at DESC');
        
        const data = result.rows.map(task => ({
            "מזהה": task.id,
            "תיאור משימה": task.description,
            "עדיפות": task.priority,
            "מבצע": task.performer,
            "קבלן": task.contractor,
            "אחראי": task.person_in_charge,
            "תאריך התחלה": task.start_date,
            "תאריך יעד": task.due_date,
            "סיבת הארכה": task.extension_reason,
            "סטטוס": task.status
        }));

        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.json_to_sheet(data);
        const wscols = [{wch:5}, {wch:30}, {wch:10}, {wch:15}, {wch:15}, {wch:15}, {wch:15}, {wch:15}, {wch:25}, {wch:10}];
        ws['!cols'] = wscols;

        xlsx.utils.book_append_sheet(wb, ws, "Tasks");
        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
        
        res.setHeader('Content-Disposition', 'attachment; filename="Tasks_Export.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});