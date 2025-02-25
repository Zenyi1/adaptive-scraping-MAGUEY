const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { parse } = require('json2csv');

// Email matching regex pattern
const EMAIL_REGEX = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;

async function findEmailsInContent(content) {
    const emails = content.match(EMAIL_REGEX);
    return emails ? [...new Set(emails)] : [];
}

async function scrapeEmail(page, url) {
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        
        // Check both page content and meta tags
        const content = await page.content();
        const emails = await findEmailsInContent(content);

        // Check contact page if no emails found on homepage
        if (emails.length === 0) {
            await page.click('a:has-text("Contact"), a:has-text("Contact Us")').catch(() => {});
            await page.waitForTimeout(2000);
            const contactContent = await page.content();
            emails.push(...await findEmailsInContent(contactContent));
        }

        return emails.length > 0 ? emails.join(', ') : 'Not found';
    } catch (error) {
        console.error(`Error scraping ${url}: ${error.message}`);
        return 'Error';
    }
}
async function updateRecordsWithEmails() {
    const records = [];
    
    // Read CSV file
    await new Promise((resolve) => {
        fs.createReadStream('output.csv')
            .pipe(csv())
            .on('data', (data) => records.push(data))
            .on('end', resolve);
    });

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    // Process each record - FIX CASE SENSITIVITY
    for (const record of records) {
        // Use correct field name matching CSV headers
        const website = record.Website || record.website;
        
        if (website && (website.startsWith('http://') || website.startsWith('https://'))) {
            console.log(`Processing: ${website}`);
            record.email = await scrapeEmail(page, website);
            await page.waitForTimeout(2000);
        } else {
            record.email = 'Invalid URL';
        }
    }

    await browser.close();

    // Update CSV - CORRECTED FIELD CONFIGURATION
    const csvPath = path.join(__dirname, 'output.csv');
    const fields = Object.keys(records[0]).map(field => ({
        label: field,  // CSV header
        value: field   // Object property
    }));
    
    const parserOptions = {
        fields,
        header: true
    };
    
    const updatedCsv = parse(records, parserOptions);
    fs.writeFileSync(csvPath, updatedCsv);

    // Update JSON
    const jsonPath = path.join(__dirname, 'output.json');
    fs.writeFileSync(jsonPath, JSON.stringify(records, null, 2));

    console.log('Email scraping completed. Files updated.');
}

// Run the email scraping process
(async () => {
    await updateRecordsWithEmails();
})();