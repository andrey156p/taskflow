const API_URL = '/api/tasks';
let currentTasks = [];

// 🔒 Логика Входа
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
            fetchTasks(); // Грузим задачи только после пароля
        } else {
            errorMsg.style.display = 'block';
        }
    } catch (e) {
        alert('שגיאת תקשורת');
    }
}

// Также разрешаем вход по Enter
document.getElementById('passwordInput').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') checkLogin();
});

document.addEventListener('DOMContentLoaded', () => {
    // Установка сегодняшней даты по умолчанию
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
});

async function fetchTasks() {
    const res = await fetch(API_URL);
    currentTasks = await res.json();
    renderTasks();
}

// 📊 Функция расчета прогресса
function calculateProgress(start, end) {
    const startDate = new Date(start).getTime();
    const endDate = new Date(end).getTime();
    const now = new Date().getTime();

    if (now < startDate) return 0; // Еще не началось
    if (now > endDate) return 100; // Просрочено

    const total = endDate - startDate;
    const elapsed = now - startDate;
    
    // Если даты совпадают, избегаем деления на ноль
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
        if (task.priority === 'חשוב' && task.status !== 'בוצע') classes += ' important';
        if (task.extension_reason && task.extension_reason.trim() !== '' && task.status !== 'בוצע') classes += ' extended';

        div.className = classes;
        
        const statusClass = task.status === 'בתהליך' ? 'status-process' : 'status-done';
        const priorityIcon = task.priority === 'חשוב' ? '🔥' : '';
        const extendedIcon = (task.extension_reason && task.extension_reason !== '') ? '⏱️' : '';

        // Расчет прогресса
        const progressPercent = calculateProgress(task.start_date, task.due_date);
        let progressColor = '';
        if (progressPercent > 75) progressColor = 'warning';
        if (progressPercent > 90) progressColor = 'danger';
        // Если выполнено - всегда зеленый (или скрываем)
        const displayProgress = task.status === 'בוצע' ? 100 : progressPercent;
        const displayColor = task.status === 'בוצע' ? 'background-color: #28a745;' : '';

        div.innerHTML = `
            <div class="task-header">
                <div>
                    <strong>${priorityIcon} ${task.description}</strong> ${extendedIcon}<br>
                    <small>📅 ${task.start_date} ➝ ${task.due_date}</small>
                </div>
                <div>
                    <span class="status-badge ${statusClass}">${task.status}</span>
                </div>
            </div>
            
            <div class="progress-container">
                <div class="progress-bar ${progressColor}" style="width: ${displayProgress}%; ${displayColor}"></div>
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

    // Контакты подрядчика теперь выводятся здесь
    let html = `
        <h3>${task.priority === 'חשוב' ? '🔥' : ''} ${task.description}</h3>
        <div class="detail-row"><div class="detail-label">עדיפות</div><div class="detail-value">${task.priority}</div></div>
        <div class="detail-row"><div class="detail-label">מבצע</div><div class="detail-value">${task.performer}</div></div>
        <div class="detail-row"><div class="detail-label">אחראי</div><div class="detail-value">${task.person_in_charge}</div></div>
        <div class="detail-row"><div class="detail-label">קבלן</div><div class="detail-value">${task.contractor || '-'}</div></div>
        
        <div class="detail-row"><div class="detail-label">פרטי קשר קבלן</div><div class="detail-value">${task.contractor_contact || '-'}</div></div>

        <div class="detail-row"><div class="detail-label">תאריך התחלה</div><div class="detail-value">${task.start_date}</div></div>
        <div class="detail-row"><div class="detail-label">תאריך יעד</div><div class="detail-value">${task.due_date}</div></div>
    `;

    if (task.extension_reason) {
        html += `<div class="detail-row" style="background:#fff3cd; padding:5px;"><div class="detail-label" style="color:#d39e00">סיבת הארכה (המשימה הוארכה)</div><div class="detail-value">${task.extension_reason}</div></div>`;
    }

    html += `<div style="margin-top: 20px; border-top: 2px solid #eee; padding-top: 15px;">`;

    if (!isDone) {
        html += `
            <h4>פעולות:</h4>
            <div class="form-group">
                <label>הארכת מועד (מחייב סיבה):</label>
                <input type="date" id="newDate" value="${task.due_date}">
                <input type="text" id="reason" placeholder="סיבת הארכה..." style="margin-top:5px;">
                <button onclick="extendTask(${task.id}, '${task.due_date}')" class="btn-primary" style="margin-top:5px;">עדכן תאריך</button>
            </div>
            <button onclick="markAsDone(${task.id})" class="btn-success">✅ סמן כ-בוצע</button>
        `;
    } else {
        html += `<p style="color: green; font-weight:bold;">המשימה הושלמה</p>`;
    }
    
    html += `<button onclick="deleteTask(${task.id})" class="btn-danger" style="margin-top: 15px;">🗑 מחק משימה</button>`;
    html += `</div>`;

    content.innerHTML = html;
    
    document.getElementById('main-view').classList.add('hidden');
    document.getElementById('detail-view').classList.remove('hidden');
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
    if(!confirm('למחוק לצמיתות?')) return;
    await fetch(`${API_URL}/${id}`, { method: 'DELETE' });
    showMainView();
}