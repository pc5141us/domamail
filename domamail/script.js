const API_BASE = "/api/moakt";

document.addEventListener('DOMContentLoaded', () => {
    console.log('%c Doma Mail %c v1.3.0 %c', 'background:#6366f1;color:#fff;padding:5px;border-radius:5px 0 0 5px;font-weight:bold', 'background:#22d3ee;color:#000;padding:5px;border-radius:0 5px 5px 0', '');
    
    const emailInput = document.getElementById('email-address');
    const copyBtn = document.getElementById('copy-btn');
    const newEmailBtn = document.getElementById('new-email-btn');
    const customPrefixInput = document.getElementById('custom-prefix');
    const domainSelect = document.getElementById('domain-select');
    const createCustomBtn = document.getElementById('create-custom-btn');
    const copyMessage = document.getElementById('copy-message');
    const messagesList = document.getElementById('messages-list');
    const unreadCount = document.getElementById('unread-count');
    const refreshBtn = document.getElementById('refresh-btn');
    
    // Persistence Check
    let currentEmail = localStorage.getItem('domamail_proxy_email') || '';
    let currentSessionId = localStorage.getItem('domamail_proxy_sessionId') || '';
    let emailHistory = JSON.parse(localStorage.getItem('domamail_history') || '[]');
    let inboxInterval = null;
    let loadedMessageIds = new Set();

    const historyList = document.getElementById('history-list');


    // Play a notification sound
    function playNotificationSound() {
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            oscillator.type = 'sine';
            oscillator.frequency.value = 880;
            gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.05);
            gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.2);
            oscillator.start(audioCtx.currentTime);
            oscillator.stop(audioCtx.currentTime + 0.2);
        } catch (e) {
            console.error('Audio play failed', e);
        }
    }

    // Load Domains into Select
    async function loadDomains() {
        const customDomains = [
            'bareed.ws', 'tmail.ws', 'moakt.ws', 'moakt.co', 'disbox.org',
            'tmails.net', 'tmpmail.net', 'tmpmail.org', 'disbox.net',
            'moakt.cc', 'tmpbox.net', 'tmpeml.com', 'teml.net'
        ];
        domainSelect.innerHTML = '';
        customDomains.forEach(domain => {
            const option = document.createElement('option');
            option.value = domain;
            option.textContent = domain;
            domainSelect.appendChild(option);
        });
    }
    loadDomains();

    // Create Account (Random or Custom)
    async function setupAccount(username, domain) {
        try {
            if (emailInput) emailInput.value = 'جاري الإنشاء...';
            const response = await fetch(`${API_BASE}/new`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address: username ? `${username}@${domain}` : null })
            });

            if (!response.ok) {
                const text = await response.text();
                console.error("Non-OK Response:", text.substring(0, 100));
                throw new Error(`تعذر الاتصال بالسيرفر (${response.status}) ❌`);
            }

            let data;
            try {
                data = await response.json();
            } catch (e) {
                console.error("JSON Parse Error:", e);
                throw new Error("تنسيق استجابة غير صالح من السيرفر! تأكد من تشغيل الـ API بشكل صحيح.");
            }

            if (!data.success) throw new Error(data.error);

            currentEmail = data.email;
            currentSessionId = data.sessionId;
            localStorage.setItem('domamail_proxy_email', currentEmail);
            localStorage.setItem('domamail_proxy_sessionId', currentSessionId);

            // Add to history
            addToHistory(currentEmail, currentSessionId);

            if (emailInput) {
                emailInput.value = currentEmail;
                emailInput.style.color = 'var(--primary-color)';
            }

            // Clear Inbox UI
            messagesList.innerHTML = `
                <div class="empty-state">
                    <div class="loader"></div>
                    <p>في انتظار رسائل جديدة...</p>
                    <small style="color:var(--primary-color);">🟢 متصل: ${currentEmail}</small>
                </div>
            `;
            unreadCount.textContent = '0';
            loadedMessageIds.clear();

            startInboxPolling();

        } catch (error) {
            console.error('Setup Error:', error);
            if (emailInput) {
                const errorMsg = error.message.includes('Failed to fetch') 
                    ? 'فشل الاتصال: تأكد من تشغيل السيرفر أو رفعه على Vercel' 
                    : error.message;
                emailInput.value = `خطأ: ${errorMsg}`;
                emailInput.style.color = 'red';
            }
        }
    }

    // History Helpers
    function addToHistory(email, sessionId) {
        // Remove duplicate if exists
        emailHistory = emailHistory.filter(item => item.email !== email);
        // Add to top
        emailHistory.unshift({ email, sessionId, timestamp: Date.now() });
        // Keep last 10
        if (emailHistory.length > 10) emailHistory.pop();
        
        localStorage.setItem('domamail_history', JSON.stringify(emailHistory));
        renderHistory();
    }

    function renderHistory() {
        if (!historyList) return;
        if (emailHistory.length === 0) {
            historyList.innerHTML = '<p class="empty-history">لا يوجد سجل حالياً</p>';
            return;
        }

        historyList.innerHTML = emailHistory.map(item => `
            <div class="history-item ${item.email === currentEmail ? 'active' : ''}" data-session="${item.sessionId}" data-email="${item.email}">
                <span class="history-email">${item.email}</span>
                <div class="history-actions">
                    <button class="history-delete-btn" data-email="${item.email}" title="حذف">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                        </svg>
                    </button>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="var(--text-secondary)">
                        <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/>
                    </svg>
                </div>
            </div>
        `).join('');
    }

    function deleteFromHistory(email) {
        emailHistory = emailHistory.filter(item => item.email !== email);
        localStorage.setItem('domamail_history', JSON.stringify(emailHistory));
        renderHistory();
    }

    function switchEmail(email, sessionId) {
        currentEmail = email;
        currentSessionId = sessionId;
        localStorage.setItem('domamail_proxy_email', currentEmail);
        localStorage.setItem('domamail_proxy_sessionId', currentSessionId);
        
        if (emailInput) {
            emailInput.value = currentEmail;
            emailInput.style.color = 'var(--primary-color)';
        }

        messagesList.innerHTML = `
            <div class="empty-state">
                <div class="loader"></div>
                <p>جاري تحميل رسائل ${currentEmail}...</p>
            </div>
        `;
        unreadCount.textContent = '0';
        loadedMessageIds.clear();
        
        renderHistory();
        startInboxPolling();
    }

    function startInboxPolling() {
        if (inboxInterval) clearInterval(inboxInterval);
        fetchInbox(true);
        inboxInterval = setInterval(() => fetchInbox(false), 5000);
    }

    // Fetch Inbox
    async function fetchInbox(isInitial = false) {
        if (!currentSessionId) return;
        try {
            const response = await fetch(`${API_BASE}/inbox/${currentSessionId}`);
            if (!response.ok) {
                if (response.status === 404) {
                    if (emailInput) emailInput.value = 'انتهت الجلسة ⚠️ أعد الإنشاء';
                }
                return;
            }

            if (!response.ok) {
                if (response.status === 404) {
                    if (emailInput) emailInput.value = 'انتهت الجلسة ⚠️ أعد الإنشاء';
                }
                const text = await response.text();
                console.error("Inbox Response Error:", text.substring(0, 50));
                return;
            }

            let data;
            try {
                data = await response.json();
            } catch (e) {
                console.error("Inbox JSON Error:", e);
                return;
            }
            const messages = data['hydra:member'] || [];
            unreadCount.textContent = messages.length;
            if (messages.length > 0) {
                const emptyState = messagesList.querySelector('.empty-state');
                if (emptyState) messagesList.innerHTML = '';
            }

            if (messages.length === 0) return;

            let newMessagesHTML = '';
            let hasNewMessage = false;

            messages.forEach(msg => {
                const pseudoId = (msg.id || '') + (msg.subject || '');
                if (pseudoId && !loadedMessageIds.has(pseudoId)) {
                    hasNewMessage = true;
                    loadedMessageIds.add(pseudoId);

                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = msg.body || '';
                    const previewText = tempDiv.textContent || tempDiv.innerText || '...';
                    const shortPreview = previewText.substring(0, 80).trim() + (previewText.length > 80 ? '...' : '');

                    const formattedDate = new Date(msg.createdAt).toLocaleString('ar-EG');
                    newMessagesHTML = `
                        <div class="message-item" data-path="${msg.id}" data-id="${pseudoId}">
                            <div class="msg-header">
                                <span>من: <strong style="color:var(--primary-color)">${msg.from.address}</strong></span>
                                <span style="font-size: 0.75rem; color:#aaa;">${formattedDate}</span>
                            </div>
                            <div class="msg-subject">${msg.subject || 'بدون موضوع'}</div>
                            <div class="msg-preview" style="margin-top:4px; font-size:0.8rem; color:#888; line-height:1.4;">
                                ${shortPreview}
                            </div>
                        </div>
                    ` + newMessagesHTML;
                }
            });

            if (newMessagesHTML) {
                messagesList.insertAdjacentHTML('afterbegin', newMessagesHTML);
            }
            if (hasNewMessage && !isInitial) playNotificationSound();
        } catch (error) {
            console.error('Inbox Error:', error);
        }
    }

    // تم إزالة وظائف النافذة المنبثقة من هنا
    
    // Event Listeners
    newEmailBtn.addEventListener('click', () => {
        const options = domainSelect.options;
        const randomIndex = Math.floor(Math.random() * options.length);
        const randomDomain = options[randomIndex].value;
        const randomPrefix = Math.random().toString(36).substring(2, 10);
        setupAccount(randomPrefix, randomDomain);
    });

    createCustomBtn.addEventListener('click', () => {
        const prefix = customPrefixInput.value.trim();
        const domain = domainSelect.value;
        if (prefix) setupAccount(prefix, domain);
        else alert('الرجاء إدخال الاسم المطلوب');
    });

    copyBtn.addEventListener('click', async () => {
        if (!currentEmail || currentEmail.includes('جاري') || currentEmail.includes('خطأ')) return;
        try {
            await navigator.clipboard.writeText(currentEmail);
            copyMessage.classList.remove('hidden');
            setTimeout(() => {
                copyMessage.classList.add('hidden');
            }, 2000);
        } catch (err) {
            console.error('Failed to copy text: ', err);
        }
    });

    refreshBtn.addEventListener('click', () => fetchInbox(false));

    messagesList.addEventListener('click', (e) => {
        // تم إغلاق وظيفة عرض الرسالة بناءً على طلب المستخدم
    });
    
    historyList.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('.history-delete-btn');
        if (deleteBtn) {
            e.stopPropagation();
            const emailToDelete = deleteBtn.getAttribute('data-email');
            if (confirm(`هل تريد حذف ${emailToDelete} من السجل؟`)) {
                deleteFromHistory(emailToDelete);
            }
            return;
        }

        const item = e.target.closest('.history-item');
        if (item) {
            const email = item.getAttribute('data-email');
            const session = item.getAttribute('data-session');
            switchEmail(email, session);
        }
    });

    // تم إغلاق ميزة مسح الكل بناءً على طلب المستخدم

    // Initial Load / Restoration
    renderHistory();

    if (currentEmail && currentSessionId) {
        if (emailInput) {
            emailInput.value = currentEmail;
            emailInput.style.color = 'var(--accent)';
        }
        messagesList.innerHTML = `
            <div class="empty-state">
                <div class="loader"></div>
                <p>جاري استعادة الاتصال بـ ${currentEmail}...</p>
            </div>
        `;
        startInboxPolling();
    } else {
        // إذا كان الموقع يفتح لأول مرة أو بدون بريد مخزن، قُم بإنشاء بريد فوراً
        const randomPrefix = Math.random().toString(36).substring(2, 10);
        setupAccount(randomPrefix, 'tmail.ws'); 
    }
});
