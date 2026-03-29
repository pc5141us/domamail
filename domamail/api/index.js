const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const tough = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const PORT = process.env.PORT || 3000;

const log = (msg) => {
    console.log(`[${new Date().toISOString()}] ${msg}`);
};

// Utilities for session serialization
function serializeSession(client, email) {
    const jarJSON = client.defaults.jar.toJSON();
    const data = JSON.stringify({ email, cookies: jarJSON });
    return Buffer.from(data).toString('base64');
}

function deserializeSession(token) {
    try {
        const data = JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
        const jar = tough.CookieJar.fromJSON(data.cookies);
        const client = createClient(jar);
        return { client, email: data.email };
    } catch (e) {
        return null;
    }
}

function createClient(existingJar = null) {
    const jar = existingJar || new tough.CookieJar();
    return wrapper(axios.create({
        jar,
        withCredentials: true,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'ar,en-US;q=0.7,en;q=0.3',
            'Referer': 'https://moakt.com/ar'
        }
    }));
}

async function scrapeMessageBody(client, msgPath) {
    try {
        const fullUrl = msgPath.startsWith('http') ? msgPath : `https://moakt.com${msgPath}`;
        const res = await client.get(fullUrl, { timeout: 10000 });
        const $ = cheerio.load(res.data);
        
        // Moakt often puts the content in an iframe now
        const iframe = $('iframe#content-iframe, .message-content iframe, #message_body_iframe').first();
        if (iframe.length > 0) {
            let iframeSrc = iframe.attr('src');
            if (iframeSrc) {
                if (!iframeSrc.startsWith('http')) iframeSrc = `https://moakt.com${iframeSrc}`;
                log(`Fetching iframe content from: ${iframeSrc}`);
                const iframeRes = await client.get(iframeSrc, { timeout: 10000 });
                return {
                    body: iframeRes.data,
                    sender: $('.sender').last().text().trim() || '...',
                    subject: $('.subject').last().text().trim() || '...'
                };
            }
        }

        const body = $('.message_body').html() || $('#message_body').html() || $('.message-content').html() || $('.mail_message_content').html() || 'لا يوجد محتوى';
        return {
            body,
            sender: $('.sender').last().text().trim() || '...',
            subject: $('.subject').last().text().trim() || '...'
        };
    } catch (e) { 
        log(`Scrape Error [${msgPath}]: ${e.message}`);
        return { body: 'ERR: فشل تحميل الرسالة أو تم حظر الطلب', sender: '...', subject: '...' }; 
    }
}

// HEALTH CHECK
const router = express.Router();

router.get('/health', (req, res) => res.json({ status: 'UP', platform: 'Vercel', stateless: true }));

// NEW EMAIL
router.post('/new', async (req, res) => {
    try {
        log("Creating new session...");
        const client = createClient();
        await client.get('https://moakt.com/ar', { timeout: 10000 });
        
        let params = new URLSearchParams();
        params.append('preferred_domain', 'tmail.ws'); 
        
        if (req.body.address) {
            const [user, dom] = req.body.address.split('@');
            params.append('username', user);
            params.append('domain', dom);
            params.append('setemail', '1');
        } else {
            params.append('random', '1');
        }
        
        const postRes = await client.post('https://moakt.com/ar/inbox', params.toString(), {
            maxRedirects: 10,
            timeout: 15000,
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded',
                'Origin': 'https://moakt.com',
                'Referer': 'https://moakt.com/ar'
            }
        });

        let $ = cheerio.load(postRes.data);
        let email = $('#email-address').text().trim() || $('.email-address').text().trim();
        
        if (!email) {
            log("Email not found in POST response, retrying with GET...");
            const inboxRes = await client.get('https://moakt.com/ar/inbox', { timeout: 10000 });
            let $i = cheerio.load(inboxRes.data);
            email = $i('#email-address').text().trim() || $i('.email-address').text().trim();
        }

        if (!email || !email.includes('@')) {
            throw new Error("لم يتمكن النظام من استخراج البريد من Moakt. ربما تم تغيير هيكل الموقع.");
        }

        const sessionId = serializeSession(client, email);
        log(`Success! Created: ${email}`);
        res.json({ success: true, email, sessionId });
    } catch (error) {
        log("SESSION FAIL: " + error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// INBOX
router.get('/inbox/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const session = deserializeSession(sessionId);
    if (!session) return res.status(404).json({ error: 'Session Invalid or Expired' });
    
    const { client } = session;
    try {
        const inboxRes = await client.get('https://moakt.com/ar/inbox', { timeout: 10000 });
        const $ = cheerio.load(inboxRes.data);
        const messagePromises = [];
        
        // Improved selector based on browser analysis
        $('#email_message_list table.tm-table tbody tr').each((i, row) => {
            const link = $(row).find('a[href*="/email/"]').first();
            const href = link.attr('href') || '';
            
            if (href && !href.includes('/delete')) {
                const cols = $(row).find('td');
                if (cols.length >= 2) {
                    messagePromises.push((async () => {
                        try {
                            // We only scrape minimal info here to keep it fast
                            return {
                                id: href,
                                subject: link.text().trim() || 'بدون موضوع',
                                from: { address: cols.eq(1).text().trim() || 'Unknown' },
                                createdAt: cols.last().text().trim() || new Date().toISOString()
                            };
                        } catch(e) { return null; }
                    })());
                }
            }
        });
        
        const messages = (await Promise.all(messagePromises)).filter(m => m !== null);
        res.json({ 'hydra:member': messages });
    } catch (error) { 
        log("INBOX ERR: " + error.message); 
        res.status(500).json({ error: error.message }); 
    }
});

// MESSAGE CONTENT
router.get('/message/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const { msgPath } = req.query;
    const session = deserializeSession(sessionId);
    if (!session) return res.status(404).json({ error: 'Session Invalid' });
    
    const { client } = session;
    try {
        const info = await scrapeMessageBody(client, msgPath);
        res.json(info);
    } catch (error) { 
        res.status(500).json({ error: error.message }); 
    }
});

// Mount the router
// We handle /api/moakt, /moakt and even the root / to ensure the router gets matched
// Mount the router
// We handle /api/moakt, /api, and fallback to ensure the router gets matched
app.use('/api/moakt', router);
app.use('/api', router);
app.use('/moakt', router);
app.use('/', router);

app.use((req, res) => {
    log(`404: ${req.method} ${req.url}`);
    res.status(404).json({ 
        error: 'Endpoint Not Found', 
        method: req.method, 
        path: req.url,
        note: 'If you are seeing this on Vercel, check vercel.json rewrites or app.use paths.'
    });
});

// Generic Error Handler to ensure JSON response for all errors
app.use((err, req, res, next) => {
    log(`ERROR: ${err.message}`);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => { log(`🚀 Proxy Ready on Port ${PORT}`); });
}

module.exports = app;
