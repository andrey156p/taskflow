const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const xlsx = require('xlsx');
const cors = require('cors');

const app = express();
const PORT = 3000;
const DB_PATH = './db.sqlite';

app.use(bodyParser.json());
app.use(cors());
app.use(express.static('public'));

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) console.error(err.message);
    console.log('Connected to the taskflow database.');
});

// Создаем таблицу с новыми полями: start_date, priority
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

app.get('/api/tasks', (req, res) => {
    // Сортировка: Сначала важные, потом по статусу, потом по дате
    const sql = `SELECT * FROM tasks ORDER BY 
        CASE WHEN priority = 'חשוב' THEN 0 ELSE 1 END,
        CASE WHEN status = 'בתהליך' THEN 0 ELSE 1 END, 
        due_date ASC`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/tasks', (req, res) => {
    const { description, performer, contractor, contractor_contact, person_in_charge, start_date, due_date, priority } = req.body;
    const sql = `INSERT INTO tasks (description, performer, contractor, contractor_contact, person_in_charge, start_date, due_date, priority, status, extension_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'בתהליך', '')`;
    const params = [description, performer, contractor, contractor_contact, person_in_charge, start_date, due_date, priority];
    
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID });
    });
});

app.put('/api/tasks/:id', (req, res) => {
    const { id } = req.params;
    const { due_date, extension_reason, status } = req.body;
    
    let sql = `UPDATE tasks SET status = ?`;
    let params = [status];

    if (due_date) {
        sql += `, due_date = ?`;
        params.push(due_date);
    }
    if (extension_reason) {
        sql += `, extension_reason = ?`;
        params.push(extension_reason);
    }

    sql += ` WHERE id = ?`;
    params.push(id);

    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ changes: this.changes });
    });
});

app.delete('/api/tasks/:id', (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM tasks WHERE id = ?`, id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ deleted: this.changes });
    });
});

app.get('/api/export', (req, res) => {
    const sql = `SELECT * FROM tasks ORDER BY created_at DESC`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const data = rows.map(task => ({
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
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});