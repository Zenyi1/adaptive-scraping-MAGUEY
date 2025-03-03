const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const csvWriter = require('csv-writer').createObjectCsvWriter;

const batchSize = 5;

// Get user inputs from command line
const [place, area] = process.argv.slice(2);
if (!place || !area) {
    console.error('Usage: node crawlfast.js "<place>" "<area>"');
    process.exit(1);
}

async function launchBrowser() {
    return await chromium.launch({ headless: true });
}

async function handleCookieConsent(page) {
    try {
        await page.click('button[aria-label="Reject all"]');
    } catch (error) {
        console.log('No cookie consent dialog found');
    }
}

async function scrollToEnd(page, targetText) {
    await page.waitForSelector('//*[@id="QA0Szd"]/div/div/div[1]/div[2]/div/div[1]/div/div/div[1]/div[1]', { timeout: 10000 });

    await page.evaluate(async (targetText) => {
        const element = document.evaluate('//*[@id="QA0Szd"]/div/div/div[1]/div[2]/div/div[1]/div/div/div[1]/div[1]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (element) {
            while (!element.innerText.includes(targetText)) {
                element.scrollBy(0, 400);
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
    }, targetText);

    await page.waitForTimeout(400);
}

async function extractUrls(page) {
    return await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a')).map(anchor => anchor.href);
    });
}

async function scrapeDetails(page, url) {
    await page.goto(url);

    const address = await page.evaluate(() => {
        const element = document.evaluate('//*[@id="QA0Szd"]/div/div/div[1]/div[2]/div/div[1]/div/div/div[9]/div[3]/button/div/div[2]/div[1]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        return element?.innerText || '';
    });

    const title = await page.evaluate(() => {
        const element = document.evaluate('//*[@id="QA0Szd"]/div/div/div[1]/div[2]/div/div[1]/div/div/div[2]/div/div[1]/div[1]/h1', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        return element?.innerText || '';
    });

    const websiteElements = await page.$$('a[data-tooltip="Open website"], a[data-tooltip="Open menu link"]');
    const website = websiteElements.length > 0 ? await websiteElements[0].evaluate(el => el.href) : '';

    const phoneElements = await page.$$('button[data-tooltip="Copy phone number"]');
    const phone = phoneElements.length > 0 ? await phoneElements[0].evaluate(el => el.textContent) : '';

    return { title, address, website, phone };
}

async function writeFiles(records) {
    // Write CSV
    const csvPath = path.join(__dirname, 'output2.csv');
    const writer = csvWriter({
        path: csvPath,
        header: [
            { id: 'title', title: 'Title' },
            { id: 'address', title: 'Address' },
            { id: 'website', title: 'Website' },
            { id: 'phone', title: 'Phone' }
        ]
    });
    await writer.writeRecords(records);
    console.log(`CSV saved to ${csvPath}`);

    // Write JSON
    const jsonPath = path.join(__dirname, 'output2.json');
    fs.writeFileSync(jsonPath, JSON.stringify(records, null, 2));
    console.log(`JSON saved to ${jsonPath}`);
}

async function processBatch(batch, page) {
    const batchRecords = [];
    for (const url of batch) {
        const details = await scrapeDetails(page, url);
        console.log(`Scraped: ${details.title}`);
        batchRecords.push(details);
    }
    return batchRecords;
}

(async () => {
    const browser = await launchBrowser();
    const page = await browser.newPage();
    
    // Construct dynamic URL
    const searchQuery = `${encodeURIComponent(place)}+in+${encodeURIComponent(area)}`;
    await page.goto(`https://www.google.com/maps/search/${searchQuery}`);

    await handleCookieConsent(page);

    const targetText = "You've reached the end of the list.";
    await scrollToEnd(page, targetText);

    const urls = await extractUrls(page);
    console.log(`Found ${urls.length} listings`);

    const allRecords = [];
    const numBatches = Math.ceil(urls.length / batchSize);

    for (let i = 0; i < numBatches; i++) {
        const batch = urls.slice(i * batchSize, (i + 1) * batchSize);
        const batchRecords = await processBatch(batch, page);
        allRecords.push(...batchRecords);
        console.log(`Processed batch ${i + 1}/${numBatches}`);
    }

    await writeFiles(allRecords);
    await browser.close();
})();