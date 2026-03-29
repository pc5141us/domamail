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

    // Modal elements
    const modal = document.getElementById('message-modal');
    const closeModal = document.getElementById('close-modal');
    const modalSubject = document.getElementById('modal-subject');
    const modalSender = document.getElementById('modal-sender');
    const modalDate = document.getElementById('modal-date');
    const modalBody = document.getElementById('modal-body');

    // Dialog elements
    const dialog = document.getElementById('custom-dialog');
    const dialogTitle = document.getElementById('dialog-title');
    const dialogMessage = document.getElementById('dialog-message');
    const dialogConfirmBtn = document.getElementById('dialog-confirm-btn');
    const dialogCancelBtn = document.getElementById('dialog-cancel-btn');

    // Custom Dialog Logic
    function showCustomDialog(title, message, isConfirm = false) {
        return new Promise((resolve) => {
            dialogTitle.textContent = title;
            dialogMessage.textContent = message;
            dialog.classList.remove('hidden');

            if (isConfirm) {
                dialogCancelBtn.classList.remove('hidden');
            } else {
                dialogCancelBtn.classList.add('hidden');
            }

            const onConfirm = () => {
                cleanup();
                resolve(true);
            };

            const onCancel = () => {
                cleanup();
                resolve(false);
            };

            const cleanup = () => {
                dialog.classList.add('hidden');
                dialogConfirmBtn.removeEventListener('click', onConfirm);
                dialogCancelBtn.removeEventListener('click', onCancel);
            };

            dialogConfirmBtn.addEventListener('click', onConfirm);
            dialogCancelBtn.addEventListener('click', onCancel);
        });
    }

    // Persistence Check
    let currentEmail = localStorage.getItem('domamail_proxy_email') || '';
    let currentSessionId = localStorage.getItem('domamail_proxy_sessionId') || '';
    let emailHistory = JSON.parse(localStorage.getItem('domamail_history') || '[]');
    let inboxInterval = null;
    let expirationInterval = null;
    let historyInterval = null;
    let loadedMessageIds = new Set();

    const expirationTimerUI = document.getElementById('expiration-timer');
    const timerValueUI = document.getElementById('timer-value');

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
            startExpirationTimer(3600); // 1 hour in seconds

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

    function cleanupHistory() {
        emailHistory = emailHistory.filter(item => {
            const expirationTime = Number(localStorage.getItem(`expire_${item.email}`) || (item.timestamp + 3600000));
            const isExpired = Date.now() >= expirationTime;
            if (isExpired) localStorage.removeItem(`expire_${item.email}`);
            return !isExpired;
        });
        localStorage.setItem('domamail_history', JSON.stringify(emailHistory));
    }

    // History Helpers
    function addToHistory(email, sessionId) {
        // Cleanup old history items
        cleanupHistory();

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

        historyList.innerHTML = emailHistory.map(item => {
            const expirationTime = Number(localStorage.getItem(`expire_${item.email}`) || (item.timestamp + 3600000));
            const now = Date.now();
            const distance = expirationTime - now;
            let timerDisplay = "00:00";
            
            if (distance > 0) {
                const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((distance % (1000 * 60)) / 1000);
                timerDisplay = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            }

            return `
                <div class="history-item ${item.email === currentEmail ? 'active' : ''}" data-session="${item.sessionId}" data-email="${item.email}">
                    <div class="history-info">
                        <span class="history-email">${item.email}</span>
                        <span class="history-timer" data-expire="${expirationTime}">${timerDisplay}</span>
                    </div>
                    <div class="history-actions">
                        <button class="history-delete-btn" data-email="${item.email}" title="حذف">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        startHistoryTimerUpdate();
    }

    function startHistoryTimerUpdate() {
        if (historyInterval) clearInterval(historyInterval);
        
        const updateAll = () => {
            const timers = document.querySelectorAll('.history-timer');
            let needsRerender = false;

            timers.forEach(timerUI => {
                const expireTime = Number(timerUI.getAttribute('data-expire'));
                const now = Date.now();
                const distance = expireTime - now;

                if (distance <= 0) {
                    timerUI.textContent = "00:00";
                    needsRerender = true; // One expired, trigger cleanup
                    return;
                }

                const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((distance % (1000 * 60)) / 1000);
                timerUI.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
                
                if (distance < 300000) timerUI.style.color = 'var(--danger)';
            });

            if (needsRerender) {
                cleanupHistory();
                renderHistory();
            }
        };

        historyInterval = setInterval(updateAll, 1000);
    }

    function deleteFromHistory(email) {
        emailHistory = emailHistory.filter(item => item.email !== email);
        localStorage.setItem('domamail_history', JSON.stringify(emailHistory));
        localStorage.removeItem(`expire_${email}`);
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
        startExpirationTimer(3600); // Reset timer to 1 hour
    }

    function startExpirationTimer(durationSeconds) {
        if (expirationInterval) clearInterval(expirationInterval);
        
        // Check if we already have an expiration time for this email
        let expirationTimeVal = localStorage.getItem(`expire_${currentEmail}`);
        let expirationTime;
        
        if (!expirationTimeVal) {
            expirationTime = Date.now() + (durationSeconds * 1000);
            localStorage.setItem(`expire_${currentEmail}`, expirationTime);
        } else {
            expirationTime = Number(expirationTimeVal);
        }

        expirationTimerUI.classList.remove('hidden');

        const updateTimer = () => {
            const now = Date.now();
            const distance = expirationTime - now;

            if (distance <= 0) {
                clearInterval(expirationInterval);
                timerValueUI.textContent = "00:00";
                handleEmailExpiration();
                return;
            }

            const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((distance % (1000 * 60)) / 1000);

            timerValueUI.textContent = 
                `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            
            // Warning color if less than 5 minutes
            if (distance < 300000) {
                timerValueUI.style.color = 'var(--danger)';
            } else {
                timerValueUI.style.color = 'var(--accent)';
            }
        };

        updateTimer();
        expirationInterval = setInterval(updateTimer, 1000);
    }

    async function handleEmailExpiration() {
        // Clear current session data
        localStorage.removeItem('domamail_proxy_email');
        localStorage.removeItem('domamail_proxy_sessionId');
        localStorage.removeItem(`expire_${currentEmail}`);
        
        const confirmed = await showCustomDialog(
            'انتهت صلاحية البريد', 
            'لقد انتهت مدة الساعة المخصصة لهذا البريد. هل تريد إنشاء بريد جديد؟',
            true
        );
        
        if (confirmed) {
            const randomPrefix = Math.random().toString(36).substring(2, 10);
            setupAccount(randomPrefix, 'tmail.ws');
        } else {
            expirationTimerUI.classList.add('hidden');
            emailInput.value = 'البريد منتهي الصلاحية ⚠️';
            emailInput.style.color = 'var(--danger)';
            if (inboxInterval) clearInterval(inboxInterval);
            currentEmail = '';
            currentSessionId = '';
        }
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

                    // Since we no longer fetch body in inbox list for speed, 
                    // we show the subject as the main info.
                    const previewText = msg.subject || 'بدون موضوع';
                    const shortPreview = previewText.substring(0, 80).trim() + (previewText.length > 80 ? '...' : '');

                    const formattedDate = msg.createdAt; // Moakt date is already formatted or raw
                    newMessagesHTML = `
                        <div class="message-item" data-path="${msg.id}" data-id="${pseudoId}">
                            <div class="msg-header">
                                <span>من: <strong style="color:var(--primary-color)">${msg.from.address}</strong></span>
                                <span style="font-size: 0.75rem; color:#aaa;">${formattedDate}</span>
                            </div>
                            <div class="msg-subject">${msg.subject || 'بدون موضوع'}</div>
                            <div class="msg-preview" style="margin-top:4px; font-size:0.8rem; color:var(--accent); line-height:1.4;">
                                🖱️ اضغط لفتح وقراءة الرسالة
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

    // Open/View Message Content
    async function openMessage(msgPath) {
        try {
            modalBody.innerHTML = '<div class="loader" style="margin:20px auto"></div>';
            modalSubject.textContent = 'جاري التحميل...';
            modal.classList.remove('hidden');

            const response = await fetch(`${API_BASE}/message/${currentSessionId}?msgPath=${encodeURIComponent(msgPath)}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            let data;
            try {
                data = await response.json();
            } catch (e) {
                throw new Error("استجابة غير صالحة");
            }

            modalSubject.textContent = data.subject || 'بدون موضوع';
            modalSender.textContent = data.sender || 'غير معروف';
            modalBody.innerHTML = data.body || 'لا يوجد محتوى لهذه الرسالة';
        } catch (error) {
            modalBody.innerHTML = '<p style="color:red">فشل في تحميل محتوى الرسالة ❌</p>';
        }
    }

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
        else showCustomDialog('تنبيه', 'الرجاء إدخال الاسم المطلوب');
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
        const item = e.target.closest('.message-item');
        if (item) {
            const msgPath = item.getAttribute('data-path');
            openMessage(msgPath);
        }
    });

    closeModal.addEventListener('click', () => modal.classList.add('hidden'));
    window.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
    
    historyList.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('.history-delete-btn');
        if (deleteBtn) {
            e.stopPropagation();
            const emailToDelete = deleteBtn.getAttribute('data-email');
            showCustomDialog('تأكيد الحذف', `هل تريد حذف ${emailToDelete} من السجل؟`, true).then(confirmed => {
                if (confirmed) {
                    deleteFromHistory(emailToDelete);
                }
            });
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
    cleanupHistory();
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
        startExpirationTimer(3600);
    } else {
        // إذا كان الموقع يفتح لأول مرة أو بدون بريد مخزن، قُم بإنشاء بريد فوراً
        const randomPrefix = Math.random().toString(36).substring(2, 10);
        setupAccount(randomPrefix, 'tmail.ws'); 
    }
});
