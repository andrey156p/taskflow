const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const xlsx = require('xlsx');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Ключи Google Sheets
const SHEET_ID = process.env.SHEET_ID;
const GOOGLE_EMAIL = process.env.GOOGLE_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '';

app.use(bodyParser.json());
app.use(cors());
app.use(express.static('public'));

// 🇮🇱 СЛОВАРЬ (Заголовки из твоей таблицы)
const H = {
    id: 'מזהה', desc: 'תיאור משימה', perf: 'מבצע', contr: 'קבלן',
    contr_c: 'פרטי קשר קבלן', pic: 'אחראי', mat: 'חומרים דרושים',
    sup: 'ספק', sup_c: 'איש קשר ספק', start: 'תאריך התחלה',
    due: 'תאריך יעד', prio: 'עדיפות', stat: 'סטטוס', ext: 'סיבת הארכה'
};

async function initSheet() {
    if (!SHEET_ID || !GOOGLE_EMAIL || !GOOGLE_PRIVATE_KEY) {
        console.error("❌ Отсутствуют ключи Google Sheets в Render Environment");
        throw new Error("Missing credentials");
    }
    const serviceAccountAuth = new JWT({
        email: GOOGLE_EMAIL,
        key: GOOGLE_PRIVATE_KEY,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    return doc.sheetsByIndex[0];
}

// --- EXCEL (ДЛЯ КНОПКИ СКАЧИВАНИЯ) ---
async function generateExcelBuffer() {
    const sheet = await initSheet();
    const rows = await sheet.getRows();

    let tasks = rows.map(row => ({
        start_date: row.get(H.start), due_date: row.get(H.due),
        extension_reason: row.get(H.ext), status: row.get(H.stat),
        priority: row.get(H.prio), description: row.get(H.desc),
        materials: row.get(H.mat), performer: row.get(H.perf),
        person_in_charge: row.get(H.pic), contractor: row.get(H.contr),
        contractor_contact: row.get(H.contr_c), supplier: row.get(H.sup),
        supplier_contact: row.get(H.sup_c), id: row.get(H.id)
    }));

    tasks.sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

    const dataForExcel = [];
    let currentWeekStart = null;

    tasks.forEach(task => {
        if (!task.due_date) return;
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
            "תאריך התחלה": task.start_date || '',      
            "תאריך יעד": task.due_date || '',          
            "סיבת הארכה": task.extension_reason || '', 
            "סטטוס": task.status || '',                
            "עדיפות": task.priority || '',             
            "תיאור משימה": task.description || '',     
            "חומרים דרושים": task.materials || '',     
            "מבצע": task.performer || '',              
            "אחראי": task.person_in_charge || '',      
            "קבלן": task.contractor || '',             
            "פרטי קשר קבלן": task.contractor_contact || '', 
            "ספק": task.supplier || '',                
            "פרטי קשר ספק": task.supplier_contact || '', 
            "מזהה": task.id || ''                      
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

// --- API ---
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) res.json({ success: true });
    else res.status(401).json({ success: false });
});

app.get('/api/tasks', async (req, res) => {
    try {
        const sheet = await initSheet();
        const rows = await sheet.getRows();
        
        let tasks = rows.map(row => ({
            id: row.get(H.id), description: row.get(H.desc),
            performer: row.get(H.perf), contractor: row.get(H.contr),
            contractor_contact: row.get(H.contr_c), person_in_charge: row.get(H.pic),
            materials: row.get(H.mat), supplier: row.get(H.sup),
            supplier_contact: row.get(H.sup_c), start_date: row.get(H.start),
            due_date: row.get(H.due), priority: row.get(H.prio),
            status: row.get(H.stat), extension_reason: row.get(H.ext)
        }));

        tasks = tasks.filter(t => t.status !== 'נמחק');

        tasks.sort((a, b) => {
            if (a.status === 'בוצע' && b.status !== 'בוצע') return 1;
            if (a.status !== 'בוצע' && b.status === 'בוצע') return -1;
            if (a.priority === 'חשוב' && b.priority !== 'חשוב') return -1;
            if (a.priority !== 'חשוב' && b.priority === 'חשוב') return 1;
            return new Date(a.due_date) - new Date(b.due_date);
        });

        res.json(tasks);
    } catch (err) { 
        console.error(err);
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/tasks', async (req, res) => {
    try {
        const sheet = await initSheet();
        const t = req.body;
        const newId = Math.floor(Date.now() / 1000).toString(); 
        
        await sheet.addRow({
            [H.id]: newId, [H.desc]: t.description || '', [H.perf]: t.performer || '',
            [H.contr]: t.contractor || '', [H.contr_c]: t.contractor_contact || '',
            [H.pic]: t.person_in_charge || '', [H.mat]: t.materials || '',
            [H.sup]: t.supplier || '', [H.sup_c]: t.supplier_contact || '',
            [H.start]: t.start_date || '', [H.due]: t.due_date || '',
            [H.prio]: t.priority || 'רגיל', [H.stat]: 'בתהליך', [H.ext]: ''
        });

        res.json({ id: newId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/tasks/:id', async (req, res) => {
    try {
        const sheet = await initSheet();
        const rows = await sheet.getRows();
        const row = rows.find(r => r.get(H.id) === req.params.id);
        if (!row) return res.status(404).json({ error: "Task not found" });

        const t = req.body;
        
        if (!t.description) {
            if (t.status) row.set(H.stat, t.status);
            if (t.due_date) row.set(H.due, t.due_date);
            if (t.extension_reason) row.set(H.ext, t.extension_reason);
        } else {
            row.set(H.desc, t.description); row.set(H.perf, t.performer);
            row.set(H.contr, t.contractor); row.set(H.contr_c, t.contractor_contact);
            row.set(H.pic, t.person_in_charge); row.set(H.mat, t.materials);
            row.set(H.sup, t.supplier); row.set(H.sup_c, t.supplier_contact);
            row.set(H.start, t.start_date); row.set(H.due, t.due_date);
            row.set(H.prio, t.priority);
        }

        await row.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/tasks/:id', async (req, res) => {
    try {
        const sheet = await initSheet();
        const rows = await sheet.getRows();
        const row = rows.find(r => r.get(H.id) === req.params.id);
        if (row) {
            row.set(H.stat, 'נמחק');
            await row.save();
        }
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