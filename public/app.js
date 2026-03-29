const API_URL = '/api/tasks';
let currentTasks = [];

function togglePasswordVisibility() {
    const passwordInput = document.getElementById('passwordInput');
    const toggleBtn = document.getElementById('togglePasswordBtn');
    
    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        toggleBtn.textContent = '🙈';
    } else {
        passwordInput.type = 'password';
        toggleBtn.textContent = '👁️';
    }
}

window.onscroll = function() { scrollFunction() };
function scrollFunction() {
    const btn = document.getElementById("scrollTopBtn");
    if (document.body.scrollTop > 200 || document.documentElement.scrollTop > 200) {
        btn.style.display = "block";
    } else {
        btn.style.display = "none";
    }
}
function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function checkLogin() {
    const password = document.getElementById('passwordInput').value;
    const errorMsg = document.getElementById('loginError');
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const data = await res.json();
        if (data.success) {
            document.getElementById('login-overlay').style.display = 'none';
            document.getElementById('main-view').classList.remove('hidden');
            fetchTasks();
        } else {
            errorMsg.style.display = 'block';
        }
    } catch (e) { alert('שגיאת תקשורת'); }
}

document.getElementById('passwordInput').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') checkLogin();
});

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('startDate').valueAsDate = new Date();
    
    document.getElementById('addTaskForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const isImportant = document.getElementById('isImportant').checked;
        
        const newTask = {
            description: document.getElementById('desc').value,
            performer: document.getElementById('performer').value,
            contractor: document.getElementById('contractor').value,
            contractor_contact: document.getElementById('contact').value,
            person_in_charge: document.getElementById('inCharge').value,
            materials: document.getElementById('materials').value,
            supplier: document.getElementById('supplier').value,
            supplier_contact: document.getElementById('supplierContact').value,
            start_date: document.getElementById('startDate').value,
            due_date: document.getElementById('dueDate').value,
            priority: isImportant ? 'חשוב' : 'רגיל'
        };

        await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newTask)
        });

        e.target.reset();
        document.getElementById('startDate').valueAsDate = new Date();
        fetchTasks();
    });

    document.getElementById('editTaskForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('editTaskId').value;
        
        const updatedTask = {
            description: document.getElementById('editDesc').value,
            priority: document.getElementById('editIsImportant').checked ? 'חשוב' : 'רגיל',
            performer: document.getElementById('editPerformer').value,
            person_in_charge: document.getElementById('editInCharge').value,
            contractor: document.getElementById('editContractor').value,
            contractor_contact: document.getElementById('editContact').value,
            materials: document.getElementById('editMaterials').value,
            supplier: document.getElementById('editSupplier').value,
            supplier_contact: document.getElementById('editSupplierContact').value,
            start_date: document.getElementById('editStartDate').value,
            due_date: document.getElementById('editDueDate').value
        };

        await fetch(`${API_URL}/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedTask)
        });

        alert('המשימה עודכנה בהצלחה!');
        cancelEdit(); 
        showMainView(); 
    });
});

async function fetchTasks() {
    const res = await fetch(API_URL);
    currentTasks = await res.json();
    renderTasks();
}

function calculateProgress(start, end) {
    const startDate = new Date(start).getTime();
    const endDate = new Date(end).getTime();
    const now = new Date().getTime();
    if (now < startDate) return 0;
    if (now > endDate) return 100;
    const total = endDate - startDate;
    const elapsed = now - startDate;
    if (total <= 0) return 100; 
    return Math.floor((elapsed / total) * 100);
}

function renderTasks() {
    const list = document.getElementById('tasksList');
    list.innerHTML = '';

    currentTasks.forEach(task => {
        const div = document.createElement('div');
        
        let classes = 'task-item';
        if (task.status === 'בוצע') classes += ' done';
        else if (task.priority === 'חשוב') classes += ' important';
        if (task.extension_reason && task.extension_reason.trim() !== '') classes += ' extended';

        div.className = classes;
        
        let statusClass = task.status === 'בוצע' ? 'status-done' : 'status-process';
        
        const priorityBadge = task.priority === 'חשוב' && task.status !== 'בוצע' 
            ? '<span style="background: red; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.8rem; margin-left: 5px;">🔥 דחוף</span>' 
            : '';
            
        const extendedIcon = (task.extension_reason && task.extension_reason !== '') ? '⏱️' : '';

        const progressPercent = calculateProgress(task.start_date, task.due_date);
        let progressColor = '';
        if (progressPercent > 75) progressColor = 'warning';
        if (progressPercent > 90) progressColor = 'danger';
        
        let displayProgress = progressPercent;
        let progressStyle = `width: ${displayProgress}%;`;
        if (task.status === 'בוצע') progressStyle += 'background-color: #28a745;';

        div.innerHTML = `
            <div class="task-header">
                <div>
                    <strong>${priorityBadge} ${task.description}</strong> ${extendedIcon}<br>
                    <small style="color: #666; font-weight: 500;">
                        📅 התחלה: <span dir="ltr">${task.start_date}</span> | יעד: <span dir="ltr">${task.due_date}</span>
                    </small>
                </div>
                <div>
                    <span class="status-badge ${statusClass}">${task.status}</span>
                </div>
            </div>
            
            <div class="progress-container">
                <div class="progress-bar ${progressColor}" style="${progressStyle}"></div>
            </div>
        `;
        
        div.onclick = () => showTaskDetails(task.id);
        list.appendChild(div);
    });
}

function showTaskDetails(id) {
    const task = currentTasks.find(t => t.id === id);
    if (!task) return;

    const content = document.getElementById('detail-content');
    const isDone = task.status === 'בוצע';

    let html = `
        <h3>${task.description}</h3>
        <div class="detail-row"><div class="detail-label">סטטוס</div><div class="detail-value">${task.status}</div></div>
        
        <h4 style="margin:15px 0 5px; color:#0d47a1; border-bottom:1px solid #ddd;">אנשים</h4>
        <div class="detail-row"><div class="detail-label">מבצע</div><div class="detail-value">${task.performer}</div></div>
        <div class="detail-row"><div class="detail-label">אחראי</div><div class="detail-value">${task.person_in_charge}</div></div>
        <div class="detail-row"><div class="detail-label">קבלן</div><div class="detail-value">${task.contractor || '-'}</div></div>
        <div class="detail-row"><div class="detail-label">פרטי קשר קבלן</div><div class="detail-value">${task.contractor_contact || '-'}</div></div>

        <h4 style="margin:15px 0 5px; color:#0d47a1; border-bottom:1px solid #ddd;">רכש ולוגיסטיקה</h4>
        <div class="detail-row"><div class="detail-label">חומרים דרושים</div><div class="detail-value">${task.materials || '-'}</div></div>
        <div class="detail-row"><div class="detail-label">ספק</div><div class="detail-value">${task.supplier || '-'}</div></div>
        <div class="detail-row"><div class="detail-label">איש קשר ספק</div><div class="detail-value">${task.supplier_contact || '-'}</div></div>

        <h4 style="margin:15px 0 5px; color:#0d47a1; border-bottom:1px solid #ddd;">זמנים</h4>
        <div class="detail-row"><div class="detail-label">תאריך התחלה</div><div class="detail-value">${task.start_date}</div></div>
        <div class="detail-row"><div class="detail-label">תאריך יעד</div><div class="detail-value">${task.due_date}</div></div>
    `;

    if (task.extension_reason) {
        html += `<div class="detail-row" style="background:#fff3cd; padding:5px;"><div class="detail-label" style="color:#d39e00">סיבת הארכה</div><div class="detail-value">${task.extension_reason}</div></div>`;
    }

    html += `<div style="margin-top: 20px; border-top: 2px solid #eee; padding-top: 15px;">`;

    if (!isDone) {
        // 🔥 ИСПРАВЛЕНИЕ ЗДЕСЬ: добавлены кавычки '${task.id}'
        html += `
            <div style="display:flex; gap:10px; margin-bottom:15px;">
                <button onclick="enableEditMode('${task.id}')" class="btn-secondary" style="background:#ff9800; color:white; flex:1;">✏️ עריכה</button>
                <button onclick="printPriceQuote('${task.id}')" class="btn-secondary" style="background:#1976d2; color:white; flex:1;">📄 בקשת מחיר (PDF)</button>
            </div>

            <h4>פעולות:</h4>
            <div class="form-group">
                <label>הארכת מועד:</label>
                <input type="date" id="newDate" value="${task.due_date}">
                <input type="text" id="reason" placeholder="סיבת הארכה..." style="margin-top:5px;">
                <button onclick="extendTask('${task.id}', '${task.due_date}')" class="btn-primary" style="margin-top:5px;">עדכן תאריך</button>
            </div>
            <button onclick="markAsDone('${task.id}')" class="btn-success">✅ סמן כ-בוצע</button>
        `;
    } else {
        html += `
            <div style="display:flex; gap:10px; margin-bottom:15px;">
                <button onclick="printPriceQuote('${task.id}')" class="btn-secondary" style="background:#1976d2; color:white; flex:1;">📄 בקשת מחיר (PDF)</button>
            </div>
            <p style="color: green; font-weight:bold; text-align:center; font-size:1.1rem;">✅ המשימה הושלמה</p>
        `;
    }
    
    html += `
            <button onclick="deleteTask('${task.id}')" class="btn-danger" style="margin-top: 15px;">🗑 העבר לארכיון (מחק)</button>
        </div>
    `;
    
    content.innerHTML = html;
    
    document.getElementById('edit-form-container').classList.add('hidden');
    document.getElementById('detail-content').classList.remove('hidden');
    document.getElementById('main-view').classList.add('hidden');
    document.getElementById('detail-view').classList.remove('hidden');
}

function enableEditMode(id) {
    const task = currentTasks.find(t => t.id === id);
    if (!task) return;

    document.getElementById('editTaskId').value = task.id;
    document.getElementById('editDesc').value = task.description;
    document.getElementById('editIsImportant').checked = (task.priority === 'חשוב');
    document.getElementById('editPerformer').value = task.performer;
    document.getElementById('editInCharge').value = task.person_in_charge;
    document.getElementById('editContractor').value = task.contractor;
    document.getElementById('editContact').value = task.contractor_contact;
    document.getElementById('editMaterials').value = task.materials;
    document.getElementById('editSupplier').value = task.supplier;
    document.getElementById('editSupplierContact').value = task.supplier_contact;
    document.getElementById('editStartDate').value = task.start_date;
    document.getElementById('editDueDate').value = task.due_date;

    document.getElementById('detail-content').classList.add('hidden');
    document.getElementById('edit-form-container').classList.remove('hidden');
}

function cancelEdit() {
    document.getElementById('edit-form-container').classList.add('hidden');
    document.getElementById('detail-content').classList.remove('hidden');
}

function showMainView() {
    document.getElementById('detail-view').classList.add('hidden');
    document.getElementById('main-view').classList.remove('hidden');
    fetchTasks();
}

async function markAsDone(id) {
    if(!confirm('האם לסגור את המשימה?')) return;
    await fetch(`${API_URL}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'בוצע' })
    });
    showMainView();
}

