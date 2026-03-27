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
        const res = await client.get(fullUrl);
        const $ = cheerio.load(res.data);
        const body = $('.message_body').html() || $('#message_body').html() || $('.message-content').html() || $('.mail_message_content').html() || 'لا يوجد محتوى';
        return {
            body,
            sender: $('.sender').last().text().trim() || '...',
            subject: $('.subject').last().text().trim() || '...'
        };
    } catch (e) { 
        return { body: 'ERR: فشل تحميل الرسالة', sender: '...', subject: '...' }; 
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
        await client.get('https://moakt.com/ar');
        
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
            const inboxRes = await client.get('https://moakt.com/ar/inbox');
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
        const inboxRes = await client.get('https://moakt.com/ar/inbox');
        const $ = cheerio.load(inboxRes.data);
        const messagePromises = [];
        
        $('a').each((i, el) => {
            const href = $(el).attr('href') || '';
            if (href.includes('/email/') && !href.includes('/delete')) {
                const row = $(el).closest('tr');
                if (row.find('td').length >= 2) {
                    messagePromises.push((async () => {
                        try {
                            const info = await scrapeMessageBody(client, href);
                            return {
                                id: href,
                                subject: $(el).text().trim() || 'بدون موضوع',
                                from: { address: row.find('td').eq(1).text().trim() || 'Unknown' },
                                body: info.body,
                                createdAt: new Date().toISOString()
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
// On Vercel, the path might be different depending on rewrites.
// We handle /api/moakt and /moakt to be safe.
app.use('/api/moakt', router);
app.use('/moakt', router);

app.use((req, res) => {
    log(`404: ${req.method} ${req.url}`);
    res.status(404).json({ 
        error: 'Endpoint Not Found', 
        method: req.method, 
        path: req.url,
        note: 'If you are seeing this on Vercel, check vercel.json rewrites or app.use paths.'
    });
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => { log(`🚀 Proxy Ready on Port ${PORT}`); });
}

module.exports = app;
