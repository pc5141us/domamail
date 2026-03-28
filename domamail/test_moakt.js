const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const tough = require('tough-cookie');
const cheerio = require('cheerio');

async function test() {
    const jar = new tough.CookieJar();
    const client = wrapper(axios.create({
        jar,
        withCredentials: true,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'ar,en-US;q=0.7,en;q=0.3',
            'Referer': 'https://moakt.com/ar'
        }
    }));

    try {
        console.log("Fetching home page...");
        await client.get('https://moakt.com/ar');
        
        console.log("Creating random email...");
        const params = new URLSearchParams();
        params.append('random', '1');
        
        const res = await client.post('https://moakt.com/ar/inbox', params.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        
        const $ = cheerio.load(res.data);
        const email = $('#email-address').text().trim();
        console.log("Result Email:", email || "NOT FOUND");
        
        if (!email) {
            console.log("Retrying with GET /ar/inbox...");
            const res2 = await client.get('https://moakt.com/ar/inbox');
            const $2 = cheerio.load(res2.data);
            const email2 = $2('#email-address').text().trim();
            console.log("Retry Email:", email2 || "STILL NOT FOUND");
        }
    } catch (e) {
        console.error("Error:", e.message);
    }
}

test();