async function extendTask(id, oldDate) {
    const newDate = document.getElementById('newDate').value;
    const reason = document.getElementById('reason').value;
    if (newDate === oldDate) { alert('יש לבחור תאריך חדש'); return; }
    if (!reason.trim()) { alert('חובה להזין סיבת הארכה!'); return; }
    await fetch(`${API_URL}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'בתהליך', due_date: newDate, extension_reason: reason })
    });
    showMainView();
}

async function deleteTask(id) {
    if(!confirm('להעביר לארכיון?')) return;
    await fetch(`${API_URL}/${id}`, { method: 'DELETE' });
    showMainView();
}

function printPriceQuote(id) {
    const task = currentTasks.find(t => t.id === id);
    if (!task) return;

    const supplierName = task.supplier || "_______________";
    const contactName = task.supplier_contact || "";
    
    let materialsList = "לפי מפרט מצורף / See attached list";
    if (task.materials && task.materials.trim() !== "") {
        materialsList = task.materials;
    }

    const date = new Date().toLocaleDateString('he-IL');

    const printWindow = window.open('', '_blank', 'width=800,height=900');
    
    if (!printWindow) {
        alert("⚠️ הדפדפן שלך חסם את החלון הקופץ!\nאנא לחץ על סמל החסימה בשורת הכתובת (למעלה) ובחר 'אפשר תמיד חלונות קופצים' (Always allow pop-ups) עבור אתר זה.");
        return;
    }
    
    printWindow.document.write(`
        <!DOCTYPE html>
        <html lang="he" dir="rtl">
        <head>
            <title>Request for Price Quote - ${task.description}</title>
            <style>
                body { font-family: 'Segoe UI', Tahoma, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; color: #333; }
                .header { text-align: center; border-bottom: 3px solid #0d47a1; padding-bottom: 20px; margin-bottom: 30px; }
                .logo { font-size: 40px; }
                .company-name { font-size: 24px; font-weight: bold; color: #0d47a1; margin: 0; }
                .sub-header { display: flex; justify-content: space-between; margin-bottom: 40px; }
                .title { text-align: center; font-size: 22px; font-weight: bold; margin-bottom: 30px; text-decoration: underline; }
                
                .content-box { border: 1px solid #ddd; padding: 20px; border-radius: 8px; background: #f9f9f9; margin-bottom: 20px; }
                .field-row { margin-bottom: 15px; font-size: 16px; }
                .label { font-weight: bold; display: inline-block; width: 120px; }
                
                .materials-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                .materials-table th, .materials-table td { border: 1px solid #ccc; padding: 12px; text-align: right; }
                .materials-table th { background: #e3f2fd; color: #0d47a1; }
                
                .footer { margin-top: 60px; text-align: center; font-size: 14px; color: #666; border-top: 1px solid #ccc; padding-top: 20px; }
                .signature-area { margin-top: 50px; display: flex; justify-content: space-between; }
                .sign-line { border-top: 1px solid #000; width: 200px; margin-top: 40px; text-align: center; padding-top: 5px; }

                @media print {
                    .no-print { display: none; }
                    body { -webkit-print-color-adjust: exact; }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="logo">🏗️ TaskFlow Pro</div>
                <p>ניהול פרויקטים ובנייה</p>
            </div>
            <div class="sub-header">
                <div><strong>תאריך:</strong> ${date}</div>
                <div><strong>לכבוד:</strong> ${supplierName} ${contactName ? `(${contactName})` : ''}</div>
            </div>
            <div class="title">הנדון: בקשה להצעת מחיר (RFQ)</div>
            <p>שלום רב,</p>
            <p>נודה לקבלת הצעת מחיר עבור החומרים/העבודות בפרויקט <strong>"${task.description}"</strong>.</p>
            <table class="materials-table">
                <thead>
                    <tr><th style="width: 50px;">#</th><th>תיאור פריט / חומר</th><th>הערות</th></tr>
                </thead>
                <tbody>
                    <tr><td>1</td><td><strong>${materialsList}</strong></td><td>דחוף</td></tr>
                    <tr><td>2</td><td></td><td></td></tr>
                    <tr><td>3</td><td></td><td></td></tr>
                </tbody>
            </table>
            <div class="content-box" style="margin-top:20px;">
                <div class="field-row"><span class="label">תאריך אספקה:</span> <span dir="ltr">${task.due_date}</span></div>
                <div class="field-row"><span class="label">איש קשר:</span> ${task.person_in_charge}</div>
            </div>
            <div class="signature-area">
                <div class="sign-line">חתימת המזמין</div>
                <div class="sign-line">חתימת הספק</div>
            </div>
            <div class="footer">הופק באמצעות מערכת TaskFlow Pro</div>
            <div class="no-print" style="text-align:center; margin-top:20px;">
                <button onclick="window.print()" style="font-size:20px; padding:10px 20px; cursor:pointer; background:#2e7d32; color:white; border:none; border-radius:5px;">🖨️ הדפס / שמור כ-PDF</button>
            </div>
            <script>window.onload = function() { setTimeout(() => window.print(), 500); };</script>
        </body>
        </html>
    `);

    printWindow.document.close();
}